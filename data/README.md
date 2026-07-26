# Dogist Full Corpus Snapshot

Tracked snapshot of the Dogist scrape exported from Blackhole Collector and processed for local analysis.

## Corpus

- Creator: `thedogist`
- Source run id: `dogist-2026-06-19-7a841a`
- Source export timestamp: `2026-06-21T03:03:58.673Z`
- Processed timestamp: `2026-06-21T03:08:29.348Z`
- Discovered posts: 5,568
- Attempted posts: 370
- Completed posts: 97
- Partial posts: 269
- Failed posts: 4
- Captured comments: 97,579
- Unique commenters: 49,478
- Stop reason: `user_stop_requested`
- Next queued post if scraping resumes: `DLA8Or_xyPl`

## Layout

- `raw-export/`: normalized copy of the browser-exported split bundle. Filenames match the manifest so the processor can read it directly.
- `processed/`: output from `npm run collector:process`, including analysis-ready comments and post summaries.
- `opportunity-analysis/`: local topic model, post clusters, opportunity candidates, Claude-ready evidence packets, and a human-readable report.

## Recommended Starting Points

- `processed/comment-analysis-import.json`: easiest single-file input for analysis scripts. Contains videos and comments with post linkage.
- `processed/summary.json`: scrape quality, post-level metrics, and representative top comments.
- `processed/comments.jsonl`: one normalized comment per line for streaming analysis.
- `raw-export/blackhole-instagram-thedogist-dogist-2026-06-19-7a841a-manifest.json`: original split-bundle entrypoint for reprocessing.
- `opportunity-analysis/opportunity-report.md`: first local analysis report with a plain-English method explanation.
- `opportunity-analysis/comment-topic-model.json`: all-comment and high-signal topic models.

## Reprocess

```bash
npm run collector:process -- \
  --input data/raw-export/blackhole-instagram-thedogist-dogist-2026-06-19-7a841a-manifest.json \
  --out local-data/instagram-scrape/thedogist/dogist-2026-06-19-7a841a-full-2026-06-21
```

The `local-data/` output is ignored by Git. This tracked `data/` snapshot is intended to make the corpus available to collaborators through GitHub.
