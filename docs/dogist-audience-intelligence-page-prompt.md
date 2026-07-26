# Prompt for Claude Design — Dogist Audience Intelligence scrollytelling page

Copy everything below the line into Claude Design.

---

Build a single-page, full-viewport scrollytelling site presenting a real audience research analysis. Each section is a full-height, vertically-centered "slide" that reveals itself as the user scrolls — think an editorial data-story (Pudding.cool / NYT-interactive style), not a dashboard. Smooth scroll-snap between sections. Subtle scroll-triggered reveals (fade/slide-up) for text and charts as each section enters view.

## Background — what this analysis is

The Dogist is a dog-content Instagram creator (290k+ followers) planning to launch **Vitality Chew** — a blueberry-and-pomegranate daily antioxidant dog supplement, salmon-flavored for palatability, launching Fall 2026. Before writing any launch marketing, we analyzed The Dogist's own audience — the actual comments left on their Instagram posts — to find out what real dog owners already say about their dogs' diet and nutrition, in their own words, and used that to generate grounded ad messaging rather than generic supplement-brand copy.

## Methodology (the funnel — this is Section 2's content)

1. **97,579** Instagram comments collected from @thedogist across 370 posts.
2. Filtered down to **7,293** comments that were topically relevant to dog diet, food, and feeding (keyword + engagement-signal filtering).
3. Of those, **912** comments contained a clearly stated problem the owner has, and/or something they want instead, regarding their dog's diet (e.g. "my dog won't eat vegetables" / "I want him to accept more variety") — every other diet-adjacent comment was on-topic but didn't express a specific pain point or desire, so it wasn't a usable signal.
4. Those 912 signals were clustered into **31 distinct pain-point/need themes** — each theme unifies a problem with the want that resolves it (e.g. "picky eating" problem = "wants food the dog will actually eat"), tagged with the dominant emotions behind it (frustration, guilt, hope, pride, etc.).
5. Ad angles were generated for the **top 10 themes** by comment volume.

Every step is grounded, not generative: no comment quote was ever paraphrased by AI — each one is pulled by a stable reference back to the original comment, so every quote shown anywhere on this page links to a real Instagram comment with its real like count.

## What is an "ad angle" (Section 3's content)

An ad angle is not what the product *is* — it's the specific psychological lens through which the same core offer is presented to spark interest, emotion, or action in one particular audience mindset. The same product can be framed as pain relief, an aspirational outcome, a plain problem/solution, social validation, an intriguing reveal, or a message to one very specific kind of owner — each version pulls a different reader in.

**We used 6 angle types, each built on a proven direct-response hook formula:**

1. **Pain-based** — *"Why Your [Thing] Isn't Working"* — names the real frustration directly, then reframes it with a non-obvious diagnosis.
2. **Desire-based** — *"The [Adjective] Way To [Outcome]"* — opens on the aspirational payoff itself, skips the pitch.
3. **Problem / Solution** — *"Stop [X]. Do [Y] Instead."* — corrective and blunt, no emotional framing.
4. **Social proof** — *"We Read [Number] Comments About [Topic]"* — real sample size from the actual corpus, not invented.
5. **Curiosity / Pattern interrupt** — *"Why [X] Actually [Y] — It's Not What You Think"* — a genuine, evidence-backed reframe of an assumption.
6. **Niche-specific** — *"If You [X], [Y]"* — speaks to one narrow, exact owner situation so precisely that only that person keeps reading.

**Every ad angle has the same 5-part structure:**

- **Hook** — one scroll-stopping sentence, under 15 words, before any product/brand mention. Must work standalone.
- **Explanation** — 1-2 sentences expanding on the hook: why this matters, what's really going on.
- **Solution** — 1-2 sentences introducing Vitality Chew as the response — the first place the product can appear.
- **Social proof / USP** — 1 sentence: why this is credible right now (a real audience pattern, an ingredient fact, or timing).
- **CTA** — a short, conversion-focused call to action (shop / get yours / see what's inside), phrased to echo that specific hook's payoff — never generic engagement bait.

Each angle also carries grounding/QA metadata that should be visible but visually secondary to the 5-part structure above:

- **Language to borrow** — 2-3 short real phrases lifted directly from audience comments, each linking out to the real comment (with its like count) it came from.
- **Claims to avoid** — 1-2 guardrails specific to this exact theme + angle combination (brand/trust constraints, not generic disclaimers).
- **Validation test** — one concrete next step: an actual Instagram post/content idea that would test this angle with the real audience before spending on it.

Important note on problem framing: the stated "problem" for each theme is always about the dog's *balanced nutrition/variety*, never narrowed to one specific ingredient (e.g. never "won't eat blueberries") — the specific ingredient belongs to the *solution*, and reducing the problem to it would be circular.

## Data shape available to you

Two JSON datasets back this page:

**`pain-point-angles.json`** — all 31 themes, each: `{ id, label, problem_statement, want_statement, emotional_triggers: string[], count_estimate, signal_strength: "high"|"medium"|"low", representative_quotes: [{ text, likes, post_url, post_title }] }` (use this for the Section 4 bar charts — sort by `count_estimate` for top/bottom 10).

**`angle-messages.json`** — the top 10 themes only, each carrying the same theme fields above plus `angles: []`, an array of exactly 6 objects: `{ angle_type, hook_formula_used, hook, explanation, solution, social_proof_usp, cta, language_to_borrow: [{ text, source_post_url, source_likes, why }], claims_to_avoid: string[], validation_prompt }` (use this for Section 5).

If live data isn't wired up yet, use realistic placeholder content that matches this exact shape and tone — dog-diet pain points, Dogist's warm/funny/dog-first voice, real-feeling but clearly-labeled-as-example quotes.

## Page structure

### Section 1 — Landing
Full-viewport, vertically centered. Title: "The Dogist Audience Intelligence Analysis". Below it: the date, and "Product: Vitality Chew". Keep it minimal and confident — this is the cover of a real research deck, not a marketing page. A subtle scroll-down affordance. Optionally, one quiet stat as a teaser (e.g. "97,579 comments analyzed") in a small mono/label style.

### Section 2 — Methodology
The funnel described above, told as a scroll-revealed sequence: as the user scrolls into this section, the five steps (97,579 → 7,293 → 912 → 31 → 10) reveal in order, each with its number large and its description small, ideally as a visual narrowing/funnel shape (a shrinking bar or a literal funnel silhouette) rather than a plain list — the shrinking-numbers visual IS the story of this section.

### Section 3 — What is an ad angle
The definition, then the 6 angle types as a grid of 6 cards (type name + hook formula + one-line description), then a simple labeled anatomy diagram of the 5-part structure (Hook → Explanation → Solution → Social Proof/USP → CTA) shown as a vertical or horizontal flow. Close with the "grounded, not generative" evidence-linking note.

### Section 4 — Theme results
A two-slide horizontal slideshow (click a right/left arrow to advance; the whole chart transitions horizontally):
- **Slide 1:** Horizontal bar chart, top 10 themes by `count_estimate`, bars color-coded by `signal_strength` (high/medium/low), theme label on each bar.
- **Slide 2:** Same chart style, bottom 10 themes.
Clicking or hovering a bar reveals that theme's `problem_statement` and `emotional_triggers` (as small chips) in a tooltip or side panel.

### Section 5 — Ad angle results
A slideshow over the top 10 themes (arrow navigation advances between themes). Each theme-slide shows:
- A compact header: theme label, problem/want statement, emotional-trigger chips, signal strength.
- **Within each theme, add a secondary control** (tabs or small pills, one per angle type) to switch between that theme's 6 angles without leaving the slide — each theme has 6 full ad angles, not one, so this sub-navigation is necessary.
- The selected angle rendered in the 5-part structure, with **Hook** treated as the visual hero of the card (largest type, first thing read) — it should genuinely read like a real ad opener, not a caption. Explanation → Solution → Social Proof/USP → CTA follow in a clear reading order, with the CTA styled as a real button.
- Below the 5-part structure, in a visually secondary/supporting area: Language to borrow (each phrase linking to its real source comment + like count), Claims to avoid, Validation test.

## Tone & aesthetic direction

Editorial and credible — this is presenting real research to a founder, not selling a product to a consumer. Warm and a little playful where the content itself is playful (Dogist's audience is funny about picky dogs), but the chrome/UI around it (nav, section 2's methodology, chart labels) should read precise and data-driven, building trust in the numbers before Section 5's messaging payoff. You have full creative freedom on color, type, and exact chart styling — just keep every section full-viewport and vertically centered, and keep the scroll-reveal motion consistent throughout.
