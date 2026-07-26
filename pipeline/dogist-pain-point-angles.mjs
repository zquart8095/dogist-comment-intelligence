#!/usr/bin/env node
/**
 * Pain-point / ad-angle analysis over Dogist's diet & feeding comments.
 *
 * Replaces the audience-mode "Message Map" framing with a direct-response framing:
 *   1. Extraction  — per diet comment: what problem is stated, what they want instead,
 *      and the dominant emotional trigger. (Haiku, batched, parallel)
 *   2. Clustering  — merge raw signals into a data-driven set of pain-point/need themes,
 *      each carrying its emotional triggers and a real quote pool. (Haiku group-reduce,
 *      then Sonnet final merge)
 *   3. Angle generation — per theme, write one message for EACH of the 6 ad-angle types
 *      (pain-based, desire-based, problem/solution, social proof, curiosity, niche-specific),
 *      grounded in that theme's quotes and Dogist's voice. (Sonnet)
 *
 * Reuses the same diet-comment population as dogist-diet-analysis.mjs (FOOD_PATTERNS +
 * isHighSignal) so both analyses describe the same underlying corpus slice.
 *
 * Outputs: data/opportunity-analysis/pain-point-angles.json
 *
 * Usage: ANTHROPIC_API_KEY=... node pipeline/dogist-pain-point-angles.mjs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const IMPORT_PATH = path.join(
  ROOT,
  "data/processed/comment-analysis-import.json"
);
const BRIEF_PATH = path.join(ROOT, "product/brief.json");
const VOICE_PATH = path.join(ROOT, "product/voice.json");
const OUT_PATH = path.join(
  ROOT,
  "data/opportunity-analysis/pain-point-angles.json"
);
const SIGNALS_CHECKPOINT = path.join(
  ROOT,
  "data/opportunity-analysis/.pain-point-signals-checkpoint.json"
);
const THEMES_CHECKPOINT = path.join(
  ROOT,
  "data/opportunity-analysis/.pain-point-themes-checkpoint.json"
);

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const CLUSTER_MODEL = "claude-sonnet-4-6";
const ANGLE_MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 150;
const PARALLEL_BATCHES = 5;
const GROUP_SIZE = 8;

// Same diet-comment population as dogist-diet-analysis.mjs, kept identical on purpose
// so both analyses describe the same corpus slice.
const FOOD_PATTERNS = [
  "blueberry", "blueberries", "berry", "berries", "biscuit", "biscuits",
  "treat", "treats", "snack", "snacks", "food", "foods", "eat", "eats",
  "ate", "eating", "recipe", "recipes", "ingredient", "ingredients", "healthy",
  "supplement", "supplements", "vitamin", "vitamins", "picky", "allergy",
  "allergies", "allergic", "peanut", "butter", "cheese", "chicken", "pumpkin",
  "kibble", "diet", "raw food", "home made", "homemade", "dog treat",
];

const GENERIC_SHORT_RE = /^(so\s+)?(cute|adorable|beautiful|sweet|precious|love|lovely|amazing|awesome|perfect|best|angel|good boy|good girl|omg|wow|aww+|awww+|love this|i love this|so cute|too cute|cutie)[\s!.]*$/i;

function normalizeText(v) {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\w.]+/g, " ")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesFoodTopic(text) {
  const lower = text.toLowerCase();
  return FOOD_PATTERNS.some((p) => lower.includes(p));
}

function isHighSignal(text, likes) {
  const clean = normalizeText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const l = parseInt(likes) || 0;

  let score = Math.min(10, Math.log2(l + 1) * 1.4);
  if (words.length >= 12) score += 2;
  if (words.length >= 28) score += 2;
  if (text.includes("?")) score += 2;
  if (/\b(i|we|my|our)\b/i.test(clean)) score += 1;
  if (/\b(need|wish|want|recommend|tried|use|buy|bought|pay|cost|afford|should)\b/i.test(clean)) score += 2;
  score += 3;

  if (!clean) return false;
  if (words.length <= 3 && GENERIC_SHORT_RE.test(text.trim()) && l < 10) score -= 4;

  return score >= 4 || l >= 8;
}

// The 6 ad-angle types (fixed vocabulary — same taxonomy every prompt call references).
const ANGLE_TYPES = [
  {
    id: "pain_based",
    label: "Pain-based",
    description:
      "Name the real discomfort, worry, or guilt directly — the thing the owner is actually feeling — then let Vitality sit alongside it as relief, not a cure.",
  },
  {
    id: "desire_based",
    label: "Desire-based",
    description:
      "Paint the aspirational outcome or identity the owner wants for their dog. Inspirational, forward-looking, not fear-driven.",
  },
  {
    id: "problem_solution",
    label: "Problem / Solution",
    description:
      "State the problem plainly, then the solution just as plainly. No embellishment, no emotional framing — just clear cause and effect.",
  },
  {
    id: "social_proof",
    label: "Social proof",
    description:
      "Lean on 'other owners like you already do this.' Community validation and shared experience, not hype or manufactured urgency.",
  },
  {
    id: "curiosity",
    label: "Curiosity / Pattern interrupt",
    description:
      "Open with a genuinely surprising or counterintuitive observation from the comments that makes an owner want to know more — without becoming clickbait or breaking Dogist's trust.",
  },
  {
    id: "niche_specific",
    label: "Niche-specific",
    description:
      "Speak to one narrow, specific situation or owner identity so precisely that it feels made for exactly that person, not a general dog-owner audience.",
  },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--fresh") args.fresh = true;
    else if (argv[i] === "--help") args.help = true;
  }
  return args;
}

async function readJSONIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function tryParseJSON(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// Best-effort recovery when a response got cut off mid-array (stop_reason: max_tokens):
// walk the array under `fieldName`, brace-matching each element, and keep only the
// complete ones. A truncated batch then contributes its complete items instead of nothing.
function salvageArrayField(raw, fieldName) {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").trim();
  const keyIdx = clean.indexOf(`"${fieldName}"`);
  if (keyIdx === -1) return [];
  const bracketIdx = clean.indexOf("[", keyIdx);
  if (bracketIdx === -1) return [];

  const items = [];
  let i = bracketIdx + 1;
  while (i < clean.length) {
    while (i < clean.length && /[\s,]/.test(clean[i])) i++;
    if (clean[i] === "]" || i >= clean.length) break;
    if (clean[i] !== "{") break;

    let depth = 0;
    let inString = false;
    let escape = false;
    const start = i;
    for (; i < clean.length; i++) {
      const ch = clean[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) break; // never closed — this element itself was truncated, stop here
    try {
      items.push(JSON.parse(clean.slice(start, i)));
    } catch {
      // malformed element, skip it and keep scanning
    }
  }
  return items;
}

async function callClaude(client, model, prompt, maxTokens, attempts = 3, label = "", salvageField = null) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const rawText = response.content[0].text.trim();
      const parsed = tryParseJSON(rawText);
      if (parsed) return parsed;

      console.warn(
        `\n  [${label}] JSON parse failed (attempt ${attempt}/${attempts}), stop_reason=${response.stop_reason}, raw length=${rawText.length}.`
      );
      if (salvageField && response.stop_reason === "max_tokens") {
        const salvaged = salvageArrayField(rawText, salvageField);
        if (salvaged.length > 0) {
          console.warn(`  [${label}] Salvaged ${salvaged.length} complete "${salvageField}" item(s) from the truncated response.`);
          return { [salvageField]: salvaged };
        }
      }
    } catch (err) {
      console.warn(`\n  [${label}] API error (attempt ${attempt}/${attempts}): ${err.message}`);
      if (attempt === attempts) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage 1: extraction — problem / want / emotional_trigger signals per comment
// ---------------------------------------------------------------------------

function extractionPrompt(comments, batchIndex, totalBatches) {
  const commentBlock = comments
    .map((c, i) => `[${i + 1}] (${c.likes} likes) ${c.text}`)
    .join("\n\n");

  return `You are analyzing Instagram comments from @thedogist's audience about dog food, diet, treats, and feeding. This is batch ${batchIndex + 1} of ${totalBatches}.

COMMENTS:
${commentBlock}

For each comment that clearly expresses a problem AND/OR a want about the dog's diet or feeding, extract a signal. Skip comments that are just affection, tagging, or unrelated chatter with no diet-relevant problem or want. Return ONLY valid JSON:
{
  "signals": [
    {
      "comment_index": <integer, the [N] this signal came from>,
      "problem": "short label for the problem/pain this owner expresses about feeding their dog, or null if there isn't one",
      "want": "short label for what this owner wants instead, or null if there isn't one",
      "emotional_trigger": "the single dominant emotion driving this comment: e.g. guilt, worry, frustration, pride, love, fear, relief, hope, defensiveness",
      "quote": "verbatim excerpt from this comment (max 200 chars) that best captures the problem/want"
    }
  ]
}

Rules:
- Only extract a signal if there's a real problem or want about diet/feeding — not general affection for the dog.
- problem and want should each be a short phrase (3-8 words), not a sentence.
- quote must be verbatim from the comment, not paraphrased.
- Return ONLY valid JSON. No markdown.`;
}

async function runExtractionBatch(client, comments, batchIndex, totalBatches) {
  const prompt = extractionPrompt(comments, batchIndex, totalBatches);
  const parsed = await callClaude(client, EXTRACT_MODEL, prompt, 4096, 3, `batch-${batchIndex + 1}`, "signals");
  return parsed ?? { signals: [] };
}

// Resolve each signal's comment_index back to the real source comment right away, and give
// it a stable id. Every later stage (clustering, angle generation) references signals by this
// id instead of copying quote text — the model never has to reproduce a quote verbatim, so it
// can't paraphrase, "fix", or fabricate one in a later pass. Signals whose comment_index the
// model got wrong are dropped rather than silently attached to the wrong comment.
function enrichSignals(rawSignals, batchComments, batchIndex, videoById) {
  const enriched = [];
  for (let i = 0; i < rawSignals.length; i++) {
    const s = rawSignals[i];
    if (!s.problem && !s.want) continue;
    const comment = batchComments[s.comment_index - 1];
    if (!comment) continue; // hallucinated/out-of-range index — drop rather than mis-attribute
    const video = videoById.get(comment.video_id);
    enriched.push({
      signal_id: `sig_${batchIndex}_${i}`,
      problem: s.problem ?? null,
      want: s.want ?? null,
      emotional_trigger: s.emotional_trigger ?? null,
      quote: comment.text, // the real, full comment text — not the model's excerpt
      comment_id: comment.id,
      likes: parseInt(comment.likes) || 0,
      post_id: comment.video_id,
      post_url: video?.permalink_url ?? null,
      post_title: video?.title ?? null,
    });
  }
  return enriched;
}

async function runExtractionParallel(client, chunks, concurrency) {
  const results = new Array(chunks.length);
  let nextIdx = 0;
  let done = 0;
  async function worker() {
    while (nextIdx < chunks.length) {
      const idx = nextIdx++;
      results[idx] = await runExtractionBatch(client, chunks[idx], idx, chunks.length);
      done++;
      const pct = Math.round((done / chunks.length) * 100);
      process.stdout.write(`\r  ${done}/${chunks.length} batches complete (${pct}%)   `);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return results;
}

// ---------------------------------------------------------------------------
// Stage 2: clustering — raw signals -> data-driven pain-point/need themes
// ---------------------------------------------------------------------------

// The model only ever handles IDs and short synthesized prose here — never quote text.
// Quotes are resolved from signal_id back to the original comment in code (see enrichSignals),
// so nothing the model writes in this stage can corrupt or fabricate a quote.
function groupClusterPrompt(signals) {
  const signalsJson = JSON.stringify(
    signals.map((s) => ({
      signal_id: s.signal_id,
      problem: s.problem,
      want: s.want,
      emotional_trigger: s.emotional_trigger,
    })),
    null,
    2
  );

  return `You are clustering raw problem/want signals extracted from Dogist Instagram comments about dog food, diet, and feeding.

SIGNALS:
${signalsJson}

Group these into candidate pain-point/need themes — a theme unifies a problem with the want that resolves it (they're two sides of the same thing, e.g. "picky eating" problem = "want food the dog will actually eat"). Return ONLY valid JSON:
{
  "themes": [
    {
      "label": "short theme name (3-6 words)",
      "problem_statement": "1 sentence: the problem as owners describe it",
      "want_statement": "1 sentence: what owners want instead",
      "emotional_triggers": ["1-3 dominant emotions for this theme"],
      "signal_ids": ["every signal_id from the list above that belongs to this theme"]
    }
  ]
}

Rules:
- Merge near-duplicate problems/wants into one theme. Keep themes distinct from each other.
- Only include themes with real support in the signals above — do not invent themes.
- signal_ids must be copied exactly (character-for-character) from the signal_id fields above — do not alter, abbreviate, or invent ids.
- Return ONLY valid JSON. No markdown.`;
}

// Final merge only decides which CANDIDATE THEMES (not individual signals) belong together —
// the full signal_ids list per final theme is computed in code as the union of its merged
// candidates', so a long list here never risks the model dropping or mistyping an id.
function finalClusterPrompt(candidateThemes, totalSignals) {
  const themesJson = JSON.stringify(
    candidateThemes.map((t) => ({
      candidate_id: t.candidate_id,
      label: t.label,
      problem_statement: t.problem_statement,
      want_statement: t.want_statement,
      emotional_triggers: t.emotional_triggers,
      signal_count: t.signal_ids.length,
    })),
    null,
    2
  );

  return `You are merging ${candidateThemes.length} candidate pain-point/need themes (from separate batches of an analysis of ${totalSignals} problem/want signals in Dogist's dog-food/diet/feeding comments). They may overlap or duplicate each other.

CANDIDATE THEMES:
${themesJson}

Merge these into a final, deduplicated set of distinct pain-point/need themes. Return ONLY valid JSON:
{
  "themes": [
    {
      "id": "short_snake_case_id",
      "label": "short theme name (3-6 words)",
      "problem_statement": "1 sentence: the problem as owners describe it, synthesized across the merged candidates",
      "want_statement": "1 sentence: what owners want instead",
      "emotional_triggers": ["1-3 dominant emotions"],
      "source_candidate_ids": ["every candidate_id above that was merged into this final theme"]
    }
  ]
}

Rules:
- Merge duplicate/near-duplicate candidates into one final theme; do not just relist every candidate as its own theme.
- Every candidate_id from the list above must appear in exactly one final theme's source_candidate_ids — do not drop any, do not duplicate one across two final themes.
- source_candidate_ids must be copied exactly (character-for-character) from the candidate_id fields above.
- Let the number of final themes be whatever the data actually supports — do not force a fixed count. Typically this lands somewhere around 15-30 for a corpus this size, but go with what's real.
- Return ONLY valid JSON. No markdown.`;
}

// ---------------------------------------------------------------------------
// Stage 3: angle generation — one message per theme x per ad-angle type
// ---------------------------------------------------------------------------

function angleGenerationPrompt(theme, brief, voice) {
  const claimsBlock = brief.claims_to_test
    .map((c) => `- ${c.id} ("${c.label}"): keywords ${c.keywords.join(", ")}`)
    .join("\n");

  return `You are writing launch messaging for The Dogist's Vitality Chew (a blueberry-based daily antioxidant dog supplement, launching ${brief.launch_timing}), grounded in one real pain-point/need theme from the audience's own comments about dog food and feeding.

THEME:
- Label: ${theme.label}
- Problem: ${theme.problem_statement}
- Want: ${theme.want_statement}
- Emotional triggers: ${theme.emotional_triggers.join(", ")}
- Real audience quotes (cite by comment_id in language_to_borrow.source_comment_id):
${theme.representative_quotes.map((q) => `  - [${q.comment_id}] (${q.likes} likes) "${q.text.length > 300 ? q.text.slice(0, 300) + "…" : q.text}"`).join("\n")}

PRODUCT CONTEXT:
- Positioning: ${brief.positioning.join(" / ")}
- Ingredients: ${brief.ingredients.map((i) => `${i.name} (${i.role})`).join(", ")}
- Claims this product can actually support:
${claimsBlock}
- Trust constraints (must never violate):
${brief.trust_constraints.map((t) => `  - ${t}`).join("\n")}
- Brand guardrails: ${brief.brand_guardrails.map((g) => g.text).join(", ")}

DOGIST VOICE:
- Do: ${voice.do_rules.join(" / ")}
- Avoid: ${voice.avoid_rules.join(" / ")}
- Tone markers: ${voice.tone_markers.join(" / ")}

Write ONE message for EACH of these 6 ad-angle types. Each must feel meaningfully different in structure and tone — not the same line six times with a different label.

ANGLE TYPES:
${ANGLE_TYPES.map((a) => `- ${a.id} ("${a.label}"): ${a.description}`).join("\n")}

Return ONLY valid JSON:
{
  "angles": [
    {
      "angle_type": "one of the angle type ids above",
      "dogist_style_angle": "the actual message/copy line, in Dogist's voice, grounded in this theme",
      "why_this_type_fits": "1 sentence: why this angle type suits this specific theme",
      "language_to_borrow": [
        { "text": "a short real phrase (max 15 words), lifted or lightly trimmed from one of the theme's quotes above", "source_comment_id": "the comment_id (in brackets above) this phrase was trimmed from", "why": "why this phrase is worth reusing" }
      ],
      "claims_to_avoid": ["1-2 items specific to THIS theme + angle type — do not repeat the universal trust constraints listed above, those are already enforced separately"],
      "validation_prompt": "one concrete next content/test idea (an Instagram post concept or question) that would validate this angle with the audience"
    }
  ]
}

Rules:
- Produce exactly 6 angles, one per angle_type, in the order listed above.
- Ground every angle in the theme's real quotes and emotional triggers — do not invent generic supplement marketing copy.
- language_to_borrow: 2-3 items, each a SHORT phrase actually trimmed from the quotes above, not a full sentence or a paraphrase.
- Respect every trust constraint and brand guardrail listed above in every angle.
- Return ONLY valid JSON. No markdown.`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: ANTHROPIC_API_KEY=... node pipeline/dogist-pain-point-angles.mjs [--out <path>]");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
  const client = new Anthropic({ apiKey });

  console.log("Loading comments, brief, and voice profile...");
  const importData = JSON.parse(await fs.readFile(IMPORT_PATH, "utf8"));
  const brief = JSON.parse(await fs.readFile(BRIEF_PATH, "utf8"));
  const voice = JSON.parse(await fs.readFile(VOICE_PATH, "utf8"));

  const allComments = importData.comments ?? [];
  const videoById = new Map((importData.videos ?? []).map((v) => [v.id, v]));

  const dietComments = allComments.filter(
    (c) => matchesFoodTopic(c.text ?? "") && isHighSignal(c.text ?? "", c.likes)
  );
  dietComments.sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0));
  console.log(`  Total comments: ${allComments.length.toLocaleString()}`);
  console.log(`  High-signal diet/feeding comments: ${dietComments.length.toLocaleString()}`);

  // Stage 1: extraction (checkpointed — re-running 49 batches is expensive).
  // Signals are enriched with real comment metadata (id/likes/url/full text) immediately,
  // per batch, before anything else touches them — this is the only place quote text is
  // ever read from the source corpus.
  let allSignals;
  const cachedSignals = args.fresh ? null : await readJSONIfExists(SIGNALS_CHECKPOINT);
  if (cachedSignals) {
    console.log(`\nStage 1: Using ${cachedSignals.length.toLocaleString()} cached signals from checkpoint (pass --fresh to re-extract).`);
    allSignals = cachedSignals;
  } else {
    const chunks = chunkArray(dietComments, BATCH_SIZE);
    console.log(`\nStage 1: Extracting signals from ${chunks.length} batches (${BATCH_SIZE} comments each, ${PARALLEL_BATCHES} parallel) with ${EXTRACT_MODEL}...`);
    const batchResults = await runExtractionParallel(client, chunks, PARALLEL_BATCHES);

    allSignals = [];
    for (let b = 0; b < batchResults.length; b++) {
      allSignals.push(...enrichSignals(batchResults[b].signals ?? [], chunks[b], b, videoById));
    }
    console.log(`  Extracted ${allSignals.length.toLocaleString()} problem/want signals.`);
    await fs.writeFile(SIGNALS_CHECKPOINT, JSON.stringify(allSignals, null, 2));
  }

  const signalsById = new Map(allSignals.map((s) => [s.signal_id, s]));

  // Stage 2a: group-reduce — the model only returns signal_ids per theme, checkpointed.
  let groupThemes;
  const cachedThemes = args.fresh ? null : await readJSONIfExists(THEMES_CHECKPOINT);
  if (cachedThemes) {
    console.log(`\nStage 2a: Using ${cachedThemes.length.toLocaleString()} cached candidate themes from checkpoint.`);
    groupThemes = cachedThemes;
  } else {
    const signalGroups = chunkArray(allSignals, Math.ceil(allSignals.length / GROUP_SIZE) || 1);
    console.log(`\nStage 2a: Reducing ${signalGroups.length} signal groups with ${EXTRACT_MODEL}...`);
    groupThemes = [];
    for (let g = 0; g < signalGroups.length; g++) {
      process.stdout.write(`\r  Group ${g + 1}/${signalGroups.length}...   `);
      const parsed = await callClaude(client, EXTRACT_MODEL, groupClusterPrompt(signalGroups[g]), 4096, 3, `group-${g + 1}`, "themes");
      for (let t = 0; t < (parsed?.themes ?? []).length; t++) {
        const theme = parsed.themes[t];
        const validIds = (theme.signal_ids ?? []).filter((id) => signalsById.has(id));
        if (validIds.length === 0) continue; // hallucinated theme with no real signals behind it
        groupThemes.push({ ...theme, candidate_id: `g${g + 1}_${t}`, signal_ids: validIds });
      }
    }
    process.stdout.write("\n");
    await fs.writeFile(THEMES_CHECKPOINT, JSON.stringify(groupThemes, null, 2));
  }

  console.log(`\nStage 2b: Final theme merge with ${CLUSTER_MODEL} (${groupThemes.length} candidate themes in)...`);
  const finalClusters = await callClaude(
    client,
    CLUSTER_MODEL,
    finalClusterPrompt(groupThemes, allSignals.length),
    8000,
    3,
    "final-cluster",
    "themes"
  );
  if (!finalClusters?.themes?.length) throw new Error("Final clustering produced no themes");

  const candidateById = new Map(groupThemes.map((t) => [t.candidate_id, t]));
  const claimedCandidates = new Set();
  const resolvedFinalThemes = [];
  for (const theme of finalClusters.themes) {
    const signalIdSet = new Set();
    for (const cid of theme.source_candidate_ids ?? []) {
      const candidate = candidateById.get(cid);
      if (!candidate) continue; // hallucinated candidate_id
      if (claimedCandidates.has(cid)) {
        console.warn(`  [final-cluster] candidate ${cid} claimed by more than one final theme — keeping first claim only.`);
        continue;
      }
      claimedCandidates.add(cid);
      for (const sid of candidate.signal_ids) signalIdSet.add(sid);
    }
    if (signalIdSet.size === 0) continue; // no real signals resolved, drop
    resolvedFinalThemes.push({ ...theme, signal_ids: [...signalIdSet] });
  }
  const orphaned = groupThemes.filter((c) => !claimedCandidates.has(c.candidate_id));
  if (orphaned.length > 0) {
    console.warn(`  [final-cluster] ${orphaned.length} candidate theme(s) were not merged into any final theme (dropped): ${orphaned.map((c) => c.candidate_id).join(", ")}`);
  }
  console.log(`  ${resolvedFinalThemes.length} final themes (${resolvedFinalThemes.reduce((n, t) => n + t.signal_ids.length, 0)} signals accounted for).`);

  // Stage 3: angle generation, one call per theme (6 angles each). Representative quotes are
  // resolved directly from signalsById — real text, no text-matching guesswork.
  console.log(`\nStage 3: Generating 6 angles per theme with ${ANGLE_MODEL}...`);
  const themesWithAngles = [];
  for (let i = 0; i < resolvedFinalThemes.length; i++) {
    const theme = resolvedFinalThemes[i];
    process.stdout.write(`\r  Theme ${i + 1}/${resolvedFinalThemes.length}: ${theme.label}...   `);

    const themeSignals = theme.signal_ids.map((id) => signalsById.get(id)).filter(Boolean);
    const uniqueByComment = [...new Map(themeSignals.map((s) => [s.comment_id, s])).values()];
    uniqueByComment.sort((a, b) => b.likes - a.likes);
    const representative_quotes = uniqueByComment.slice(0, 6).map((s) => ({
      comment_id: s.comment_id,
      text: s.quote,
      likes: s.likes,
      post_id: s.post_id,
      post_url: s.post_url,
      post_title: s.post_title,
    }));

    const themeForPrompt = { ...theme, representative_quotes };
    const angleResult = await callClaude(client, ANGLE_MODEL, angleGenerationPrompt(themeForPrompt, brief, voice), 4096, 3, `angles-${theme.id}`, "angles");

    const quoteByCommentId = new Map(representative_quotes.map((q) => [q.comment_id, q]));
    const angles = (angleResult?.angles ?? []).map((a) => ({
      ...a,
      language_to_borrow: (a.language_to_borrow ?? []).map((l) => {
        const evidence = quoteByCommentId.get(l.source_comment_id);
        return { text: l.text, why: l.why, source_post_url: evidence?.post_url ?? null, source_likes: evidence?.likes ?? null };
      }),
    }));

    const signalStrength = theme.signal_ids.length >= 80 ? "high" : theme.signal_ids.length >= 25 ? "medium" : "low";

    themesWithAngles.push({
      id: theme.id,
      label: theme.label,
      problem_statement: theme.problem_statement,
      want_statement: theme.want_statement,
      emotional_triggers: theme.emotional_triggers,
      count_estimate: theme.signal_ids.length,
      signal_strength: signalStrength,
      representative_quotes,
      angles,
    });
  }
  process.stdout.write("\n");

  const outPath = args.out ?? OUT_PATH;
  const output = {
    generated_at: new Date().toISOString(),
    extract_model: EXTRACT_MODEL,
    cluster_model: CLUSTER_MODEL,
    angle_model: ANGLE_MODEL,
    diet_comments_total: dietComments.length,
    signals_extracted: allSignals.length,
    angle_types: ANGLE_TYPES,
    themes: themesWithAngles,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  await fs.rm(SIGNALS_CHECKPOINT, { force: true });
  await fs.rm(THEMES_CHECKPOINT, { force: true });

  console.log(`\nDone → ${outPath}`);
  console.log(`\nThemes:`);
  for (const t of themesWithAngles) {
    console.log(`  - ${t.label} (${t.signal_strength}, ~${t.count_estimate} signals, ${t.angles.length} angles)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
