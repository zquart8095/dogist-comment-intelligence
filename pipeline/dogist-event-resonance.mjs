#!/usr/bin/env node
/**
 * Builds post-window event resonance outputs for the Dogist corpus.
 *
 * Default mode is fully local and uses curated manual seeds. Pass
 * --fetch-gdelt to add cached GDELT DOC 2.0 article candidates.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data/processed/comment-analysis-import.json");
const DEFAULT_OUT = path.join(ROOT, "data/opportunity-analysis");

const WINDOW_DAYS = [1, 3, 7];
const REQUEST_DELAY_MS = 5500;

const MANUAL_EVENT_SEEDS = [
  {
    event_id: "knicks_2026_nba_finals_win",
    name: "New York Knicks win the 2026 NBA Finals",
    event_date: "2026-06-14T03:30:00.000Z",
    date_range: { start: "2026-06-14", end: "2026-06-18" },
    event_type: "sports_championship",
    source: "manual_seed",
    source_url: "https://www.nba.com/playoffs/2026/nba-finals",
    description: "The Knicks won Game 5 of the 2026 NBA Finals and the series 4-1, creating a New York celebration window.",
    entities: ["knicks", "new york knicks", "nba", "championship", "finals", "spurs", "jalen brunson"],
    locations: ["new york", "nyc", "manhattan", "madison square garden"],
    query_terms: ["knicks", "new york knicks", "nba championship", "championship", "finals", "spurs", "knicks in five"],
    emoji_markers: ["🏀", "🏆", "💙", "🧡", "👏", "🙌", "🔥"],
    salience: 0.9,
    gdelt_query: "\"New York Knicks\" championship",
  },
  {
    event_id: "knicks_2026_championship_parade_meetup",
    name: "Knicks championship parade and Dogist meetup window",
    event_date: "2026-06-18T16:00:00.000Z",
    date_range: { start: "2026-06-18", end: "2026-06-18" },
    event_type: "local_celebration",
    source: "manual_seed",
    source_url: "https://www.nba.com/playoffs/2026/nba-finals",
    description: "New York celebration activity around the Knicks title, including Dogist's June 18 dog meetup/parade content.",
    entities: ["knicks", "new york knicks", "parade", "championship parade", "dogist meetup", "nyknicks"],
    locations: ["new york", "nyc", "manhattan", "washington square park"],
    query_terms: ["knicks", "parade", "championship parade", "meetup", "washington square", "nyknicks"],
    emoji_markers: ["🏀", "🐶", "🏆", "💙", "🧡"],
    salience: 0.75,
    gdelt_query: "\"New York Knicks\" parade",
  },
  {
    event_id: "justice_for_jameson_discourse",
    name: "Justice for Jameson memorial and anger discourse",
    event_date: "2026-06-16T12:00:00.000Z",
    date_range: { start: "2026-06-16", end: "2026-06-18" },
    event_type: "social_memorial_discourse",
    source: "manual_seed",
    source_url: null,
    description: "Dogist commenters connected Knicks celebration posts to Jameson, a Knicks fan dog, using memorial and justice language.",
    entities: ["jameson", "justice for jameson", "lapd", "knicks dog", "jamison"],
    locations: ["los angeles", "la", "new york", "nyc"],
    query_terms: ["jameson", "jamison", "justice for jameson", "#justiceforjameson", "lapd", "moment of silence", "tribute", "rainbow bridge"],
    emoji_markers: ["💙", "🧡", "🌈", "🐾", "😢", "💔", "🙏", "❤️‍🩹"],
    salience: 0.65,
    gdelt_query: "\"Justice for Jameson\" OR (Jameson LAPD dog)",
  },
];

const TERM_GROUPS = {
  justice_language: [
    /justice\s+for\s+jameson/i,
    /#justiceforjameson/i,
    /\bjustice\b/i,
    /\blapd\b/i,
    /trigger happy/i,
    /police over reaction/i,
  ],
  grief_memorial_language: [
    /\br\.?i\.?p\.?\b/i,
    /rainbow bridge/i,
    /\bmemorial\b/i,
    /\bin memory\b/i,
    /\btribute\b/i,
    /moment of silence/i,
    /\bin spirit\b/i,
    /\bhearts?\b/i,
    /\bsobbing\b/i,
    /\bdead dog\b/i,
  ],
  celebration_language: [
    /\bknicks\b/i,
    /\bchampionship\b/i,
    /\bparade\b/i,
    /\bcelebrat/i,
    /\blfg\b/i,
    /go knicks/i,
    /knicks in five/i,
    /\btrophy\b/i,
    /\bwin\b/i,
  ],
  community_language: [
    /\bmeetup\b/i,
    /\bjoin\b/i,
    /\btogether\b/i,
    /\bcommunity\b/i,
    /washington square/i,
    /\bnyc\b/i,
    /new york/i,
    /\bhonor\b/i,
    /\bmomentum\b/i,
  ],
  calls_to_action: [
    /\bplease\b/i,
    /\bshould\b/i,
    /can we/i,
    /moment of silence/i,
    /\bhonor\b/i,
    /\bjustice\b/i,
    /\btribute\b/i,
    /photoshop/i,
  ],
  brand_product_relevance: [
    /\bblueberr/i,
    /\btreat\b/i,
    /\btreats\b/i,
    /\bsupplement\b/i,
    /\bbuy\b/i,
    /\bproduct\b/i,
    /\brecipe\b/i,
  ],
};

const LOCATION_PATTERNS = [
  ["new york", /\bnew york\b|\bnyc\b/i],
  ["brooklyn", /\bbrooklyn\b/i],
  ["manhattan", /\bmanhattan\b/i],
  ["queens", /\bqueens\b/i],
  ["washington square park", /washington square/i],
  ["central park", /central park/i],
  ["los angeles", /\blos angeles\b|\bla\b|\blapd\b/i],
  ["san diego", /san diego/i],
  ["tampa", /\btampa\b/i],
];

const ENTITY_PATTERNS = [
  ["knicks", /\bknicks\b|@nyknicks/i],
  ["new york knicks", /new york knicks/i],
  ["nba", /\bnba\b/i],
  ["championship", /\bchampionship\b/i],
  ["parade", /\bparade\b/i],
  ["meetup", /\bmeetup\b/i],
  ["washington square", /washington square/i],
  ["jameson", /\bjameson\b/i],
  ["jamison", /\bjamison\b/i],
  ["justice for jameson", /justice\s+for\s+jameson|#justiceforjameson/i],
  ["lapd", /\blapd\b/i],
  ["spurs", /\bspurs\b/i],
  ["dogist", /\bdogist\b|@thedogist/i],
  ["elsa", /\belsa\b/i],
  ["blueberry", /\bblueberr/i],
  ["rescue", /\brescue\b|\brescued\b/i],
  ["adoption", /\badopt/i],
  ["senior dog", /\bsenior\b/i],
];

const POST_CLUSTER_RULES = [
  ["Food, treats, and recipes", /\bblueberr|\btreat|\brecipe|\bfood|\beat|\bkibble|\bpicky|\bsnack/i],
  ["Health, senior, and care stories", /\bsenior\b|\bdiabet|\bblind\b|\bvet\b|\bhealth\b|\bcancer\b|\bsurgery\b/i],
  ["Loss, grief, and memorial stories", /\brainbow bridge|\brip\b|\bgrief\b|\bmiss\b|\bpassed away\b|\bin memory\b/i],
  ["Rescue and adoption stories", /\brescue|\badopt|\bfoster|\bshelter|\bstray\b/i],
  ["IRL community, walks, and events", /\bknicks\b|\bmeetup\b|\bevent\b|\bparade\b|\bnyc\b|new york|washington square|central park|come to|visit/i],
  ["Products, gear, and commerce", /\bbuy\b|\blink\b|\bbrand\b|\bmerch\b|\bcollar\b|\bleash\b|\bharness\b/i],
  ["Behavior, anxiety, and training", /\btraining\b|\btrainer\b|\banxiety\b|\bbark\b|\bleash\b|\breactive\b|\bcrate\b/i],
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    if (flag === "--input") args.input = resolveUserPath(next());
    else if (flag === "--out") args.out = resolveUserPath(next());
    else if (flag === "--cache-dir") args.cacheDir = resolveUserPath(next());
    else if (flag === "--fetch-gdelt") args.fetchGdelt = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function resolveUserPath(value) {
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function printHelp() {
  console.log(`Dogist event resonance analysis

Usage:
  npm run dogist:event -- --input data/processed/comment-analysis-import.json

Options:
  --input <file>       Processed comment-analysis-import.json.
  --out <dir>          Output directory. Defaults to opportunity-analysis.
  --cache-dir <dir>    Cache directory. Defaults to <out>/event-cache.
  --fetch-gdelt        Add cached GDELT DOC 2.0 article candidates.
`);
}

function normalizeLoose(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}#@'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return normalizeLoose(value)
    .split(/\s+/)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));
}

function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function graphemes(value) {
  const text = String(value ?? "");
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

function isEmojiSegment(value) {
  return /\p{Extended_Pictographic}/u.test(value)
    || /\p{Emoji_Presentation}/u.test(value)
    || /\p{Emoji}\uFE0F/u.test(value);
}

function extractEmojis(value) {
  return graphemes(value).filter(isEmojiSegment);
}

function stripEmojiAndWhitespace(value) {
  return graphemes(value)
    .filter((part) => !isEmojiSegment(part) && !/\s/u.test(part) && part !== "\uFE0F")
    .join("");
}

function extractMentions(value) {
  const mentions = new Set();
  for (const match of String(value ?? "").matchAll(/(^|[^\w])(@[\w.]+)/g)) mentions.add(match[2].toLowerCase());
  return [...mentions];
}

function extractHashtags(value) {
  const hashtags = new Set();
  for (const match of String(value ?? "").matchAll(/(^|[^\w])(#\w+)/g)) hashtags.add(match[2].toLowerCase());
  return [...hashtags];
}

function extractPatternValues(value, patterns) {
  const text = String(value ?? "");
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function languageCues(value) {
  const text = String(value ?? "");
  const scriptCues = [];
  if (/\p{Script=Han}/u.test(text)) scriptCues.push("han");
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) scriptCues.push("japanese");
  if (/\p{Script=Arabic}/u.test(text)) scriptCues.push("arabic");
  if (/\p{Script=Cyrillic}/u.test(text)) scriptCues.push("cyrillic");
  if (/\p{Script=Hebrew}/u.test(text)) scriptCues.push("hebrew");
  if (/\p{Script=Hangul}/u.test(text)) scriptCues.push("hangul");
  return {
    has_non_ascii: /[^\x00-\x7F]/.test(text),
    has_non_latin_script: scriptCues.length > 0,
    script_cues: scriptCues,
  };
}

function countTermGroups(comments) {
  const counts = {};
  for (const key of Object.keys(TERM_GROUPS)) counts[key] = 0;
  for (const comment of comments) {
    const text = String(comment.text ?? "");
    for (const [key, patterns] of Object.entries(TERM_GROUPS)) {
      if (patterns.some((pattern) => pattern.test(text))) counts[key] += 1;
    }
  }
  return counts;
}

function topPhrases(comments, limit = 20) {
  const counts = new Map();
  for (const comment of comments) {
    const tokens = words(comment.text ?? "").filter((token) => token.length <= 24 && !token.startsWith("@"));
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
  }
  return topEntries(counts, limit);
}

function emojiSummary(comments) {
  const emojiCounts = new Map();
  const sequenceCounts = new Map();
  let emojiOnlyComments = 0;
  let textAndEmojiComments = 0;
  let repeatedEmojiComments = 0;

  for (const comment of comments) {
    const text = String(comment.text ?? "");
    const emojis = extractEmojis(text);
    if (emojis.length === 0) continue;
    if (stripEmojiAndWhitespace(text).length === 0) emojiOnlyComments += 1;
    else textAndEmojiComments += 1;

    for (const emoji of emojis) emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + 1);
    const sequence = emojis.join("");
    if (sequence) sequenceCounts.set(sequence, (sequenceCounts.get(sequence) ?? 0) + 1);
    if (emojis.some((emoji, index) => index > 0 && emojis[index - 1] === emoji)) repeatedEmojiComments += 1;
  }

  return {
    emoji_comments: emojiOnlyComments + textAndEmojiComments,
    emoji_only_comments: emojiOnlyComments,
    text_and_emoji_comments: textAndEmojiComments,
    repeated_emoji_comments: repeatedEmojiComments,
    top_emojis: topEntries(emojiCounts, 20),
    top_emoji_sequences: topEntries(sequenceCounts, 12),
  };
}

function inferPostCluster(title, comments) {
  const combined = `${title ?? ""}\n${comments.slice(0, 60).map((comment) => comment.text ?? "").join("\n")}`;
  const match = POST_CLUSTER_RULES.find(([, pattern]) => pattern.test(combined));
  return match?.[0] ?? "General portrait or story posts";
}

function buildPostTimeline(input) {
  const videos = input.videos ?? [];
  const comments = input.comments ?? [];
  const commentsByPost = new Map();
  for (const comment of comments) {
    if (!commentsByPost.has(comment.video_id)) commentsByPost.set(comment.video_id, []);
    commentsByPost.get(comment.video_id).push(comment);
  }

  const posts = videos
    .map((video) => {
      const postComments = commentsByPost.get(video.id) ?? [];
      const caption = String(video.title ?? "");
      const commentText = postComments.map((comment) => comment.text ?? "").join("\n");
      const combined = `${caption}\n${commentText}`;
      const hashtags = new Set([...extractHashtags(caption), ...postComments.flatMap((comment) => extractHashtags(comment.text))]);
      const mentions = new Set([...extractMentions(caption), ...postComments.flatMap((comment) => extractMentions(comment.text))]);
      const entities = new Set([
        ...extractPatternValues(caption, ENTITY_PATTERNS),
        ...extractPatternValues(commentText, ENTITY_PATTERNS),
      ]);
      const locations = new Set([
        ...extractPatternValues(caption, LOCATION_PATTERNS),
        ...extractPatternValues(commentText, LOCATION_PATTERNS),
      ]);
      const termCounts = countTermGroups(postComments);
      const emoji = emojiSummary(postComments);
      const language = languageCues(combined);

      return {
        post_id: video.id,
        posted_date: video.posted_date ?? null,
        caption,
        post_url: video.permalink_url ?? null,
        like_count: Number(video.like_count ?? 0),
        total_comments: Number(video.total_comments ?? 0),
        captured_comments: Number(video.captured_comments ?? postComments.length),
        capture_rate_estimate: Number(video.capture_rate_estimate ?? 0),
        post_cluster: inferPostCluster(caption, postComments),
        entities: [...entities].sort(),
        hashtags: [...hashtags].sort(),
        mentions: [...mentions].sort(),
        location_cues: [...locations].sort(),
        top_comment_phrases: topPhrases(postComments, 16),
        emoji,
        term_counts: termCounts,
        language_cues: language,
        comment_ids: postComments.map((comment) => comment.id).filter(Boolean),
      };
    })
    .sort((a, b) => String(a.posted_date ?? "").localeCompare(String(b.posted_date ?? "")));

  return {
    generated_at: new Date().toISOString(),
    source: input.source ?? null,
    creator_handle: input.creator_handle ?? null,
    summary: {
      posts: posts.length,
      comments: comments.length,
      posts_with_dates: posts.filter((post) => post.posted_date).length,
      posts_with_emoji_comments: posts.filter((post) => post.emoji.emoji_comments > 0).length,
    },
    posts,
  };
}

function buildManualEventCandidates(postTimeline) {
  const posts = postTimeline.posts ?? [];
  return {
    generated_at: new Date().toISOString(),
    gdelt_enabled: false,
    cache_policy: "External event lookups must be cached locally and are never run per comment.",
    query_windows: WINDOW_DAYS.map((days) => ({ days })),
    methodology: {
      unit_of_analysis: "post_time_window",
      note: "Comment timestamps are unavailable, so candidate events are linked to post-level windows only.",
      default_windows_days: WINDOW_DAYS,
      sources: ["manual_seed"],
    },
    candidates: MANUAL_EVENT_SEEDS.map((seed) => ({
      ...seed,
      windows: WINDOW_DAYS.map((days) => ({ days, start: offsetDate(seed.event_date, -days), end: offsetDate(seed.event_date, days) })),
      candidate_post_ids: posts
        .filter((post) => daysBetween(post.posted_date, seed.event_date) <= 7)
        .map((post) => post.post_id),
    })),
  };
}

function offsetDate(isoDate, days) {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

function containsTerm(text, term) {
  const normalized = normalizeLoose(text);
  const cleanTerm = normalizeLoose(term).replace(/^#/, "");
  if (!cleanTerm) return false;
  if (term.startsWith("#")) return normalized.includes(cleanTerm);
  return normalized.includes(cleanTerm);
}

function eventTermHits(post, event) {
  const captionHits = [];
  const phraseHits = [];
  const hashtagHits = [];
  const entityHits = [];
  const commentText = [
    ...post.top_comment_phrases.map((item) => item.value),
    ...(post.hashtags ?? []),
    ...(post.entities ?? []),
  ].join("\n");

  for (const term of event.query_terms ?? []) {
    if (containsTerm(post.caption, term)) captionHits.push(term);
    if ((post.top_comment_phrases ?? []).some((phrase) => containsTerm(phrase.value, term))) phraseHits.push(term);
    if ((post.hashtags ?? []).some((hashtag) => containsTerm(hashtag, term))) hashtagHits.push(term);
    if ((post.entities ?? []).some((entity) => containsTerm(entity, term)) || containsTerm(commentText, term)) entityHits.push(term);
  }

  return {
    captionHits: [...new Set(captionHits)],
    phraseHits: [...new Set(phraseHits)],
    hashtagHits: [...new Set(hashtagHits)],
    entityHits: [...new Set(entityHits)],
  };
}

function baselineForPost(post, posts) {
  const date = new Date(post.posted_date);
  const sameCluster = posts.filter((candidate) => (
    candidate.post_id !== post.post_id
    && candidate.post_cluster === post.post_cluster
    && Math.abs(new Date(candidate.posted_date).getTime() - date.getTime()) / 86_400_000 <= 45
  ));
  const nearby = posts.filter((candidate) => (
    candidate.post_id !== post.post_id
    && Math.abs(new Date(candidate.posted_date).getTime() - date.getTime()) / 86_400_000 <= 21
  ));
  const sample = sameCluster.length >= 3 ? sameCluster : nearby;
  return summarizeBaseline(sample, sameCluster.length >= 3 ? "same_cluster_45d" : "nearby_21d");
}

function summarizeBaseline(posts, basis) {
  const avg = (field) => posts.length
    ? posts.reduce((sum, post) => sum + Number(post[field] ?? 0), 0) / posts.length
    : 0;
  const termShares = {};
  for (const key of Object.keys(TERM_GROUPS)) {
    const totalComments = posts.reduce((sum, post) => sum + Number(post.captured_comments ?? 0), 0);
    const totalHits = posts.reduce((sum, post) => sum + Number(post.term_counts?.[key] ?? 0), 0);
    termShares[key] = totalComments ? totalHits / totalComments : 0;
  }
  const emojiCounts = new Map();
  let emojiCommentTotal = 0;
  for (const post of posts) {
    emojiCommentTotal += Number(post.emoji?.emoji_comments ?? 0);
    for (const item of post.emoji?.top_emojis ?? []) {
      emojiCounts.set(item.value, (emojiCounts.get(item.value) ?? 0) + item.count);
    }
  }
  return {
    basis,
    posts: posts.length,
    avg_captured_comments: Number(avg("captured_comments").toFixed(2)),
    avg_like_count: Number(avg("like_count").toFixed(2)),
    term_shares: termShares,
    emoji_per_emoji_comment: Object.fromEntries(
      topEntries(emojiCounts, 12).map((item) => [item.value, emojiCommentTotal ? Number((item.count / emojiCommentTotal).toFixed(4)) : 0])
    ),
  };
}

function scorePostEvent(post, event, baseline = null) {
  const reasons = [];
  let score = 0;
  const days = daysBetween(post.posted_date, event.event_date);
  if (days <= 1) {
    score += 25;
    reasons.push(`temporal_proximity:${days.toFixed(1)}d`);
  } else if (days <= 3) {
    score += 18;
    reasons.push(`temporal_proximity:${days.toFixed(1)}d`);
  } else if (days <= 7) {
    score += 10;
    reasons.push(`temporal_proximity:${days.toFixed(1)}d`);
  } else {
    return { score: 0, confidence: "none", reason_codes: [], components: { days_from_event: Number(days.toFixed(2)) } };
  }

  const postEntities = new Set(post.entities ?? []);
  for (const entity of event.entities ?? []) {
    if (postEntities.has(entity) || [...postEntities].some((value) => containsTerm(value, entity))) {
      if (!reasons.includes(`entity_overlap:${entity.replace(/\s+/g, "_")}`)) {
        reasons.push(`entity_overlap:${entity.replace(/\s+/g, "_")}`);
        score += 8;
      }
    }
  }
  score = Math.min(score, 25 + 24 + (days <= 3 ? 8 : 0));

  const locations = new Set(post.location_cues ?? []);
  for (const location of event.locations ?? []) {
    if (locations.has(location)) {
      reasons.push(`location_overlap:${location.replace(/\s+/g, "_")}`);
      score += 12;
      break;
    }
  }

  const hits = eventTermHits(post, event);
  for (const term of hits.captionHits.slice(0, 3)) {
    reasons.push(`caption_overlap:${term.replace(/\s+/g, "_").replace(/^#/, "hashtag_")}`);
    score += 8;
  }
  for (const term of hits.phraseHits.slice(0, 3)) {
    reasons.push(`comment_phrase:${term.replace(/\s+/g, "_").replace(/^#/, "hashtag_")}`);
    score += 8;
  }
  for (const term of hits.hashtagHits.slice(0, 2)) {
    reasons.push(`comment_hashtag:${term.replace(/^#/, "")}`);
    score += 10;
  }
  if (hits.entityHits.length > 0 && !reasons.some((reason) => reason.startsWith("entity_overlap:"))) {
    reasons.push(`comment_entity:${hits.entityHits[0].replace(/\s+/g, "_").replace(/^#/, "hashtag_")}`);
    score += 8;
  }

  const eventEmoji = new Set(event.emoji_markers ?? []);
  const emojiHits = (post.emoji?.top_emojis ?? []).filter((item) => eventEmoji.has(item.value));
  if (emojiHits.length >= 2) {
    const code = event.event_id.includes("jameson") ? "emoji_shift:memorial_orange_blue" : "emoji_shift:event_markers";
    reasons.push(code);
    score += 7;
  }

  if (baseline?.posts) {
    const capturedBaseline = Math.max(baseline.avg_captured_comments, 1);
    if (post.captured_comments / capturedBaseline >= 1.5) {
      reasons.push("volume_shift:captured_comments_above_baseline");
      score += 5;
    }
    const likeBaseline = Math.max(baseline.avg_like_count, 1);
    if (post.like_count / likeBaseline >= 1.5) {
      reasons.push("volume_shift:like_count_above_baseline");
      score += 5;
    }
  }

  if (Number(event.salience ?? 0) >= 0.75) {
    reasons.push("news_salience:seeded_high");
    score += 6;
  }

  const evidenceReasons = reasons.filter((reason) => (
    reason.startsWith("entity_overlap:")
    || reason.startsWith("location_overlap:")
    || reason.startsWith("caption_overlap:")
    || reason.startsWith("comment_phrase:")
    || reason.startsWith("comment_hashtag:")
    || reason.startsWith("comment_entity:")
    || reason.startsWith("emoji_shift:")
  ));
  let confidence = "temporal_only";
  if (evidenceReasons.length > 0 && score >= 65) confidence = "strong";
  else if (evidenceReasons.length > 0 && score >= 42) confidence = "moderate";
  else if (evidenceReasons.length > 0 && score >= 25) confidence = "weak";

  return {
    score: Math.min(100, score),
    confidence,
    reason_codes: [...new Set(reasons)],
    components: {
      days_from_event: Number(days.toFixed(2)),
      caption_hits: hits.captionHits,
      comment_phrase_hits: hits.phraseHits,
      hashtag_hits: hits.hashtagHits,
      entity_hits: hits.entityHits,
      emoji_hits: emojiHits.map((item) => item.value),
    },
  };
}

function linkEventsToPosts(postTimeline, eventCandidates) {
  const posts = postTimeline.posts ?? [];
  const candidates = eventCandidates.candidates ?? [];
  const links = [];

  for (const post of posts) {
    const baseline = baselineForPost(post, posts);
    for (const event of candidates) {
      const scored = scorePostEvent(post, event, baseline);
      if (scored.score < 25 && scored.confidence !== "temporal_only") continue;
      if (scored.score === 0) continue;
      links.push({
        link_id: `${post.post_id}__${event.event_id}`,
        post_id: post.post_id,
        event_id: event.event_id,
        event_name: event.name,
        posted_date: post.posted_date,
        event_date: event.event_date,
        post_url: post.post_url,
        post_caption: post.caption,
        score: scored.score,
        confidence: scored.confidence,
        reason_codes: scored.reason_codes,
        components: scored.components,
        baseline,
        warning: scored.confidence === "temporal_only"
          ? "Temporal correlation only. Do not infer audience causality without textual or entity evidence."
          : "Candidate external context. Treat as event-adjacent unless validated.",
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    scoring_note: "Post-event links are scored by temporal proximity, text/entity/location overlap, emoji markers, abnormal volume, and external salience. Scores are evidence triage, not causal proof.",
    links: links.sort((a, b) => b.score - a.score || a.posted_date.localeCompare(b.posted_date)),
  };
}

function share(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

function compareToBaseline(post, baseline) {
  const termShareDeltas = {};
  for (const key of Object.keys(TERM_GROUPS)) {
    const postShare = share(post.term_counts?.[key] ?? 0, post.captured_comments);
    termShareDeltas[key] = Number((postShare - (baseline?.term_shares?.[key] ?? 0)).toFixed(4));
  }
  const emojiDeltas = {};
  for (const item of post.emoji?.top_emojis ?? []) {
    const baselineShare = baseline?.emoji_per_emoji_comment?.[item.value] ?? 0;
    const postShare = share(item.count, Math.max(post.emoji?.emoji_comments ?? 0, 1));
    const delta = Number((postShare - baselineShare).toFixed(4));
    if (Math.abs(delta) >= 0.02) emojiDeltas[item.value] = delta;
  }
  return {
    captured_comments_delta_vs_baseline: baseline?.posts ? Number((post.captured_comments - baseline.avg_captured_comments).toFixed(2)) : null,
    like_count_delta_vs_baseline: baseline?.posts ? Number((post.like_count - baseline.avg_like_count).toFixed(2)) : null,
    term_share_deltas: termShareDeltas,
    emoji_share_deltas: emojiDeltas,
  };
}

function buildEventResonance(postTimeline, eventCandidates, postEventLinks, input) {
  const postsById = new Map((postTimeline.posts ?? []).map((post) => [post.post_id, post]));
  const commentsByPost = new Map();
  for (const comment of input.comments ?? []) {
    if (!commentsByPost.has(comment.video_id)) commentsByPost.set(comment.video_id, []);
    commentsByPost.get(comment.video_id).push(comment);
  }

  const events = [];
  for (const event of eventCandidates.candidates ?? []) {
    const links = (postEventLinks.links ?? []).filter((link) => link.event_id === event.event_id && link.confidence !== "temporal_only");
    if (links.length === 0) continue;
    const linkedPosts = links.map((link) => {
      const post = postsById.get(link.post_id);
      return {
        ...link,
        baseline_comparison: post ? compareToBaseline(post, link.baseline) : null,
      };
    });
    const evidenceQuotes = collectEvidenceQuotes(event, linkedPosts, commentsByPost, 8);
    const confidenceRank = linkedPosts.some((link) => link.confidence === "strong")
      ? "strong"
      : linkedPosts.some((link) => link.confidence === "moderate") ? "moderate" : "weak";
    events.push({
      event_id: event.event_id,
      name: event.name,
      event_date: event.event_date,
      event_type: event.event_type,
      source: event.source,
      description: event.description,
      confidence: confidenceRank,
      linked_post_count: linkedPosts.length,
      linked_posts: linkedPosts,
      top_reason_codes: topReasonCodes(linkedPosts),
      observed_pattern: observedPattern(event),
      interpretation_boundary: "Use coincided with, event-adjacent, or audience reframed the post around. Do not claim causality without strong text/entity evidence.",
      evidence_quotes: evidenceQuotes,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    unit_of_analysis: "post_time_window",
    caution: "Comment timestamps are unavailable. This module compares post-window audience response against nearby baselines and does not prove causality.",
    events: events.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))),
  };
}

function observedPattern(event) {
  if (event.event_id.includes("jameson")) {
    return "Audience comments reframed event-adjacent Knicks posts around Jameson memorial, grief, and justice language.";
  }
  if (event.event_id.includes("knicks")) {
    return "Dogist posts coincided with Knicks championship celebration and local New York identity signals.";
  }
  return "Audience response shows candidate external-event resonance that requires validation.";
}

function topReasonCodes(links) {
  const counts = new Map();
  for (const link of links) {
    for (const code of link.reason_codes ?? []) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return topEntries(counts, 12);
}

function collectEvidenceQuotes(event, linkedPosts, commentsByPost, limit) {
  const rows = [];
  const termPatterns = (event.query_terms ?? []).map((term) => new RegExp(term.replace(/^#/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  for (const link of linkedPosts) {
    for (const comment of commentsByPost.get(link.post_id) ?? []) {
      const text = String(comment.text ?? "");
      if (!termPatterns.some((pattern) => pattern.test(text)) && !eventMatchesSpecial(event, text)) continue;
      rows.push({
        post_id: link.post_id,
        post_url: link.post_url,
        posted_date: link.posted_date,
        event_id: event.event_id,
        author: comment.author ?? null,
        likes: Number(comment.likes ?? 0),
        raw_text: text,
      });
    }
  }
  return rows
    .sort((a, b) => b.likes - a.likes || b.raw_text.length - a.raw_text.length)
    .slice(0, limit);
}

function eventMatchesSpecial(event, text) {
  if (event.event_id.includes("jameson")) return /justice|jameson|jamison|lapd|rainbow bridge|moment of silence|tribute|rip/i.test(text);
  if (event.event_id.includes("knicks")) return /knicks|championship|parade|nyknicks|spurs|go knicks|lfg/i.test(text);
  return false;
}

function buildEventEvidencePackets(eventResonance) {
  return {
    generated_at: new Date().toISOString(),
    llm_boundaries: [
      "Separate observed corpus facts from event interpretation.",
      "Use candidate external context language unless textual/entity evidence is strong.",
      "Do not claim event causality from temporal proximity alone.",
      "Cite raw quotes and reason codes for every event-resonance claim.",
    ],
    packets: (eventResonance.events ?? []).flatMap((event) => (
      event.linked_posts.map((link) => ({
        event_id: event.event_id,
        event_name: event.name,
        post_id: link.post_id,
        post_url: link.post_url,
        posted_date: link.posted_date,
        link_score: link.score,
        confidence: link.confidence,
        reason_codes: link.reason_codes,
        baseline_comparison: link.baseline_comparison,
        raw_evidence_quotes: event.evidence_quotes.filter((quote) => quote.post_id === link.post_id),
        counterevidence: [
          "No per-comment timestamps are available; analysis is post-window based.",
          "Some links may reflect audience importation of outside discourse rather than the post author's intent.",
        ],
        required_output_fields: [
          "observed_pattern",
          "candidate_event_context",
          "interpretation",
          "confidence",
          "unsupported_claims_to_avoid",
        ],
        unsupported_claims_to_avoid: [
          "Do not say the event caused the comment behavior unless source text directly supports that.",
          "Do not treat Jameson discourse as part of the Knicks win itself; it is an audience reframing layer.",
          "Do not treat GDELT absence as proof that an event did not matter socially.",
        ],
      }))
    )),
  };
}

async function fetchGdeltCandidates(events, cacheDir) {
  const enriched = [];
  await fs.mkdir(cacheDir, { recursive: true });
  for (const event of events) {
    const start = `${event.date_range.start.replaceAll("-", "")}000000`;
    const end = `${event.date_range.end.replaceAll("-", "")}235959`;
    const query = event.gdelt_query ?? event.name;
    const cacheKey = crypto.createHash("sha256").update(`${query}|${start}|${end}`).digest("hex").slice(0, 16);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(cachePath, "utf8"));
    } catch {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&startdatetime=${start}&enddatetime=${end}&maxrecords=20`;
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      const response = await fetch(url);
      const text = await response.text();
      payload = { url, fetched_at: new Date().toISOString(), status: response.status, body: safeParseJson(text) ?? { raw: text } };
      await fs.writeFile(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
    }
    enriched.push({
      ...event,
      gdelt_doc: {
        cache_file: path.relative(cacheDir, cachePath),
        article_count: payload.body?.articles?.length ?? 0,
        articles: (payload.body?.articles ?? []).slice(0, 8).map((article) => ({
          title: article.title,
          url: article.url,
          domain: article.domain,
          seendate: article.seendate,
          sourceCountry: article.sourceCountry,
        })),
      },
    });
  }
  return enriched;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = args.input ?? DEFAULT_INPUT;
  const outDir = args.out ?? DEFAULT_OUT;
  const cacheDir = args.cacheDir ?? path.join(outDir, "event-cache");
  await fs.mkdir(cacheDir, { recursive: true });

  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const postTimeline = buildPostTimeline(input);
  let eventCandidates = buildManualEventCandidates(postTimeline);
  eventCandidates.cache_dir = cacheDir;
  eventCandidates.gdelt_enabled = Boolean(args.fetchGdelt);
  eventCandidates.methodology.sources = args.fetchGdelt
    ? ["manual_seed", "gdelt_doc_2_0_cached"]
    : ["manual_seed"];

  if (args.fetchGdelt) {
    eventCandidates.candidates = await fetchGdeltCandidates(eventCandidates.candidates, cacheDir);
  }

  const postEventLinks = linkEventsToPosts(postTimeline, eventCandidates);
  const eventResonance = buildEventResonance(postTimeline, eventCandidates, postEventLinks, input);
  const eventEvidencePackets = buildEventEvidencePackets(eventResonance);

  await writeJson(path.join(outDir, "post-timeline.json"), postTimeline);
  await writeJson(path.join(outDir, "event-candidates.json"), eventCandidates);
  await writeJson(path.join(outDir, "post-event-links.json"), postEventLinks);
  await writeJson(path.join(outDir, "event-resonance.json"), eventResonance);
  await writeJson(path.join(outDir, "event-evidence-packets.json"), eventEvidencePackets);

  console.log(`Event resonance analyzed ${postTimeline.summary.posts} posts and ${input.comments?.length ?? 0} comments.`);
  console.log(`Linked events: ${eventResonance.events.length}`);
  console.log(`Output: ${outDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  MANUAL_EVENT_SEEDS,
  buildEventEvidencePackets,
  buildEventResonance,
  buildManualEventCandidates,
  buildPostTimeline,
  extractEmojis,
  linkEventsToPosts,
  scorePostEvent,
};
