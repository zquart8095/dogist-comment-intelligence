# Dogist Comment Intelligence

**Turning a 97,579-comment Instagram corpus into fully sourced ad angles — no quote ever generated, only ever looked up.**

[![Live demo](https://img.shields.io/badge/live%20demo-audience--intelligence-1E7A6B?style=flat-square)](https://dogist.vercel.app/audience-intelligence)
[![Technical design](https://img.shields.io/badge/read-technical%20design-3B5BA8?style=flat-square)](https://zquart8095.github.io/dogist-comment-intelligence/technical-design.html)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-Haiku%204.5%20%2F%20Sonnet%204.6-D97757?style=flat-square)
![Python](https://img.shields.io/badge/Python-BERTopic-3776AB?style=flat-square&logo=python&logoColor=white)

[![System flow: a browser extension collects comments from @thedogist on Instagram, an on-device stage filters them by keyword matching and engagement then clusters similar comments together, and an analysis pipeline evaluates needs and wants, groups them into themes, and generates ad angles for the final report](docs/media/pipeline-flow.png)](docs/media/pipeline-flow.png)

<sub>*Click to enlarge. Starred stages are Claude calls; everything before them runs locally on a laptop.*</sub>

**📊 [Step-by-step walkthrough](docs/media/how-it-works.png)** — the same pipeline as a five-step
funnel with the real counts at each stage, following one actual comment (♥42, from the corpus)
all the way through to the ad copy it produced.

## The challenge

The launch of The Dogist's **Vitality Chew** — a blueberry-and-pomegranate antioxidant dog
supplement — lives or dies on its positioning. Generic creative invented by a room of marketers
guessing at what the audience cares about would sink the product before it got off the ground.

The Dogist has something no other brand entering this category has: a community of highly engaged
pet owners who have spent years posting their unprompted needs, wants, and frustrations. That
signal was real, and it was already theirs.

It was also unusable. The high-signal quotes sat buried in the comments section of The Dogist's
Instagram — scattered thin across 370 posts and 97,579 comments, with no export path and no
realistic way to read them manually.

## What Ctrl+R built

Ctrl+R started by researching how performance advertisers actually construct winning positioning
angles, then codified that research into a repeatable workflow: **six proven direct-response angle
types** (pain-based, desire-based, problem/solution, social proof, curiosity, niche-specific) and a
**five-part message structure** (hook → explanation → solution → social proof/USP → CTA).

That workflow became the specification for an AI-native pipeline that replaces the manual
collection-and-analysis work entirely. Five stages collect, reduce, interpret, and package social
comments into structured ad angles — with the codified angle framework passed to the model as its
operating instructions, not left to its own judgment — read through a single scrollytelling report
(`/`) that walks section by section through the funnel, the ad-angle framework, and the results.

**The funnel:**

| Comments collected | Diet-relevant | Pain-point signals | Themes | Ad angles |
|---:|---:|---:|---:|---:|
| 97,579 | 7,293 | 912 | 31 | 60 |

Every quote in the report is looked up by a stable reference back to the original captured
comment — the model that writes an ad angle never has the text of the quote it's using, only a
pointer to it, so nothing downstream can paraphrase or fabricate one.

### Why it's built this way

**📐 [Technical design document](https://zquart8095.github.io/dogist-comment-intelligence/technical-design.html)** — the
architecture, and the nine key design decisions with the trade-off behind each one: why DOM
scraping over API interception, why two unrelated clustering methods instead of one, why theme
clustering deliberately *stops* using embeddings, and how the no-fabricated-quotes guarantee is
enforced structurally rather than by asking the model nicely.

**📖 [Pipeline walkthrough](docs/comment-intelligence-pipeline.md)** — a narrative, stage-by-stage
read of how the corpus actually moves through the system.

**✍️ [Prompt design](docs/prompt-design.md)** — how the direct-response expertise was encoded into
the prompts, and the construction techniques that make the output verifiable: index references
instead of quote text, ranges as calibration rather than targets, constraints loaded from JSON, and
the hardcoded guard against the one circular ad this corpus leads you toward.

**📋 [Report structure](docs/report-structure.md)** — what the deliverable actually is: five
sections, and how 10 themes × 6 angle types × a 5-part structure nest into 60 ad angles, each with
the borrowed language, claims to avoid, and validation test a media buyer needs to spend against it.

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript — a single scrollytelling report, no
  client-side data fetching
- **Anthropic Claude** (`@anthropic-ai/sdk`) — Haiku 4.5 for high-volume extraction, Sonnet 4.6
  for theme deduplication and ad-angle writing
- **Python** (BERTopic, UMAP, HDBSCAN, sentence-transformers) for the independent embedding-based
  discovery pass
- A Chrome extension (vanilla JS, no build step) for corpus collection

## Local development

```bash
npm install
npm run dev   # http://localhost:3000
```

No secrets needed to view the report — it reads committed JSON. `ANTHROPIC_API_KEY` (via
`cp .env.example .env.local`) is only needed to re-run the Claude pipeline stages below.

## Tests

```bash
npm test            # self-contained unit tests — no local data needed
npm run test:corpus # integration tests against the full local corpus snapshot (see below)
```

## Regenerating the analysis

The report consumes the small JSON files in `data/opportunity-analysis/`,
produced from the corpus by:

```bash
npm run dogist:full   # analyze → event → discover → claude → diet → cultural → pain-points → angle-messages
```

Individual stages: `dogist:analyze`, `dogist:event`, `dogist:discover` (Python), `dogist:claude`,
`dogist:diet`, `dogist:cultural`, `dogist:pain-points`, `dogist:angle-messages`. The Claude/diet/
cultural/pain-point stages call the Anthropic API and load `.env.local`.

> **This repo ships the pipeline code and the small derived outputs it produces, not the raw
> scraped corpus.** The full comment-level export (real Instagram commenters' names and text,
> ~150MB) is real third-party personal data and is intentionally excluded — the pipeline scripts
> and `test:corpus` integration tests expect it locally under `data/processed/` but won't find it
> in a fresh clone of this repo. Everything the deployed report actually reads
> (`data/opportunity-analysis/pain-point-angles.json`, `angle-messages.json`) is committed and
> works out of the box.

## Data collection

`collector/` is the load-unpacked Chrome extension used to capture a corpus from
a logged-in Instagram session — DOM-based rather than API interception, with per-post capture-rate
telemetry and checkpointed state so a killed tab doesn't lose already-captured data. Operator
steps live in [`docs/blackhole-collector-runbook.md`](docs/blackhole-collector-runbook.md); process
a run export with `npm run collector:process -- --input <manifest.json>`.

## Project structure

```
collector/    Chrome extension — corpus collection
pipeline/     the pipeline: process → reduce → interpret → extract → angle-write
app/          the report route (app/page.tsx)
components/   the report's UI
product/      product brief + brand voice data the pipeline and report read
data/         committed pipeline outputs (raw corpus excluded, see above)
docs/         architecture, design decisions, and process docs
tests/        unit tests (self-contained) + corpus integration tests
```
