(async function () {
  const CHECKPOINT_KEY = "dogist_checkpoint";
  const DB_NAME = "dogist_collector";
  const DB_VERSION = 2;
  const statusEl = document.getElementById("status");

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("posts")) db.createObjectStore("posts", { keyPath: "shortcode" });
        if (!db.objectStoreNames.contains("comments")) db.createObjectStore("comments", { keyPath: "comment_id" });
        if (!db.objectStoreNames.contains("raw_post_records")) db.createObjectStore("raw_post_records", { keyPath: "id" });
        if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
        const comments = request.transaction.objectStore("comments");
        if (!comments.indexNames.contains("post_shortcode")) comments.createIndex("post_shortcode", "post_shortcode", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(name, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const result = callback(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).finally(() => db.close());
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAllRecords(storeName) {
    return withStore(storeName, "readonly", (store) => requestToPromise(store.getAll()));
  }

  async function countRecords(storeName) {
    return withStore(storeName, "readonly", (store) => requestToPromise(store.count()));
  }

  async function readStoreAsJsonlParts(storeName, onProgress, mapper = (record) => record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const parts = [];
      let count = 0;
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        parts.push(JSON.stringify(mapper(cursor.value)), "\n");
        count++;
        if (count % 500 === 0) onProgress?.(count);
        cursor.continue();
      };
      tx.oncomplete = () => resolve({ parts, count });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }).finally(() => db.close());
  }

  async function putRecord(storeName, record) {
    return withStore(storeName, "readwrite", (store) => requestToPromise(store.put(record)));
  }

  async function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    try {
      if (chrome.downloads?.download) {
        await chrome.downloads.download({ url, filename, saveAs: false });
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
      }
      return filename;
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
  }

  function downloadText(filename, text, type) {
    return downloadBlob(filename, new Blob([text], { type }));
  }

  function downloadJson(filename, data) {
    return downloadText(filename, `${JSON.stringify(data, null, 2)}\n`, "application/json");
  }

  function downloadJsonCompact(filename, data) {
    return downloadText(filename, `${JSON.stringify(data)}\n`, "application/json");
  }

  function downloadJsonlParts(filename, parts) {
    return downloadBlob(filename, new Blob(parts, { type: "application/x-ndjson" }));
  }

  function slimCommentRow(comment) {
    if (!comment || typeof comment !== "object") return comment;
    return {
      comment_id: comment.comment_id,
      scraped_at: comment.scraped_at ?? null,
      platform: comment.platform ?? "instagram",
      creator_handle: comment.creator_handle ?? null,
      post_shortcode: comment.post_shortcode,
      post_url: comment.post_url ?? "",
      post_kind: comment.post_kind ?? null,
      comment_author: comment.comment_author ?? "unknown",
      comment_text: comment.comment_text ?? "",
      comment_likes: comment.comment_likes ?? 0,
      comment_verified: comment.comment_verified ?? false,
      comment_posted_at: comment.comment_posted_at ?? null,
      worker_id: comment.worker_id ?? null,
      batch_id: comment.batch_id ?? null,
      extraction_source: comment.extraction_source ?? null
    };
  }

  function csvCell(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function buildQueue(checkpoint, posts) {
    const byShortcode = new Map(posts.map((post) => [post.shortcode, post]));
    const ordered = (checkpoint.discovered_post_queue ?? [])
      .map((shortcode, index) => {
        const post = byShortcode.get(shortcode);
        if (!post) return null;
        return {
          position: index + 1,
          shortcode: post.shortcode,
          kind: post.kind,
          url: post.url,
          canonical_url: post.canonical_url ?? null,
          discovered_at: post.discovered_at ?? null,
          discovery_round: post.discovery_round ?? null,
          visible_index: post.visible_index ?? null
        };
      })
      .filter(Boolean);

    return {
      version: 1,
      type: "blackhole_instagram_post_queue",
      platform: checkpoint.platform ?? "instagram",
      creator_handle: checkpoint.creator_handle ?? checkpoint.target ?? "thedogist",
      target: checkpoint.target ?? checkpoint.creator_handle ?? "thedogist",
      profile_url: checkpoint.profile_url ?? "https://www.instagram.com/thedogist/",
      run_id: checkpoint.run_id,
      exported_at: nowIso(),
      discovery: checkpoint.discovery ?? null,
      counts: {
        posts: ordered.length
      },
      posts: ordered
    };
  }

  function buildQueueCsv(queue) {
    const headers = [
      "position",
      "shortcode",
      "kind",
      "url",
      "canonical_url",
      "discovered_at",
      "discovery_round",
      "visible_index"
    ];
    return [
      headers.join(","),
      ...queue.posts.map((post) => headers.map((header) => csvCell(post[header])).join(","))
    ].join("\n") + "\n";
  }

  function stripCheckpointForRecovery(checkpoint) {
    const { posts, ...lightCheckpoint } = checkpoint ?? {};
    return {
      ...lightCheckpoint,
      posts_omitted_from_checkpoint: Boolean(posts),
      posts_exported_as: "posts.ndjson"
    };
  }

  async function exportRecoveryBundle(checkpoint) {
    const runId = checkpoint.run_id || nowIso().slice(0, 10);
    const handle = normalizeHandle(checkpoint.creator_handle || checkpoint.target || "thedogist");
    const base = `blackhole-instagram-${handle}-${runId}`;
    const counts = {
      posts: await countRecords("posts"),
      comments: await countRecords("comments"),
      raw_post_records: await countRecords("raw_post_records"),
      events: await countRecords("events")
    };

    setStatus(`Recovery export: reading ${counts.posts} posts...`);
    const postsExport = await readStoreAsJsonlParts("posts", (count) => {
      setStatus(`Recovery export: read ${count}/${counts.posts} posts...`);
    });
    const posts = postsExport.parts
      .filter((part) => part !== "\n")
      .map((part) => JSON.parse(part));

    setStatus(`Recovery export: reading ${counts.comments} comments...`);
    const commentsExport = await readStoreAsJsonlParts("comments", (count) => {
      setStatus(`Recovery export: read ${count}/${counts.comments} comments...`);
    }, slimCommentRow);

    setStatus(`Recovery export: reading ${counts.raw_post_records} raw post records...`);
    const rawExport = await readStoreAsJsonlParts("raw_post_records", (count) => {
      setStatus(`Recovery export: read ${count}/${counts.raw_post_records} raw records...`);
    });

    setStatus(`Recovery export: reading ${counts.events} events...`);
    const eventsExport = await readStoreAsJsonlParts("events", (count) => {
      setStatus(`Recovery export: read ${count}/${counts.events} events...`);
    });

    const queue = buildQueue(checkpoint, posts);
    const manifest = {
      version: 1,
      type: "blackhole_split_scrape_bundle",
      platform: checkpoint.platform ?? "instagram",
      creator_handle: handle,
      target: checkpoint.target ?? handle,
      profile_url: checkpoint.profile_url ?? `https://www.instagram.com/${handle}/`,
      exported_at: nowIso(),
      run_id: runId,
      note: "Split export created to avoid one huge JSON string.",
      files: {
        manifest: `${base}-manifest.json`,
        checkpoint: `${base}-checkpoint.json`,
        posts: `${base}-posts.ndjson`,
        comments: `${base}-comments.ndjson`,
        raw_post_records: `${base}-raw-post-records.ndjson`,
        events: `${base}-events.ndjson`,
        post_queue: `${base}-post-queue.json`,
        post_urls: `${base}-post-urls.csv`
      },
      counts
    };

    setStatus("Recovery export: downloading split files...");
    const downloaded = [];
    downloaded.push(await downloadJsonCompact(manifest.files.manifest, manifest));
    downloaded.push(await downloadJsonCompact(manifest.files.checkpoint, stripCheckpointForRecovery(checkpoint)));
    downloaded.push(await downloadJsonlParts(manifest.files.posts, postsExport.parts));
    downloaded.push(await downloadJsonlParts(manifest.files.comments, commentsExport.parts));
    downloaded.push(await downloadJsonlParts(manifest.files.raw_post_records, rawExport.parts));
    downloaded.push(await downloadJsonlParts(manifest.files.events, eventsExport.parts));
    downloaded.push(await downloadJsonCompact(manifest.files.post_queue, queue));
    downloaded.push(await downloadText(manifest.files.post_urls, buildQueueCsv(queue), "text/csv"));

    await putRecord("events", {
      id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
      ts: nowIso(),
      type: "split_bundle_exported",
      detail: {
        files: downloaded,
        counts
      }
    });

    setStatus(`Downloaded split export for ${runId}: ${counts.comments} comments, ${counts.posts} posts. You can close this tab.`);
  }

  function normalizeHandle(value) {
    const text = String(value ?? "").trim().replace(/^@/, "");
    const match = text.match(/[A-Za-z0-9._]{1,30}/);
    return (match ? match[0] : "thedogist").toLowerCase();
  }

  try {
    setStatus("Reading checkpoint...");
    const mode = new URL(window.location.href).searchParams.get("mode") || "bundle";
    const checkpointResult = await chrome.storage.local.get(CHECKPOINT_KEY);
    const checkpoint = checkpointResult[CHECKPOINT_KEY];
    if (!checkpoint) {
      setStatus("No Blackhole Collector checkpoint exists yet.");
      return;
    }

    if (mode === "queue") {
      setStatus("Reading stored posts...");
      const posts = await getAllRecords("posts");
      const queue = buildQueue(checkpoint, posts);
      const handle = normalizeHandle(checkpoint.creator_handle || checkpoint.target || "thedogist");
      const base = `blackhole-instagram-${handle}-post-queue-${checkpoint.run_id || nowIso().slice(0, 10)}`;
      const jsonFilename = await downloadJson(`${base}.json`, queue);
      const csvFilename = await downloadText(`blackhole-instagram-${handle}-post-urls-${checkpoint.run_id || nowIso().slice(0, 10)}.csv`, buildQueueCsv(queue), "text/csv");
      await putRecord("events", {
        id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
        ts: nowIso(),
        type: "queue_exported",
        detail: {
          json_filename: jsonFilename,
          csv_filename: csvFilename,
          posts: queue.posts.length
        }
      });
      setStatus(`Downloaded ${jsonFilename} and ${csvFilename}. You can close this tab.`);
      return;
    }

    if (mode === "single") {
      setStatus("Reading stored posts, comments, raw records, and events...");
      const posts = await getAllRecords("posts");
      const bundle = {
        version: 1,
        type: "blackhole_scrape_bundle",
        exported_at: nowIso(),
        checkpoint,
        posts,
        comments: (await getAllRecords("comments")).map(slimCommentRow),
        raw_post_records: await getAllRecords("raw_post_records"),
        events: await getAllRecords("events"),
        post_queue: buildQueue(checkpoint, posts)
      };

      const handle = normalizeHandle(checkpoint.creator_handle || checkpoint.target || "thedogist");
      const filename = await downloadJson(`blackhole-instagram-${handle}-${bundle.checkpoint.run_id || nowIso().slice(0, 10)}.json`, bundle);
      await putRecord("events", {
        id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
        ts: nowIso(),
        type: "bundle_exported",
        detail: {
          filename,
          posts: bundle.posts.length,
          comments: bundle.comments.length,
          raw_post_records: bundle.raw_post_records.length
        }
      });
      setStatus(`Downloaded ${filename}. You can close this tab.`);
      return;
    }

    await exportRecoveryBundle(checkpoint);
  } catch (error) {
    setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
})();
