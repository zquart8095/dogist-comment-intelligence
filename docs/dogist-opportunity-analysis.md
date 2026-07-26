# Dogist Opportunity Analysis Tracker

This document tracks the proposed low-cost analysis path for the Dogist comment corpus. The goal is not to make a generic comment-summarization tool. The goal is to turn post/comment data into business-readable opportunity areas that Zach can use for product, launch, and content decisions.

## Context

Source meeting: Granola note `Zach x Moe Dogist Chat`, June 19, 2026.

Dogist goals from the meeting:

- Launch a blueberry-based dog supplement in the fall.
- Understand community language, motivations, and objections around supplement-like products.
- Identify broader pet-space pain points that could inform the product portfolio, such as insurance, dog walking, care, and related services.
- Deliver insights, not another social-media tool for the team to manage.
- Analyze by post or post group. Analyzing all comments together will likely produce a messy result.
- Start with directly relevant posts, especially the blueberry biscuits post and the high-comment grief/loss post.
- Use future targeted posts as validation prompts, for example asking whether followers have tried dog insurance and why or why not.

Important context boundary:

- These goals come from the Zach meeting, not from unsupervised analysis.
- The corpus does organically contain blueberry, treat, recipe, picky-eater, and healthy-food comments.
- The claim that those comments matter for a blueberry supplement launch is an interpretation layer that should be tested, not treated as a discovered fact.
- Zach-facing outputs should separate corpus evidence from business context.

Current local corpus:

- Dogist tracked corpus: `data/processed/comment-analysis-import.json`
- Current full snapshot: 370 attempted posts, 97,579 captured comments, and 49,478 unique commenters.
- Source export timestamp: `2026-06-21T03:03:58.673Z`.
- Available fields include post link, caption/title, displayed comment count, captured comment count, post likes, comment text, and comment likes.
- Local reduction outputs live in `data/opportunity-analysis/`.

## Working Hypothesis

There is no reliable canonical post-type taxonomy yet. We should not manually define one too early.

Instead, infer structure from the corpus:

1. Cluster posts from captions/titles to discover content formats and campaign-like groups.
2. Cluster high-signal comments separately to discover audience language and needs.
3. Cross-tab post clusters with comment topics and engagement.
4. Convert the strongest intersections into opportunity areas.
5. Use LLMs only after local reduction, mainly for labeling, business validation, quote selection, and next-test generation.

This creates two different output types:

- Corpus-derived outputs: topic model, high-signal topic model, post clusters, representative comments.
- Business-lens outputs: opportunity candidates generated with Zach's launch and pet-services context in mind.

The second type is useful, but it is not neutral discovery.

## Method Adapted From INFO230

The useful pattern from the INFO230 Moltbook vs. Reddit project is still computational discovery before interpretation, but this Dogist run should use much less manual close reading before Claude.

1. Computational discovery first.
2. Light spot-checking second.
3. Claude interpretation third.
4. Validation fourth.

For Dogist, that means:

- Use local statistical passes to find candidate patterns cheaply.
- Spot-check representative comments mainly to catch obvious false positives, not to manually interpret the corpus.
- Ask Claude to interpret reduced topic/evidence packets instead of reading raw comments from scratch.
- Normalize claims by post count, comment count, and engagement instead of relying on raw volume.
- Track whether a signal is broad or driven by one post, one commenter, or one unusually viral thread.
- Explain the method in plain English for Zach. He was not part of the INFO230 project, so reports should say what was done, why it was done, how it works, and how to read the outputs without assuming prior context.

## Proposed Pipeline

### 1. Ingest And Normalize

Inputs:

- `videos`: post id, caption/title, post URL, posted date when available, post likes, displayed comments, captured comments.
- `comments`: comment id, post id, text, likes, author where available.

Derived fields:

- `caption_tokens`
- `comment_tokens`
- `comment_word_count`
- `comment_signal_score`
- `post_engagement_summary`

Noise filters:

- Remove emoji-only and very short comments.
- Downweight generic affection comments such as "cute", "beautiful", and "love this" unless highly liked or attached to a business-relevant post.
- Keep comments with questions, first-person product experience, objections, specific recommendations, costs, service mentions, health/care details, or high likes.

### 2. Infer Post Clusters From Captions

Use captions before comments because captions encode the likely post intent.

Candidate methods:

- TF-IDF over caption unigrams and bigrams.
- Lightweight k-means or hierarchical clustering.
- Optional embedding clustering later if local TF-IDF is too brittle.

Cluster outputs:

- Cluster label candidates from centroid terms.
- Top posts by comment volume and engagement.
- Representative captions.
- Confidence level: strong, mixed, or weak.

Important: caption clustering should be treated as format discovery, not final business insight.

### 3. Infer Comment Topics Separately

Run an all-comment topic model to understand the corpus shape, then use high-signal comments for business interpretation.

Candidate methods:

- TF-IDF over filtered comments.
- Local unsupervised topic clusters across all tokenizable comments.
- A second high-signal topic view so generic affection does not drown out business signal.
- Collocation/KWIC for business terms like `blueberry`, `treat`, `vet`, `insurance`, `senior`, `rescue`, `lost`, and `walking`.
- Like-weighted representative comment selection.

Comment topic outputs:

- Topic terms.
- Representative comments.
- Like-weighted examples.
- Post-format distribution.
- Signal breadth across posts.

### 4. Cross-Tab Post Clusters And Comment Topics

This is where the output becomes useful.

For each post cluster and comment topic intersection, compute:

- Number of posts.
- Number of comments.
- Share of high-signal comments.
- Total and median comment likes.
- Representative posts.
- Representative comments.
- Whether the topic is broad or concentrated.

The useful unit is not "topic". The useful unit is:

> In this kind of post, this kind of audience language appears with this much support and suggests this business opportunity.

### 5. Build Evidence Packets

Each candidate opportunity should be represented as a compact evidence packet:

```json
{
  "name": "Picky-eater trust around healthy treats",
  "status": "candidate",
  "post_cluster": "Food/treat experiments",
  "comment_topic": "picky dogs, trust, recipes, dog-approved treats",
  "business_relevance": "Supplement launch messaging and objections",
  "counts": {
    "posts": 0,
    "comments": 0,
    "high_signal_comments": 0,
    "total_comment_likes": 0
  },
  "representative_posts": [],
  "representative_comments": [],
  "possible_angle": "Healthy products need to feel dog-approved, safe, and not medicinal.",
  "next_validation_post": "What healthy treats does your dog actually refuse?"
}
```

### 6. Use LLMs After Local Reduction

LLMs should not be the primary clustering engine. Use them on evidence packets.

Claude should do two passes:

1. A context-free read: interpret the topic model and evidence packets without knowing the blueberry supplement launch.
2. A business-context read: reinterpret the same evidence with the launch, services, and validation goals from the Zach meeting.

The useful output is the comparison between those passes: what appears organically, what only appears after applying the business lens, and what needs a follow-up validation post.

LLM jobs:

- Label clusters in plain business language.
- Decide whether a candidate is a real business opportunity or just entertainment/engagement.
- Extract audience motivations and objections.
- Pick the clearest representative quotes from locally selected candidates.
- Generate follow-up post questions for validation.
- Produce a concise report for Zach.

Expected LLM prompt shape:

```text
Given this evidence packet from Dogist comments, decide whether it supports a real product or marketing opportunity.
If yes, name the opportunity, summarize the audience language, list objections or motivations, choose the best quotes, and propose a next validation post.
If no, explain why it is only engagement or entertainment signal.
```

## Candidate Opportunity Areas To Test

These are working candidates, not validated findings.

### Food, Treats, And Product Trust

Why it matters:

- Directly relevant to the blueberry-based supplement launch.

Likely signal:

- Blueberries, biscuits, treats, recipes, picky eaters, "my dog would/would not eat this", healthy foods, food restraint, trust in homemade treats.

What to validate:

- Are comments expressing purchase motivation, taste concerns, ingredient trust, or just jokes about dogs eating anything?

### Senior, Health, And Care Companionship

Why it matters:

- Strong emotional connection to health, cancer, blindness, diabetes, senior dogs, and care.

Likely signal:

- Dogs as support during illness, owners adapting homes/routines, senior dog care, grief around health decline.

What to validate:

- Is this a supplement-adjacent wellness angle, a care-content angle, or a separate product/service opportunity?

### Rescue And Adoption Trust

Why it matters:

- Dogist community appears highly responsive to rescue/adoption stories.

Likely signal:

- Shelter, rescue, senior adoption, found dogs, animal testing survivors, "changed my life" language.

What to validate:

- Is this primarily mission/brand affinity, or can it inform a partner/product strategy?

### Services And Cost Pain Points

Why it matters:

- Zach specifically mentioned insurance, walking, and broader pet services.

Likely signal:

- Insurance appears weakly in the existing organic comments, while vet/cost/care language appears more often.

What to validate:

- Existing comments may not be enough. This likely needs a targeted validation post.

### IRL Community And Sampling

Why it matters:

- Dogist walks, meetups, sports events, and treat handouts may be launch channels.

Likely signal:

- Comments around meetups, wanting Dogist to come to a city, treat sampling, community participation.

What to validate:

- Can the supplement launch be tested through IRL sampling posts rather than only social listening?

## Tracking Checklist

- [x] Confirm current dashboard analysis sends a capped subset of comments to Claude.
- [x] Confirm Dogist export includes captions/titles and comment-to-post linkage.
- [x] Capture Zach meeting constraints and business goals.
- [x] Draft unsupervised analysis direction.
- [x] Move the 97,579-comment corpus into tracked repo data for GitHub collaboration.
- [x] Create a repeatable local corpus-analysis script: `npm run dogist:analyze`.
- [x] Generate post clusters from captions and comment signals.
- [x] Generate an all-comment topic model and a high-signal topic model.
- [x] Generate high-signal comment topic buckets.
- [x] Cross-tab post clusters with comment topics and engagement.
- [x] Produce evidence packet JSON for candidate opportunity areas.
- [x] Add plain-English method explanation for collaborators who did not see the INFO230 notebooks.
- [x] Draft Claude API batch/caching plan: `docs/dogist-claude-api-plan.md`.
- [ ] Add an optional LLM validation implementation.
- [ ] Render results in a simple report or dashboard view.
- [ ] Test the blueberry biscuits post as the first end-to-end case.
- [ ] Test a health/grief post as the second end-to-end case.
- [ ] Decide whether targeted validation posts should become a first-class workflow.

## Open Questions

- Should post clusters be creator-specific, or should the model learn reusable post formats across creators?
- Should comments be clustered globally, per post cluster, or both?
- How should we define "business-ifyable" rigorously enough for the app?
- What threshold makes an opportunity area worth showing: comment count, like-weighted signal, breadth across posts, or LLM confidence?
- Should the first version save opportunity areas into `multi_analyses`, or should it get a separate table/schema?
- Does Zach need a static report first, or should the dashboard get an interactive opportunity view?

## Proposed First Implementation Slice

Current local script:

```bash
npm run dogist:analyze -- \
  --input data/processed/comment-analysis-import.json \
  --out data/opportunity-analysis
```

It reads a `comment-analysis-import.json` file and writes:

- `post-clusters.json`
- `comment-topics.json`
- `comment-topic-model.json`
- `opportunity-candidates.json`
- `claude-evidence-packets.json`
- `opportunity-report.md`

This keeps the first version outside production routes while we learn whether the method produces useful outputs. The intended path is local reduction first, light QA second, Claude interpretation third.

Once the output quality is acceptable, wire the pipeline into the app behind a separate endpoint or dashboard action.
