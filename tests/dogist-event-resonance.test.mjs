import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildEventResonance,
  buildManualEventCandidates,
  buildPostTimeline,
  linkEventsToPosts,
  scorePostEvent,
} from "../pipeline/dogist-event-resonance.mjs";

const INPUT_PATH = "data/processed/comment-analysis-import.json";
const KNICKS_POST_IDS = [
  "instagram_thedogist_DZp-5B8RwWk",
  "instagram_thedogist_DZsSngvEdcq",
  "instagram_thedogist_DZvT0dwGuTX",
];

function loadInput() {
  return JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
}

test("post timeline preserves Dogist post dates, metrics, and social text signals", () => {
  const timeline = buildPostTimeline(loadInput());

  assert.equal(timeline.summary.posts, 370);
  assert.equal(timeline.summary.comments, 97579);

  for (const postId of KNICKS_POST_IDS) {
    const post = timeline.posts.find((candidate) => candidate.post_id === postId);
    assert.ok(post, `${postId} should be in post-timeline`);
    assert.ok(post.posted_date, `${postId} should preserve posted_date`);
    assert.ok(post.caption.length > 0, `${postId} should preserve caption`);
    assert.ok(post.entities.includes("knicks"), `${postId} should extract Knicks entity`);
    assert.ok(post.emoji.top_emojis.length > 0, `${postId} should preserve emoji distribution`);
  }
});

test("Knicks and Jameson links include transparent reason codes", () => {
  const input = loadInput();
  const timeline = buildPostTimeline(input);
  const candidates = buildManualEventCandidates(timeline);
  const links = linkEventsToPosts(timeline, candidates);

  for (const postId of KNICKS_POST_IDS) {
    const knicksLink = links.links.find((link) => (
      link.post_id === postId && link.event_id === "knicks_2026_nba_finals_win"
    ));
    assert.ok(knicksLink, `${postId} should link to Knicks championship`);
    assert.ok(
      knicksLink.reason_codes.some((reason) => reason.startsWith("entity_overlap:knicks")),
      `${postId} should include Knicks entity overlap`
    );
    assert.ok(
      knicksLink.reason_codes.some((reason) => reason.startsWith("caption_overlap:") || reason.startsWith("location_overlap:")),
      `${postId} should include caption or location evidence`
    );

    const jamesonLink = links.links.find((link) => (
      link.post_id === postId && link.event_id === "justice_for_jameson_discourse"
    ));
    assert.ok(jamesonLink, `${postId} should link to Jameson discourse`);
    assert.ok(
      jamesonLink.reason_codes.some((reason) => (
        reason.startsWith("comment_phrase:")
        || reason.startsWith("comment_hashtag:")
        || reason.startsWith("comment_entity:")
      )),
      `${postId} should include comment-level Jameson evidence`
    );
  }

  const resonance = buildEventResonance(timeline, candidates, links, input);
  const text = JSON.stringify(resonance).toLowerCase();
  assert.equal(text.includes("caused"), false, "event outputs should not use causal wording");
});

test("temporal-only links are explicitly marked as correlation, not evidence", () => {
  const post = {
    post_id: "post_1",
    posted_date: "2026-06-15T00:00:00.000Z",
    caption: "A sweet dog in the park",
    entities: [],
    hashtags: [],
    location_cues: [],
    top_comment_phrases: [],
    emoji: { top_emojis: [] },
    captured_comments: 20,
    like_count: 100,
  };
  const event = {
    event_id: "external_event",
    event_date: "2026-06-14T00:00:00.000Z",
    entities: ["knicks"],
    locations: ["new york"],
    query_terms: ["knicks"],
    emoji_markers: ["🏀"],
    salience: 0.9,
  };

  const scored = scorePostEvent(post, event, {
    posts: 4,
    avg_captured_comments: 20,
    avg_like_count: 100,
    term_shares: {},
    emoji_per_emoji_comment: {},
  });

  assert.equal(scored.confidence, "temporal_only");
  assert.ok(scored.reason_codes.every((reason) => reason.startsWith("temporal_proximity") || reason.startsWith("news_salience")));
});
