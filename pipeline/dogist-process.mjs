#!/usr/bin/env node
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_BASE_OUT = path.join(REPO_ROOT, "local-data", "instagram-scrape");

function parseArgs(argv) {
  const args = { input: "", out: "" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    if (flag === "--input") args.input = resolveUserPath(next());
    else if (flag === "--out") args.out = resolveUserPath(next());
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function printHelp() {
  console.log(`Blackhole Instagram scrape processor

Usage:
  npm run collector:process -- --input ~/Downloads/blackhole-instagram-<handle>-<run-id>-manifest.json
  npm run collector:process -- --input ~/Downloads/blackhole-instagram-<handle>-post-queue-<run-id>.json
  npm run dogist:process -- --input ~/Downloads/dogist-scrape-<run-id>.json

Options:
  --input <file>  Required extension-exported scrape bundle, split manifest, or post queue JSON.
  --out <dir>    Optional output directory. Defaults to local-data/instagram-scrape/<creator_handle>/<run-id>.
`);
}

function resolveUserPath(value) {
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

async function loadInput(inputPath) {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (input?.type === "dogist_post_queue" || input?.type === "blackhole_instagram_post_queue") {
    return queueToBundle(input);
  }
  if (isSplitManifest(input)) {
    return loadSplitManifest(inputPath, input);
  }
  return normalizeBundle(input);
}

function isSplitManifest(input) {
  return input?.type === "dogist_split_scrape_bundle" || input?.type === "blackhole_split_scrape_bundle";
}

async function loadSplitManifest(manifestPath, manifest) {
  const dir = path.dirname(manifestPath);
  const fileFor = async (key) => {
    const filename = manifest.files?.[key];
    return filename ? resolveSiblingFile(path.join(dir, filename)) : null;
  };
  const checkpointPath = await fileFor("checkpoint");
  const queuePath = await fileFor("post_queue");
  const checkpoint = checkpointPath ? JSON.parse(await fs.readFile(checkpointPath, "utf8")) : {};
  const postQueue = queuePath ? JSON.parse(await fs.readFile(queuePath, "utf8")) : null;
  const posts = await readNdjson(await fileFor("posts"));
  const comments = await readNdjson(await fileFor("comments"), slimCommentRow);
  const rawPostRecords = await readNdjson(await fileFor("raw_post_records"));
  const events = await readNdjson(await fileFor("events"));
  return normalizeBundle({
    version: manifest.version ?? 1,
    type: manifest.type,
    exported_at: manifest.exported_at,
    checkpoint,
    posts,
    comments,
    raw_post_records: rawPostRecords,
    events,
    post_queue: postQueue
  });
}

async function resolveSiblingFile(filePath) {
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    const alternates = [];
    if (filePath.endsWith(".jsonl")) alternates.push(filePath.replace(/\.jsonl$/, ".ndjson"));
    if (filePath.endsWith(".ndjson")) alternates.push(filePath.replace(/\.ndjson$/, ".jsonl"));
    for (const alternate of alternates) {
      try {
        await fs.access(alternate);
        return alternate;
      } catch {
        // Try the next alternate.
      }
    }
    return filePath;
  }
}

async function readNdjson(filePath, mapper = (row) => row) {
  if (!filePath) return [];
  const rows = [];
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const mapped = mapper(JSON.parse(trimmed));
    if (mapped) rows.push(mapped);
  }
  return rows;
}

function normalizeBundle(bundle) {
  const checkpoint = bundle.checkpoint ?? {};
  const posts = Array.isArray(bundle.posts) ? bundle.posts : [];
  const comments = Array.isArray(bundle.comments) ? bundle.comments.map(slimCommentRow).filter(Boolean) : [];
  return {
    ...bundle,
    type: bundle.type ?? "dogist_scrape_bundle",
    checkpoint,
    posts,
    comments,
    raw_post_records: Array.isArray(bundle.raw_post_records) ? bundle.raw_post_records : [],
    events: Array.isArray(bundle.events) ? bundle.events : []
  };
}

function slimCommentRow(comment) {
  if (!comment || typeof comment !== "object") return null;
  return {
    comment_id: comment.comment_id,
    scraped_at: comment.scraped_at ?? null,
    platform: comment.platform ?? "instagram",
    creator_handle: comment.creator_handle ?? null,
    post_shortcode: comment.post_shortcode,
    post_url: comment.post_url ?? "",
    post_kind: comment.post_kind ?? null,
    comment_author: comment.comment_author ?? "unknown",
    comment_text: comment.comment_text ?? "",
    comment_likes: comment.comment_likes ?? 0,
    comment_verified: comment.comment_verified ?? false,
    comment_posted_at: comment.comment_posted_at ?? null,
    native_comment_id: comment.native_comment_id ?? null,
    comment_permalink: comment.comment_permalink ?? null,
    comment_depth: Number.isFinite(Number(comment.comment_depth)) ? Number(comment.comment_depth) : 0,
    parent_comment_id: comment.parent_comment_id ?? null,
    worker_id: comment.worker_id ?? null,
    batch_id: comment.batch_id ?? null,
    extraction_source: comment.extraction_source ?? null
  };
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildSummary(bundle, outDir) {
  const checkpoint = bundle.checkpoint ?? {};
  const creatorHandle = getCreatorHandle(bundle);
  const posts = [...(bundle.posts ?? [])].sort((a, b) => {
    const queue = checkpoint.discovered_post_queue ?? [];
    return queue.indexOf(a.shortcode) - queue.indexOf(b.shortcode);
  });
  const comments = bundle.comments ?? [];
  const byPost = new Map();
  for (const comment of comments) {
    if (!byPost.has(comment.post_shortcode)) byPost.set(comment.post_shortcode, []);
    byPost.get(comment.post_shortcode).push(comment);
  }

  const postRows = posts.map((post) => {
    const postComments = byPost.get(post.shortcode) ?? [];
    const likes = postComments.map((comment) => Number(comment.comment_likes ?? 0));
    const lengths = postComments.map((comment) => normalize(comment.comment_text).length);
    const uniqueCommenters = new Set(postComments.map((comment) => normalize(comment.comment_author).toLowerCase()).filter(Boolean));
    const rawDisplayed = post.displayed_comment_count ?? postComments[0]?.displayed_comment_count ?? null;
    const displayed = Number(rawDisplayed) >= postComments.length ? Number(rawDisplayed) : null;
    const target = post.target_comment_count ?? postComments[0]?.target_comment_count ?? displayed;
    return {
      shortcode: post.shortcode,
      kind: post.kind ?? post.post_kind ?? null,
      url: post.url,
      status: post.status,
      attempts: post.attempts ?? 0,
      stop_reason: post.stop_reason ?? "",
      exhaustion_reason: post.exhaustion_reason ?? post.stop_reason ?? "",
      worker_id: post.worker_id ?? "",
      effective_concurrency: post.effective_concurrency ?? null,
      active_hydrated_at: post.active_hydrated_at ?? null,
      active_hydrate_ms: post.active_hydrate_ms ?? null,
      hydrate_visibility_state: post.hydrate_visibility_state ?? null,
      hydrate_comments_found: post.hydrate_comments_found ?? null,
      hydrate_target_comment_count: post.hydrate_target_comment_count ?? null,
      active_scrape_started_at: post.active_scrape_started_at ?? null,
      active_scrape_finished_at: post.active_scrape_finished_at ?? null,
      active_scroll_rounds: post.active_scroll_rounds ?? null,
      active_visibility_states: (post.active_visibility_states ?? []).join("|"),
      background_scroll_visibility_states: (post.background_scroll_visibility_states ?? []).join("|"),
      post_like_count: Number(post.like_count ?? postComments[0]?.post_like_count ?? 0),
      repost_count: post.repost_count ?? postComments[0]?.post_repost_count ?? null,
      captured_comments: postComments.length,
      displayed_comment_count: displayed,
      target_comment_count: target ?? null,
      target_comment_source: post.target_comment_source ?? postComments[0]?.target_comment_source ?? null,
      capture_rate_estimate: target ? Number((postComments.length / target).toFixed(4)) : null,
      unique_commenters: uniqueCommenters.size,
      total_comment_likes: likes.reduce((sum, value) => sum + value, 0),
      mean_comment_likes: Number(mean(likes).toFixed(2)),
      median_comment_likes: Number(median(likes).toFixed(2)),
      mean_text_length: Number(mean(lengths).toFixed(2)),
      median_text_length: Number(median(lengths).toFixed(2)),
      posted_at: post.posted_at ?? postComments[0]?.post_posted_at ?? null,
      caption_preview: post.caption_preview ?? normalize(postComments[0]?.post_caption).slice(0, 160),
      top_comments_by_likes: [...postComments]
        .sort((a, b) => Number(b.comment_likes ?? 0) - Number(a.comment_likes ?? 0))
        .slice(0, 5)
        .map((comment) => ({
          author: comment.comment_author,
          text: comment.comment_text,
          likes: comment.comment_likes ?? 0
        }))
    };
  });

  const allLikes = comments.map((comment) => Number(comment.comment_likes ?? 0));
  const allLengths = comments.map((comment) => normalize(comment.comment_text).length);
  const uniqueCommenters = new Set(comments.map((comment) => normalize(comment.comment_author).toLowerCase()).filter(Boolean));
  const postLikeCounts = postRows.map((row) => Number(row.post_like_count ?? 0));
  const repostCounts = postRows.map((row) => Number(row.repost_count ?? 0));
  const failuresByReason = {};
  const preloadOnlyByReason = {};
  for (const post of posts) {
    const reason = post.stop_reason || post.last_error || "unknown";
    const row = postRows.find((candidate) => candidate.shortcode === post.shortcode);
    if (post.status === "failed" && !isMeaningfulSummaryAttempt(row)) {
      preloadOnlyByReason[reason] = (preloadOnlyByReason[reason] ?? 0) + 1;
      continue;
    }
    if (post.status === "failed" || post.status === "partial" || post.status === "partial_unknown_target") {
      failuresByReason[reason] = (failuresByReason[reason] ?? 0) + 1;
    }
  }
  const attemptedRows = postRows.filter(isMeaningfulSummaryAttempt);
  const claimedRows = postRows.filter((row) => row.attempts > 0);

  return {
    generated_at: new Date().toISOString(),
    output_dir: outDir,
    source_bundle: bundle.exported_at ?? null,
    source_type: bundle.type ?? "dogist_scrape_bundle",
    platform: checkpoint.platform ?? "instagram",
    creator_handle: creatorHandle,
    target: checkpoint.target ?? creatorHandle,
    checkpoint: {
      status: checkpoint.status ?? null,
      stop_reason: checkpoint.stop_reason ?? null,
      discovery: checkpoint.discovery ?? null,
      last_attempted_post: checkpoint.last_attempted_post ?? null,
      counts: checkpoint.counts ?? null,
      next_queued_post: findNextQueuedPost(checkpoint, posts)
    },
    overall: {
      total_posts_discovered: posts.length,
      total_posts_attempted: attemptedRows.length,
      total_posts_claimed: claimedRows.length,
      preload_only_claims: claimedRows.length - attemptedRows.length,
      completed_posts: posts.filter((post) => post.status === "complete").length,
      partial_posts: posts.filter((post) => post.status === "partial" || post.status === "partial_unknown_target").length,
      partial_unknown_target_posts: posts.filter((post) => post.status === "partial_unknown_target").length,
      failed_posts: postRows.filter((row) => row.status === "failed" && isMeaningfulSummaryAttempt(row)).length,
      comments_captured: comments.length,
      unique_commenters: uniqueCommenters.size,
      total_post_likes: postLikeCounts.reduce((sum, value) => sum + value, 0),
      total_reposts: repostCounts.reduce((sum, value) => sum + value, 0),
      mean_comments_per_attempted_post: Number(mean(attemptedRows.map((row) => row.captured_comments)).toFixed(2)),
      median_comments_per_attempted_post: Number(median(attemptedRows.map((row) => row.captured_comments)).toFixed(2)),
      total_comment_likes: allLikes.reduce((sum, value) => sum + value, 0),
      mean_comment_likes: Number(mean(allLikes).toFixed(2)),
      median_comment_likes: Number(median(allLikes).toFixed(2)),
      mean_text_length: Number(mean(allLengths).toFixed(2)),
      median_text_length: Number(median(allLengths).toFixed(2))
    },
    quality: {
      posts_with_zero_comments: postRows.filter((row) => isMeaningfulSummaryAttempt(row) && row.captured_comments === 0).map((row) => row.shortcode),
      posts_missing_caption: postRows.filter((row) => isMeaningfulSummaryAttempt(row) && !row.caption_preview).map((row) => row.shortcode),
      posts_missing_posted_at: postRows.filter((row) => isMeaningfulSummaryAttempt(row) && !row.posted_at).map((row) => row.shortcode),
      failures_by_reason: failuresByReason,
      preload_only_by_reason: preloadOnlyByReason,
      last_successful_post: [...postRows].reverse().find((row) => row.status === "complete" || row.status === "partial" || row.status === "partial_unknown_target")?.shortcode ?? null
    },
    posts: postRows
  };
}

function isMeaningfulSummaryAttempt(row) {
  if (!row) return false;
  if (Number(row.captured_comments || 0) > 0) return true;
  if (row.active_hydrated_at || row.active_scrape_started_at || row.active_scrape_finished_at) return true;
  if (row.status === "failed" && row.stop_reason !== "tab_load_timeout") return true;
  return false;
}

function queueToBundle(queue) {
  const creatorHandle = queue.creator_handle ?? queue.target ?? "thedogist";
  const posts = (queue.posts ?? []).map((post, index) => ({
    shortcode: post.shortcode,
    kind: post.kind,
    url: post.url,
    canonical_url: post.canonical_url ?? null,
    status: "queued",
    attempts: 0,
    discovered_at: post.discovered_at ?? null,
    discovery_round: post.discovery_round ?? null,
    visible_index: post.visible_index ?? post.position ?? index + 1,
    captured_comments: 0,
    displayed_comment_count: null,
    target_comment_count: null,
    like_count: null,
    repost_count: null,
    stop_reason: null
  }));
  return {
    version: 1,
    type: "dogist_post_queue",
    exported_at: queue.exported_at ?? null,
    checkpoint: {
      run_id: queue.run_id,
      platform: queue.platform ?? "instagram",
      creator_handle: creatorHandle,
      target: queue.target ?? creatorHandle,
      profile_url: queue.profile_url ?? "https://www.instagram.com/thedogist/",
      status: "stopped",
      phase: "scraping",
      run_mode: "scrape_queue",
      stop_reason: "queue_only_input",
      discovery: queue.discovery ?? null,
      discovered_post_queue: posts.map((post) => post.shortcode),
      counts: {
        discovered_posts: posts.length,
        attempted_posts: 0,
        completed_posts: 0,
        partial_posts: 0,
        failed_posts: 0,
        comments_captured: 0
      }
    },
    posts,
    comments: [],
    raw_post_records: [],
    events: []
  };
}

function buildPostQueue(bundle) {
  const checkpoint = bundle.checkpoint ?? {};
  const creatorHandle = getCreatorHandle(bundle);
  const byShortcode = new Map((bundle.posts ?? []).map((post) => [post.shortcode, post]));
  const ordered = (checkpoint.discovered_post_queue ?? [])
    .map((shortcode, index) => {
      const post = byShortcode.get(shortcode);
      if (!post) return null;
      return {
        position: index + 1,
        shortcode: post.shortcode,
        kind: post.kind,
        url: post.url,
        canonical_url: post.canonical_url ?? null,
        discovered_at: post.discovered_at ?? null,
        discovery_round: post.discovery_round ?? null,
        visible_index: post.visible_index ?? null
      };
    })
    .filter(Boolean);

  return {
    version: 1,
    type: "blackhole_instagram_post_queue",
    platform: checkpoint.platform ?? "instagram",
    creator_handle: creatorHandle,
    target: checkpoint.target ?? creatorHandle,
    profile_url: checkpoint.profile_url ?? "https://www.instagram.com/thedogist/",
    run_id: checkpoint.run_id ?? null,
    exported_at: new Date().toISOString(),
    discovery: checkpoint.discovery ?? null,
    counts: {
      posts: ordered.length
    },
    posts: ordered
  };
}

function buildPostUrlsCsv(queue) {
  const headers = [
    "position",
    "shortcode",
    "kind",
    "url",
    "canonical_url",
    "discovered_at",
    "discovery_round",
    "visible_index"
  ];
  return [
    headers.join(","),
    ...queue.posts.map((post) => headers.map((header) => csvCell(post[header])).join(","))
  ].join("\n") + "\n";
}

function findNextQueuedPost(checkpoint, posts) {
  const byShortcode = new Map(posts.map((post) => [post.shortcode, post]));
  for (const shortcode of checkpoint.discovered_post_queue ?? []) {
    const post = byShortcode.get(shortcode);
    if (post?.status === "queued") return shortcode;
  }
  return null;
}

function getCreatorHandle(bundle) {
  const checkpoint = bundle.checkpoint ?? {};
  const raw = checkpoint.creator_handle || checkpoint.target || bundle.post_queue?.creator_handle || bundle.post_queue?.target || "thedogist";
  return normalizeHandle(raw);
}

function normalizeHandle(value) {
  const text = normalize(value).replace(/^@/, "");
  try {
    const url = new URL(text, "https://www.instagram.com");
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (first) return first.toLowerCase();
  } catch {
    // Plain handles are expected.
  }
  const match = text.match(/[A-Za-z0-9._]{1,30}/);
  return (match ? match[0] : "thedogist").toLowerCase();
}

function buildCsv(summary) {
  const headers = [
    "shortcode",
    "kind",
    "url",
    "status",
    "attempts",
    "post_like_count",
    "repost_count",
    "captured_comments",
    "displayed_comment_count",
    "target_comment_count",
    "target_comment_source",
    "capture_rate_estimate",
    "unique_commenters",
    "total_comment_likes",
    "mean_comment_likes",
    "median_comment_likes",
    "mean_text_length",
    "median_text_length",
    "posted_at",
    "stop_reason",
    "exhaustion_reason",
    "effective_concurrency",
    "worker_id",
    "active_hydrated_at",
    "active_hydrate_ms",
    "hydrate_visibility_state",
    "hydrate_comments_found",
    "hydrate_target_comment_count",
    "active_scrape_started_at",
    "active_scrape_finished_at",
    "active_scroll_rounds",
    "active_visibility_states",
    "background_scroll_visibility_states",
    "caption_preview"
  ];
  return [
    headers.join(","),
    ...summary.posts.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n") + "\n";
}

function buildImportJson(bundle, summary) {
  const postsByShortcode = new Map((bundle.posts ?? []).map((post) => [post.shortcode, post]));
  const creatorHandle = getCreatorHandle(bundle);
  return {
    generated_at: new Date().toISOString(),
    source: "blackhole-instagram-extension",
    platform: "instagram",
    creator_handle: creatorHandle,
    videos: summary.posts
      .filter(isMeaningfulSummaryAttempt)
      .map((row) => {
        const post = postsByShortcode.get(row.shortcode) ?? {};
        const rawLikeCount = Number(post.like_count ?? 0);
        const topCommentLikes = Number(row.top_comments_by_likes?.[0]?.likes ?? 0);
        return {
          id: `instagram_${creatorHandle}_${row.shortcode}`,
          title: row.caption_preview || null,
          posted_date: row.posted_at,
          total_comments: row.displayed_comment_count ?? row.captured_comments,
          like_count: rawLikeCount >= topCommentLikes ? rawLikeCount : 0,
          repost_count: row.repost_count ?? null,
          captured_comments: row.captured_comments,
          capture_rate_estimate: row.capture_rate_estimate,
          thumbnail_url: null,
          view_count: 0,
          permalink_url: row.url
        };
      }),
    comments: (bundle.comments ?? []).map((comment) => ({
      id: comment.comment_id,
      video_id: `instagram_${creatorHandle}_${comment.post_shortcode}`,
      text: comment.comment_text,
      likes: comment.comment_likes ?? 0,
      author: comment.comment_author ?? "unknown",
      verified: comment.comment_verified ?? false,
      native_comment_id: comment.native_comment_id ?? null,
      comment_permalink: comment.comment_permalink ?? null,
      parent_comment_id: comment.parent_comment_id ?? null,
      depth: comment.comment_depth ?? 0
    }))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) throw new Error("--input is required");

  const bundle = await loadInput(args.input);
  const creatorHandle = getCreatorHandle(bundle);
  const runId = bundle.checkpoint?.run_id || path.basename(args.input, ".json").replace(/^dogist-scrape-/, "").replace(/-manifest$/, "");
  const outDir = args.out || path.join(DEFAULT_BASE_OUT, creatorHandle, runId);
  await fs.mkdir(outDir, { recursive: true });

  const summary = buildSummary(bundle, outDir);
  const importJson = buildImportJson(bundle, summary);
  const postQueue = buildPostQueue(bundle);

  await writeJson(path.join(outDir, "checkpoint.json"), bundle.checkpoint ?? {});
  await writeJsonl(path.join(outDir, "comments.jsonl"), bundle.comments ?? []);
  await writeJsonl(path.join(outDir, "raw_posts.jsonl"), bundle.raw_post_records ?? []);
  await writeJson(path.join(outDir, "post-queue.json"), postQueue);
  await fs.writeFile(path.join(outDir, "post-urls.csv"), buildPostUrlsCsv(postQueue));
  await writeJson(path.join(outDir, "summary.json"), summary);
  await fs.writeFile(path.join(outDir, "summary.csv"), buildCsv(summary));
  await writeJson(path.join(outDir, "comment-analysis-import.json"), importJson);

  console.log(`Processed Blackhole Instagram input: ${args.input}`);
  console.log(`Output: ${outDir}`);
  console.log(`${summary.overall.total_posts_attempted} attempted posts, ${summary.overall.comments_captured} comments`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
