# Dogist Opportunity Analysis Outputs

This folder contains local reduction outputs for the full Dogist corpus. It is meant to make the 97,579-comment snapshot easier for Zach and collaborators to inspect before any Claude interpretation step.

## What Was Done

1. Started from `../processed/comment-analysis-import.json`, which links posts to comments.
2. Tokenized all usable comment text and built a TF-IDF topic model across the full corpus.
3. Scored comments for business signal using first-person language, questions, specificity, likes, and Dogist-relevant terms.
4. Built a second topic model on the high-signal subset.
5. Grouped posts by caption/comment signals.
6. Cross-tabbed post groups with comment topics.
7. Created Claude-ready evidence packets.

## Why

The raw corpus is too large and repetitive to interpret directly. The local topic model and signal scan reduce the corpus into structured evidence so Claude can spend tokens on interpretation rather than basic sorting.

This is not the same as a long human close-reading project. The intended workflow is:

1. Local computation reduces the corpus.
2. A human spot-checks for obvious false positives.
3. Claude interprets the reduced evidence packets.
4. Zach validates promising claims with business judgment or follow-up posts.

## Files

- `corpus-summary.json`: corpus counts and basic metadata.
- `comment-topic-model.json`: unsupervised TF-IDF/k-means topics over all tokenizable comments, plus a high-signal topic model.
- `post-clusters.json`: post-format groupings inferred from captions and comment signals.
- `comment-topics.json`: domain topic buckets such as food, rescue, health, grief, services, and IRL community.
- `opportunity-candidates.json`: candidate business opportunity packets with counts, posts, and representative comments.
- `claude-evidence-packets.json`: compact input for Claude interpretation.
- `opportunity-report.md`: human-readable summary of the local analysis.

## How To Read The Topic Model

- `label_terms` are machine-selected cluster terms, not polished labels.
- `representative_comments` are examples close to the cluster center, not proof.
- Large generic topics are expected because Dogist comments include a lot of affection and praise.
- The high-signal topic model is usually better for business interpretation.

## Context Boundary

The topic models are corpus-derived. The opportunity buckets are hypothesis-driven and use the Zach meeting context as a business lens.

That distinction matters most for the blueberry/supplement launch. The corpus does contain organic comments about blueberries, treats, recipes, picky eating, and healthy foods. The idea that those comments are relevant to a supplement launch comes from the business context, not from the topic model alone.

Recommended Claude workflow:

1. Ask Claude for a context-free interpretation of the topic model and evidence packets.
2. Ask Claude for a second interpretation with the Dogist launch context.
3. Compare the two outputs and only keep claims that remain grounded in the comments.
