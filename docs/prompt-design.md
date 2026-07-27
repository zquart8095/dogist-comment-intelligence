# Prompt Design

How the Claude prompts in this pipeline are constructed, and why. Every prompt quoted below is
verbatim from the code in `pipeline/`, not a paraphrase.

The pipeline's leverage isn't the model — it's what gets handed to the model. Two things are
encoded into every generation prompt: **domain expertise the model doesn't have**, and
**structural constraints that make the output verifiable**.

## Part 1 — Encoding the performance-marketing expertise

A prompt that says "write a pain-based ad" gets a generic pain-based ad. The direct-response
research that preceded this build was codified into a data structure the prompt renders from,
rather than prose instructions written inline.

### The six angle types

Each type is defined with four fields (`pipeline/dogist-angle-messages.mjs:40`):

| Field | Purpose |
|---|---|
| `hook_formula` | The named direct-response pattern |
| `hook_pattern` | The formula as a fill-in template |
| `hook_worked_example` | A concrete example written for this specific product |
| `hook_why_it_works` | The persuasion mechanic underneath it |

| Angle type | Hook formula |
|---|---|
| Pain-based | "Why Your [Thing] Isn't Working" — Problem Identification + Authority |
| Desire-based | "The [Adjective] Way To [Outcome]" — Method + Promise |
| Problem / Solution | "Stop [X]. Do [Y] Instead." — Corrective + Actionable |
| Social proof | "I [Read/Watched] [Number] [Thing]" — Research + Synthesis |
| Curiosity / Pattern interrupt | "Why [X] Actually [Y] — It's Not What You Think" — Behind-the-scenes + Truth |
| Niche-specific | "If You [X], [Y]" — Pattern Interrupt + Authority |

**`hook_why_it_works` does the heavy lifting.** Giving the model the mechanic rather than just the
shape is what lets it adapt a formula to a theme it has never seen instead of pattern-matching the
example. The pain-based entry reads:

> Addresses a frustration they already have and promises a non-obvious diagnosis — reframes
> something they've written off as "my dog is just difficult" into something explainable.

Every worked example ships with an explicit instruction not to reuse it: *"ANGLE TYPES, THEIR HOOK
FORMULA, AND A WORKED EXAMPLE (write your own, grounded in the real quotes — do not just reuse the
worked example)."*

### The five-part structure

Each of the six angles is broken into five parts rather than written as one flowing block, and each
part carries a real media-buying constraint (`dogist-angle-messages.mjs:237-241`):

| Part | Constraint in the prompt |
|---|---|
| `hook` | 1 sentence, ideally under 15 words. Must land *before* any product is mentioned — no brand name, no product name, not even the word "chew" |
| `explanation` | 1–2 sentences — why this matters, what's really going on |
| `solution` | 1–2 sentences — the first place the product or brand is allowed to appear |
| `social_proof_usp` | 1 sentence — credibility from a real audience pattern, ingredient fact, or timing reason, "not generic hype" |
| `cta` | Conversion-focused (shop / get yours / try it), phrased to echo *this* hook's emotional payoff. Explicitly not engagement bait — "not 'comment below,' not 'tag a friend'" |

The CTA rule is the sharpest of these: *"every cta should read like it belongs to exactly this angle
and no other."* It exists because the default failure mode of LLM ad copy is six different hooks
converging on one interchangeable closing line.

There's a matching instruction at the top: the six messages *"must feel meaningfully different in
structure and tone — not the same line six times with a different label."*

## Part 2 — Prompt construction techniques

### Reference, never reproduce

The extraction prompt asks for a `comment_index`, not quote text. The real text, like count, and
post URL are swapped in from the corpus afterward (`dogist-pain-point-angles.mjs:302`):

```js
const comment = batchComments[s.comment_index - 1];
if (!comment) continue; // hallucinated/out-of-range index — drop rather than mis-attribute
```

An index the model got wrong causes the signal to be **dropped**, not silently attached to the
wrong comment. The quote stored is `comment.text` — the real, full comment — never the model's
excerpt of it.

This is the whole no-fabricated-quotes guarantee, and it's enforced by data flow rather than by
asking the model nicely. No later stage ever re-types quote text, so no later stage can paraphrase,
"improve," or invent one.

### Hand the model the smallest decision that still needs judgment

The final theme-merge pass sees only candidate theme *summaries* and their IDs — never the 912
underlying signals. Each final theme's signal list is then computed in code as the union of its
merged candidates' lists (`dogist-pain-point-angles.mjs:388`):

> Final merge only decides which CANDIDATE THEMES (not individual signals) belong together — the
> full signal_ids list per final theme is computed in code as the union of its merged candidates',
> so a long list here never risks the model dropping or mistyping an id.

Where IDs *are* passed through, the instruction is exact: *"signal_ids must be copied exactly
(character-for-character) from the signal_id fields above — do not alter, abbreviate, or invent
ids."* Paired with: *"Every candidate_id from the list above must appear in exactly one final
theme's source_candidate_ids — do not drop any, do not duplicate one across two final themes."*

### Don't force a count

```
Let the number of final themes be whatever the data actually supports — do not force a fixed
count. Typically this lands somewhere around 15-30 for a corpus this size, but go with what's
real.
```

Naming a target number produces that number. Giving a range as *calibration* while explicitly
disowning it as a target gets an honest one. The actual result was **31** — just outside the stated
range, which is the evidence the instruction worked.

### Guard the specific failure mode you can predict

The angle prompt carries a hardcoded block (`dogist-angle-messages.mjs:233`) correcting one
circular-reasoning trap, worth quoting in full because it's the clearest example of domain
knowledge that no amount of general capability substitutes for:

> **IMPORTANT — WHAT THE PROBLEM ACTUALLY IS**
>
> The problem is NOT "the dog won't eat [one specific ingredient]." The problem is that the dog
> rejects a balanced, nutrient-varied diet — a specific ingredient is just one example the audience
> happens to mention. Vitality's blueberry/pomegranate antioxidants are part of the SOLUTION,
> delivered in a salmon-flavored chew specifically so the dog doesn't have to eat produce directly.
> Never frame the hook or problem around "won't eat [ingredient]" — that's circular (the reader
> immediately thinks "so don't make me feed that"). Frame the problem as the real thing underneath
> it: getting a picky dog real nutrition without a fight.

Without this, the corpus leads the model straight into the trap: the single most common complaint in
the data is dogs refusing fruits and vegetables, and the product's headline ingredient is blueberry.
The obvious synthesis — "your dog won't eat blueberries, so here's a blueberry chew" — is an ad that
argues against itself.

### Separate universal constraints from per-item ones

Trust constraints and brand guardrails are injected once and enforced globally. The per-angle
`claims_to_avoid` field then explicitly instructs the model not to restate them:

> "1-2 items specific to THIS theme + angle type — do not repeat the universal trust constraints
> listed above, those are already enforced separately"

Without that clause the field fills up with the same five global constraints on all 60 angles and
carries no information.

### Load constraints from data, not from the prompt string

Nothing brand- or product-specific is hardcoded in the prompt text. It renders from two committed
files:

**`product/brief.json`** — positioning, ingredients and their roles, the six supportable claims
(`healthy_aging`, `brain_health`, `joint_support`, `daily_vitality`, `ingredient_transparency`,
`palatability`), brand guardrails, and five trust constraints:

- Do not imply the chew prevents disease, cures medical conditions, or extends lifespan.
- Do not use grief, rescue, or senior-dog stories as direct purchase hooks without extra care.
- Do not frame the product as a substitute for veterinary guidance.
- Do not overstate the comment corpus as validated demand.
- Do not write generic superfood copy that could come from any pet brand.

**`product/voice.json`** — a voice profile inferred from all 370 post captions, split into
`do_rules`, `avoid_rules`, and `tone_markers`:

> Start from a real dog, routine, or owner question. · Use product language only after the care
> moment is clear. · Make uncertainty and validation feel honest. · Borrow audience words only when
> the evidence source is attached.

The file carries its own scope note: *"It is used to shape angles, not to invent audience
evidence."* Changing what the brand may claim is a JSON edit, not a prompt edit.

### Never invent a number

The social-proof angle must cite the theme's real signal count. The instruction closes with the
reasoning rather than just the rule:

> Real sample size (use the theme's actual count, never invent a number) creates authority and
> promises a distilled, non-obvious pattern — and it's true, which is the whole point.

### Keep the organic read separate from the business read

The interpretation stage runs two prompts in sequence rather than one
(`pipeline/dogist-claude-interpret.mjs`).

**Pass 1 — context-free.** *"Read these comments as they are — no product or business context."*
Returns `signal_type`, `key_motivations`, `key_concerns`, and verbatim `authentic_language`. The
launch is never mentioned.

**Pass 2 — business context.** Receives the launch briefing *plus pass 1's own output as stated
findings*, then returns `supplement_relevance` (direct / adjacent / indirect / none),
`messaging_angles`, and `objections_to_address`.

Splitting them means a business-motivated reading can never be mistaken for something the audience
said unprompted — pass 1's answer is already fixed on the record before the commercial lens is
applied.

The parallel cultural pass (`dogist-cultural-interpret.mjs`) goes further and constrains the model
to auditing rather than concluding — *"Your job is to label and audit the reduced evidence. Do not
invent findings outside this packet"* — with two required output fields that exist purely to force
the model to argue against itself: `counterevidence_or_limits` and `unsupported_claims_to_avoid`.

### Match model to task, and expect the response to break

Haiku 4.5 runs the 49 high-volume extraction batches (150 comments each, 5 concurrent). Sonnet 4.6
handles theme deduplication and angle writing — the steps where quality compounds.

Every call demands JSON-only output (*"Return ONLY valid JSON. No markdown."*), retries 3× with
linear backoff, and on a `max_tokens` stop reason runs a hand-rolled salvage routine
(`dogist-angle-messages.mjs:176`) that walks the truncated response brace-by-brace and recovers
whichever array elements parsed cleanly — rather than discarding a batch of 150 comments because the
last object was cut in half.

## Summary

| Technique | What it prevents |
|---|---|
| Index references instead of quote text | Fabricated or paraphrased quotes |
| Drop on out-of-range index | Quotes attached to the wrong person |
| Merge candidates, union IDs in code | Dropped or mistyped IDs at scale |
| Range as calibration, not target | Theme counts that match the prompt instead of the data |
| Hardcoded circular-reasoning guard | The one wrong ad the corpus leads you toward |
| Universal vs. per-item constraints | 60 copies of the same five warnings |
| Constraints loaded from JSON | Prompt edits every time the brief changes |
| Context-free pass before business pass | Commercial framing read as organic finding |
| Required counterevidence fields | Confident overreach past the evidence |
| Truncation salvage | Losing 150 comments to one cut-off object |
