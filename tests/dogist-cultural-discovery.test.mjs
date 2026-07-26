import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data/opportunity-analysis");
const LEGACY_BUCKET_NAMES = new Set([
  "Food, Treats, And Product Trust",
  "Rescue And Adoption Trust",
  "IRL Community And Sampling",
  "Grief, Loss, And Memorial Language",
  "Senior, Health, And Care Companionship",
  "Services, Cost, And Access Pain Points",
  "Product, Commerce, And Merch Pull",
  "Behavior, Anxiety, And Training",
  "Travel And Dog-Friendly Places",
]);

function readJson(name) {
  return JSON.parse(readFileSync(path.join(OUT, name), "utf8"));
}

function scanFeatures() {
  const lines = readFileSync(path.join(OUT, "cultural-comment-features.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);
  const result = {
    count: lines.length,
    sawEmojiOnly: false,
    sawHashtag: false,
    sawMention: false,
    sawNonLatin: false,
    sawJusticeForJameson: false,
    sawAuthorControls: false,
    sawAffectTags: false,
    sawStanceTags: false,
  };
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.emoji_only) result.sawEmojiOnly = true;
    if (row.hashtags?.length) result.sawHashtag = true;
    if (row.mentions?.length) result.sawMention = true;
    if (row.script_cues?.has_non_latin_script) result.sawNonLatin = true;
    if (Number.isFinite(row.author_comment_count) && row.commenter_segment) result.sawAuthorControls = true;
    if (row.affect_tags?.length) result.sawAffectTags = true;
    if (row.stance_tags?.length) result.sawStanceTags = true;
    if ((row.hashtags ?? []).includes("#justiceforjameson") || /justice\s+for\s+jameson/i.test(row.raw_text ?? "")) {
      result.sawJusticeForJameson = true;
    }
    if (
      result.sawEmojiOnly
      && result.sawHashtag
      && result.sawMention
      && result.sawNonLatin
      && result.sawJusticeForJameson
      && result.sawAuthorControls
      && result.sawAffectTags
      && result.sawStanceTags
    ) break;
  }
  return result;
}

test("cultural discovery is primary and independent of legacy handwritten bucket names", () => {
  const discovery = readJson("cultural-discovery.json");
  const clusters = readJson("cultural-clusters.json");

  assert.equal(discovery.primary_analysis_layer, "embedding_cultural_discovery");
  assert.equal(discovery.legacy_handwritten_topics_used, false);
  assert.equal(discovery.summary.legacy_handwritten_topics_used, false);
  assert.ok(discovery.summary.discovered_clusters > 0);
  assert.ok(discovery.summary.model_eligible_comments > 0);
  assert.ok(discovery.summary.unique_authors > 0);
  assert.ok(discovery.author_summary.unique_authors > 0);
  assert.ok(clusters.clusters.length > 0);

  for (const cluster of clusters.clusters.slice(0, 20)) {
    assert.equal(LEGACY_BUCKET_NAMES.has(cluster.label_terms), false, `cluster label reused legacy bucket: ${cluster.label_terms}`);
  }
});

test("cultural feature extraction preserves emoji, hashtags, mentions, and script cues", () => {
  const features = scanFeatures();
  const discovery = readJson("cultural-discovery.json");

  assert.equal(features.count, discovery.summary.comments_analyzed);
  assert.equal(features.sawEmojiOnly, true);
  assert.equal(features.sawHashtag, true);
  assert.equal(features.sawMention, true);
  assert.equal(features.sawNonLatin, true);
  assert.equal(features.sawJusticeForJameson, true);
  assert.equal(features.sawAuthorControls, true);
  assert.equal(features.sawAffectTags, true);
  assert.equal(features.sawStanceTags, true);
});

test("emoji motifs model short affective and event-adjacent emoji behavior", () => {
  const motifs = readJson("emoji-motifs.json");
  const byId = new Map(motifs.motifs.map((motif) => [motif.motif_id, motif]));

  assert.ok(byId.get("high_volume_affection")?.comment_count > 0);
  assert.ok(byId.get("emoji_only_reactions")?.emoji_only_comments > 0);
  assert.ok(byId.get("grief_memorial")?.comment_count > 0);
  assert.ok(byId.get("knicks_blue_orange")?.comment_count > 0);

  const blueOrangeEmojis = new Set((byId.get("knicks_blue_orange")?.top_emojis ?? []).map((item) => item.value));
  assert.equal(blueOrangeEmojis.has("💙") || blueOrangeEmojis.has("🧡"), true);
});

test("cultural evidence packets include diverse evidence and event overlap", () => {
  const packets = readJson("cultural-evidence-packets.json");
  assert.equal(packets.legacy_handwritten_topics_used, false);
  assert.ok(packets.author_controls);
  assert.ok(packets.packets.length > 0);

  assert.equal(
    packets.packets.some((packet) => (packet.short_affective_examples ?? []).length > 0),
    true,
    "expected short affective evidence examples"
  );
  assert.equal(
    packets.packets.some((packet) => (packet.counterevidence ?? []).length > 0),
    true,
    "expected counterevidence examples"
  );
  assert.equal(
    packets.packets.some((packet) => (packet.event_links ?? []).some((link) => /knicks|jameson/i.test(link.event_id))),
    true,
    "expected Knicks or Jameson event overlap in discovered evidence packets"
  );
  assert.equal(
    packets.packets.every((packet) => packet.author_profile && packet.validation && packet.affect_profile),
    true,
    "expected author, validation, and affect controls in every packet"
  );
  assert.equal(
    packets.packets.some((packet) => (packet.detected_tensions ?? []).length > 0),
    true,
    "expected at least one candidate tension for Claude to audit"
  );
  assert.equal(
    packets.packets.every((packet) => packet.required_output_fields?.includes("author_or_segment_limits")),
    true,
    "expected Claude output contract to include author/segment limits"
  );
});

test("community segments summarize participation modes without demographic claims", () => {
  const segments = readJson("community-segments.json");
  assert.ok(segments.author_count > 0);
  assert.ok(segments.segment_count > 0);
  assert.ok(segments.segments.length > 0);
  assert.ok(segments.guardrails.some((item) => /not demographic/i.test(item)));
  assert.ok(segments.segments.some((segment) => segment.segment_id === "casual_single_commenters"));
  assert.ok(segments.segments.every((segment) => Number.isFinite(segment.author_count) && Number.isFinite(segment.comment_count)));
});
