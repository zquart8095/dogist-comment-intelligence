# Dogist Comment Intelligence Pipeline

Technical reference for how the @thedogist Instagram comment corpus is collected, processed,
and turned into the Audience Intelligence scrollytelling report. Written as source material for
a portfolio case study — every number and mechanism below is verified against the actual code
and committed data files in this repo, not just design docs.

## Why this exists

The Dogist (290k+ Instagram followers) is launching **Vitality Chew** — a blueberry-and-
pomegranate antioxidant dog supplement, salmon-flavored, Fall 2026. Rather than write generic
supplement-brand ad copy, the goal was to find out what real dog owners already say about their
dogs' diet and feeding, in their own words, on The Dogist's own posts — then generate ad
messaging grounded in that language instead of invented positioning.

## The funnel

| Stage | Count | What it is |
|---|---:|---|
| Comments collected | **97,579** | Full @thedogist corpus across 370 posts |
| Diet-relevant subset | **7,293** | Keyword-filtered + engagement-scored comments about food/diet/feeding |
| Pain-point signals | **912** | Comments that state a clear problem and/or want about diet |
| Distinct themes | **31** | Signals clustered into named problem/want pairs |
| Themes carried to ad angles | **10** | Top themes by signal volume, each given 6 ad angles |

Every number above is read directly from committed pipeline output (`diet-analysis.json`,
`pain-point-angles.json`, `angle-messages.json`) — nothing here is an estimate.

## Stage 1 — Collection: the Blackhole Collector

`collector/` is a load-unpacked Chrome extension that runs inside a normal,
logged-in Instagram browser session.

**Why DOM scraping instead of API interception.** The collector reads the *rendered page*
(`document.querySelector` against `article`, `time[datetime]`, `span[dir="auto"]`,
`a[href*="/c/"]`, comment `<li>` rows) rather than intercepting Instagram's private GraphQL
endpoints. That's a deliberate trade: slower than hooking network responses, but it doesn't
break every time Instagram rotates its internal API schema, and it uses structural selectors
(element roles, attribute patterns) instead of Instagram's frequently-changing CSS class names.

**Capture flow, per post:**
1. Click Instagram's native "View all N comments" control (retried 3–4×).
2. Locate the actual scrollable comment container and scroll it repeatedly, watching DOM growth
   and scroll position until both stop changing (`captureCommentsExhaustively`).
3. Stream newly-seen comments back to the extension's background worker as incremental batches
   — the run doesn't wait for full exhaustion before persisting data, so a killed tab or a
   Chrome crash mid-post doesn't lose already-captured comments.
4. Detect and short-circuit on login walls, challenge screens, or missing post markup
   (`detectLimitation`) rather than silently returning empty data.

**Resilience.** State is checkpointed in Chrome storage after every discovered post, comment
batch, raw post record, and event. A run can be stopped and resumed later from the same
checkpoint; partial posts are retried after queued posts are attempted. Every post also gets
scrape-quality telemetry — displayed comment count vs. captured comment count, a
`capture_rate_estimate`, and a `stop_reason`/`exhaustion_reason` — because Instagram sometimes
displays a comment count that includes surfaces the logged-in web client can't actually reach,
so a capture rate under 100% isn't automatically a scraper bug.

**Output.** A split export (manifest + NDJSON files for posts, comments, raw post records, and
events) that a local Node script, `pipeline/dogist-process.mjs`, normalizes into
`comment-analysis-import.json` — the single input file every downstream analysis stage reads.

## Stage 2 — Local reduction (no LLM yet)

Before any Claude call, three local/deterministic passes reduce the raw corpus to something an
LLM can afford to read.

**`dogist-opportunity-analyze.mjs`** — first-pass reduction, entirely local:
- A custom from-scratch **TF-IDF + k-means** implementation (sparse vectors, cosine similarity,
  8–9 iterations) run twice — once over all comments (24 topics), once over a high-signal
  subset only (18 topics) — to keep generic affection comments ("cute!", "omg") from drowning
  out business-relevant language.
- A `high_signal` scoring heuristic applied to every comment: `log2(likes+1)×1.4` (capped at 10)
  plus bonuses for length, question marks, first-person pronouns, intent verbs (need/want/buy/
  afford), and topic-keyword matches, minus a penalty for generic short comments. A comment
  counts as high-signal if its score is ≥4 **or** it has ≥8 likes. This exact formula is reused
  verbatim in every later filtering stage.
- Nine hand-authored keyword-bucket topics (food/treat/supplement trust, health/senior care,
  grief/loss, rescue/adoption, services/cost, IRL community, travel, commerce, behavior) as a
  simpler, auditable complement to the k-means clusters.

**`dogist-event-resonance.mjs`** — tests whether real-world events (e.g. a Knicks NBA Finals
win, a viral dog-death news story) produced a measurable spike in comment volume/language on
nearby posts, scored against a same-cluster post baseline. Explicitly labeled in its own output
as "evidence triage, not causal proof."

**`dogist-cultural-discovery.py`** — a second, independent discovery pass using actual sentence
embeddings (`paraphrase-multilingual-MiniLM-L12-v2`) and **BERTopic** (UMAP dimensionality
reduction → HDBSCAN clustering → c-TF-IDF term extraction), plus rule-based affect tagging
(grief, celebration, gratitude, food-routine, etc.), author-concentration risk flags (is a
cluster driven by one prolific commenter?), and emoji-motif analysis — all without an LLM. This
runs independently of the hand-authored keyword buckets above, as a check on whether the
manually-defined topics match what unsupervised clustering actually finds in the data.

## Stage 3 — Claude interpretation of the local clusters

Two parallel interpretation passes, each reading the *compacted evidence packets* from Stage 2
rather than raw comments:

- **`dogist-claude-interpret.mjs`** interprets the keyword-bucket packets with an explicit
  two-pass design: a context-free read (what does this evidence say with no business framing),
  then a business-context read that's fed the first pass's output plus the actual launch
  briefing, to produce `supplement_relevance` (direct/adjacent/indirect/none), messaging angles,
  and objections to pre-empt.
- **`dogist-cultural-interpret.mjs`** interprets the BERTopic-discovered packets with a single,
  strictly descriptive pass — no business framing injected — producing an observed pattern, a
  candidate cultural meaning, confidence tier, and explicit counterevidence/unsupported-claims
  fields. The prompt is constrained to "label and audit," not invent findings outside the
  packet.

Both stages use **Claude Haiku 4.5**. Separating a context-free read from a business-context
read is intentional: it surfaces what the audience is actually saying organically versus what
only becomes "relevant" once the launch lens is applied — so a business framing never gets
mistaken for an organic finding.

## Stage 4 — The diet pain-point pipeline

This is the stage that feeds the ad-angle output and the scrollytelling report.

**`dogist-diet-analysis.mjs`** filters the 97,579-comment corpus down to **7,293** diet-relevant
comments via keyword substring matching (39 food/diet/feeding terms) combined with the same
high-signal scoring formula from Stage 2. The filtered comments are batched (150/batch, 49
batches) and sent to Claude Haiku with 5 concurrent workers to extract feeding-behavior
attributes and genuine opposing-position tensions, then reduced in two synthesis passes (Haiku
→ Claude Sonnet) into 10–16 final attributes and 4–7 tensions.

**`dogist-pain-point-angles.mjs`** — the core signal-extraction and clustering stage:
- Runs the same 49-batch extraction over the same 7,293 comments, but asks Claude to extract a
  **signal** only where a comment clearly states a problem and/or a want about diet/feeding —
  skipping pure affection or chatter. Result: **912 signals**.
- A key anti-hallucination design: the model never has to reproduce a comment's quote text. It
  returns a `comment_index` reference; the actual quote, likes, and comment ID are swapped in
  afterward from the source corpus. No later stage ever re-types or re-derives quote text from
  model output, so nothing downstream can paraphrase, "improve," or fabricate a quote.
- Clustering the 912 signals into themes is **Claude-driven, not embedding-based**: the signals
  are split into 8 groups, each group is independently clustered into candidate themes by Haiku,
  then all candidate themes from all 8 groups are merged and deduplicated in one final pass by
  Claude Sonnet. The prompt deliberately avoids forcing a target count ("typically lands around
  15–30 for a corpus this size, but go with what's real") — the actual result is **31 themes**.
- Six ad angles are then generated per theme (all 31, not just the top 10) by Claude Sonnet,
  grounded in that theme's top-6-by-likes real quotes plus the product brief and brand voice
  profile.
- **Resilience:** two gitignored checkpoint files let a full run resume without re-running the
  49 batches if interrupted; both are deleted automatically on a clean completed run. A
  hand-rolled JSON-array salvage routine recovers whichever elements parsed successfully out of
  a response truncated by a token limit, instead of discarding the whole batch.

**`dogist-angle-messages.mjs`** takes the top 10 of the 31 themes by signal volume and, one
Claude Sonnet call per theme, produces the final structured ad angles used in the report:

Six angle types, each built on a named direct-response hook formula:

| Angle type | Hook formula |
|---|---|
| Pain-based | "Why Your [Thing] Isn't Working" |
| Desire-based | "The [Adjective] Way To [Outcome]" |
| Problem/solution | "Stop [X]. Do [Y] Instead." |
| Social proof | "I [Read/Watched] [Number] [Thing]" — must cite the theme's real signal count |
| Curiosity | "Why [X] Actually [Y] — It's Not What You Think" |
| Niche-specific | "If You [X], [Y]" |

Every angle has the same five-part structure — **Hook → Explanation → Solution → Social
Proof/USP → CTA** — plus supporting metadata: 2–3 real phrases borrowed from audience comments
(each linked back to its source comment and like count), claims to avoid for that specific
theme, and a suggested validation post to test the angle before spending on it. One guardrail
is hardcoded into every prompt: the stated *problem* for a theme is always about balanced
nutrition/variety, never narrowed to a single rejected ingredient — since the specific
ingredient (blueberry) belongs to the *solution*, and folding it into the problem statement
would be circular reasoning.

## Stage 5 — Output surface

`pain-point-angles.json` and `angle-messages.json` feed a single scrollytelling report (`/`) —
a section-by-section narrative page walking through the funnel, the ad-angle framework, and the
theme/angle results, built for a non-technical stakeholder read. It reads those files directly
at build time; nothing is generated at view time and no client-side fetching is involved.

## Design principles worth calling out in a case study

- **Local reduction before any LLM call.** TF-IDF/k-means and BERTopic do the expensive,
  cheap-to-compute clustering; Claude is only ever shown compacted evidence packets, never the
  raw 97k-comment corpus.
- **Every quote is traceable.** No comment quote is ever generated or paraphrased by a model —
  quotes are looked up by stable reference back to the original captured comment, all the way
  through signal extraction, theme clustering, and final ad-angle generation.
- **Organic vs. business-lens findings are kept separate.** The context-free/business-context
  two-pass pattern (Stage 3) exists specifically so a launch-motivated interpretation is never
  presented as something the audience said unprompted.
- **Cheap models for volume, stronger models for synthesis.** High-volume, low-complexity batch
  extraction runs on Haiku; theme deduplication and final ad-angle writing — the steps where
  quality compounds — run on Sonnet.
- **Everything is resumable.** Both the browser collector and the multi-hour Claude batch
  pipeline checkpoint their progress and can pick back up after an interruption without
  reprocessing already-done work.
