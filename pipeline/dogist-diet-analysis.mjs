#!/usr/bin/env node
/**
 * Sends ALL high-signal food/treats comments to Claude via batched extraction,
 * then synthesizes results into consolidated attributes + tensions.
 *
 * Flow:
 *   1. Load all comments from comment-analysis-import.json
 *   2. Apply food topic pattern matching (same patterns as pipeline)
 *   3. Apply high-signal scoring heuristic
 *   4. Chunk into BATCH_SIZE batches, run Haiku extraction in parallel
 *   5. Run Sonnet synthesis over all batch results
 *   6. Save to diet-analysis.json
 *
 * Usage: ANTHROPIC_API_KEY=... node pipeline/dogist-diet-analysis.mjs
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
const OUT_PATH = path.join(
  ROOT,
  "data/opportunity-analysis/diet-analysis.json"
);

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const SYNTH_MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 150;
const PARALLEL_BATCHES = 5; // concurrent Haiku calls

// Exact patterns from food_treat_supplement_trust topic in the pipeline
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

  // Replica of pipeline scoreComment logic
  let score = Math.min(10, Math.log2(l + 1) * 1.4);
  if (words.length >= 12) score += 2;
  if (words.length >= 28) score += 2;
  if (text.includes("?")) score += 2;
  if (/\b(i|we|my|our)\b/i.test(clean)) score += 1;
  if (/\b(need|wish|want|recommend|tried|use|buy|bought|pay|cost|afford|should)\b/i.test(clean)) score += 2;
  score += 3; // topic match bonus (2 + topicIds.length of 1)

  // isGenericShort penalty
  if (!clean) return false;
  if (words.length <= 3 && GENERIC_SHORT_RE.test(text.trim()) && l < 10) score -= 4;

  return score >= 4 || l >= 8;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function extractionPrompt(comments, batchIndex, totalBatches) {
  const commentBlock = comments
    .map((c, i) => `[${i + 1}] (${c.likes} likes) ${c.text}`)
    .join("\n\n");

  return `You are analyzing Instagram comments from @thedogist's audience about dog food, diet, treats, and feeding. This is batch ${batchIndex + 1} of ${totalBatches}.

COMMENTS:
${commentBlock}

Extract what you observe in THESE comments only. Return ONLY valid JSON:
{
  "attributes": [
    {
      "label": "concise label for a specific feeding behavior, ingredient, product type, or owner practice",
      "count": <integer: how many of these comments mention or relate to this attribute>,
      "example_quote": "best verbatim phrase (max 100 chars) from these comments"
    }
  ],
  "tensions": [
    {
      "topic": "short name for a genuine contradiction where commenters take opposing positions",
      "side_a": { "label": "position name", "quote": "verbatim fragment (max 120 chars)" },
      "side_b": { "label": "opposing position", "quote": "verbatim fragment (max 120 chars)" }
    }
  ]
}

Rules:
- attributes: find distinct things owners mention wanting, doing, or using for their dogs' diet. Include specific ingredients, feeding philosophies, product types, health concerns, and care behaviors. Only include things present in THESE comments.
- tensions: only include genuine contradictions where commenters clearly take opposing sides. 0-3 per batch is fine.
- count must be an integer based on these comments only.
- Quotes must be verbatim fragments from the comments above.
- Return ONLY valid JSON. No markdown.`;
}

function synthesisPrompt(batchResults, totalComments) {
  const resultsJson = JSON.stringify(batchResults, null, 2);
  return `You are synthesizing ${batchResults.length} batch analyses of Dogist Instagram comments about dog food, diet, and feeding. Together these batches cover ALL ${totalComments} high-signal comments in the food/treats topic cluster.

BATCH RESULTS:
${resultsJson}

Produce a consolidated analysis. Merge identical or near-identical attributes, sum their counts, and keep the best example quote. Do the same for tensions. Return ONLY valid JSON:
{
  "attributes": [
    {
      "label": "concise human-readable label",
      "count_estimate": <summed integer count across all batches>,
      "signal_strength": "high" | "medium" | "low",
      "example_quote": "best verbatim quote fragment (max 120 chars)",
      "example_quote_likes": <integer or 0>
    }
  ],
  "tensions": [
    {
      "topic": "short name",
      "side_a": {
        "label": "position name",
        "count_estimate": <integer>,
        "quote": "verbatim fragment (max 160 chars)"
      },
      "side_b": {
        "label": "opposing position",
        "count_estimate": <integer>,
        "quote": "verbatim fragment (max 160 chars)"
      },
      "why_it_matters": "one sentence: why this tension matters for a blueberry supplement launch",
      "suggested_question": "a follow-up Instagram post caption that would help The Dogist resolve this tension"
    }
  ]
}

Rules:
- attributes: merge duplicates, sum counts. Order by count_estimate descending. Include 10-16 distinct attributes. Assign signal_strength: high (count>=15), medium (count>=6), low (count<6).
- tensions: merge near-duplicates. Keep 4-7 distinct, meaningful tensions. Each needs both sides with real quotes.
- All quotes must come from the batch results above.
- Return ONLY valid JSON. No markdown.`;
}

function tryParseJSON(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Try to salvage a partial JSON object by truncating at the last valid item
    const attrMatch = clean.match(/"attributes"\s*:\s*(\[[\s\S]*?\])/);
    const tensionMatch = clean.match(/"tensions"\s*:\s*(\[[\s\S]*?\])/);
    try {
      return {
        attributes: attrMatch ? JSON.parse(attrMatch[1]) : [],
        tensions: tensionMatch ? JSON.parse(tensionMatch[1]) : [],
      };
    } catch {
      return null;
    }
  }
}

async function runBatch(client, comments, batchIndex, totalBatches, attempt = 1) {
  const prompt = extractionPrompt(comments, batchIndex, totalBatches);
  try {
    const response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = tryParseJSON(response.content[0].text.trim());
    if (parsed) return parsed;
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return runBatch(client, comments, batchIndex, totalBatches, attempt + 1);
    }
    console.warn(`  Batch ${batchIndex + 1}: failed after ${attempt} attempts, skipping`);
    return { attributes: [], tensions: [] };
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return runBatch(client, comments, batchIndex, totalBatches, attempt + 1);
    }
    console.warn(`  Batch ${batchIndex + 1}: API error: ${err.message}`);
    return { attributes: [], tensions: [] };
  }
}

async function runParallel(client, chunks, concurrency) {
  const results = new Array(chunks.length);
  let nextIdx = 0;
  let done = 0;
  async function worker() {
    while (nextIdx < chunks.length) {
      const idx = nextIdx++;
      results[idx] = await runBatch(client, chunks[idx], idx, chunks.length);
      done++;
      const pct = Math.round((done / chunks.length) * 100);
      process.stdout.write(`\r  ${done}/${chunks.length} batches complete (${pct}%)   `);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return results;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

  const client = new Anthropic({ apiKey });

  console.log("Loading comments from comment-analysis-import.json...");
  const importData = JSON.parse(await fs.readFile(IMPORT_PATH, "utf8"));
  const allComments = importData.comments ?? [];

  // Filter to high-signal food/treats comments
  const foodComments = allComments.filter(
    (c) => matchesFoodTopic(c.text ?? "") && isHighSignal(c.text ?? "", c.likes)
  );
  console.log(`  Total comments: ${allComments.length.toLocaleString()}`);
  console.log(`  High-signal food/treats comments: ${foodComments.length.toLocaleString()}`);

  // Sort by likes desc so highest-engagement comments appear early
  foodComments.sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0));

  const chunks = chunkArray(foodComments, BATCH_SIZE);
  console.log(`\nRunning ${chunks.length} extraction batches (${BATCH_SIZE} comments each, ${PARALLEL_BATCHES} parallel) with ${EXTRACT_MODEL}...`);

  const batchResults = await runParallel(client, chunks, PARALLEL_BATCHES);

  const totalAttrs = batchResults.reduce((s, r) => s + (r.attributes?.length ?? 0), 0);
  const totalTensions = batchResults.reduce((s, r) => s + (r.tensions?.length ?? 0), 0);
  console.log(`  Extraction complete: ${totalAttrs} attribute mentions, ${totalTensions} tension mentions across batches`);

  // Two-stage synthesis: first reduce each group of batches, then final merge
  const GROUP_SIZE = 8;
  const groups = chunkArray(batchResults, GROUP_SIZE);
  console.log(`\nStage 1: Reducing ${groups.length} groups of ${GROUP_SIZE} batches with ${EXTRACT_MODEL}...`);

  const groupSummaries = [];
  for (let g = 0; g < groups.length; g++) {
    process.stdout.write(`\r  Group ${g + 1}/${groups.length}...   `);
    const groupPrompt = synthesisPrompt(groups[g], Math.min(GROUP_SIZE * BATCH_SIZE, foodComments.length));
    let attempt = 0;
    let parsed = null;
    while (!parsed && attempt < 3) {
      attempt++;
      const resp = await client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: groupPrompt }],
      });
      parsed = tryParseJSON(resp.content[0].text.trim());
      if (!parsed && attempt < 3) await new Promise((r) => setTimeout(r, 1500));
    }
    groupSummaries.push(parsed ?? { attributes: [], tensions: [] });
  }
  process.stdout.write("\n");

  console.log(`\nStage 2: Final synthesis with ${SYNTH_MODEL}...`);
  const finalSynthResponse = await client.messages.create({
    model: SYNTH_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: synthesisPrompt(groupSummaries, foodComments.length) }],
  });
  const synthRaw = finalSynthResponse.content[0].text.trim();
  const synthesis = tryParseJSON(synthRaw);
  if (!synthesis) throw new Error("Final synthesis JSON parse failed:\n" + synthRaw.slice(0, 500));

  const output = {
    generated_at: new Date().toISOString(),
    extract_model: EXTRACT_MODEL,
    synthesis_model: SYNTH_MODEL,
    food_comments_total: foodComments.length,
    diet_comments_sampled: foodComments.length,
    batches: chunks.length,
    batch_size: BATCH_SIZE,
    ...synthesis,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(output, null, 2) + "\n");

  console.log(`\nDone → ${OUT_PATH}`);
  console.log(`\nTop attributes:`);
  for (const a of (synthesis.attributes ?? []).slice(0, 6)) {
    console.log(`  ${a.count_estimate} — ${a.label}`);
  }
  console.log(`\nTensions (${synthesis.tensions?.length}):`);
  for (const t of synthesis.tensions ?? []) {
    console.log(`  ⟷ ${t.topic}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
