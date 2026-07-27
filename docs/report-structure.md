# Report Structure

What the deliverable actually is, and how the output nests. The report is a single scrollytelling
page (`/`, rendered by `components/AudienceIntelligenceReport.tsx`) built to be read top to bottom
by a non-technical stakeholder — a brand marketer or media buyer, not an analyst.

It reads two committed files at build time (`app/page.tsx:5-6`) and fetches nothing at view time:

```
data/opportunity-analysis/pain-point-angles.json   all 31 themes + their signals
data/opportunity-analysis/angle-messages.json      the top 10 themes × 6 angles
```

## The five sections

| | Section | What it does |
|---|---|---|
| 01 | Landing | The corpus and the claim |
| 02 | Methodology | The funnel as a narrowing bar chart |
| 03 | What Is An Ad Angle | The framework itself, before any results |
| 04 | Theme Results | All 31 themes ranked by signal volume |
| 05 | Ad Angle Results | One full screen per theme — ten of them |

A persistent side nav (Landing · Methodology · Ad Angles · Themes · Messaging) scroll-jumps between
them.

### 02 — Methodology

Four rows, each narrowing, animating to width on scroll:

```
97,579   Comments collected
 7,293   Filtered to comments topically relevant to diet, food & feeding
   912   Contained a clearly stated problem or want about diet
    31   Distinct pain-point & need themes, clustered from those signals
```

Headline: *"From 97,579 comments to 60 ad angles."* Subhead: *"Every step narrows real audience
language down to messaging worth testing — nothing here was invented, only filtered."*

The counts are computed from the loaded JSON, not typed into the page — the funnel can't drift out
of sync with the data behind it.

### 03 — What Is An Ad Angle

The framework is explained *before* any results, so a stakeholder reads the output already knowing
what they're looking at.

> **Not what the product is — the lens it's viewed through.**
>
> An ad angle is the specific psychological hook used to present the same core offer to one
> particular audience mindset — pain relief, an aspirational outcome, a blunt fix, social proof, an
> intriguing reveal, or a message to one very specific kind of owner.

Six cards follow, one per angle type, each showing its name, its hook formula in mono, and what it
does. Then the anatomy strip — `Hook → Explanation → Solution → Social Proof / USP → CTA` — and the
provenance note:

> Grounded, not generative: no comment quote shown anywhere on this page was paraphrased by AI.
> Every quote is pulled by a stable reference back to the original comment — it links to a real
> Instagram comment with its real like count.

### 04 — Theme Results

All 31 themes as a ranked bar chart, split across two slides: **top 10 by volume** and **bottom 10
by volume**. Hovering a bar surfaces that theme's detail.

Showing the long tail matters. The report claims 31 themes and then shows all 31, including the thin
ones — which is also the honest argument for why only the top 10 were carried forward to ad angles.

### 05 — Ad Angle Results

The bulk of the report: **one screen per theme, ten screens**, navigated with arrows.

Each theme screen opens with its header — the theme label, then `problem_statement → want_statement`
on one line, then chips for its emotional triggers and a colour-coded signal-strength badge
(high / medium / low).

Below that, six tabs — one per angle type. Selecting a tab swaps the angle in place.

## How the output nests

```
10 themes  ×  6 angle types  ×  5-part structure  =  60 ad angles
```

### Level 1 — Theme

Top 10 of the 31 by signal volume. Each carries:

| Field | |
|---|---|
| `label` | e.g. "Dogs Refusing Fruits and Vegetables" |
| `problem_statement` | The problem as owners describe it |
| `want_statement` | What owners want instead |
| `emotional_triggers` | 1–3 dominant emotions |
| `signal_strength` | high / medium / low |
| `representative_quotes` | Top real comments by like count |

### Level 2 — Angle

One per type, per theme. Six per screen, each following its own hook formula so they read as
genuinely different approaches rather than one line rewritten six times.

### Level 3 — The five parts

Rendered as the main column of each angle:

```
hook              scroll-stopper, no brand name yet — set in display type
explanation       why this matters, what's really going on
solution          first mention of Vitality
social_proof_usp  why it's credible right now
cta               rendered as an actual button — "Stop fighting the bowl. Try Vitality and see what happens. →"
```

### Level 4 — The buying support

A right-hand aside on every angle, which is what makes the output something a media buyer can act on
rather than just read:

**Language to borrow** — 2–3 short phrases lifted from real comments. Each is a **live link to the
Instagram post it came from**, annotated with its like count. This is where the no-fabricated-quotes
guarantee becomes visible: the reader can click through and find the comment.

**Claims to avoid** — what not to say for this specific theme and angle type, distinct from the
universal trust constraints enforced everywhere.

**Validation test** — a concrete post concept to test the angle with the audience before spending
against it.

## A worked example

From theme 1 of 10, *"Dogs Refusing Fruits and Vegetables"* — the pain-based angle:

> **Hook** — "Why getting real nutrition into your picky dog isn't working — it's not your fault."
>
> **Explanation** — "Plenty of owners spend real energy trying to sneak variety into their dog's
> bowl — tucked into meals, dressed up, disguised — and the dog still wins. The issue isn't effort
> or creativity. It's that most delivery methods ask the dog to cooperate with something their nose
> already vetoed."
>
> **Solution** — "The Dogist Vitality Chew was built for exactly this: blueberry and pomegranate
> antioxidants, salmon flavor your dog actually wants, in a daily chew that doesn't ask for a
> negotiation. No hiding required."
>
> **Social proof / USP** — "Owners in our community described dogs who'd catch a piece of meat
> mid-air and spit out a vegetable in the same motion — Vitality's palatability was designed with
> that exact dog in mind."
>
> **CTA** — "Stop fighting the bowl. Try Vitality and see what happens."
>
> **Language to borrow** — *"carefully packed inside meatballs"* (♥42) — "the clearest, most
> specific image of the workaround owners are already doing — it shows real effort without making
> the owner feel stupid."

That phrase is a real comment from a real person on a real post, and the report links to it. Note
also what the hook does *not* say: it never mentions the dog refusing blueberries, even though that
is the theme's most literal content — see the circular-reasoning guard in
[`prompt-design.md`](prompt-design.md).

Nothing in the chain from raw comment to finished ad copy was invented by a model. The copy is
written; the evidence is looked up.
