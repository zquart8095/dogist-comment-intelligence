# Blackhole Collector Runbook

This is the operator guide for the Instagram comment collector in this repo. It is written for Zach after pulling the latest code.

The collector has two parts:

- `collector/`: a Chrome extension that runs inside a normal logged-in Instagram browser session and saves scrape state in Chrome.
- `pipeline/dogist-process.mjs`: a local Node processor that turns downloaded collector files into reviewable artifacts under `local-data/instagram-scrape/`.

The processor does not import anything into the dashboard database. It only writes local files, including `comment-analysis-import.json`, which is shaped for a future dashboard import step.

## Before You Start

You need:

1. Google Chrome.
2. An Instagram account already logged in at `https://www.instagram.com/`.
3. This repo pulled locally.
4. Node dependencies installed if you want to process exports:

```bash
npm install
```

You do not need Vercel env vars to run the collector extension or process an exported scrape.

## Install Or Reload The Chrome Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder from the repo:

```text
collector/
```

6. Pin `Blackhole Collector` from the Chrome extensions menu if you want quick access.

After pulling new code, go back to `chrome://extensions` and click the reload icon on the `Blackhole Collector` card. If a scrape is currently running, export or stop it before reloading the extension.

## Recommended First Smoke Test

Do this before a long scrape.

1. Open Instagram in Chrome and confirm you are logged in.
2. Click the `Blackhole Collector` extension icon.
3. In `Instagram handle or URL`, enter a handle like:

```text
thedogist
```

You can also paste a profile URL like:

```text
https://www.instagram.com/thedogist/
```

4. Open `Settings and Recovery`.
5. Set `Max posts` to `2`.
6. Keep `Preload tabs` at `1`.
7. Keep `Mode` as `Exhaustive`.
8. Click `Full Scrape`.
9. Watch the popup counters until the run stops or completes.
10. Click `Export Split`.
11. Process the downloaded manifest:

```bash
npm run collector:process -- --input ~/Downloads/blackhole-instagram-thedogist-<run-id>-manifest.json
```

Replace `<run-id>` with the run id in the downloaded filename.

Success looks like this in the terminal:

```text
Processed Blackhole Instagram input: ...
Output: .../local-data/instagram-scrape/thedogist/<run-id>
<N> attempted posts, <N> comments
```

## Run A Full Scrape

Use this when you want discovery and comment capture in one pass.

1. Open Chrome and confirm Instagram is logged in.
2. Click the `Blackhole Collector` extension icon.
3. Enter the Instagram handle or profile URL.
4. Leave `Max posts` blank for the full profile, or enter a number to cap the run.
5. Keep `Preload tabs` at `1` unless you are intentionally benchmarking speed.
6. Keep `Mode` as `Exhaustive` for the most complete capture.
7. Click `Full Scrape`.

Important: `Full Scrape` starts fresh and clears the current collector checkpoint in the extension. Export anything important before starting a new full scrape.

While it runs:

- Keep Chrome open.
- Do not manually use the active scraping tabs.
- It is okay to close the extension popup; reopen it to check status.
- The extension saves progress in Chrome after each discovered post, comment batch, raw post record, and event.
- The status line shows the handle, run status, phase, and run mode.
- `Saved Comments`, `Active Post`, `Active Capture`, and `Rate` are the main live counters.

When the run finishes, the phase should stop changing and the status should become `complete` or `stopped`.

## Pause, Stop, And Resume

The collector is designed to survive interruption.

To pause immediately:

1. Open the popup.
2. Click `Stop`.

`Stop` closes active post tabs and marks the active post as partial or queued depending on whether comments were captured.

To continue later:

1. Reopen Chrome.
2. Confirm Instagram is still logged in.
3. Open the popup.
4. Click `Resume`.

Resume uses the saved checkpoint and continues from the queue. It retries partial posts after the queued posts have been attempted.

If Chrome, the extension worker, or the popup closes unexpectedly, reopen the popup and click `Resume`.

## Export The Results

Use `Export Split` for normal scrape results, especially long runs.

1. Open the popup after stopping or completing a run.
2. Click `Export Split`.
3. Chrome opens an export tab.
4. Wait until the export tab says the downloads are complete.
5. Keep all downloaded sibling files together in the same folder.

The downloaded files are named like:

```text
blackhole-instagram-<handle>-<run-id>-manifest.json
blackhole-instagram-<handle>-<run-id>-checkpoint.json
blackhole-instagram-<handle>-<run-id>-posts.ndjson
blackhole-instagram-<handle>-<run-id>-comments.ndjson
blackhole-instagram-<handle>-<run-id>-raw-post-records.ndjson
blackhole-instagram-<handle>-<run-id>-events.ndjson
blackhole-instagram-<handle>-<run-id>-post-queue.json
blackhole-instagram-<handle>-<run-id>-post-urls.csv
```

The manifest references the sibling files. If you move files around, move the full set together.

## Process An Export

From the repo root:

```bash
npm run collector:process -- --input ~/Downloads/blackhole-instagram-<handle>-<run-id>-manifest.json
```

You can choose a different output directory:

```bash
npm run collector:process -- --input ~/Downloads/blackhole-instagram-<handle>-<run-id>-manifest.json --out ~/Desktop/blackhole-output
```

The default output path is:

```text
local-data/instagram-scrape/<creator_handle>/<run_id>/
```

`local-data/` is gitignored. Do not commit raw scrape output to the repo.

The processor writes:

- `checkpoint.json`: run state, counts, stop reason, and discovery metadata.
- `comments.jsonl`: one slim JSON row per captured comment.
- `raw_posts.jsonl`: raw extraction records for debugging quality.
- `post-queue.json`: reusable queue JSON.
- `post-urls.csv`: ordered post URL inventory.
- `summary.json`: full scrape summary with per-post quality fields.
- `summary.csv`: spreadsheet-friendly per-post summary.
- `comment-analysis-import.json`: dashboard-import-shaped data, not automatically imported.

To quickly inspect the summary:

```bash
open local-data/instagram-scrape/<creator_handle>/<run_id>/summary.csv
```

## Queue-First Workflow

Use this when you want to discover the profile once, save the post list, and scrape comments later.

Discovery:

1. Open the popup.
2. Enter the handle or profile URL.
3. Optional: set `Max posts` to cap discovery.
4. Click `Discover Queue`.
5. When discovery stops, click `Export Queue`.

This downloads:

```text
blackhole-instagram-<handle>-post-queue-<run-id>.json
blackhole-instagram-<handle>-post-urls-<run-id>.csv
```

Scrape from a queue later:

1. Open the popup.
2. Open `Settings and Recovery`.
3. Click `Import`.
4. Choose the queue JSON, a full bundle JSON, or a split manifest plus its sibling files.
5. Click `Scrape Queue`.

Imports merge by shortcode and comment id. Re-importing the same queue or bundle should not duplicate posts or comments.

## Settings Reference

Use the defaults unless you have a specific reason to change them.

| Setting | Default | What It Does |
|---|---:|---|
| `Max posts` | blank | Caps discovery and/or attempted posts. Useful for smoke tests. Blank means no explicit cap. |
| `Preload tabs` | `1` | Number of post tabs to preload. Comment scraping still runs on the visible active tab. Try `3` or `5` only as a speed experiment. |
| `Mode` | `Exhaustive` | Attempts the fullest comment capture per post. |
| `Max post min` | `8` | Maximum time spent on one post in exhaustive mode. |
| `No-new rounds` | `8` | Stops a post after this many scroll rounds without new comments. |
| `Coverage comments` | `250` | Coverage-mode cap for comments per post. |
| `Coverage min` | `4` | Coverage-mode time cap per post. |
| `Coverage rate` | `0.5` | Coverage-mode minimum capture-rate target when a reliable target exists. |
| `Retry hard failures` | off | Allows failed posts to be retried. Use after rate-limit or tab-load issues are resolved. |

## Quality Checks

After processing, check `summary.csv` or `summary.json`.

Look at:

- `total_posts_discovered`
- `total_posts_attempted`
- `comments_captured`
- `failed_posts`
- `partial_posts`
- `preload_only_claims`
- `quality.failures_by_reason`
- `quality.last_successful_post`
- Per-post `capture_rate_estimate`
- Per-post `stop_reason` and `exhaustion_reason`

Notes:

- Instagram can show comment counts that include surfaces the page does not expose to the logged-in browser. A lower capture rate is not always a scraper bug.
- `partial_unknown_target` means the collector captured comments but did not have a reliable visible target count.
- `tab_load_timeout`, `login_wall`, `challenge_required`, and rate-limit reasons usually mean Chrome or Instagram account state needs attention before retrying.

## Troubleshooting

If the popup says `login_wall`:

1. Open Instagram in a normal tab.
2. Log in again.
3. Return to the popup and click `Resume`.

If the popup says `challenge_required`:

1. Open Instagram manually.
2. Complete the challenge.
3. Resume only after normal browsing works.

If it hits rate limits:

1. Click `Stop`.
2. Wait before continuing.
3. Keep `Preload tabs` at `1`.
4. Resume later.

If exports fail or a single JSON export is too large:

1. Use `Export Split`.
2. Keep all downloaded files together.
3. Process the `-manifest.json` file.

If Chrome was closed mid-run:

1. Reopen Chrome.
2. Confirm Instagram is logged in.
3. Open the popup.
4. Click `Resume`.

If you accidentally start a new full scrape before exporting:

- The extension checkpoint may have been cleared. Check Downloads for any prior export. If there is no export, the prior extension state may not be recoverable.

## What To Send Back

For Zach to hand off a completed run, send or preserve:

1. The split export files from Downloads, especially the `-manifest.json` and all sibling files.
2. The processed output directory under `local-data/instagram-scrape/<creator_handle>/<run_id>/`.
3. A note with the handle, run id, and whether the run ended as `complete`, `stopped`, or rate-limited.

Do not git commit `local-data/`; it is ignored on purpose.
