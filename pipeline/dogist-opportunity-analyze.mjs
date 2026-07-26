#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT = path.join(ROOT, "data/processed/comment-analysis-import.json");
const DEFAULT_OUT = path.join(ROOT, "data/opportunity-analysis");

const GENERIC_SHORT_RE = /^(so\s+)?(cute|adorable|beautiful|sweet|precious|love|lovely|amazing|awesome|perfect|best|angel|good boy|good girl|omg|wow|aww+|awww+|❤️|😍|🥹|😂|😭|👏|🔥|🙏|💕|💙|💜|💛|💚|🧡|🤍|🖤|♥️|love this|i love this|so cute|too cute|cutie)$/i;
const EMOJI_ONLY_RE = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s]+$/u;

const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "all", "also", "always", "and", "any", "are", "around",
  "because", "been", "before", "being", "between", "both", "but", "can", "could", "did", "does", "doing",
  "don", "down", "each", "for", "from", "get", "gets", "got", "had", "has", "have", "having", "her",
  "here", "hers", "him", "his", "how", "into", "its", "just", "like", "lol", "look", "looks", "make",
  "many", "more", "most", "much", "not", "now", "off", "one", "only", "our", "out", "over", "own",
  "really", "same", "see", "she", "should", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "too", "under", "very", "was", "were",
  "what", "when", "where", "which", "while", "who", "why", "will", "with", "would", "you", "your",
  "youre", "yourself", "dog", "dogs", "pup", "puppy", "pups", "doggo", "thedogist", "instagram"
]);

const LEGACY_OPPORTUNITY_BUCKETS = [
  {
    id: "food_treat_supplement_trust",
    name: "Food, Treats, And Product Trust",
    business_relevance: "Direct launch messaging for blueberry supplements, treats, ingredient trust, and picky-eater objections.",
    possible_angle: "Healthy pet products need to feel dog-approved, safe, and emotionally rewarding rather than medicinal.",
    next_validation_post: "What healthy treat does your dog actually refuse, even when you want them to like it?",
    patterns: [
      "blueberry", "blueberries", "berry", "berries", "biscuit", "biscuits", "treat", "treats", "snack", "snacks",
      "food", "foods", "eat", "eats", "ate", "eating", "recipe", "recipes", "ingredient", "ingredients", "healthy",
      "supplement", "supplements", "vitamin", "vitamins", "picky", "allergy", "allergies", "allergic", "peanut",
      "butter", "cheese", "chicken", "pumpkin", "kibble", "diet", "raw food", "home made", "homemade", "dog treat"
    ]
  },
  {
    id: "health_senior_care",
    name: "Senior, Health, And Care Companionship",
    business_relevance: "Wellness, care routines, senior dog content, and trust-building around health-adjacent products.",
    possible_angle: "The strongest wellness language may be about owner care, adaptation, and companionship, not clinical optimization.",
    next_validation_post: "What is one care routine that changed as your dog got older?",
    patterns: [
      "senior", "seniors", "aging", "blind", "deaf", "cancer", "diabetes", "diabetic", "seizure",
      "medication", "medicine", "meds", "vet", "vets", "veterinarian", "surgery", "arthritis", "pain", "illness",
      "sick", "recovery", "recovering", "wheelchair", "dementia", "hospice", "caretaker", "mobility", "take care",
      "limp", "limping", "tumor", "chemo", "kidney", "heart disease"
    ]
  },
  {
    id: "grief_loss_memorial",
    name: "Grief, Loss, And Memorial Language",
    business_relevance: "Deep emotional connection, memorial content, and sensitive customer language around end-of-life care.",
    possible_angle: "Grief posts can reveal very high trust and emotional intensity, but they should not be treated as product demand by default.",
    next_validation_post: "What helped you remember your dog in a way that felt personal?",
    patterns: [
      "rip", "rest in peace", "rainbow bridge", "passed", "passed away", "lost", "loss", "miss", "missing", "gone",
      "condolences", "cry", "cried", "crying", "tears", "heartbreak", "heartbroken", "grief", "mourning", "memorial",
      "in memory", "forever in my heart"
    ]
  },
  {
    id: "rescue_adoption_trust",
    name: "Rescue And Adoption Trust",
    business_relevance: "Mission alignment, partnership strategy, adoption storytelling, and community trust.",
    possible_angle: "Rescue/adoption may be less about immediate commerce and more about brand affinity and partner credibility.",
    next_validation_post: "What made you trust the rescue or shelter you adopted from?",
    patterns: [
      "rescue", "rescued", "rescues", "adopt", "adopted", "adoption", "shelter", "foster", "fostered", "stray",
      "saved", "rehomed", "rehome", "forever home", "pound", "humane society", "aspca", "sanctuary", "abandoned"
    ]
  },
  {
    id: "services_cost_pain",
    name: "Services, Cost, And Access Pain Points",
    business_relevance: "Potential validation area for insurance, vet-cost, walking, grooming, boarding, and care-service products.",
    possible_angle: "Organic service/cost mentions are likely undercounted; strong conclusions require targeted posts.",
    next_validation_post: "Have you tried pet insurance, and what made you keep it or cancel it?",
    patterns: [
      "insurance", "insured", "vet bill", "vet bills", "bill", "bills", "cost", "costs", "expensive", "afford",
      "walker", "walking", "walkers", "daycare", "boarding", "groomer", "grooming", "trainer", "training",
      "sitter", "sitting", "rover", "wag", "service", "services", "appointment", "appointments", "payment"
    ]
  },
  {
    id: "irl_community_sampling",
    name: "IRL Community And Sampling",
    business_relevance: "Launch-channel testing through walks, meetups, city visits, events, and product sampling.",
    possible_angle: "If the audience asks Dogist to show up in places, IRL sampling may be a stronger first test than broad e-commerce.",
    next_validation_post: "Where should The Dogist host a walk and what treat should every dog get?",
    patterns: [
      "nyc", "new york", "brooklyn", "manhattan", "central park", "meet", "meetup", "event", "events", "come to",
      "visit", "city", "sample", "samples", "sampling", "launch", "pop up", "popup",
      "collab", "collaboration", "farmers market", "booth"
    ]
  },
  {
    id: "travel_dog_friendly",
    name: "Travel And Dog-Friendly Places",
    business_relevance: "Content partnerships, place guides, and adjacent products for owners who take dogs into public life.",
    possible_angle: "Dog-friendly travel/place language can identify partnership surfaces even when it is not a product request.",
    next_validation_post: "What is the most dog-friendly place you have ever taken your dog?",
    patterns: [
      "plane", "flight", "airport", "hotel", "restaurant", "bar", "beach", "subway", "train", "car",
      "travel", "vacation", "trip", "dog friendly", "dog-friendly", "store", "cafe", "patio"
    ]
  },
  {
    id: "product_commerce_merch",
    name: "Product, Commerce, And Merch Pull",
    business_relevance: "Signals explicit purchase language, merchandise demand, gear questions, and brand/link requests.",
    possible_angle: "Explicit buying language is sparse but high value; separate it from general affection before using Claude.",
    next_validation_post: "What Dogist product would you actually buy for yourself or your dog?",
    patterns: [
      "buy", "bought", "purchase", "sell", "sold", "where can", "link", "brand", "merch",
      "collar", "leash", "harness", "toy", "toys", "bed", "blanket", "bandana", "tag", "tags", "sweater"
    ]
  },
  {
    id: "behavior_training",
    name: "Behavior, Anxiety, And Training",
    business_relevance: "Owner pain points around behavior support, training, enrichment, anxiety, and routines.",
    possible_angle: "Behavior comments can point to real owner stress and service demand, not just cute-story engagement.",
    next_validation_post: "What behavior issue did you finally understand after living with your dog?",
    patterns: [
      "reactive", "reaction", "anxiety", "anxious", "bark", "barks", "barking", "aggressive", "aggression",
      "training", "trainer", "calm", "leash", "crate", "separation anxiety", "nervous", "scared", "fearful",
      "socialize", "enrichment", "chew", "chewing"
    ]
  }
];

const POST_CLUSTER_RULES = [
  { id: "food_treats", label: "Food, treats, and recipes", topicIds: ["food_treat_supplement_trust"] },
  { id: "health_senior_care", label: "Health, senior, and care stories", topicIds: ["health_senior_care"] },
  { id: "loss_memorial", label: "Loss, grief, and memorial stories", topicIds: ["grief_loss_memorial"] },
  { id: "rescue_adoption", label: "Rescue and adoption stories", topicIds: ["rescue_adoption_trust"] },
  { id: "services_cost", label: "Services, cost, and owner logistics", topicIds: ["services_cost_pain", "behavior_training"] },
  { id: "irl_community", label: "IRL community, walks, and events", topicIds: ["irl_community_sampling", "travel_dog_friendly"] },
  { id: "commerce_products", label: "Products, gear, and commerce", topicIds: ["product_commerce_merch"] }
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
  console.log(`Dogist local opportunity analysis

Usage:
  npm run dogist:analyze
  npm run dogist:analyze -- --input local-data/instagram-scrape/thedogist/<run>/comment-analysis-import.json

Options:
  --input <file>  Processed comment-analysis-import.json. Defaults to the checked-in Dogist snapshot.
  --out <dir>    Output directory. Defaults to the Dogist opportunity-analysis directory.
`);
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\w.]+/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
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

function socialSignals(value) {
  const text = String(value ?? "");
  const emojis = extractEmojis(text);
  return {
    raw_text: text,
    normalized_text: normalizeText(text),
    emoji_features: {
      emojis,
      emoji_sequence: emojis.join(""),
      emoji_only: emojis.length > 0 && stripEmojiAndWhitespace(text).length === 0,
      repeated_emoji: emojis.some((emoji, index) => index > 0 && emojis[index - 1] === emoji),
    },
    mentions: extractMentions(text),
    hashtags: extractHashtags(text),
    language_cues: languageCues(text),
  };
}

function summarizeSocialSignals(comments) {
  const emojiCounts = new Map();
  const hashtagCounts = new Map();
  const mentionCounts = new Map();
  let emojiComments = 0;
  let emojiOnlyComments = 0;
  let textAndEmojiComments = 0;
  let repeatedEmojiComments = 0;
  let commentsWithMentions = 0;
  let commentsWithHashtags = 0;
  let commentsWithNonLatinScript = 0;
  let normalizedEmptyComments = 0;

  for (const comment of comments) {
    const social = comment.emoji_features ? comment : socialSignals(comment.text ?? "");
    const emojis = social.emoji_features?.emojis ?? [];
    if (emojis.length > 0) {
      emojiComments += 1;
      if (social.emoji_features.emoji_only) emojiOnlyComments += 1;
      else textAndEmojiComments += 1;
      if (social.emoji_features.repeated_emoji) repeatedEmojiComments += 1;
      for (const emoji of emojis) increment(emojiCounts, emoji);
    }
    if ((social.mentions ?? []).length) {
      commentsWithMentions += 1;
      for (const mention of social.mentions) increment(mentionCounts, mention);
    }
    if ((social.hashtags ?? []).length) {
      commentsWithHashtags += 1;
      for (const hashtag of social.hashtags) increment(hashtagCounts, hashtag);
    }
    if (social.language_cues?.has_non_latin_script) commentsWithNonLatinScript += 1;
    if (!social.normalized_text) normalizedEmptyComments += 1;
  }

  return {
    emoji_comments: emojiComments,
    emoji_only_comments: emojiOnlyComments,
    text_and_emoji_comments: textAndEmojiComments,
    repeated_emoji_comments: repeatedEmojiComments,
    comments_with_mentions: commentsWithMentions,
    comments_with_hashtags: commentsWithHashtags,
    comments_with_non_latin_script: commentsWithNonLatinScript,
    normalized_empty_comments: normalizedEmptyComments,
    top_emojis: [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([emoji, count]) => ({ emoji, count })),
    top_hashtags: [...hashtagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([hashtag, count]) => ({ hashtag, count })),
    top_mentions: [...mentionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([mention, count]) => ({ mention, count })),
  };
}

function matchesPattern(textLower, pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(textLower);
}

function matchedTopicIds(text, options = {}) {
  let lower = String(text ?? "").toLowerCase();
  if (options.captionMode) {
    // Dogist captions often include street/city labels. Those locations are not
    // enough by themselves to make a post an IRL/community opportunity.
    lower = lower
      .replace(/\b(new york|nyc|brooklyn|manhattan|central park)\b/g, " ")
      .replace(/\b(\d+(st|nd|rd|th)|street|st\.?|ave\.?|avenue|place|plaza|park)\b/g, " ");
  }
  return LEGACY_OPPORTUNITY_BUCKETS
    .filter((topic) => topic.patterns.some((pattern) => matchesPattern(lower, pattern)))
    .map((topic) => topic.id);
}

function countTopicMatches(text, topicId) {
  const topic = LEGACY_OPPORTUNITY_BUCKETS.find((candidate) => candidate.id === topicId);
  if (!topic) return 0;
  const lower = String(text ?? "").toLowerCase();
  return topic.patterns.filter((pattern) => matchesPattern(lower, pattern)).length;
}

function isGenericShort(text, likes) {
  const clean = normalizeText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  if (!clean) return true;
  if (EMOJI_ONLY_RE.test(String(text ?? "").trim())) return true;
  if (words.length <= 3 && GENERIC_SHORT_RE.test(String(text ?? "").trim())) return Number(likes ?? 0) < 10;
  return false;
}

function scoreComment(comment, topicIds) {
  const text = String(comment.text ?? "");
  const clean = normalizeText(text);
  const lower = clean.toLowerCase();
  const words = clean.split(/\s+/).filter(Boolean);
  let score = 0;
  const likes = Number(comment.likes ?? 0);
  score += Math.min(10, Math.log2(likes + 1) * 1.4);
  if (words.length >= 12) score += 2;
  if (words.length >= 28) score += 2;
  if (text.includes("?")) score += 2;
  if (/\b(i|we|my|our|mine|ours)\b/i.test(lower)) score += 1;
  if (/\b(need|needs|needed|wish|want|wanted|recommend|tried|use|using|buy|bought|pay|paid|cost|afford|should)\b/i.test(lower)) score += 2;
  if (topicIds.length > 0) score += 2 + topicIds.length;
  if (isGenericShort(text, likes)) score -= 4;
  return Number(score.toFixed(2));
}

function postClusterFor(video, commentsForPost) {
  const captionTopicIds = matchedTopicIds(video.title ?? "", { captionMode: true });
  const commentTopicCounts = new Map();
  for (const comment of commentsForPost) {
    for (const topicId of comment.topic_ids ?? []) {
      commentTopicCounts.set(topicId, (commentTopicCounts.get(topicId) ?? 0) + 1);
    }
  }

  let best = null;
  for (const rule of POST_CLUSTER_RULES) {
    const captionHits = rule.topicIds.filter((id) => captionTopicIds.includes(id)).length;
    const commentHits = rule.topicIds.reduce((sum, id) => sum + (commentTopicCounts.get(id) ?? 0), 0);
    const score = captionHits * 8 + commentHits;
    if (!best || score > best.score) best = { ...rule, score };
  }

  if (best && best.score > 0) return { id: best.id, label: best.label, confidence: best.score >= 8 ? "medium" : "weak" };
  return { id: "general_portrait_story", label: "General portrait or story posts", confidence: "weak" };
}

function increment(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topTerms(rows, field, limit = 20) {
  const counts = new Map();
  for (const row of rows) {
    const seen = new Set();
    for (const token of tokenize(row[field] ?? "")) {
      if (seen.has(token)) continue;
      seen.add(token);
      increment(counts, token);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function topPhrases(comments, limit = 20) {
  const counts = new Map();
  for (const comment of comments) {
    const tokens = tokenize(comment.text ?? "").filter((token) => token.length <= 24);
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        if (phrase.split(" ").some((token) => STOPWORDS.has(token))) continue;
        increment(counts, phrase);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}

function representativeComments(comments, videosById, limit = 8, topicId = null) {
  const seen = new Set();
  const reps = [];
  const ranked = [...comments].sort((a, b) => {
    const aTopic = topicId ? countTopicMatches(a.text, topicId) : 0;
    const bTopic = topicId ? countTopicMatches(b.text, topicId) : 0;
    const aOther = topicId ? Math.max(0, (a.topic_ids?.length ?? 1) - 1) : 0;
    const bOther = topicId ? Math.max(0, (b.topic_ids?.length ?? 1) - 1) : 0;
    const aScore = a.signal_score + aTopic * 4 - aOther * 1.5;
    const bScore = b.signal_score + bTopic * 4 - bOther * 1.5;
    return bScore - aScore || Number(b.likes ?? 0) - Number(a.likes ?? 0);
  });
  for (const comment of ranked) {
    if (topicId && countTopicMatches(comment.text, topicId) === 0) continue;
    const text = normalizeText(comment.text);
    const social = socialSignals(comment.text);
    const key = text.toLowerCase().slice(0, 120);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const video = videosById.get(comment.video_id);
    reps.push({
      id: comment.id,
      author: comment.author,
      text,
      ...social,
      likes: Number(comment.likes ?? 0),
      signal_score: comment.signal_score,
      post_id: comment.video_id,
      post_url: video?.permalink_url ?? null,
      post_title: video?.title ?? null
    });
    if (reps.length >= limit) break;
  }
  return reps;
}

function representativePosts(videos, comments, topicId, limit = 5) {
  const byPost = new Map();
  for (const comment of comments) {
    if (!comment.topic_ids.includes(topicId)) continue;
    const entry = byPost.get(comment.video_id) ?? { comments: 0, high_signal_comments: 0, total_likes: 0 };
    entry.comments += 1;
    if (comment.high_signal) entry.high_signal_comments += 1;
    entry.total_likes += Number(comment.likes ?? 0);
    byPost.set(comment.video_id, entry);
  }
  return videos
    .filter((video) => byPost.has(video.id))
    .map((video) => ({ video, stats: byPost.get(video.id) }))
    .sort((a, b) => b.stats.high_signal_comments - a.stats.high_signal_comments || b.stats.comments - a.stats.comments)
    .slice(0, limit)
    .map(({ video, stats }) => ({
      id: video.id,
      title: video.title,
      url: video.permalink_url,
      post_cluster: video.post_cluster_label,
      captured_comments: Number(video.captured_comments ?? 0),
      topic_comments: stats.comments,
      high_signal_topic_comments: stats.high_signal_comments,
      topic_comment_likes: stats.total_likes
    }));
}

function buildCrossTabs(comments, videosById) {
  const tabs = new Map();
  for (const comment of comments) {
    const video = videosById.get(comment.video_id);
    if (!video) continue;
    for (const topicId of comment.topic_ids) {
      const key = `${video.post_cluster_id}::${topicId}`;
      const row = tabs.get(key) ?? {
        post_cluster_id: video.post_cluster_id,
        post_cluster_label: video.post_cluster_label,
        topic_id: topicId,
        topic_name: LEGACY_OPPORTUNITY_BUCKETS.find((topic) => topic.id === topicId)?.name ?? topicId,
        comments: 0,
        high_signal_comments: 0,
        total_comment_likes: 0,
        posts: new Set()
      };
      row.comments += 1;
      if (comment.high_signal) row.high_signal_comments += 1;
      row.total_comment_likes += Number(comment.likes ?? 0);
      row.posts.add(comment.video_id);
      tabs.set(key, row);
    }
  }
  return [...tabs.values()]
    .map((row) => ({ ...row, posts: row.posts.size }))
    .sort((a, b) => b.high_signal_comments - a.high_signal_comments || b.comments - a.comments);
}

function dotSparseDense(vector, dense) {
  let score = 0;
  for (let i = 0; i < vector.indices.length; i++) {
    score += vector.values[i] * dense[vector.indices[i]];
  }
  return score;
}

function sparseToDense(vector, size) {
  const dense = new Float64Array(size);
  for (let i = 0; i < vector.indices.length; i++) {
    dense[vector.indices[i]] = vector.values[i];
  }
  return dense;
}

function normalizeDense(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

function vectorizeDocs(comments, { minDf, maxDfRatio, maxVocab }) {
  const docs = [];
  const df = new Map();
  for (const comment of comments) {
    const tokens = tokenize(comment.text ?? "");
    if (tokens.length < 2) continue;
    const counts = new Map();
    for (const token of tokens) increment(counts, token);
    for (const token of counts.keys()) increment(df, token);
    docs.push({ comment, counts });
  }

  const maxDf = Math.max(1, Math.floor(docs.length * maxDfRatio));
  const vocab = [...df.entries()]
    .filter(([, count]) => count >= minDf && count <= maxDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxVocab)
    .map(([term, count], index) => ({ term, count, index, idf: Math.log((1 + docs.length) / (1 + count)) + 1 }));

  const vocabByTerm = new Map(vocab.map((entry) => [entry.term, entry]));
  const vectorRows = [];
  for (const doc of docs) {
    const pairs = [];
    for (const [token, count] of doc.counts.entries()) {
      const entry = vocabByTerm.get(token);
      if (!entry) continue;
      pairs.push([entry.index, (1 + Math.log(count)) * entry.idf]);
    }
    if (pairs.length < 2) continue;
    pairs.sort((a, b) => b[1] - a[1]);
    const clipped = pairs.slice(0, 24).sort((a, b) => a[0] - b[0]);
    let norm = 0;
    for (const [, value] of clipped) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    vectorRows.push({
      doc,
      vector: {
        indices: Int32Array.from(clipped.map(([index]) => index)),
        values: Float64Array.from(clipped.map(([, value]) => value / norm))
      }
    });
  }

  return { vocab, vectorRows, input_docs: comments.length, tokenized_docs: docs.length, modeled_docs: vectorRows.length };
}

function topCenterTerms(center, vocab, limit = 12) {
  const terms = [];
  for (let i = 0; i < center.length; i++) {
    if (center[i] > 0) terms.push({ term: vocab[i].term, weight: Number(center[i].toFixed(4)) });
  }
  return terms.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term)).slice(0, limit);
}

function summarizeModeledTopic({ topicIndex, rows, center, vocab, videosById, namespace }) {
  const comments = rows.map((row) => row.doc.comment);
  const posts = new Set(comments.map((comment) => comment.video_id));
  const uniqueCommenters = new Set(comments.map((comment) => String(comment.author ?? "").toLowerCase()).filter(Boolean));
  const sortedRepresentatives = rows
    .map((row) => ({
      row,
      similarity: dotSparseDense(row.vector, center)
    }))
    .sort((a, b) => {
      const aComment = a.row.doc.comment;
      const bComment = b.row.doc.comment;
      return b.similarity - a.similarity || Number(bComment.likes ?? 0) - Number(aComment.likes ?? 0);
    })
    .slice(0, 8)
    .map(({ row, similarity }) => {
      const comment = row.doc.comment;
      const video = videosById.get(comment.video_id);
      const text = normalizeText(comment.text).slice(0, 500);
      const social = socialSignals(comment.text);
      return {
        id: comment.id,
        author: comment.author,
        text,
        ...social,
        likes: Number(comment.likes ?? 0),
        similarity: Number(similarity.toFixed(4)),
        signal_score: comment.signal_score,
        high_signal: comment.high_signal,
        post_id: comment.video_id,
        post_title: video?.title ?? null,
        post_url: video?.permalink_url ?? null
      };
    });

  const postsByCount = new Map();
  for (const comment of comments) {
    const entry = postsByCount.get(comment.video_id) ?? { comments: 0, high_signal_comments: 0, total_likes: 0 };
    entry.comments += 1;
    if (comment.high_signal) entry.high_signal_comments += 1;
    entry.total_likes += Number(comment.likes ?? 0);
    postsByCount.set(comment.video_id, entry);
  }

  const topPosts = [...postsByCount.entries()]
    .map(([postId, stats]) => ({ video: videosById.get(postId), stats }))
    .filter((entry) => entry.video)
    .sort((a, b) => b.stats.comments - a.stats.comments || b.stats.high_signal_comments - a.stats.high_signal_comments)
    .slice(0, 6)
    .map(({ video, stats }) => ({
      id: video.id,
      title: video.title,
      url: video.permalink_url,
      comments: stats.comments,
      high_signal_comments: stats.high_signal_comments,
      total_likes: stats.total_likes
    }));

  const topTermsForTopic = topCenterTerms(center, vocab, 14);
  return {
    id: `${namespace}_topic_${String(topicIndex + 1).padStart(2, "0")}`,
    label_terms: topTermsForTopic.slice(0, 5).map((item) => item.term),
    top_terms: topTermsForTopic,
    counts: {
      comments: comments.length,
      posts: posts.size,
      unique_commenters: uniqueCommenters.size,
      high_signal_comments: comments.filter((comment) => comment.high_signal).length,
      generic_short_comments: comments.filter((comment) => comment.generic_short).length,
      total_comment_likes: comments.reduce((sum, comment) => sum + Number(comment.likes ?? 0), 0),
      median_comment_likes: median(comments.map((comment) => Number(comment.likes ?? 0)))
    },
    representative_posts: topPosts,
    representative_comments: sortedRepresentatives
  };
}

function buildCommentTopicModel(comments, videosById, options = {}) {
  const namespace = options.namespace ?? "all_comments";
  const topicCount = options.topicCount ?? 24;
  const maxVocab = options.maxVocab ?? 2500;
  const minDf = options.minDf ?? 12;
  const maxDfRatio = options.maxDfRatio ?? 0.35;
  const iterations = options.iterations ?? 8;
  const { vocab, vectorRows, input_docs, tokenized_docs, modeled_docs } = vectorizeDocs(comments, { minDf, maxDfRatio, maxVocab });

  if (vectorRows.length === 0 || vocab.length === 0) {
    return {
      namespace,
      method: "tf-idf sparse k-means",
      params: { topicCount, maxVocab, minDf, maxDfRatio, iterations },
      input_docs,
      tokenized_docs,
      modeled_docs,
      vocab_terms: vocab.length,
      topics: []
    };
  }

  const k = Math.min(topicCount, vectorRows.length);
  const centers = [];
  const step = Math.max(1, Math.floor(vectorRows.length / k));
  for (let i = 0; i < k; i++) {
    centers.push(sparseToDense(vectorRows[(i * step) % vectorRows.length].vector, vocab.length));
  }

  const assignments = new Int32Array(vectorRows.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sums = Array.from({ length: k }, () => new Float64Array(vocab.length));
    const counts = new Int32Array(k);

    for (let rowIndex = 0; rowIndex < vectorRows.length; rowIndex++) {
      const vector = vectorRows[rowIndex].vector;
      let bestCluster = 0;
      let bestScore = -Infinity;
      for (let clusterIndex = 0; clusterIndex < k; clusterIndex++) {
        const score = dotSparseDense(vector, centers[clusterIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestCluster = clusterIndex;
        }
      }
      assignments[rowIndex] = bestCluster;
      counts[bestCluster] += 1;
      for (let i = 0; i < vector.indices.length; i++) {
        sums[bestCluster][vector.indices[i]] += vector.values[i];
      }
    }

    for (let clusterIndex = 0; clusterIndex < k; clusterIndex++) {
      if (counts[clusterIndex] === 0) continue;
      centers[clusterIndex] = normalizeDense(sums[clusterIndex]);
    }
  }

  const rowsByCluster = Array.from({ length: k }, () => []);
  for (let i = 0; i < vectorRows.length; i++) {
    rowsByCluster[assignments[i]].push(vectorRows[i]);
  }

  const topics = rowsByCluster
    .map((rows, topicIndex) => summarizeModeledTopic({ topicIndex, rows, center: centers[topicIndex], vocab, videosById, namespace }))
    .filter((topic) => topic.counts.comments > 0)
    .sort((a, b) => b.counts.comments - a.counts.comments || b.counts.high_signal_comments - a.counts.high_signal_comments);

  return {
    namespace,
    method: "tf-idf sparse k-means",
    params: { topicCount: k, maxVocab, minDf, maxDfRatio, iterations },
    input_docs,
    tokenized_docs,
    modeled_docs,
    vocab_terms: vocab.length,
    topics
  };
}

function buildOpportunityReport({ corpus, topicSummaries, opportunityCandidates, postClusters, crossTabs, commentTopicModel, outputFiles }) {
  const lines = [];
  lines.push("# Dogist Local Opportunity Analysis");
  lines.push("");
  lines.push(`Generated: ${corpus.generated_at}`);
  lines.push(`Input: \`${corpus.input}\``);
  lines.push("");
  lines.push("## Corpus");
  lines.push("");
  lines.push(`- Posts analyzed: ${corpus.posts_analyzed}`);
  lines.push(`- Comments analyzed: ${corpus.comments_analyzed.toLocaleString()}`);
  lines.push(`- Unique commenters: ${corpus.unique_commenters.toLocaleString()}`);
  lines.push(`- High-signal comments: ${corpus.high_signal_comments.toLocaleString()}`);
  lines.push(`- Generic/short comments: ${corpus.generic_short_comments.toLocaleString()}`);
  lines.push(`- Median comment likes: ${corpus.median_comment_likes}`);
  lines.push("");
  lines.push("## Method In Plain English");
  lines.push("");
  lines.push("What was done:");
  lines.push("");
  lines.push("1. Start from the processed Dogist export with post captions, post links, comment text, authors, and comment likes.");
  lines.push("2. Run a topic model across all tokenizable comments to see the broad shape of the conversation.");
  lines.push("3. Score comments for business signal using length, questions, first-person experience, likes, and domain terms.");
  lines.push("4. Run a second topic model on that high-signal subset so generic praise does not bury product, care, rescue, or service language.");
  lines.push("5. Cross-tab comment topics with post formats so the unit of analysis is not just a topic, but a topic inside a kind of post.");
  lines.push("6. Build compact evidence packets for Claude to interpret.");
  lines.push("");
  lines.push("Why this shape:");
  lines.push("");
  lines.push("- The corpus is too large and repetitive to send raw to Claude.");
  lines.push("- A topic model helps reveal structure without manually reading thousands of comments.");
  lines.push("- The local pass is intentionally a reduction step, not the final interpretation.");
  lines.push("- Manual reading here should stay light: spot-check for false positives, then let Claude interpret reduced packets.");
  lines.push("");
  lines.push("How to read a topic:");
  lines.push("");
  lines.push("- `label_terms` are the strongest TF-IDF terms near the cluster center, not a human-written label.");
  lines.push("- `representative_comments` are examples near the cluster center, not proof by themselves.");
  lines.push("- Treat high counts as \"worth asking Claude about,\" not validated demand.");
  lines.push("");
  lines.push("Important context boundary:");
  lines.push("");
  lines.push("- The topic models are corpus-derived: they come from the scraped comments.");
  lines.push("- The business opportunity buckets are hypothesis-driven: they use Zach's meeting context as a lens.");
  lines.push("- The blueberry/supplement launch is not an organic conclusion from the topic model by itself. The corpus does contain organic blueberry, food, treat, recipe, and picky-eater comments, but connecting that to a supplement launch is an interpretation step.");
  lines.push("- Claude should run both a context-free read and a business-context read before Zach treats any claim as useful.");
  lines.push("");
  lines.push("## Early Business Signals");
  lines.push("");
  for (const candidate of opportunityCandidates.slice(0, 8)) {
    lines.push(`### ${candidate.name}`);
    lines.push("");
    lines.push(`- Status: ${candidate.status}`);
    lines.push(`- Breadth: ${candidate.counts.posts} posts, ${candidate.counts.comments.toLocaleString()} matched comments, ${candidate.counts.high_signal_comments.toLocaleString()} high-signal comments`);
    lines.push(`- Comment likes on matched comments: ${candidate.counts.total_comment_likes.toLocaleString()}`);
    lines.push(`- Working read: ${candidate.possible_angle}`);
    lines.push(`- Next validation post: ${candidate.next_validation_post}`);
    if (candidate.representative_comments.length > 0) {
      const quote = candidate.representative_comments[0];
      lines.push(`- Example: "${quote.text.slice(0, 260)}"${quote.likes ? ` (${quote.likes} likes)` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Post Format Distribution");
  lines.push("");
  for (const cluster of postClusters) {
    lines.push(`- ${cluster.label}: ${cluster.posts} posts, ${cluster.comments.toLocaleString()} comments, ${cluster.high_signal_comments.toLocaleString()} high-signal comments`);
  }
  lines.push("");
  lines.push("## Strongest Cross-Tabs");
  lines.push("");
  for (const row of crossTabs.slice(0, 12)) {
    lines.push(`- ${row.post_cluster_label} x ${row.topic_name}: ${row.high_signal_comments.toLocaleString()} high-signal comments across ${row.posts} posts`);
  }
  lines.push("");
  lines.push("## All-Comment Topic Model");
  lines.push("");
  lines.push(`Modeled ${commentTopicModel.all_comments.modeled_docs.toLocaleString()} comments after tokenization from ${commentTopicModel.all_comments.input_docs.toLocaleString()} total comments.`);
  lines.push("");
  for (const topic of commentTopicModel.all_comments.topics.slice(0, 10)) {
    lines.push(`- ${topic.id}: ${topic.label_terms.join(", ")} - ${topic.counts.comments.toLocaleString()} comments, ${topic.counts.high_signal_comments.toLocaleString()} high-signal`);
  }
  lines.push("");
  lines.push("## High-Signal Topic Model");
  lines.push("");
  lines.push(`Modeled ${commentTopicModel.high_signal_comments.modeled_docs.toLocaleString()} comments from ${commentTopicModel.high_signal_comments.input_docs.toLocaleString()} high-signal comments.`);
  lines.push("");
  for (const topic of commentTopicModel.high_signal_comments.topics.slice(0, 10)) {
    lines.push(`- ${topic.id}: ${topic.label_terms.join(", ")} - ${topic.counts.comments.toLocaleString()} comments across ${topic.counts.posts} posts`);
  }
  lines.push("");
  lines.push("## Claude-Ready Files");
  lines.push("");
  for (const file of outputFiles) {
    lines.push(`- \`${file}\``);
  }
  lines.push("");
  lines.push("## Caution");
  lines.push("");
  lines.push("These are local reduction outputs, not validated product findings. Treat high counts as places to inspect and validate, especially because broad Dogist affection can overwhelm business signal.");
  lines.push("");
  lines.push("## Topic Term Snapshots");
  lines.push("");
  for (const topic of topicSummaries.slice(0, 6)) {
    lines.push(`### ${topic.name}`);
    lines.push("");
    const terms = topic.top_terms.slice(0, 10).map((item) => `${item.term} (${item.count})`).join(", ");
    const phrases = topic.top_phrases.slice(0, 8).map((item) => `${item.phrase} (${item.count})`).join(", ");
    lines.push(`Terms: ${terms || "n/a"}`);
    lines.push("");
    lines.push(`Phrases: ${phrases || "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inputPath = args.input ?? DEFAULT_INPUT;
  const outDir = args.out ?? DEFAULT_OUT;

  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const videos = (input.videos ?? []).map((video) => ({ ...video }));
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const commentsByPost = new Map();
  const comments = (input.comments ?? []).map((comment) => {
    const topicIds = matchedTopicIds(comment.text ?? "");
    const signalScore = scoreComment(comment, topicIds);
    const highSignal = signalScore >= 4 || Number(comment.likes ?? 0) >= 8;
    const social = socialSignals(comment.text ?? "");
    const row = {
      ...comment,
      ...social,
      topic_ids: topicIds,
      signal_score: signalScore,
      high_signal: highSignal,
      generic_short: isGenericShort(comment.text, comment.likes)
    };
    if (!commentsByPost.has(comment.video_id)) commentsByPost.set(comment.video_id, []);
    commentsByPost.get(comment.video_id).push(row);
    return row;
  });

  for (const video of videos) {
    const postComments = commentsByPost.get(video.id) ?? [];
    const cluster = postClusterFor(video, postComments);
    video.post_cluster_id = cluster.id;
    video.post_cluster_label = cluster.label;
    video.post_cluster_confidence = cluster.confidence;
  }

  const uniqueCommenters = new Set(comments.map((comment) => String(comment.author ?? "").toLowerCase()).filter(Boolean));
  const highSignalComments = comments.filter((comment) => comment.high_signal);
  const genericShortComments = comments.filter((comment) => comment.generic_short);
  const topicSummaries = LEGACY_OPPORTUNITY_BUCKETS.map((topic) => {
    const matched = comments.filter((comment) => comment.topic_ids.includes(topic.id));
    const highSignalMatched = matched.filter((comment) => comment.high_signal);
    const posts = new Set(matched.map((comment) => comment.video_id));
    return {
      id: topic.id,
      name: topic.name,
      business_relevance: topic.business_relevance,
      counts: {
        posts: posts.size,
        comments: matched.length,
        high_signal_comments: highSignalMatched.length,
        total_comment_likes: matched.reduce((sum, comment) => sum + Number(comment.likes ?? 0), 0),
        median_comment_likes: median(matched.map((comment) => Number(comment.likes ?? 0)))
      },
      top_terms: topTerms(highSignalMatched.length ? highSignalMatched : matched, "text", 20),
      top_phrases: topPhrases(highSignalMatched.length ? highSignalMatched : matched, 20),
      representative_posts: representativePosts(videos, comments, topic.id, 6),
      representative_comments: representativeComments(highSignalMatched.length ? highSignalMatched : matched, videosById, 10, topic.id)
    };
  }).sort((a, b) => b.counts.high_signal_comments - a.counts.high_signal_comments || b.counts.comments - a.counts.comments);

  const opportunityCandidates = topicSummaries.map((summary) => {
    const topic = LEGACY_OPPORTUNITY_BUCKETS.find((candidate) => candidate.id === summary.id);
    return {
      id: summary.id,
      name: summary.name,
      status: summary.id === "product_commerce_merch"
        ? "weak / noisy heuristic / needs Claude cleanup"
        : "candidate / needs validation",
      business_relevance: summary.business_relevance,
      counts: summary.counts,
      representative_posts: summary.representative_posts,
      representative_comments: summary.representative_comments.slice(0, 6),
      possible_angle: topic?.possible_angle ?? "",
      next_validation_post: topic?.next_validation_post ?? ""
    };
  });

  const clusterMap = new Map();
  for (const video of videos) {
    const postComments = commentsByPost.get(video.id) ?? [];
    const row = clusterMap.get(video.post_cluster_id) ?? {
      id: video.post_cluster_id,
      label: video.post_cluster_label,
      posts: 0,
      comments: 0,
      high_signal_comments: 0,
      representative_posts: []
    };
    row.posts += 1;
    row.comments += postComments.length;
    row.high_signal_comments += postComments.filter((comment) => comment.high_signal).length;
    row.representative_posts.push({
      id: video.id,
      title: video.title,
      url: video.permalink_url,
      captured_comments: Number(video.captured_comments ?? 0)
    });
    clusterMap.set(video.post_cluster_id, row);
  }
  const postClusters = [...clusterMap.values()]
    .map((cluster) => ({
      ...cluster,
      representative_posts: cluster.representative_posts
        .sort((a, b) => b.captured_comments - a.captured_comments)
        .slice(0, 8)
    }))
    .sort((a, b) => b.high_signal_comments - a.high_signal_comments || b.comments - a.comments);

  const crossTabs = buildCrossTabs(comments, videosById);
  const commentTopicModel = {
    generated_at: new Date().toISOString(),
    method_note: "Unsupervised TF-IDF sparse k-means. This is a reduction layer for Claude interpretation, not a final human-coded close reading.",
    all_comments: buildCommentTopicModel(comments, videosById, {
      namespace: "all_comments",
      topicCount: 24,
      maxVocab: 2600,
      minDf: 14,
      maxDfRatio: 0.35,
      iterations: 9
    }),
    high_signal_comments: buildCommentTopicModel(highSignalComments, videosById, {
      namespace: "high_signal",
      topicCount: 18,
      maxVocab: 2200,
      minDf: 6,
      maxDfRatio: 0.4,
      iterations: 9
    })
  };
  const corpus = {
    generated_at: new Date().toISOString(),
    input: args.input,
    source: input.source ?? null,
    creator_handle: input.creator_handle ?? null,
    posts_analyzed: videos.length,
    comments_analyzed: comments.length,
    unique_commenters: uniqueCommenters.size,
    high_signal_comments: highSignalComments.length,
    generic_short_comments: genericShortComments.length,
    social_signal_summary: summarizeSocialSignals(comments),
    total_comment_likes: comments.reduce((sum, comment) => sum + Number(comment.likes ?? 0), 0),
    median_comment_likes: median(comments.map((comment) => Number(comment.likes ?? 0)))
  };

  const outputFiles = [
    path.join(outDir, "corpus-summary.json"),
    path.join(outDir, "post-clusters.json"),
    path.join(outDir, "comment-topics.json"),
    path.join(outDir, "comment-topic-model.json"),
    path.join(outDir, "opportunity-candidates.json"),
    path.join(outDir, "claude-evidence-packets.json"),
    path.join(outDir, "opportunity-report.md")
  ];

  await writeJson(outputFiles[0], corpus);
  await writeJson(outputFiles[1], postClusters);
  await writeJson(outputFiles[2], topicSummaries);
  await writeJson(outputFiles[3], commentTopicModel);
  await writeJson(outputFiles[4], opportunityCandidates);
  await writeJson(outputFiles[5], opportunityCandidates.map((candidate) => ({
    name: candidate.name,
    status: candidate.status,
    business_relevance: candidate.business_relevance,
    counts: candidate.counts,
    representative_posts: candidate.representative_posts,
    representative_comments: candidate.representative_comments,
    possible_angle: candidate.possible_angle,
    next_validation_post: candidate.next_validation_post,
    llm_instruction: "Decide whether this evidence supports a real product, launch, content, partnership, or validation opportunity. Separate evidence from interpretation."
  })));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outputFiles[6], buildOpportunityReport({ corpus, topicSummaries, opportunityCandidates, postClusters, crossTabs, commentTopicModel, outputFiles }));

  console.log(`Analyzed ${corpus.posts_analyzed} posts and ${corpus.comments_analyzed} comments.`);
  console.log(`High-signal comments: ${corpus.high_signal_comments}`);
  console.log(`All-comment topic model: ${commentTopicModel.all_comments.topics.length} topics over ${commentTopicModel.all_comments.modeled_docs} modeled comments`);
  console.log(`Output: ${outDir}`);
  console.log("Top candidate topics:");
  for (const candidate of opportunityCandidates.slice(0, 5)) {
    console.log(`- ${candidate.name}: ${candidate.counts.high_signal_comments} high-signal comments across ${candidate.counts.posts} posts`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
