# Dogist Comment Intelligence — Technical Design

**Author:** Zach Quart · **Status:** Shipped, in production use
**Repo paths referenced:** `collector/`, `pipeline/dogist-*.mjs`, `pipeline/dogist-cultural-discovery.py`, `data/`

---

## 1. Problem & Constraints

Turn an unstructured, 97,579-comment Instagram corpus (370 posts, no API access to Instagram's
private endpoints) into a small set of business-usable, fully-sourced ad angles for a product
launch — without an LLM ever fabricating a customer quote, and without burning API spend reading
raw comments end-to-end.

Hard constraints that shaped every downstream decision:

- **No official API.** Instagram's public Graph API doesn't expose another account's comment
  history. Any collection approach has to work against the logged-in web client, which means it's
  inherently more fragile than a documented API and has to be engineered for that fragility, not
  around it.
- **Volume vs. LLM cost.** 97,579 comments is roughly 3–5M tokens of raw text. Sending that
  straight to a frontier model, per analysis pass, is both expensive and a bad way to get reliable
  structure — LLMs are worse at exhaustive extraction over huge unstructured context than at
  labeling and synthesizing already-reduced evidence.
- **Trust.** Every quote that reaches a marketer has to be a real comment. An LLM that can
  paraphrase or invent a "close enough" quote is a liability in an ad-review process, not a
  convenience.
- **Interpretability under a business lens.** The client's launch thesis (a blueberry supplement)
  can bias what gets called "relevant" in the data. The system needed to keep organic audience
  signal and business-motivated interpretation from bleeding into each other.

## 2. Goals & Non-Goals

**Goals**
- Deterministic, resumable data collection from a real (non-API) web surface.
- Cheap, local-first reduction of the corpus before any model call.
- Zero-hallucination guarantee on every customer quote that reaches an output surface.
- A cost structure where the full pipeline runs for tens of dollars, not thousands.
- Reusable pipeline — same architecture should work on the next corpus, not just this one.

**Non-goals**
- Real-time or streaming analysis. This is a batch pipeline over a point-in-time snapshot.
- A general-purpose social-listening product. Every stage is tuned for this corpus and this
  launch's decision needs, not productized for arbitrary brands.
- Perfect capture. The collector is instrumented to *measure* capture rate, not guarantee 100%
  (see §4.1) — Instagram's displayed comment counts include content the logged-in web client
  can't always reach.

## 3. System Architecture

```
Instagram (logged-in web session)
        │
        ▼
[1] Blackhole Collector (Chrome extension, DOM-based)
        │  manifest + NDJSON export
        ▼
[2] dogist-process.mjs  →  comment-analysis-import.json   (single source of truth)
        │
        ├─► [3a] dogist-opportunity-analyze.mjs   — TF-IDF + k-means, keyword buckets  (local, no LLM)
        ├─► [3b] dogist-event-resonance.mjs       — event-spike detection              (local, no LLM)
        └─► [3c] dogist-cultural-discovery.py     — sentence embeddings + BERTopic      (local, no LLM)
        │
        ├─► [4a] dogist-claude-interpret.mjs      — interprets [3a] packets   (Haiku → Sonnet, 2-pass)
        └─► [4b] dogist-cultural-interpret.mjs     — interprets [3c] packets   (Haiku, descriptive-only)
        │
        ▼
[5] dogist-diet-analysis.mjs      — keyword+signal filter: 97,579 → 7,293 comments
        ▼
[6] dogist-pain-point-angles.mjs  — batched extraction + Claude-driven clustering → 912 signals → 31 themes
        ▼
[7] dogist-angle-messages.mjs     — top-10 themes × 6 codified angle types → 60 structured ad angles
        ▼
[8] Scrollytelling report (Next.js) — reads [6] and [7]'s output directly, no client-side fetching
```

Every arrow is a **file boundary**, not a function call — each stage reads a committed/versioned
JSON (or JSONL) artifact and writes another one. That's a deliberate architectural choice: it
makes every stage independently re-runnable, independently testable, and independently
inspectable without re-running anything upstream.

## 4. Key Design Decisions

### 4.1 DOM scraping over GraphQL interception, with measured (not assumed) completeness

The collector reads the rendered page (`article`, `time[datetime]`, `span[dir="auto"]`,
comment `<li>` rows) instead of intercepting Instagram's internal GraphQL responses.

**Trade-off taken deliberately:** DOM scraping is slower and more brittle to markup changes than
hooking network responses. But it doesn't break every time Instagram rotates a private API schema
or GraphQL persisted-query hash, and it can target structural selectors (roles, attributes)
instead of frequently-rotated CSS class names. GraphQL interception would be faster to build once
and faster to run, but has a shorter half-life against a platform actively fighting scraping.

**What made this defensible in production:** every post also gets scrape-quality telemetry —
displayed count vs. captured count, a `capture_rate_estimate`, and a `stop_reason` /
`exhaustion_reason`. That turns "did this actually work?" from a guess into a measured field on
every record, which matters because Instagram's own displayed count sometimes includes comments
the logged-in web client structurally can't reach — so a sub-100% capture rate is expected
telemetry, not automatically a bug to chase.

### 4.2 Resilience as a first-class design constraint, not a retry wrapper

Two failure domains needed independent resilience strategies, and treating them the same would
have been wrong for both:

- **The browser collector** runs for hours against a UI that can crash the tab, hit a login wall,
  or throw a challenge screen mid-run. State is checkpointed to Chrome storage after every
  discovered post, comment batch, and event — not batched at the end — specifically so a killed
  tab doesn't lose already-captured data. A resumed run retries only queued/partial posts.
- **The Claude batch pipeline** (49 batches × 150 comments, run with 5 concurrent workers) fails
  differently: a truncated response (`stop_reason: max_tokens`) or a transient API error, not a
  crashed process. For this, I wrote a hand-rolled brace-matching salvage routine
  (`salvageArrayField`, `pipeline/dogist-angle-messages.mjs:130`) that walks a truncated JSON
  response character-by-character, tracking string/escape state and brace depth, and recovers
  every *complete* array element instead of discarding the whole batch response over one
  incomplete trailing item. Two gitignored checkpoint files let a full pipeline run resume without
  re-running already-completed batches; both are deleted automatically on a clean finish.

### 4.3 Local reduction before any LLM call — and running it two independent ways

Before Claude ever sees the corpus, two *independent* unsupervised passes reduce it:

- A from-scratch **TF-IDF + k-means** implementation (sparse vectors, cosine similarity, 8–9
  iterations), run twice at different granularities — once over the whole corpus, once over a
  high-signal subset only, so generic affection comments ("cute!", "omg") don't drown out
  business-relevant language in the same clusters.
- A second, methodologically unrelated pass using real sentence embeddings
  (`paraphrase-multilingual-MiniLM-L12-v2`) through **BERTopic** (UMAP → HDBSCAN → c-TF-IDF), plus
  rule-based affect tagging and author-concentration risk flagging (is a cluster actually one
  prolific commenter, not a real pattern?).

**Why run two unrelated clustering methods instead of picking one:** the hand-authored
keyword-bucket topics from the first pass are auditable but can only find what a human already
thought to look for. Running BERTopic independently is a check on that blind spot — if the
unsupervised, embedding-based pass surfaces the same structure the keyword buckets did, that's
real signal validating the manual categories; if it surfaces something the keyword buckets missed,
that's new signal the hand-authored approach couldn't have found. Neither pass is trusted as
ground truth alone.

A `high_signal` heuristic (`log2(likes+1)×1.4`, capped at 10, plus bonuses for length, question
marks, first-person pronouns, and intent verbs like need/want/buy/afford, minus a penalty for
generic short comments; signal if score ≥4 **or** likes ≥8) is computed once and reused verbatim
across every later filtering stage, so "what counts as worth reading" doesn't silently drift
between pipeline stages.

### 4.4 Claude only ever sees compacted evidence packets — never raw comments end-to-end

All four LLM stages (opportunity interpretation, cultural interpretation, diet-pain-point
extraction, angle writing) read reduced output from a local stage, never the raw corpus. This is
both a cost decision and an accuracy decision: LLMs are meaningfully better at labeling,
synthesizing, and writing against a compact, already-structured packet than at needle-in-haystack
extraction over tens of thousands of raw records in one context.

### 4.5 Reference-based quotes: the model never generates the string it's quoting

This is the core anti-hallucination guarantee, and it's enforced at the interface level, not by
prompt instruction alone. During signal extraction, the model returns a `comment_index` — a
pointer into the batch it was given — never the comment text itself. The actual quote, like count,
and comment ID are looked up from the source corpus *in code, after* the model call
(`pipeline/dogist-angle-messages.mjs:303-309` does the same lookup pattern at the angle-writing
stage). Because the model's output schema has no field where quote text *can* live, there's no
downstream step where a paraphrase, "improvement," or fabrication could enter the chain — the
constraint is structural, not just a prompt asking nicely for accuracy.

### 4.6 Theme clustering is Claude-driven, not embedding-based — and that's a deliberate reversal

Stage 2 clustering (posts, comments) uses classic unsupervised methods (TF-IDF/k-means, BERTopic).
Stage 6's clustering of the 912 extracted pain-point *signals* into themes does not — it's Claude
Haiku clustering 8 independent groups into candidate themes, then Claude Sonnet merging and
deduplicating across all 8 groups' candidates into a final set.

**Why the reversal:** by this stage the input is no longer raw text needing topic discovery —
it's 912 already-extracted (problem, want) pairs, where "similar enough to merge" is a semantic
judgment ("picky eating" and "won't touch vegetables" are the same underlying theme) that
embedding-distance clustering handles less reliably than an LLM reading the actual pairs. The
prompt deliberately avoids forcing a target cluster count ("typically lands around 15–30 for a
corpus this size, but go with what's real") — the actual output was 31, not a number picked in
advance.

### 4.7 Two-pass interpretation to separate organic signal from business framing

`dogist-claude-interpret.mjs` runs a **context-free pass first** (what does this evidence say with
no business framing at all) and only then a **business-context pass**, fed the first pass's output
plus the actual launch brief. This ordering is the whole point: it guarantees the system can state
what the audience organically said *before* it's told what the business wants to hear, so a
launch-motivated interpretation never gets presented as something the audience said unprompted.
`dogist-cultural-interpret.mjs` (interpreting the independent BERTopic packets) skips the
business-context pass entirely and stays strictly descriptive — "label and audit," with explicit
counterevidence/unsupported-claims fields — since that pass exists specifically as a check against
business-lens bias in the other track, not another lens on top of it.

### 4.8 Ad-angle generation as a schema-constrained fill-in, not open-ended writing

The six ad-angle types (pain-based, desire-based, problem/solution, social proof, curiosity,
niche-specific) are hard-coded config (`ANGLE_TYPES`, `pipeline/dogist-angle-messages.mjs:40-107`),
each carrying a hook formula, a fill-in-the-blank pattern, a worked example, and the psychological
rationale for why it works. That config is rendered verbatim into the prompt as the model's output
spec — the model's task is filling a proven structure with real audience language, not deciding
from scratch what a good ad angle is. A known bad pattern discovered during manual review (the
model conflating "the problem" and "the solution" when they shared an ingredient — circular
reasoning) is now a standing, hard-coded rule in the prompt, not a one-off correction. Output is
constrained to a strict JSON contract (exactly one angle per type, in a fixed order, five
structural fields each) rather than free text, which is what makes the downstream quote-lookup
substitution in §4.5 possible in the first place.

### 4.9 Model tiering by where quality compounds

Every stage picks between Claude Haiku and Claude Sonnet on one axis: does an error here get
fixed downstream, or does it propagate? High-volume, single-batch extraction (turning one batch of
150 comments into structured signals) runs on Haiku — errors here are diluted across 49 batches
and caught at the clustering stage. Theme deduplication and final ad-angle writing run on Sonnet —
these are the steps a marketer reads directly, where a bad merge or a weak hook has no downstream
stage to correct it.

## 5. Data Model

```
comment-analysis-import.json        (normalized: videos[], comments[], derived fields)
        │
        ▼
diet-analysis.json                  (7,293 filtered comments + 10–16 feeding attributes + 4–7 tensions)
        │
        ▼
pain-point-angles.json              themes: [{ id, label, problem_statement, want_statement,
        │                                       emotional_triggers[], count_estimate,
        │                                       signal_strength, representative_quotes[] }]
        ▼
angle-messages.json                 top-10 themes, each + angles: [{ angle_type, hook_formula_used,
                                       hook, explanation, solution, social_proof_usp, cta,
                                       language_to_borrow[], claims_to_avoid[], validation_prompt }]
```

`representative_quotes` and `language_to_borrow` entries always carry `{ text, likes, post_url,
source_comment_id }` populated by the code-level lookup in §4.5 — never by the model.

## 6. Cost & Model Selection

| Model | Used for | Rate (per MTok, standard) |
|---|---|---|
| Claude Haiku 4.5 | Batch signal extraction, cheap packet labeling, per-group theme clustering | $1 / $5 |
| Claude Sonnet 4.6 | Theme deduplication, final ad-angle writing, business-context interpretation | $3 / $15 |

Batch sizing (150 comments/batch, 49 batches, 5 concurrent workers) and the reduce-before-reason
architecture (§4.4) keep every LLM call's input to a compacted packet, not raw corpus text — full
pipeline API spend lands in the tens of dollars, not the thousands a naive "send everything to a
frontier model" approach would cost.

## 7. Testing & Validation

Node's built-in test runner (`node --test`) — no external test framework dependency — split into
two tiers:

- `npm test` (`test:unit`) — `dogist-collector-state.test.mjs`, the checkpoint/resume state
  machine (§4.2). Self-contained, runs on a fresh clone with no local data.
- `npm run test:corpus` — `dogist-event-resonance.test.mjs` and `dogist-cultural-discovery.test.mjs`,
  integration tests that assert against the real corpus snapshot, which is excluded from this repo
  (see the README) since it's third-party personal data, not shipped code.

Beyond unit tests, the pipeline's core trust guarantee (§4.5) is validated structurally, not by
inspection: because the schema has no field for model-generated quote text, there is no code path
by which an untested change could introduce a fabricated quote without also breaking the
`comment_index` → source lookup, which is exercised on every pipeline run.

## 8. Limitations & Future Work

- **Snapshot, not live.** The corpus is a fixed point-in-time export (2026-06-21); a recurring
  pipeline would need incremental collection and re-clustering against a growing corpus, not a
  full re-run.
- **English-language tuning.** Keyword buckets and the high-signal heuristic are tuned for English
  comments; the BERTopic pass uses a multilingual embedding model but downstream Claude
  interpretation is not currently validated on non-English signal.
- **Single-brand angle framework.** The six angle types and hook formulas were designed against
  this launch and this brand voice; generalizing to a second brand would mean making the
  angle-type config (§4.8) a per-brand input rather than hard-coded constants.
