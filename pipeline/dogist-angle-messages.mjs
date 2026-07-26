#!/usr/bin/env node
/**
 * Structured ad-angle messages for the top N pain-point themes from pain-point-angles.json.
 *
 * Each of the 6 ad-angle types (pain-based, desire-based, problem/solution, social proof,
 * curiosity, niche-specific) is paired with a proven direct-response hook formula and
 * written as 5 structural parts: hook, explanation, solution, social_proof_usp, cta.
 * Grounded in the same real, evidence-linked quotes already resolved by
 * dogist-pain-point-angles.mjs — this script does not re-touch the corpus.
 *
 * Outputs: data/opportunity-analysis/angle-messages.json
 *
 * Usage: ANTHROPIC_API_KEY=... node pipeline/dogist-angle-messages.mjs [--top N] [--out <path>]
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PAIN_POINTS_PATH = path.join(
  ROOT,
  "data/opportunity-analysis/pain-point-angles.json"
);
const BRIEF_PATH = path.join(ROOT, "product/brief.json");
const VOICE_PATH = path.join(ROOT, "product/voice.json");
const OUT_PATH = path.join(
  ROOT,
  "data/opportunity-analysis/angle-messages.json"
);

const ANGLE_MODEL = "claude-sonnet-4-6";
const DEFAULT_TOP_N = 10;

// Each type is paired with one proven direct-response hook formula (chosen for its
// psychological driver) and a worked example the model adapts per theme.
const ANGLE_TYPES = [
  {
    id: "pain_based",
    label: "Pain-based",
    description:
      "Name the real discomfort, worry, or guilt directly — the thing the owner is actually feeling — then let Vitality sit alongside it as relief, not a cure.",
    hook_formula: '"Why Your [Thing] Isn\'t Working" — Problem Identification + Authority',
    hook_pattern: "Why [specific frustration] isn't working (it's not [the cause they assume]).",
    hook_worked_example: "Why your dog still won't touch anything green (it's probably not stubbornness).",
    hook_why_it_works:
      "Addresses a frustration they already have and promises a non-obvious diagnosis — reframes something they've written off as 'my dog is just difficult' into something explainable.",
  },
  {
    id: "desire_based",
    label: "Desire-based",
    description:
      "Paint the aspirational outcome or identity the owner wants for their dog. Inspirational, forward-looking, not fear-driven.",
    hook_formula: '"The [Adjective] Way To [Outcome]" — Method + Promise',
    hook_pattern: "The [unexpected adjective] way to [outcome the owner wants].",
    hook_worked_example: "The zero-negotiation way to know your dog's getting real nutrition every day.",
    hook_why_it_works:
      "An unexpected adjective (zero-negotiation, effortless, boring) creates curiosity while staying outcome-first — it's the payoff, not the pitch.",
  },
  {
    id: "problem_solution",
    label: "Problem / Solution",
    description:
      "State the problem plainly, then the solution just as plainly. No embellishment, no emotional framing — just clear cause and effect.",
    hook_formula: '"Stop [X]. Do [Y] Instead." — Corrective + Actionable',
    hook_pattern: "Stop [the workaround they're doing]. [Alternative], instead.",
    hook_worked_example: "Stop hiding vegetables in meatballs. Give her a chew that already has the nutrients in it, instead.",
    hook_why_it_works:
      "Calls out the specific behavior they're already doing and promises a better way — corrective, not judgmental. Crucially: the problem is the dog rejecting balanced nutrition, NOT rejecting one specific ingredient — that ingredient is the solution's, not the thing being fought over. Don't write 'your dog won't eat X, here's a chew with X' — that's circular.",
  },
  {
    id: "social_proof",
    label: "Social proof",
    description:
      "Lean on 'other owners like you already do this.' Community validation and shared experience, not hype or manufactured urgency.",
    hook_formula: '"I [Read/Watched] [Number] [Thing]" — Research + Synthesis',
    hook_pattern: "We read [real count from this theme]+ comments from dog owners about [topic]. Here's [the pattern].",
    hook_worked_example: "We read 100+ comments from owners about picky eaters. The pattern surprised us.",
    hook_why_it_works:
      "Real sample size (use the theme's actual count, never invent a number) creates authority and promises a distilled, non-obvious pattern — and it's true, which is the whole point.",
  },
  {
    id: "curiosity",
    label: "Curiosity / Pattern interrupt",
    description:
      "Open with a genuinely surprising or counterintuitive observation from the comments that makes an owner want to know more — without becoming clickbait or breaking Dogist's trust.",
    hook_formula: '"Why [X] Actually [Y] — It\'s Not What You Think" — Behind-the-scenes + Truth',
    hook_pattern: "Why [common assumption] is actually [surprising reframe] — it's not what you think.",
    hook_worked_example: "Why your dog won't eat vegetables — it's probably not pickiness.",
    hook_why_it_works:
      "Promises an insider reframe of something the reader assumed they already understood. Must be a real, evidence-backed reframe — never a fake mystery.",
  },
  {
    id: "niche_specific",
    label: "Niche-specific",
    description:
      "Speak to one narrow, specific situation or owner identity so precisely that it feels made for exactly that person, not a general dog-owner audience.",
    hook_formula: '"If You [X], [Y]" — Pattern Interrupt + Authority',
    hook_pattern: "If your dog [very specific, recognizable behavior], [directive or reframe].",
    hook_worked_example: "If your dog has been meat-and-cheese-only since puppyhood, this is for you — not the salad-dog on your feed.",
    hook_why_it_works:
      "Calls out one exact behavior/identity specifically enough that only that person keeps reading — everyone else scrolling past is a feature, not a bug.",
  },
];

function parseArgs(argv) {
  const args = { top: DEFAULT_TOP_N };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--top") args.top = parseInt(argv[++i], 10);
    else if (argv[i] === "--help") args.help = true;
  }
  return args;
}

function tryParseJSON(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// Same brace-matching salvage as dogist-pain-point-angles.mjs — recover complete array
// items from a response truncated by stop_reason:max_tokens instead of losing all of it.
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
    if (depth !== 0) break;
    try {
      items.push(JSON.parse(clean.slice(start, i)));
    } catch {
      // skip malformed element
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

      console.warn(`\n  [${label}] JSON parse failed (attempt ${attempt}/${attempts}), stop_reason=${response.stop_reason}, raw length=${rawText.length}.`);
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

function angleGenerationPrompt(theme, brief, voice) {
  const claimsBlock = brief.claims_to_test.map((c) => `- ${c.id} ("${c.label}"): keywords ${c.keywords.join(", ")}`).join("\n");

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

IMPORTANT — WHAT THE PROBLEM ACTUALLY IS:
The problem is NOT "the dog won't eat [one specific ingredient]." The problem is that the dog rejects a balanced, nutrient-varied diet — a specific ingredient is just one example the audience happens to mention. Vitality's blueberry/pomegranate antioxidants are part of the SOLUTION, delivered in a salmon-flavored chew specifically so the dog doesn't have to eat produce directly. Never frame the hook or problem around "won't eat [ingredient]" — that's circular (the reader immediately thinks "so don't make me feed that"). Frame the problem as the real thing underneath it: getting a picky dog real nutrition without a fight. Specific foods the dog rejects can appear as color/evidence, but the STATED problem is always about balanced nutrition, not one ingredient.

Write ONE message for EACH of these 6 ad-angle types. Each must feel meaningfully different in structure and tone — not the same line six times with a different label. Each message is broken into 5 structural parts, not one flowing line:

- hook: A brief, scroll-stopping opener (1 sentence, ideally under 15 words). Must make the reader pause and lean in BEFORE any product is mentioned — no brand name, no product name, no "chew" in the hook itself. Each angle type below has a specific proven hook FORMULA — follow its pattern, adapted with real specifics from this theme (not the worked example verbatim).
- explanation: 1-2 sentences expanding on the hook — why this matters, what's really going on.
- solution: 1-2 sentences introducing Vitality as the response — the first place the product/brand can appear.
- social_proof_usp: 1 sentence — why this is credible/relevant right now (real audience pattern, ingredient fact, or timing reason), not generic hype.
- cta: A short, CONVERSION-focused call to action that drives to purchase (shop / get yours / try it / see what's inside), phrased to echo the specific emotional payoff of THIS hook — e.g. if the hook is about getting mornings back, the cta might be "Click here to get your morning back." Not generic engagement bait (not "comment below," not "tag a friend") — every cta should read like it belongs to exactly this angle and no other.

ANGLE TYPES, THEIR HOOK FORMULA, AND A WORKED EXAMPLE (write your own, grounded in the real quotes — do not just reuse the worked example):
${ANGLE_TYPES.map(
  (a) =>
    `- ${a.id} ("${a.label}")\n  Formula: ${a.hook_formula}\n  Pattern: ${a.hook_pattern}\n  Worked example for this theme: "${a.hook_worked_example}"\n  Why it works: ${a.hook_why_it_works}`
).join("\n\n")}

Return ONLY valid JSON:
{
  "angles": [
    {
      "angle_type": "one of the angle type ids above",
      "hook_formula_used": "the formula name you followed",
      "hook": "...",
      "explanation": "...",
      "solution": "...",
      "social_proof_usp": "...",
      "cta": "...",
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
- The hook must stand alone — someone who reads ONLY the hook should feel the pain/desire/curiosity without knowing yet that this is an ad, and without the problem being reduced to a specific ingredient.
- Ground every part in the theme's real quotes and emotional triggers — do not invent generic supplement marketing copy.
- language_to_borrow: 2-3 items, each a SHORT phrase actually trimmed from the quotes above, not a full sentence or a paraphrase.
- cta must be conversion-focused and specific to this angle's hook, not generic and not engagement-only.
- Respect every trust constraint and brand guardrail listed above in every angle.
- Return ONLY valid JSON. No markdown.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: ANTHROPIC_API_KEY=... node pipeline/dogist-angle-messages.mjs [--top N] [--out <path>]");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required");
  const client = new Anthropic({ apiKey });

  const painPoints = JSON.parse(await fs.readFile(PAIN_POINTS_PATH, "utf8"));
  const brief = JSON.parse(await fs.readFile(BRIEF_PATH, "utf8"));
  const voice = JSON.parse(await fs.readFile(VOICE_PATH, "utf8"));

  const topThemes = [...painPoints.themes].sort((a, b) => b.count_estimate - a.count_estimate).slice(0, args.top);
  console.log(`Generating structured angles for top ${topThemes.length} of ${painPoints.themes.length} themes with ${ANGLE_MODEL}...`);

  const results = [];
  for (let i = 0; i < topThemes.length; i++) {
    const theme = topThemes[i];
    process.stdout.write(`\r  Theme ${i + 1}/${topThemes.length}: ${theme.label}...   `);
    const angleResult = await callClaude(client, ANGLE_MODEL, angleGenerationPrompt(theme, brief, voice), 6500, 3, `angles-${theme.id}`, "angles");

    const quoteByCommentId = new Map(theme.representative_quotes.map((q) => [q.comment_id, q]));
    const angles = (angleResult?.angles ?? []).map((a) => ({
      ...a,
      language_to_borrow: (a.language_to_borrow ?? []).map((l) => {
        const evidence = quoteByCommentId.get(l.source_comment_id);
        return { text: l.text, why: l.why, source_post_url: evidence?.post_url ?? null, source_likes: evidence?.likes ?? null };
      }),
    }));

    results.push({
      id: theme.id,
      label: theme.label,
      problem_statement: theme.problem_statement,
      want_statement: theme.want_statement,
      emotional_triggers: theme.emotional_triggers,
      count_estimate: theme.count_estimate,
      signal_strength: theme.signal_strength,
      representative_quotes: theme.representative_quotes,
      angles,
    });
  }
  process.stdout.write("\n");

  const outPath = args.out ?? OUT_PATH;
  const output = {
    generated_at: new Date().toISOString(),
    angle_model: ANGLE_MODEL,
    source: path.relative(ROOT, PAIN_POINTS_PATH),
    top_n: topThemes.length,
    angle_types: ANGLE_TYPES,
    themes: results,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nDone → ${outPath}`);
  console.log(`\nThemes:`);
  for (const t of results) {
    console.log(`  - ${t.label} (${t.signal_strength}, ~${t.count_estimate} signals, ${t.angles.length} angles)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
