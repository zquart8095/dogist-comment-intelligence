# Dogist Claude API Analysis Plan

This plan describes how to use Claude on the Dogist corpus without asking the model to read 97,579 raw comments in one pass.

Docs checked: June 21, 2026.

Official Anthropic references:

- Pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Batch processing: https://platform.claude.com/docs/en/build-with-claude/batch-processing
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Rate limits: https://platform.claude.com/docs/en/api/rate-limits

## Current Corpus Size

Tracked input:

```text
data/processed/comment-analysis-import.json
```

Current local counts:

- 370 attempted posts
- 97,579 captured comments
- 49,478 unique commenters
- 4,956,447 raw comment characters
- About 1.24M rough tokens from comment text alone, before JSON structure, post captions, examples, and instructions

The corpus is large enough that raw full-corpus prompting would be expensive, brittle, and likely lower quality than local reduction plus Claude interpretation.

## Current Claude Pricing Assumptions

Use the current model names from Anthropic docs:

| Model | Best role here | Standard input/output | Batch input/output |
|---|---|---:|---:|
| Claude Haiku 4.5 | cheap packet labeling and quote triage | $1 / $5 per MTok | $0.50 / $2.50 per MTok |
| Claude Sonnet 4.6 | synthesis and business interpretation | $3 / $15 per MTok | $1.50 / $7.50 per MTok |
| Claude Opus 4.8 | final high-stakes strategy review only if needed | $5 / $25 per MTok | $2.50 / $12.50 per MTok |

Batch processing gives a 50% discount when immediate responses are not needed. Prompt caching can reduce repeated input cost when requests share identical instructions or context. In batch mode, Anthropic says caching can stack with batch discounts, but cache hits are best effort because batch requests run asynchronously and concurrently.

Privacy caveat: Anthropic's Batch API is not Zero Data Retention eligible, and batch inputs/results are retained under the batch retention policy. That is probably acceptable for public Instagram comments in a private repo, but it should be an explicit decision.

## Recommended Workflow

### 1. Local reduction

Run:

```bash
npm run dogist:analyze -- \
  --input data/processed/comment-analysis-import.json \
  --out data/opportunity-analysis
```

This produces:

- all-comment topic model
- high-signal topic model
- post clusters
- business topic buckets
- cross-tabs
- Claude-ready evidence packets

### 2. Claude packet interpretation

Use `data/opportunity-analysis/claude-evidence-packets.json`.

Recommended model: Claude Haiku 4.5 through Message Batches.

Run two passes over the same packets:

1. **Context-free pass:** do not mention the blueberry supplement launch or the Zach meeting. Ask Claude what the comments support on their own.
2. **Business-context pass:** provide the launch/services context and ask how the same evidence could inform product, launch, content, partnership, or validation decisions.

One request per packet should:

- label the opportunity in plain language
- decide whether it is business signal, content signal, partnership signal, or generic engagement
- identify motivations, objections, and concrete language
- choose the best quotes from the provided examples
- propose follow-up validation posts
- return strict JSON

This should be cheap because each request reads a compact packet, not the raw corpus.

### 3. Claude topic-model interpretation

Use `comment-topic-model.json`.

Recommended model: Claude Haiku 4.5 for first labeling, Claude Sonnet 4.6 if labels are too mushy.

Ask Claude to:

- rename machine topic labels in human language
- identify which all-comment topics are generic affection
- identify which high-signal topics deserve business analysis
- map topics to candidate opportunity areas
- flag topics that need more local filtering

### 4. Claude synthesis

Use Sonnet 4.6 on:

- packet interpretation outputs
- topic labels
- `opportunity-report.md`
- selected representative posts/comments

Ask for a Zach-facing report that explains:

- what we did
- why we did it this way
- what the topic model found
- what is probably just engagement
- what looks like a business opportunity
- what needs validation
- what posts Dogist should run next
- which claims came from the context-free read
- which claims only emerged after applying the business-context lens

### 5. Optional Opus review

Use Opus 4.8 only after Sonnet has produced a coherent report.

Opus should review:

- whether evidence supports each claim
- whether any founder interpretation is being overclaimed
- whether the report is useful for Dogist product/launch decisions

## Prompt Caching

Use prompt caching for stable shared material:

- the explanation of the workflow
- JSON output schema
- definitions of evidence vs. interpretation
- Zach-facing writing requirements
- the same examples of good and bad interpretation

For batch work, consider 1-hour cache duration because batches may run beyond the default 5-minute cache window. Keep cached blocks byte-identical across requests.

## What Not To Do

- Do not send all 97,579 comments to Claude as one raw prompt.
- Do not ask Claude to discover everything from scratch.
- Do not treat topic labels as validated findings.
- Do not present the blueberry supplement angle as an organic finding. It is Zach meeting context applied to organic blueberry/treat/food comments.
- Do not do a large manual close-reading phase before Claude. Use spot checks only to catch false positives and obvious data quality problems.
- Do not hide uncertainty. Label outputs as evidence, interpretation, or validation need.

## Implementation Slice

Next code step:

1. Add a `pipeline/dogist-claude-packets.mjs` batch-prep script.
2. Read `claude-evidence-packets.json`.
3. Emit JSONL batch requests for Haiku 4.5.
4. Include a stable cached system/method block.
5. Save batch outputs under ignored `local-data/claude-runs/`.
6. Only promote selected outputs into tracked `data/` after review.
