#!/usr/bin/env node
/**
 * Optional Claude interpretation over discovered cultural clusters.
 *
 * Claude only labels and audits reduced evidence packets produced by
 * dogist-cultural-discovery.py. It does not discover clusters from raw comments.
 *
 * Usage:
 *   node --env-file=.env.local pipeline/dogist-cultural-interpret.mjs
 *   node --env-file=.env.local pipeline/dogist-cultural-interpret.mjs --limit 8
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKETS = path.join(
  ROOT,
  "data/opportunity-analysis/cultural-evidence-packets.json"
);
const DEFAULT_OUT = path.join(
  ROOT,
  "data/opportunity-analysis/cultural-interpretations.json"
);
const MODEL = "claude-haiku-4-5-20251001";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    if (flag === "--packets") args.packets = path.resolve(next());
    else if (flag === "--out") args.out = path.resolve(next());
    else if (flag === "--limit") args.limit = Number(next());
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

function printHelp() {
  console.log(`Dogist cultural interpretation

Usage:
  node --env-file=.env.local pipeline/dogist-cultural-interpret.mjs

Options:
  --packets <file>  Defaults to cultural-evidence-packets.json.
  --out <file>      Defaults to cultural-interpretations.json.
  --limit <n>       Optional cap for a small paid run.
`);
}

function compactPacket(packet) {
  return {
    cluster_id: packet.cluster_id,
    label_terms: packet.label_terms,
    size: packet.size,
    post_count: packet.post_count,
    language_mix: packet.language_mix,
    top_terms: packet.top_terms?.slice(0, 10),
    top_phrases: packet.top_phrases?.slice(0, 12),
    top_emojis: packet.top_emojis?.slice(0, 10),
    top_hashtags: packet.top_hashtags?.slice(0, 8),
    event_links: packet.event_links,
    author_profile: packet.author_profile,
    affect_profile: packet.affect_profile,
    detected_tensions: packet.detected_tensions,
    validation: packet.validation,
    confidence: packet.confidence,
    representative_quotes: packet.representative_quotes?.slice(0, 6),
    high_engagement_quotes: packet.high_engagement_quotes?.slice(0, 4),
    short_affective_examples: packet.short_affective_examples?.slice(0, 4),
    counterevidence: packet.counterevidence?.slice(0, 4),
  };
}

function promptFor(packet) {
  return `You are labeling a discovered cultural cluster from Instagram comments. The cluster was discovered locally using sentence embeddings, BERTopic, UMAP, and HDBSCAN. Your job is to label and audit the reduced evidence. Do not invent findings outside this packet.

Evidence packet:
${JSON.stringify(compactPacket(packet), null, 2)}

Return ONLY valid JSON:
{
  "cluster_id": "${packet.cluster_id}",
  "observed_pattern": "2 sentences grounded in the quoted comments, emojis, and post context",
  "candidate_cultural_meaning": "1-2 sentences, explicitly framed as interpretation",
  "short_label": "plain-English label under 7 words",
  "confidence": "strong" | "moderate" | "weak",
  "evidence_quotes_to_cite": ["exact quote text from packet"],
  "author_or_segment_limits": ["specific author concentration, repeat-commenter, or segment caveat if relevant"],
  "candidate_tensions": ["candidate tension visible in the packet, or []"],
  "counterevidence_or_limits": ["specific limitation or counterexample"],
  "unsupported_claims_to_avoid": ["claim that would overreach the evidence"]
}`;
}

async function callClaude(client, packet) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: promptFor(packet) }],
  });
  const block = response.content.find((item) => item.type === "text");
  const text = block?.type === "text" ? block.text.trim() : "";
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(clean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required. Use npm run dogist:cultural or node --env-file=.env.local.");

  const packetsPath = args.packets ?? DEFAULT_PACKETS;
  const outPath = args.out ?? DEFAULT_OUT;
  const input = JSON.parse(await fs.readFile(packetsPath, "utf8"));
  const packets = Number.isFinite(args.limit) ? input.packets.slice(0, args.limit) : input.packets;
  const client = new Anthropic({ apiKey });

  console.log(`Loaded ${packets.length} cultural evidence packets`);
  const interpretations = [];
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    console.log(`[${i + 1}/${packets.length}] ${packet.cluster_id} ${packet.label_terms}`);
    interpretations.push(await callClaude(client, packet));
    if (i < packets.length - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    model: MODEL,
    packets_analyzed: interpretations.length,
    source_packets: packetsPath,
    interpretation_boundary: "Claude labeled and audited reduced discovered clusters. It did not discover topics from raw comments.",
    interpretations,
  }, null, 2)}\n`);
  console.log(`Done. Output: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
