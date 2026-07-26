#!/usr/bin/env python3
"""Local-first cultural discovery for the Dogist Instagram corpus.

This script intentionally does not use the legacy hand-authored opportunity
topic buckets. It discovers comment clusters from multilingual sentence
embeddings, models emoji behavior separately, and writes reduced evidence
packets for optional LLM interpretation.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
import math
import os
import re
import statistics
import unicodedata
import warnings
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import emoji as emoji_lib
import numpy as np
from langdetect import LangDetectException, detect
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/processed/comment-analysis-import.json"
DEFAULT_OUT = ROOT / "data/opportunity-analysis"
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_CACHE = ROOT / "local-data/models"
RANDOM_STATE = 42
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
warnings.filterwarnings("ignore", category=RuntimeWarning, module="sklearn.utils.extmath")

STOPWORDS = {
    "about", "above", "after", "again", "against", "all", "also", "always", "and", "any", "are", "around",
    "because", "been", "before", "being", "between", "both", "but", "can", "could", "did", "does", "doing",
    "as", "at", "be", "by", "for", "from", "get", "gets", "got", "had", "has", "have", "having", "he", "her",
    "here", "hers", "him", "his", "how", "i", "if", "im", "in", "into", "is", "it", "its", "ive", "just",
    "like", "ll", "lol", "look", "looks", "m", "make", "many", "me", "more", "most", "much", "my", "not",
    "now", "of", "off", "on", "one", "only", "or", "our", "out", "over", "own", "really", "re", "s", "same",
    "see", "she", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "to", "too", "under", "ve", "very", "was", "we", "were",
    "what", "when", "where", "which", "while", "who", "why", "will", "with", "would", "you", "your", "dog",
    "dogs", "pup", "puppy", "pups", "doggo", "thedogist",
    "instagram", "http", "https", "www", "com",
}

SHORT_AFFECTIVE_RE = re.compile(
    r"^(so\s+)?(cute|adorable|beautiful|sweet|precious|love|lovely|amazing|awesome|perfect|best|angel|"
    r"good boy|good girl|omg|wow|aww+|awww+|love this|i love this|too cute|cutie|rip|rest in peace|"
    r"go knicks|lets go|let's go|same|yes|no|thank you|thanks)[.!?\s]*$",
    re.IGNORECASE,
)

AFFECT_TAG_DEFS = [
    {
        "id": "affection",
        "label": "Affection / warmth",
        "patterns": [r"\blove\b", r"\badore\b", r"\bcute\b", r"\badorable\b", r"\bbeautiful\b", r"\bsweet\b", r"\bprecious\b"],
        "emojis": ["❤️", "♥️", "😍", "🥰", "💕", "🩷", "🤍", "💜"],
    },
    {
        "id": "laughter_play",
        "label": "Laughter / play",
        "patterns": [r"\blol\b", r"\bhaha+\b", r"\bfunny\b", r"\bhilarious\b", r"\bcrack(?:ing)? up\b"],
        "emojis": ["😂", "🤣", "😆", "😅"],
    },
    {
        "id": "grief_memorial",
        "label": "Grief / memorial",
        "patterns": [r"\brip\b", r"\brest in peace\b", r"\brainbow bridge\b", r"\bpassed away\b", r"\bmiss(?:ing)?\b", r"\bheartbroken\b", r"\bmemorial\b"],
        "emojis": ["😭", "😢", "💔", "❤️‍🩹", "🌈", "🕊️"],
    },
    {
        "id": "justice_anger",
        "label": "Justice / anger",
        "patterns": [r"\bjustice\b", r"\bunacceptable\b", r"\boutrage\b", r"\bangry\b", r"\bfurious\b", r"\bshot\b", r"\baccountab"],
        "emojis": ["😡", "🤬"],
    },
    {
        "id": "celebration",
        "label": "Celebration / approval",
        "patterns": [r"\bcongrats?\b", r"\bcongratulations\b", r"\bchamp(?:ion|s)?\b", r"\bparade\b", r"\bwin(?:ning)?\b", r"\bbirthday\b", r"\blet'?s go\b"],
        "emojis": ["👏", "🙌", "🔥", "🎉", "🏆", "✨", "🏀", "🥳"],
    },
    {
        "id": "gratitude_prayer",
        "label": "Gratitude / prayer",
        "patterns": [r"\bthank you\b", r"\bthanks\b", r"\bgrateful\b", r"\bbless(?:ed|ing)?\b", r"\bprayers?\b"],
        "emojis": ["🙏", "🙏🏻", "🙏🏼", "🙏🏽", "🙏🏾", "🙏🏿", "🤲"],
    },
    {
        "id": "care_concern",
        "label": "Care / concern",
        "patterns": [r"\bhope\b", r"\bsafe\b", r"\bvet\b", r"\bsurgery\b", r"\bcancer\b", r"\binsulin\b", r"\bdiabet", r"\bsenior\b", r"\bworried\b", r"\bhealth\b"],
        "emojis": ["🥹", "😢", "🙏"],
    },
    {
        "id": "food_routine",
        "label": "Food / feeding routine",
        "patterns": [r"\brecipe\b", r"\bchicken\b", r"\brice\b", r"\bkibble\b", r"\bcarrots?\b", r"\bblueberr", r"\bfeed(?:ing)?\b", r"\bcooked?\b", r"\beat(?:ing|s)?\b", r"\btreats?\b"],
        "emojis": ["🫐", "🥕", "🍗", "🍚", "🍳"],
    },
    {
        "id": "local_sports_identity",
        "label": "Local / sports identity",
        "patterns": [r"\bknicks\b", r"\bmets\b", r"\bnyc\b", r"\bnew york\b", r"\bbrooklyn\b", r"\bwashington square\b", r"\bparade\b"],
        "emojis": ["💙", "🧡", "🏀", "🏆", "🗽"],
    },
]

STANCE_TAG_DEFS = [
    {
        "id": "praise_affirmation",
        "label": "Praise / affirmation",
        "patterns": [r"\blove\b", r"\bamazing\b", r"\bbeautiful\b", r"\bperfect\b", r"\bbest\b", r"\bgood (?:boy|girl)\b"],
        "emojis": ["❤️", "😍", "👏"],
    },
    {
        "id": "advice_recommendation",
        "label": "Advice / recommendation",
        "patterns": [r"\btry\b", r"\badd\b", r"\bshould\b", r"\brecommend\b", r"\brecipe\b", r"\bfeed\b", r"\bvet\b", r"\buse\b"],
        "emojis": [],
    },
    {
        "id": "objection_refusal",
        "label": "Objection / refusal",
        "patterns": [r"\brefuse\b", r"\bwon'?t\b", r"\bdoesn'?t\b", r"\bnope\b", r"\bno\b", r"\ballergic\b", r"\bnot\b", r"\bnever\b"],
        "emojis": ["🙅", "🚫"],
    },
    {
        "id": "request_nomination",
        "label": "Request / nomination",
        "patterns": [r"\bnominate\b", r"\bplease\b", r"\bcan you\b", r"\bcome to\b", r"\bvisit\b", r"\bpick\b"],
        "emojis": [],
    },
    {
        "id": "call_to_action",
        "label": "Call to action",
        "patterns": [r"\bdonate\b", r"\badopt\b", r"\bfoster\b", r"\bhelp\b", r"\bsign\b", r"\bjustice\b", r"\bhonor\b"],
        "emojis": ["🙏", "📢"],
    },
    {
        "id": "personal_testimony",
        "label": "Personal testimony",
        "patterns": [r"\bmy dog\b", r"\bmy pup\b", r"\bmine\b", r"\bour dog\b", r"\bwe\b", r"\bi have\b", r"\bi had\b"],
        "emojis": [],
    },
    {
        "id": "question",
        "label": "Question / uncertainty",
        "patterns": [r"\?", r"\bdoes anyone\b", r"\bwhat\b", r"\bwhy\b", r"\bhow\b", r"\bwhere\b"],
        "emojis": [],
    },
    {
        "id": "concern_warning",
        "label": "Concern / warning",
        "patterns": [r"\bcareful\b", r"\btoxic\b", r"\bdanger(?:ous)?\b", r"\bpoison\b", r"\bshouldn'?t\b", r"\bwarning\b"],
        "emojis": ["⚠️", "🚨"],
    },
]

TENSION_DEFS = [
    {
        "id": "food_aspiration_vs_refusal",
        "label": "Healthy feeding aspiration vs dog refusal",
        "side_a": {
            "label": "Owners share feeding routines/advice",
            "all_affect": ["food_routine"],
            "any_stance": ["advice_recommendation", "personal_testimony"],
            "patterns": [r"\brecipe\b", r"\bchicken\b", r"\brice\b", r"\bkibble\b", r"\bcarrots?\b", r"\bblueberr", r"\bfeed", r"\beat"],
        },
        "side_b": {
            "label": "Dogs reject or complicate healthy foods",
            "all_affect": ["food_routine"],
            "any_stance": ["objection_refusal"],
            "patterns": [r"\brefuse\b", r"\bwon'?t\b", r"\bdoesn'?t\b", r"\bno\b", r"\bnot\b", r"\bspit\b", r"\bpicky\b", r"\ballergic\b"],
        },
    },
    {
        "id": "celebration_vs_mourning",
        "label": "Celebration vs mourning/justice reframing",
        "side_a": {
            "label": "Celebration, hype, local pride",
            "any_affect": ["celebration", "local_sports_identity"],
            "patterns": [r"\bknicks\b", r"\bmets\b", r"\bchamp", r"\bparade\b", r"\bbirthday\b", r"\bcongrats?\b", r"\blet'?s go\b"],
        },
        "side_b": {
            "label": "Grief, justice, memorial language",
            "any_affect": ["grief_memorial", "justice_anger"],
            "any_stance": ["call_to_action"],
            "patterns": [r"\bjustice\b", r"\bjameson\b", r"\brip\b", r"\brest in peace\b", r"\bpassed\b", r"\bmemorial\b", r"\bshot\b", r"\bhonor\b"],
        },
    },
    {
        "id": "rescue_gratitude_vs_action",
        "label": "Rescue gratitude vs action requests",
        "side_a": {
            "label": "Gratitude and praise for rescue work",
            "any_affect": ["gratitude_prayer", "affection"],
            "any_stance": ["praise_affirmation"],
            "patterns": [r"\brescue\b", r"\bshelter\b", r"\badopt", r"\bfoster\b", r"\bhumane\b", r"\bfund\b"],
        },
        "side_b": {
            "label": "Requests to nominate, adopt, foster, or help",
            "any_stance": ["request_nomination", "call_to_action"],
            "patterns": [r"\bnominate\b", r"\badopt", r"\bfoster\b", r"\bdonate\b", r"\brescue\b", r"\bshelter\b"],
        },
    },
    {
        "id": "training_advice_vs_discomfort",
        "label": "Training advice vs discomfort/warnings",
        "side_a": {
            "label": "Practical advice or correction",
            "any_stance": ["advice_recommendation"],
            "patterns": [r"\bcollar\b", r"\bprong\b", r"\btraining\b", r"\btrainer\b", r"\breactive\b", r"\bservice\b", r"\banxiety\b"],
        },
        "side_b": {
            "label": "Concern, warning, or objection",
            "any_stance": ["concern_warning", "objection_refusal"],
            "patterns": [r"\bcollar\b", r"\bprong\b", r"\btraining\b", r"\btrainer\b", r"\breactive\b", r"\bservice\b", r"\banxiety\b", r"\btoxic\b", r"\bdanger"],
        },
    },
]

SCRIPT_RANGES = {
    "cyrillic": ((0x0400, 0x04FF),),
    "arabic": ((0x0600, 0x06FF),),
    "hebrew": ((0x0590, 0x05FF),),
    "devanagari": ((0x0900, 0x097F),),
    "cjk": ((0x4E00, 0x9FFF),),
    "hiragana_katakana": ((0x3040, 0x30FF),),
    "hangul": ((0xAC00, 0xD7AF),),
}

EMOJI_MOTIF_DEFS = [
    {
        "id": "high_volume_affection",
        "label": "High-volume affection reactions",
        "emojis": ["❤️", "♥️", "😍", "🥰", "💕", "🩷", "🤍", "💜", "💙", "🧡"],
        "interpretation_boundary": "Signals warmth or approval, but does not by itself explain why the audience reacted.",
    },
    {
        "id": "laughter_play",
        "label": "Play, laughter, and comic recognition",
        "emojis": ["😂", "🤣", "😆", "😹", "😅"],
        "interpretation_boundary": "Often marks amused recognition; avoid reading it as product intent.",
    },
    {
        "id": "applause_celebration",
        "label": "Applause, celebration, and approval",
        "emojis": ["👏", "🙌", "🔥", "🎉", "🏆", "✨", "🏀"],
        "interpretation_boundary": "Can mark celebration, hype, or social approval depending on text and post context.",
    },
    {
        "id": "grief_memorial",
        "label": "Grief, memorial, and care",
        "emojis": ["😭", "😢", "💔", "❤️‍🩹", "🌈", "🙏", "🕊️"],
        "interpretation_boundary": "Affective grief markers require text/post context before inferring a memorial narrative.",
    },
    {
        "id": "prayer_gratitude",
        "label": "Prayer, gratitude, and blessing",
        "emojis": ["🙏", "🙏🏻", "🙏🏼", "🙏🏽", "🙏🏾", "🙏🏿", "🤲"],
        "interpretation_boundary": "May express thanks, hope, mourning, or request; do not collapse all uses into faith.",
    },
    {
        "id": "knicks_blue_orange",
        "label": "Blue/orange Knicks-adjacent reactions",
        "emojis": ["💙", "🧡", "🏀", "🏆"],
        "interpretation_boundary": "This is event-adjacent color/sports context, not causal proof of why commenters posted.",
    },
    {
        "id": "emoji_only_reactions",
        "label": "Emoji-only reactions",
        "emojis": [],
        "interpretation_boundary": "Emoji-only comments are engagement and affect signals; their meaning should stay broad unless repeated with text context.",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover Dogist cultural clusters from local embeddings.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--model", default=MODEL_NAME)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--min-cluster-size", type=int, default=80)
    parser.add_argument("--min-samples", type=int, default=10)
    parser.add_argument("--max-comments", type=int, default=None, help="Optional debug cap; full corpus by default.")
    return parser.parse_args()


def read_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return fallback


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def normalize_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_text(value: str) -> str:
    return normalize_ws(unicodedata.normalize("NFKC", str(value or "")))


def extract_emojis(value: str) -> list[str]:
    return [item["emoji"] for item in emoji_lib.emoji_list(value or "")]


def strip_emoji(value: str) -> str:
    return normalize_ws(emoji_lib.replace_emoji(value or "", replace=" "))


def alpha_count(value: str) -> int:
    return sum(1 for ch in value if unicodedata.category(ch).startswith("L"))


def word_count(value: str) -> int:
    return len(re.findall(r"\b[\w']+\b", value.lower()))


def hashtags(value: str) -> list[str]:
    return [m.group(0).lower() for m in re.finditer(r"#[A-Za-z0-9_]+", value or "")]


def mentions(value: str) -> list[str]:
    return [m.group(0).lower() for m in re.finditer(r"@[A-Za-z0-9_.]+", value or "")]


def script_cues(value: str) -> dict[str, Any]:
    hits: dict[str, bool] = {}
    for name, ranges in SCRIPT_RANGES.items():
        hits[name] = any(start <= ord(ch) <= end for ch in value for start, end in ranges)
    hits["latin"] = any(("A" <= ch <= "Z") or ("a" <= ch <= "z") for ch in value)
    hits["has_non_latin_script"] = any(v for k, v in hits.items() if k not in {"latin", "has_non_latin_script"})
    return hits


def detect_language(value: str, emojis: list[str], scripts: dict[str, Any]) -> str:
    stripped = strip_emoji(value)
    if emojis and not stripped:
        return "emoji_only"
    if alpha_count(stripped) < 20:
        return "und_non_latin" if scripts.get("has_non_latin_script") else "und"
    try:
        return detect(stripped)
    except LangDetectException:
        return "und"


def repeated_emoji(emojis: list[str]) -> bool:
    return any(index > 0 and emojis[index - 1] == emoji for index, emoji in enumerate(emojis))


def is_short_affective(stripped_text: str, emojis: list[str]) -> bool:
    if not stripped_text:
        return bool(emojis)
    wc = word_count(stripped_text)
    if wc <= 5 and emojis:
        return True
    return wc <= 5 and bool(SHORT_AFFECTIVE_RE.match(stripped_text))


def text_matches(patterns: list[str], value: str) -> bool:
    return any(re.search(pattern, value, re.IGNORECASE) for pattern in patterns)


def classify_tags(value: str, emojis: list[str], definitions: list[dict[str, Any]]) -> list[str]:
    lowered = value.lower()
    emoji_set = set(emojis)
    tags = []
    for definition in definitions:
        if text_matches(definition.get("patterns", []), lowered) or emoji_set.intersection(definition.get("emojis", [])):
            tags.append(definition["id"])
    return tags


def commenter_segment_for_count(author: str | None, count: int) -> str:
    if author == "thedogist":
        return "creator_account"
    if count >= 50:
        return "highly_engaged_regular"
    if count >= 10:
        return "repeat_regular"
    if count >= 2:
        return "repeat_commenter"
    return "casual_commenter"


def annotate_author_controls(features: list[dict[str, Any]]) -> dict[str, Any]:
    author_counts = Counter(feature["author"] or "unknown" for feature in features)
    author_posts: dict[str, set[str]] = defaultdict(set)
    author_likes: Counter = Counter()
    for feature in features:
        author = feature["author"] or "unknown"
        author_posts[author].add(feature["post_id"])
        author_likes[author] += feature["likes"]

    segment_counts: Counter = Counter()
    for feature in features:
        author = feature["author"] or "unknown"
        count = author_counts[author]
        segment = commenter_segment_for_count(author, count)
        feature["author_comment_count"] = count
        feature["author_unique_post_count"] = len(author_posts[author])
        feature["author_total_likes_received"] = int(author_likes[author])
        feature["commenter_segment"] = segment
        segment_counts[segment] += 1

    return {
        "unique_authors": len(author_counts),
        "top_authors": [
            {
                "author": author,
                "comments": count,
                "share": round(count / max(len(features), 1), 4),
                "segment": commenter_segment_for_count(author, count),
                "unique_posts": len(author_posts[author]),
            }
            for author, count in author_counts.most_common(12)
        ],
        "commenter_segment_mix": top_items(segment_counts, 8),
    }


def build_embedding_text(raw: str, caption: str, hash_tags: list[str]) -> str:
    demojized = emoji_lib.demojize(raw or "", delimiters=(" ", " "))
    hash_text = " ".join(tag.lstrip("#") for tag in hash_tags)
    return normalize_ws(f"{raw} {demojized} {hash_text} {caption[:280]}")[:1000]


def comment_feature(comment: dict[str, Any], post: dict[str, Any]) -> dict[str, Any]:
    raw = normalize_text(comment.get("text") or "")
    post_caption = normalize_text(post.get("title") or "")
    emoji_values = extract_emojis(raw)
    stripped = strip_emoji(raw)
    script = script_cues(raw)
    hash_tags = hashtags(raw)
    mention_values = mentions(raw)
    emoji_only = bool(emoji_values) and not stripped
    short_affective = is_short_affective(stripped, emoji_values)
    language = detect_language(raw, emoji_values, script)
    affect_tags = classify_tags(raw, emoji_values, AFFECT_TAG_DEFS)
    stance_tags = classify_tags(raw, emoji_values, STANCE_TAG_DEFS)
    eligible = (
        not emoji_only
        and not short_affective
        and alpha_count(stripped) >= 8
        and len(stripped) >= 12
    )
    return {
        "feature_id": hashlib.sha1(str(comment.get("id") or f'{comment.get("video_id")}::{raw}').encode()).hexdigest()[:16],
        "comment_id": comment.get("id"),
        "post_id": comment.get("video_id"),
        "author": comment.get("author"),
        "likes": int(comment.get("likes") or 0),
        "raw_text": raw,
        "normalized_text": raw.lower(),
        "stripped_text": stripped,
        "emojis": emoji_values,
        "emoji_sequence": "".join(emoji_values),
        "emoji_only": emoji_only,
        "repeated_emoji": repeated_emoji(emoji_values),
        "hashtags": hash_tags,
        "mentions": mention_values,
        "language": language,
        "script_cues": script,
        "short_affective": short_affective,
        "affect_tags": affect_tags,
        "stance_tags": stance_tags,
        "model_eligible": eligible,
        "embedding_text": build_embedding_text(raw, post_caption, hash_tags),
        "post_caption": post_caption[:500],
        "post_url": post.get("permalink_url"),
        "posted_date": post.get("posted_date"),
        "post_like_count": post.get("like_count"),
        "post_total_comments": post.get("total_comments"),
        "post_captured_comments": post.get("captured_comments"),
        "cultural_cluster_id": None,
        "post_context_cluster_id": None,
        "centroid_similarity": None,
        "author_comment_count": None,
        "author_unique_post_count": None,
        "author_total_likes_received": None,
        "commenter_segment": None,
    }


def top_items(counter: Counter, limit: int = 12) -> list[dict[str, Any]]:
    return [{"value": value, "count": count} for value, count in counter.most_common(limit)]


def quote_payload(feature: dict[str, Any]) -> dict[str, Any]:
    return {
        "comment_id": feature["comment_id"],
        "post_id": feature["post_id"],
        "post_url": feature["post_url"],
        "posted_date": feature["posted_date"],
        "author": feature["author"],
        "likes": feature["likes"],
        "raw_text": feature["raw_text"],
        "emojis": feature["emojis"],
        "hashtags": feature["hashtags"],
        "language": feature["language"],
        "affect_tags": feature.get("affect_tags", []),
        "stance_tags": feature.get("stance_tags", []),
        "commenter_segment": feature.get("commenter_segment"),
        "author_comment_count": feature.get("author_comment_count"),
        "centroid_similarity": feature.get("centroid_similarity"),
    }


def select_diverse(features: list[dict[str, Any]], limit: int, score_fn) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_posts: set[str] = set()
    seen_authors: set[str] = set()
    for feature in sorted(features, key=score_fn, reverse=True):
        author = feature.get("author") or "unknown"
        if feature["post_id"] in seen_posts and len(seen_posts) < limit:
            continue
        if author in seen_authors and len(seen_authors) < limit:
            continue
        selected.append(quote_payload(feature))
        seen_posts.add(feature["post_id"])
        seen_authors.add(author)
        if len(selected) >= limit:
            break
    if len(selected) < limit:
        selected_ids = {item["comment_id"] for item in selected}
        for feature in sorted(features, key=score_fn, reverse=True):
            if feature["comment_id"] in selected_ids:
                continue
            selected.append(quote_payload(feature))
            if len(selected) >= limit:
                break
    return selected


def phrase_counter(texts: list[str], limit: int = 18, min_df: int = 2) -> list[dict[str, Any]]:
    docs = [strip_emoji(text).lower() for text in texts if alpha_count(strip_emoji(text)) >= 4]
    if not docs:
        return []
    try:
        vectorizer = CountVectorizer(
            stop_words=list(STOPWORDS),
            ngram_range=(1, 3),
            min_df=min_df,
            max_features=4000,
            token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z']+\b",
        )
        matrix = vectorizer.fit_transform(docs)
    except ValueError:
        return []
    counts = np.asarray(matrix.sum(axis=0)).ravel()
    names = vectorizer.get_feature_names_out()
    ranked = sorted(zip(names, counts), key=lambda item: int(item[1]), reverse=True)
    return [{"value": name, "count": int(count)} for name, count in ranked[:limit]]


def load_sentence_model(model_name: str):
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(MODEL_CACHE))
    from sentence_transformers import SentenceTransformer

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    return SentenceTransformer(model_name, cache_folder=str(MODEL_CACHE))


def encode_dedup(model, texts: list[str], batch_size: int) -> np.ndarray:
    unique_texts = list(dict.fromkeys(texts))
    print(f"Encoding {len(unique_texts):,} unique texts for {len(texts):,} eligible comments...")
    unique_embeddings = model.encode(
        unique_texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    by_text = {text: unique_embeddings[index] for index, text in enumerate(unique_texts)}
    return np.asarray([by_text[text] for text in texts], dtype=np.float32)


def run_bertopic(docs: list[str], embeddings: np.ndarray, min_cluster_size: int, min_samples: int):
    from bertopic import BERTopic
    from hdbscan import HDBSCAN
    from umap import UMAP

    umap_model = UMAP(
        n_neighbors=30,
        n_components=5,
        min_dist=0.0,
        metric="cosine",
        random_state=RANDOM_STATE,
        low_memory=True,
    )
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        prediction_data=False,
    )
    vectorizer_model = CountVectorizer(
        stop_words=list(STOPWORDS),
        ngram_range=(1, 3),
        min_df=1,
        max_features=20000,
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z']+\b",
    )
    topic_model = BERTopic(
        embedding_model=None,
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        calculate_probabilities=False,
        verbose=True,
    )
    topics, _ = topic_model.fit_transform(docs, embeddings)
    return topic_model, topics


def score_confidence(
    size: int,
    coherence: float,
    post_count: int,
    noise_ratio: float,
    language_count: int,
    author_profile: dict[str, Any],
    top_post_share: float,
) -> dict[str, Any]:
    size_score = min(28, math.log10(max(size, 1)) * 14)
    coherence_score = max(0, min(34, (coherence - 0.15) * 80))
    spread_score = min(24, post_count / 2)
    language_score = min(8, language_count * 2)
    noise_penalty = min(16, noise_ratio * 22)
    top_author_share = float(author_profile.get("top_author_share") or 0)
    top3_author_share = float(author_profile.get("top_3_author_share") or 0)
    prolific_share = float(author_profile.get("prolific_author_comment_share") or 0)
    concentration_penalty = 0
    if top_author_share >= 0.15:
        concentration_penalty += 12
    elif top_author_share >= 0.08:
        concentration_penalty += 6
    if top3_author_share >= 0.3:
        concentration_penalty += 8
    if prolific_share >= 0.3:
        concentration_penalty += 8
    if top_post_share >= 0.65:
        concentration_penalty += 10
    elif top_post_share >= 0.45:
        concentration_penalty += 5
    score = round(max(0, min(100, size_score + coherence_score + spread_score + language_score - noise_penalty - concentration_penalty)))
    if score >= 72:
        level = "strong"
    elif score >= 50:
        level = "moderate"
    else:
        level = "weak"
    return {
        "level": level,
        "score": score,
        "factors": {
            "cluster_size": size,
            "mean_centroid_similarity": round(coherence, 4),
            "post_spread": post_count,
            "language_count": language_count,
            "global_noise_ratio": round(noise_ratio, 4),
            "top_author_share": round(top_author_share, 4),
            "top_3_author_share": round(top3_author_share, 4),
            "top_post_share": round(top_post_share, 4),
            "prolific_author_comment_share": round(prolific_share, 4),
            "concentration_penalty": concentration_penalty,
        },
    }


def cluster_author_profile(members: list[dict[str, Any]]) -> dict[str, Any]:
    author_counts = Counter(feature.get("author") or "unknown" for feature in members)
    segment_counts = Counter(feature.get("commenter_segment") or "unknown" for feature in members)
    size = max(len(members), 1)
    top_authors = []
    for author, count in author_counts.most_common(10):
        sample = next((feature for feature in members if (feature.get("author") or "unknown") == author), {})
        top_authors.append({
            "author": author,
            "comments": count,
            "share": round(count / size, 4),
            "corpus_comments": sample.get("author_comment_count"),
            "unique_posts_in_corpus": sample.get("author_unique_post_count"),
            "segment": sample.get("commenter_segment"),
        })
    top_author_share = top_authors[0]["share"] if top_authors else 0
    top3_author_share = sum(item["comments"] for item in top_authors[:3]) / size if top_authors else 0
    prolific_segments = {"repeat_regular", "highly_engaged_regular", "creator_account"}
    prolific_count = sum(1 for feature in members if feature.get("commenter_segment") in prolific_segments)
    creator_count = sum(1 for feature in members if feature.get("commenter_segment") == "creator_account")
    if top_author_share >= 0.15 or top3_author_share >= 0.3:
        concentration_level = "high"
    elif top_author_share >= 0.08 or top3_author_share >= 0.18:
        concentration_level = "moderate"
    else:
        concentration_level = "low"
    return {
        "unique_author_count": len(author_counts),
        "top_author_share": round(top_author_share, 4),
        "top_3_author_share": round(top3_author_share, 4),
        "prolific_author_comment_share": round(prolific_count / size, 4),
        "creator_account_comment_share": round(creator_count / size, 4),
        "concentration_level": concentration_level,
        "top_authors": top_authors,
        "commenter_segment_mix": top_items(segment_counts, 8),
        "interpretation_boundary": "Low concentration supports community-wide evidence. High concentration means Claude must treat the cluster as possibly driven by repeat commenters.",
    }


def cluster_affect_profile(members: list[dict[str, Any]]) -> dict[str, Any]:
    affect_counts = Counter(tag for feature in members for tag in feature.get("affect_tags", []))
    stance_counts = Counter(tag for feature in members for tag in feature.get("stance_tags", []))
    size = max(len(members), 1)
    return {
        "top_affect_tags": [
            {"value": value, "count": count, "share": round(count / size, 4)}
            for value, count in affect_counts.most_common(10)
        ],
        "top_stance_tags": [
            {"value": value, "count": count, "share": round(count / size, 4)}
            for value, count in stance_counts.most_common(10)
        ],
        "interpretation_boundary": "Affect and stance tags are lightweight lexical/emoji cues for evidence review, not a validated psychology classifier.",
    }


def feature_matches_side(feature: dict[str, Any], side: dict[str, Any]) -> bool:
    affects = set(feature.get("affect_tags", []))
    stances = set(feature.get("stance_tags", []))
    raw = feature.get("raw_text", "")
    if side.get("patterns") and not text_matches(side["patterns"], raw):
        return False
    if side.get("all_affect") and not set(side["all_affect"]).issubset(affects):
        return False
    if side.get("all_stance") and not set(side["all_stance"]).issubset(stances):
        return False
    any_affect = set(side.get("any_affect", side.get("affect", [])))
    any_stance = set(side.get("any_stance", side.get("stance", [])))
    if any_affect or any_stance:
        return bool(affects.intersection(any_affect) or stances.intersection(any_stance))
    return bool(side.get("patterns"))


def cluster_tensions(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tensions = []
    size = max(len(members), 1)
    for definition in TENSION_DEFS:
        side_a_members = [feature for feature in members if feature_matches_side(feature, definition["side_a"])]
        side_b_members = [feature for feature in members if feature_matches_side(feature, definition["side_b"])]
        if len(side_a_members) < 8 or len(side_b_members) < 8:
            continue
        overlap = {
            feature["comment_id"]
            for feature in side_a_members
        }.intersection(feature["comment_id"] for feature in side_b_members)
        tensions.append({
            "tension_id": definition["id"],
            "label": definition["label"],
            "side_a": {
                "label": definition["side_a"]["label"],
                "count": len(side_a_members),
                "share": round(len(side_a_members) / size, 4),
                "evidence": select_diverse(side_a_members, 2, lambda feature: (feature.get("centroid_similarity") or 0, feature["likes"])),
            },
            "side_b": {
                "label": definition["side_b"]["label"],
                "count": len(side_b_members),
                "share": round(len(side_b_members) / size, 4),
                "evidence": select_diverse(side_b_members, 2, lambda feature: (feature.get("centroid_similarity") or 0, feature["likes"])),
            },
            "overlap_comment_count": len(overlap),
            "interpretation_boundary": "This is a candidate tension in cluster language; validate against raw quotes before framing it as a real audience split.",
        })
    return sorted(tensions, key=lambda item: min(item["side_a"]["count"], item["side_b"]["count"]), reverse=True)[:4]


def validation_checks(
    members: list[dict[str, Any]],
    sims: np.ndarray,
    post_counts: Counter,
    author_profile: dict[str, Any],
    noise_ratio: float,
) -> dict[str, Any]:
    size = len(members)
    top_post_count = post_counts.most_common(1)[0][1] if post_counts else 0
    top_post_share = top_post_count / max(size, 1)
    sim_values = [float(value) for value in sims]
    quantiles = {
        "p25": round(float(np.quantile(sim_values, 0.25)), 4) if sim_values else 0,
        "p50": round(float(np.quantile(sim_values, 0.5)), 4) if sim_values else 0,
        "p75": round(float(np.quantile(sim_values, 0.75)), 4) if sim_values else 0,
    }
    risk_flags = []
    if author_profile.get("top_author_share", 0) >= 0.15:
        risk_flags.append("high_single_author_concentration")
    if author_profile.get("top_3_author_share", 0) >= 0.3:
        risk_flags.append("high_top_3_author_concentration")
    if author_profile.get("prolific_author_comment_share", 0) >= 0.3:
        risk_flags.append("repeat_commenter_heavy")
    if top_post_share >= 0.55:
        risk_flags.append("single_post_thread_heavy")
    if len(post_counts) < 3:
        risk_flags.append("thin_post_spread")
    if author_profile.get("unique_author_count", 0) < 25:
        risk_flags.append("thin_author_base")
    if quantiles["p50"] < 0.35:
        risk_flags.append("low_semantic_coherence")
    if noise_ratio >= 0.35:
        risk_flags.append("high_global_noise_context")
    status = "needs_review" if risk_flags else "candidate_signal"
    if not risk_flags and size >= 250 and len(post_counts) >= 8 and author_profile.get("unique_author_count", 0) >= 100:
        status = "broad_candidate_signal"
    return {
        "status": status,
        "risk_flags": risk_flags,
        "top_post_share": round(top_post_share, 4),
        "top_post_count": top_post_count,
        "centroid_similarity_quantiles": quantiles,
        "review_guidance": "Use as observed corpus structure. Do not call it validated demand without external validation or explicit purchase/request evidence.",
    }


def aggregate_events(features: list[dict[str, Any]], event_links_by_post: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    counts: Counter = Counter()
    reasons: dict[str, Counter] = defaultdict(Counter)
    confidence: dict[str, Counter] = defaultdict(Counter)
    for post_id in {feature["post_id"] for feature in features}:
        for link in event_links_by_post.get(post_id, []):
            event_id = link.get("event_id")
            if not event_id:
                continue
            counts[event_id] += 1
            confidence[event_id][link.get("confidence", "unknown")] += 1
            for code in link.get("reason_codes", [])[:8]:
                reasons[event_id][code] += 1
    return [
        {
            "event_id": event_id,
            "linked_posts": count,
            "confidence_counts": dict(confidence[event_id]),
            "top_reason_codes": top_items(reasons[event_id], 8),
        }
        for event_id, count in counts.most_common(5)
    ]


def build_clusters(
    features: list[dict[str, Any]],
    eligible_indices: list[int],
    embeddings: np.ndarray,
    topics: list[int],
    topic_model,
    event_links_by_post: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    topic_to_positions: dict[int, list[int]] = defaultdict(list)
    for eligible_position, topic in enumerate(topics):
        feature_index = eligible_indices[eligible_position]
        features[feature_index]["cultural_cluster_id"] = int(topic)
        topic_to_positions[int(topic)].append(eligible_position)

    noise_count = len(topic_to_positions.get(-1, []))
    noise_ratio = noise_count / max(len(eligible_indices), 1)
    clusters = []
    packets = []

    for topic, positions in sorted(topic_to_positions.items(), key=lambda item: len(item[1]), reverse=True):
        if topic == -1:
            continue
        member_indices = [eligible_indices[pos] for pos in positions]
        members = [features[index] for index in member_indices]
        member_embeddings = embeddings[positions]
        centroid = np.mean(member_embeddings, axis=0, dtype=np.float64)
        centroid = centroid / max(np.linalg.norm(centroid), 1e-9)
        sims = cosine_similarity(member_embeddings, centroid.reshape(1, -1)).ravel()
        for feature, sim in zip(members, sims):
            feature["centroid_similarity"] = round(float(sim), 4)

        lang_counts = Counter(feature["language"] for feature in members)
        post_counts = Counter(feature["post_id"] for feature in members)
        emoji_counts = Counter(emoji for feature in members for emoji in feature["emojis"])
        hashtag_counts = Counter(tag for feature in members for tag in feature["hashtags"])
        mention_counts = Counter(mention for feature in members for mention in feature["mentions"])
        top_posts = []
        by_post = defaultdict(list)
        for feature in members:
            by_post[feature["post_id"]].append(feature)
        for post_id, count in post_counts.most_common(8):
            sample = by_post[post_id][0]
            post_emoji_counts = Counter(emoji for feature in by_post[post_id] for emoji in feature["emojis"])
            top_posts.append({
                "post_id": post_id,
                "posted_date": sample["posted_date"],
                "post_url": sample["post_url"],
                "caption": sample["post_caption"],
                "comments_in_cluster": count,
                "top_emojis": top_items(post_emoji_counts, 6),
            })

        topic_terms = []
        try:
            topic_terms = [
                {"value": term, "weight": round(float(weight), 5)}
                for term, weight in (topic_model.get_topic(topic) or [])[:14]
            ]
        except Exception:
            topic_terms = []
        top_phrases = phrase_counter([feature["raw_text"] for feature in members], 18, min_df=3)
        coherence = statistics.fmean(float(value) for value in sims) if len(sims) else 0.0
        author_profile = cluster_author_profile(members)
        top_post_share = (post_counts.most_common(1)[0][1] / max(len(members), 1)) if post_counts else 0
        validation = validation_checks(members, sims, post_counts, author_profile, noise_ratio)
        confidence = score_confidence(len(members), coherence, len(post_counts), noise_ratio, len(lang_counts), author_profile, top_post_share)
        affect_profile = cluster_affect_profile(members)
        tensions = cluster_tensions(members)
        cluster_id = f"cultural_{topic}"
        term_label = ", ".join(item["value"] for item in topic_terms[:4]) or ", ".join(item["value"] for item in top_phrases[:4]) or cluster_id
        event_links = aggregate_events(members, event_links_by_post)

        representative = select_diverse(
            members,
            8,
            lambda feature: (
                (feature.get("centroid_similarity") or 0) * 0.55
                + min(feature["likes"], 50) / 50 * 0.2
                + min(len(feature["emojis"]), 3) / 3 * 0.15
                + min(word_count(feature["stripped_text"]), 40) / 40 * 0.1
            ),
        )
        high_engagement = select_diverse(members, 5, lambda feature: (feature["likes"], feature.get("centroid_similarity") or 0))
        member_posts = {feature["post_id"] for feature in members}
        short_candidates = [
            feature for feature in features
            if feature["post_id"] in member_posts and feature["short_affective"] and (feature["emojis"] or feature["likes"] > 0)
        ]
        short_affective_examples = select_diverse(
            short_candidates,
            5,
            lambda feature: (len(feature["emojis"]) * 0.5 + min(feature["likes"], 25) / 25 * 0.5),
        )
        counterevidence = select_diverse(
            sorted(members, key=lambda feature: feature.get("centroid_similarity") or 0)[: max(10, min(40, len(members) // 5))],
            4,
            lambda feature: -(feature.get("centroid_similarity") or 0),
        )

        cluster_summary = {
            "cluster_id": cluster_id,
            "topic_id": topic,
            "label_terms": term_label,
            "size": len(members),
            "post_count": len(post_counts),
            "language_mix": top_items(lang_counts, 8),
            "top_terms": topic_terms,
            "top_phrases": top_phrases,
            "top_emojis": top_items(emoji_counts, 12),
            "top_hashtags": top_items(hashtag_counts, 10),
            "top_mentions": top_items(mention_counts, 8),
            "top_posts": top_posts,
            "event_links": event_links,
            "author_profile": author_profile,
            "affect_profile": affect_profile,
            "detected_tensions": tensions,
            "validation": validation,
            "confidence": confidence,
            "representative_quotes": representative[:4],
            "short_affective_examples": short_affective_examples[:3],
            "interpretation_boundary": "Discovered by embedding/topic modeling. Treat labels as hypotheses until reviewed against raw evidence.",
        }
        clusters.append(cluster_summary)
        packets.append({
            **cluster_summary,
            "representative_quotes": representative,
            "high_engagement_quotes": high_engagement,
            "short_affective_examples": short_affective_examples,
            "counterevidence": counterevidence,
            "required_output_fields": [
                "observed_pattern",
                "candidate_cultural_meaning",
                "confidence",
                "evidence_quotes_to_cite",
                "author_or_segment_limits",
                "candidate_tensions",
                "unsupported_claims_to_avoid",
            ],
        })

    return clusters, packets


def build_post_context_clusters(features: list[dict[str, Any]], posts: list[dict[str, Any]], model, batch_size: int) -> list[dict[str, Any]]:
    features_by_post: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        features_by_post[feature["post_id"]].append(feature)

    post_docs = []
    post_ids = []
    for post in posts:
        post_features = features_by_post.get(post["id"], [])
        top_phrases = phrase_counter([feature["raw_text"] for feature in post_features], 10, min_df=1)
        emoji_counts = Counter(emoji for feature in post_features for emoji in feature["emojis"])
        emoji_text = " ".join(emoji_lib.demojize(item["value"], delimiters=(" ", " ")) for item in top_items(emoji_counts, 10))
        doc = normalize_ws(f"{post.get('title') or ''} {' '.join(item['value'] for item in top_phrases)} {emoji_text}")
        post_docs.append(doc or post.get("id", ""))
        post_ids.append(post["id"])

    embeddings = model.encode(post_docs, batch_size=batch_size, show_progress_bar=False, normalize_embeddings=True)
    labels: np.ndarray
    try:
        from hdbscan import HDBSCAN
        from umap import UMAP

        reduced = UMAP(n_neighbors=15, n_components=5, min_dist=0.0, metric="cosine", random_state=RANDOM_STATE).fit_transform(embeddings)
        labels = HDBSCAN(min_cluster_size=8, min_samples=3, metric="euclidean").fit_predict(reduced)
        if len(set(labels) - {-1}) < 3:
            raise ValueError("too few post clusters")
    except Exception:
        cluster_count = min(14, max(4, round(math.sqrt(len(posts)))))
        labels = KMeans(n_clusters=cluster_count, random_state=RANDOM_STATE, n_init=10).fit_predict(embeddings)

    for post_id, label in zip(post_ids, labels):
        for feature in features_by_post.get(post_id, []):
            feature["post_context_cluster_id"] = int(label)

    cluster_posts: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for post, label, doc in zip(posts, labels, post_docs):
        cluster_posts[int(label)].append({**post, "_doc": doc})

    output = []
    for label, members in sorted(cluster_posts.items(), key=lambda item: len(item[1]), reverse=True):
        texts = [member["_doc"] for member in members]
        output.append({
            "post_context_cluster_id": int(label),
            "post_count": len(members),
            "top_terms": phrase_counter(texts, 12, min_df=1),
            "posts": [
                {
                    "post_id": member.get("id"),
                    "posted_date": member.get("posted_date"),
                    "caption": normalize_text(member.get("title") or "")[:240],
                    "post_url": member.get("permalink_url"),
                    "captured_comments": member.get("captured_comments"),
                    "like_count": member.get("like_count"),
                }
                for member in members[:8]
            ],
        })
    return output


def build_emoji_motifs(features: list[dict[str, Any]], event_links_by_post: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    emoji_counts = Counter(emoji for feature in features for emoji in feature["emojis"])
    sequence_counts = Counter(feature["emoji_sequence"] for feature in features if feature["emoji_sequence"])
    pair_counts: Counter = Counter()
    for feature in features:
        unique = sorted(set(feature["emojis"]))
        for index, left in enumerate(unique):
            for right in unique[index + 1:]:
                pair_counts[f"{left} {right}"] += 1

    motifs = []
    for motif_def in EMOJI_MOTIF_DEFS:
        if motif_def["id"] == "emoji_only_reactions":
            motif_features = [feature for feature in features if feature["emoji_only"]]
        else:
            markers = set(motif_def["emojis"])
            motif_features = [feature for feature in features if markers.intersection(feature["emojis"])]
        emoji_counter = Counter(emoji for feature in motif_features for emoji in feature["emojis"])
        sequence_counter = Counter(feature["emoji_sequence"] for feature in motif_features if feature["emoji_sequence"])
        post_count = len({feature["post_id"] for feature in motif_features})
        event_ids = Counter(
            link.get("event_id")
            for feature in motif_features
            for link in event_links_by_post.get(feature["post_id"], [])
            if link.get("event_id")
        )
        motifs.append({
            "motif_id": motif_def["id"],
            "label": motif_def["label"],
            "comment_count": len(motif_features),
            "post_count": post_count,
            "emoji_only_comments": sum(1 for feature in motif_features if feature["emoji_only"]),
            "text_and_emoji_comments": sum(1 for feature in motif_features if feature["emojis"] and not feature["emoji_only"]),
            "top_emojis": top_items(emoji_counter, 14),
            "top_emoji_sequences": top_items(sequence_counter, 10),
            "related_event_ids": top_items(event_ids, 5),
            "evidence_quotes": select_diverse(
                motif_features,
                6,
                lambda feature: (len(feature["emojis"]) * 0.45 + min(feature["likes"], 50) / 50 * 0.35 + (0.2 if not feature["emoji_only"] else 0)),
            ),
            "interpretation_boundary": motif_def["interpretation_boundary"],
        })

    return {
        "summary": {
            "emoji_comments": sum(1 for feature in features if feature["emojis"]),
            "emoji_only_comments": sum(1 for feature in features if feature["emoji_only"]),
            "repeated_emoji_comments": sum(1 for feature in features if feature["repeated_emoji"]),
            "top_emojis": top_items(emoji_counts, 25),
            "top_emoji_sequences": top_items(sequence_counts, 20),
            "top_emoji_cooccurrences": top_items(pair_counts, 20),
        },
        "motifs": sorted(motifs, key=lambda item: item["comment_count"], reverse=True),
        "interpretation_boundary": "Emoji motifs are cultural and affective evidence. They should change evidence selection and UI presentation, not become unsupported psychological claims.",
    }


def author_segment_label(stats: dict[str, Any]) -> str:
    if stats["author"] == "thedogist":
        return "creator_account"
    if stats["comment_count"] == 1:
        return "casual_single_commenters"
    affect_counts = stats["affect_counts"]
    stance_counts = stats["stance_counts"]
    if stats["comment_count"] >= 50:
        return "highly_engaged_regulars"
    if affect_counts.get("food_routine", 0) >= 2 or stance_counts.get("advice_recommendation", 0) >= 3:
        return "food_and_care_advice_givers"
    if stance_counts.get("request_nomination", 0) >= 2 or stance_counts.get("call_to_action", 0) >= 2:
        return "rescue_and_action_advocates"
    if affect_counts.get("grief_memorial", 0) >= 2 or affect_counts.get("gratitude_prayer", 0) >= 3:
        return "supportive_grief_and_prayer_commenters"
    if stats["emoji_share"] >= 0.65 or stats["short_affective_share"] >= 0.65:
        return "repeat_affective_reactors"
    return "repeat_general_commenters"


def build_community_segments(features: list[dict[str, Any]]) -> dict[str, Any]:
    by_author: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        by_author[feature.get("author") or "unknown"].append(feature)

    author_stats = []
    for author, rows in by_author.items():
        affect_counts = Counter(tag for feature in rows for tag in feature.get("affect_tags", []))
        stance_counts = Counter(tag for feature in rows for tag in feature.get("stance_tags", []))
        cluster_counts = Counter(
            f"cultural_{feature.get('cultural_cluster_id')}"
            for feature in rows
            if feature.get("cultural_cluster_id") not in {None, -1}
        )
        emoji_count = sum(1 for feature in rows if feature["emojis"])
        short_count = sum(1 for feature in rows if feature["short_affective"])
        stats = {
            "author": author,
            "comment_count": len(rows),
            "unique_post_count": len({feature["post_id"] for feature in rows}),
            "emoji_share": round(emoji_count / max(len(rows), 1), 4),
            "short_affective_share": round(short_count / max(len(rows), 1), 4),
            "total_likes_received": sum(feature["likes"] for feature in rows),
            "affect_counts": affect_counts,
            "stance_counts": stance_counts,
            "cluster_counts": cluster_counts,
            "top_emojis": Counter(emoji for feature in rows for emoji in feature["emojis"]),
        }
        stats["segment_id"] = author_segment_label(stats)
        author_stats.append(stats)

    by_segment: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for stats in author_stats:
        by_segment[stats["segment_id"]].append(stats)

    segments = []
    for segment_id, rows in by_segment.items():
        comments = sum(row["comment_count"] for row in rows)
        posts = sum(row["unique_post_count"] for row in rows)
        affect_counts = Counter()
        stance_counts = Counter()
        cluster_counts = Counter()
        emoji_counts = Counter()
        for row in rows:
            affect_counts.update(row["affect_counts"])
            stance_counts.update(row["stance_counts"])
            cluster_counts.update(row["cluster_counts"])
            emoji_counts.update(row["top_emojis"])
        representative_authors = sorted(
            rows,
            key=lambda row: (row["comment_count"], row["unique_post_count"], row["total_likes_received"]),
            reverse=True,
        )[:8]
        segments.append({
            "segment_id": segment_id,
            "author_count": len(rows),
            "comment_count": comments,
            "avg_comments_per_author": round(comments / max(len(rows), 1), 2),
            "avg_posts_per_author": round(posts / max(len(rows), 1), 2),
            "top_affect_tags": top_items(affect_counts, 8),
            "top_stance_tags": top_items(stance_counts, 8),
            "top_clusters": top_items(cluster_counts, 8),
            "top_emojis": top_items(emoji_counts, 10),
            "representative_authors": [
                {
                    "author": row["author"],
                    "comments": row["comment_count"],
                    "unique_posts": row["unique_post_count"],
                    "emoji_share": row["emoji_share"],
                    "short_affective_share": row["short_affective_share"],
                }
                for row in representative_authors
            ],
            "interpretation_boundary": "Behavior segment derived from comment activity and lexical/emoji cues. Treat as audience participation mode, not identity or demographic inference.",
        })

    return {
        "generated_from": "author-level comment behavior, emoji use, affect/stance tags, and cluster participation",
        "segment_count": len(segments),
        "author_count": len(author_stats),
        "segments": sorted(segments, key=lambda item: item["comment_count"], reverse=True),
        "guardrails": [
            "Segments are participation modes, not demographic identities.",
            "Casual commenters should not be drowned out by prolific commenters.",
            "Use segment mix to qualify cluster confidence before asking Claude for interpretation.",
        ],
    }


def load_event_links(out_dir: Path) -> dict[str, list[dict[str, Any]]]:
    data = read_json(out_dir / "post-event-links.json", {"links": []}) or {"links": []}
    links_by_post: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for link in data.get("links", []):
        links_by_post[link.get("post_id")].append(link)
    return links_by_post


def write_features(path: Path, features: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for feature in features:
            public_feature = {key: value for key, value in feature.items() if key != "embedding_text"}
            handle.write(json.dumps(public_feature, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    input_path = args.input.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading Dogist corpus: {input_path}")
    corpus = json.loads(input_path.read_text())
    posts = corpus.get("videos", [])
    comments = corpus.get("comments", [])
    if args.max_comments:
        comments = comments[: args.max_comments]
    posts_by_id = {post["id"]: post for post in posts}
    features = [
        comment_feature(comment, posts_by_id.get(comment.get("video_id"), {}))
        for comment in comments
    ]
    author_summary = annotate_author_controls(features)
    event_links_by_post = load_event_links(out_dir)

    model = load_sentence_model(args.model)
    eligible_indices = [index for index, feature in enumerate(features) if feature["model_eligible"]]
    eligible_features = [features[index] for index in eligible_indices]
    eligible_docs = [feature["embedding_text"] for feature in eligible_features]
    embeddings = encode_dedup(model, eligible_docs, args.batch_size)
    print(f"Running BERTopic over {len(eligible_docs):,} eligible comments...")
    topic_model, topics = run_bertopic(eligible_docs, embeddings, args.min_cluster_size, args.min_samples)
    clusters, packets = build_clusters(features, eligible_indices, embeddings, list(topics), topic_model, event_links_by_post)
    print(f"Discovered {len(clusters):,} non-noise cultural clusters.")

    post_context_clusters = build_post_context_clusters(features, posts, model, args.batch_size)
    emoji_motifs = build_emoji_motifs(features, event_links_by_post)
    community_segments = build_community_segments(features)

    noise_count = sum(1 for feature in features if feature.get("cultural_cluster_id") == -1)
    discovery = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "primary_analysis_layer": "embedding_cultural_discovery",
        "legacy_handwritten_topics_used": False,
        "summary": {
            "posts_analyzed": len(posts),
            "comments_analyzed": len(features),
            "model_eligible_comments": len(eligible_indices),
            "emoji_only_comments": sum(1 for feature in features if feature["emoji_only"]),
            "short_affective_comments": sum(1 for feature in features if feature["short_affective"]),
            "discovered_clusters": len(clusters),
            "noise_comments": noise_count,
            "noise_ratio": round(noise_count / max(len(eligible_indices), 1), 4),
            "legacy_handwritten_topics_used": False,
            "unique_authors": author_summary["unique_authors"],
        },
        "author_summary": author_summary,
        "model": {
            "embedding_model": args.model,
            "topic_model": "BERTopic",
            "umap": {"n_neighbors": 30, "n_components": 5, "min_dist": 0.0, "metric": "cosine"},
            "hdbscan": {"min_cluster_size": args.min_cluster_size, "min_samples": args.min_samples},
            "emoji_modeling": "first-class motif/cooccurrence/sequence layer",
        },
        "clusters": clusters[:40],
        "post_context_clusters": post_context_clusters,
        "emoji_motifs_summary": emoji_motifs["summary"],
        "community_segments_summary": {
            "segment_count": community_segments["segment_count"],
            "author_count": community_segments["author_count"],
            "top_segments": [
                {
                    "segment_id": segment["segment_id"],
                    "author_count": segment["author_count"],
                    "comment_count": segment["comment_count"],
                    "avg_comments_per_author": segment["avg_comments_per_author"],
                }
                for segment in community_segments["segments"][:8]
            ],
        },
        "guardrails": [
            "Discovered clusters are areas to inspect, not validated product demand.",
            "Emoji-only and short affective reactions are modeled as cultural signals but excluded from sentence-cluster coherence claims.",
            "Legacy handwritten topics are retained only as a comparison overlay.",
            "LLM interpretation should label and audit reduced evidence packets; it must not invent meaning beyond raw evidence.",
        ],
        "files": {
            "features": "cultural-comment-features.jsonl",
            "clusters": "cultural-clusters.json",
            "emoji_motifs": "emoji-motifs.json",
            "community_segments": "community-segments.json",
            "evidence_packets": "cultural-evidence-packets.json",
        },
    }

    clusters_output = {
        "generated_at": discovery["generated_at"],
        "method": discovery["model"],
        "legacy_handwritten_topics_used": False,
        "clusters": clusters,
    }
    evidence_packets = {
        "generated_at": discovery["generated_at"],
        "method": "embedding-discovered clusters with evidence selected by centroid proximity, engagement, emoji diversity, post and author diversity, plus counterevidence",
        "legacy_handwritten_topics_used": False,
        "author_controls": {
            "cluster_fields": [
                "author_profile.unique_author_count",
                "author_profile.top_author_share",
                "author_profile.top_3_author_share",
                "author_profile.commenter_segment_mix",
                "validation.risk_flags",
            ],
            "community_segments_file": "community-segments.json",
            "instruction": "Before interpreting a cluster, check whether evidence is broad across authors or concentrated among repeat commenters.",
        },
        "llm_boundaries": [
            "Label discovered cultural patterns; do not discover from raw comments.",
            "Separate observed corpus facts from candidate cultural meaning.",
            "Do not treat cluster volume as validated product demand.",
            "Cite raw quotes, emoji motifs, confidence factors, and counterevidence.",
            "Call out author concentration, repeat-commenter skew, low post spread, and candidate tensions when present.",
        ],
        "packets": packets[:40],
    }

    write_features(out_dir / "cultural-comment-features.jsonl", features)
    write_json(out_dir / "cultural-clusters.json", clusters_output)
    write_json(out_dir / "emoji-motifs.json", emoji_motifs)
    write_json(out_dir / "community-segments.json", community_segments)
    write_json(out_dir / "cultural-evidence-packets.json", evidence_packets)
    write_json(out_dir / "cultural-discovery.json", discovery)

    print(f"Wrote cultural discovery outputs to {out_dir}")
    print(f"Eligible comments: {len(eligible_indices):,}; emoji-only: {discovery['summary']['emoji_only_comments']:,}; clusters: {len(clusters):,}")


if __name__ == "__main__":
    main()
