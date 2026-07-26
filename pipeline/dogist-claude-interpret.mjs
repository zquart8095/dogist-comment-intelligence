#!/usr/bin/env node
/**
 * Runs two Claude passes over each Dogist evidence packet:
 *   1. Context-free read — what the comments show on their own
 *   2. Business-context read — how it connects to the blueberry supplement launch
 *
 * Outputs: data/opportunity-analysis/claude-interpretations.json
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node pipeline/dogist-claude-interpret.mjs
 *   node pipeline/dogist-claude-interpret.mjs --packets <path> --out <path>
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_PACKETS = path.join(
  ROOT,
  "data/opportunity-analysis/claude-evidence-packets.json"
);
const DEFAULT_OUT = path.join(
  ROOT,
  "data/opportunity-analysis/claude-interpretations.json"
);

const MODEL = "claude-haiku-4-5-20251001";

const SUPPLEMENT_CONTEXT = `The Dogist is planning to launch a blueberry-based dog supplement in fall 2026. The goal is to understand the community's language, motivations, and objections — to inform product positioning, launch messaging, and content strategy. The creator has 290k+ Instagram followers and 175k TikTok followers. The audience is highly engaged dog owners who follow for authentic dog stories, not ads.`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--packets") args.packets = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--help") args.help = true;
  }
  return args;
}

function contextFreePrompt(packet) {
  const packetJson = JSON.stringify(
    {
      opportunity_name: packet.name,
      corpus_counts: packet.counts,
      representative_posts: packet.representative_posts.map((p) => ({
        title: p.title,
        url: p.url,
        high_signal_comments_in_this_topic: p.high_signal_topic_comments,
      })),
      representative_comments: packet.representative_comments.map((c) => ({
        text: c.text,
        likes: c.likes,
        post_url: c.post_url,
        signal_score: c.signal_score,
      })),
      topic_terms: packet.top_terms,
      topic_phrases: packet.top_phrases,
    },
    null,
    2
  );

  return `You are analyzing a cluster of high-signal Instagram comments from a dog content creator's audience. Read these comments as they are — no product or business context.

Evidence packet:
${packetJson}

Return ONLY a JSON object with these fields:
{
  "signal_type": one of "product_demand" | "content_engagement" | "community_affinity" | "pain_point" | "mixed",
  "signal_strength": one of "strong" | "moderate" | "weak",
  "summary": "2-3 sentences describing what this audience is actually saying and feeling",
  "key_motivations": ["up to 4 motivations expressed in the comments"],
  "key_concerns": ["up to 4 concerns, frustrations, or objections expressed"],
  "authentic_language": ["up to 6 exact phrases or words the audience uses — verbatim from comments"],
  "best_quotes": [
    {
      "text": "exact quote text",
      "post_url": "url",
      "why": "one sentence: what makes this quote revealing"
    }
  ]
}

Pick 3 best_quotes from the representative_comments provided. Return ONLY valid JSON, no markdown, no explanation.`;
}

function businessContextPrompt(packet, contextFreeResult) {
  return `Context about this creator and launch:
${SUPPLEMENT_CONTEXT}

You previously analyzed a comment cluster called "${packet.name}" and found:
- Signal type: ${contextFreeResult.signal_type}
- Signal strength: ${contextFreeResult.signal_strength}
- Summary: ${contextFreeResult.summary}
- Key motivations: ${contextFreeResult.key_motivations.join("; ")}
- Key concerns: ${contextFreeResult.key_concerns.join("; ")}

Corpus data for this cluster:
- ${packet.counts.high_signal_comments} high-signal comments across ${packet.counts.posts} posts
- ${packet.counts.total_comment_likes} total comment likes

Now, with the supplement launch context in mind, return ONLY a JSON object:
{
  "supplement_relevance": one of "direct" | "adjacent" | "indirect" | "none",
  "relevance_explanation": "1-2 sentences: how this audience signal connects (or doesn't) to a blueberry supplement launch",
  "messaging_angles": ["up to 3 specific content or messaging angles this evidence supports for the launch"],
  "objections_to_address": ["up to 3 objections or concerns the launch messaging should pre-empt"],
  "language_to_borrow": ["up to 5 words or phrases from the audience worth using in launch copy"],
  "recommended_next_step": "one concrete action: a specific validation post idea, partnership angle, or content test"
}

Return ONLY valid JSON, no markdown, no explanation.`;
}

async function callClaude(client, prompt) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(clean);
}

async function interpretPacket(client, packet, index, total) {
  console.log(`[${index + 1}/${total}] ${packet.name}`);

  console.log(`  → context-free pass`);
  const contextFree = await callClaude(client, contextFreePrompt(packet));

  console.log(`  → business-context pass`);
  const businessContext = await callClaude(
    client,
    businessContextPrompt(packet, contextFree)
  );

  return {
    opportunity_id: packet.id ?? packet.name.toLowerCase().replace(/\W+/g, "_"),
    opportunity_name: packet.name,
    status: packet.status,
    counts: packet.counts,
    representative_posts: packet.representative_posts,
    context_free: contextFree,
    business_context: businessContext,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node pipeline/dogist-claude-interpret.mjs [--packets <path>] [--out <path>]"
    );
    return;
  }

  const packetsPath = args.packets ?? DEFAULT_PACKETS;
  const outPath = args.out ?? DEFAULT_OUT;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");

  const client = new Anthropic({ apiKey });
  const packets = JSON.parse(await fs.readFile(packetsPath, "utf8"));

  console.log(`Loaded ${packets.length} evidence packets from ${packetsPath}`);
  console.log(`Model: ${MODEL}\n`);

  const interpretations = [];
  for (let i = 0; i < packets.length; i++) {
    const result = await interpretPacket(client, packets[i], i, packets.length);
    interpretations.push(result);
    // Brief pause to avoid rate limits
    if (i < packets.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  const output = {
    generated_at: new Date().toISOString(),
    model: MODEL,
    packets_analyzed: interpretations.length,
    supplement_context: SUPPLEMENT_CONTEXT,
    interpretations,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n");

  console.log(`\nDone. Output: ${outPath}`);
  console.log("\nSupplement relevance summary:");
  for (const r of interpretations) {
    const rel = r.business_context.supplement_relevance;
    const icon = rel === "direct" ? "●" : rel === "adjacent" ? "◐" : rel === "indirect" ? "○" : "–";
    console.log(`  ${icon} [${rel}] ${r.opportunity_name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
