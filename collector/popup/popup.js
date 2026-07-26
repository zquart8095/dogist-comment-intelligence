(function () {
  const els = {
    statusLine: document.getElementById("status-line"),
    freshness: document.getElementById("freshness"),
    creatorTarget: document.getElementById("creator-target"),
    maxPosts: document.getElementById("max-posts"),
    preloadTabs: document.getElementById("preload-tabs"),
    scrapeMode: document.getElementById("scrape-mode"),
    maxPostMinutes: document.getElementById("max-post-minutes"),
    noNewRounds: document.getElementById("no-new-rounds"),
    coverageMaxComments: document.getElementById("coverage-max-comments"),
    coverageMaxMinutes: document.getElementById("coverage-max-minutes"),
    coverageMinRate: document.getElementById("coverage-min-rate"),
    retryFailures: document.getElementById("retry-failures"),
    startBtn: document.getElementById("start-btn"),
    discoverOnlyBtn: document.getElementById("discover-only-btn"),
    scrapeQueueBtn: document.getElementById("scrape-queue-btn"),
    resumeBtn: document.getElementById("resume-btn"),
    stopBtn: document.getElementById("stop-btn"),
    exportBtn: document.getElementById("export-btn"),
    exportQueueBtn: document.getElementById("export-queue-btn"),
    importQueueBtn: document.getElementById("import-queue-btn"),
    queueFile: document.getElementById("queue-file"),
    clearBtn: document.getElementById("clear-btn"),
    savedComments: document.getElementById("saved-comments"),
    activePost: document.getElementById("active-post"),
    activeCapture: document.getElementById("active-capture"),
    rateLine: document.getElementById("rate-line"),
    phaseLabel: document.getElementById("phase-label"),
    durationLabel: document.getElementById("duration-label"),
    progressFill: document.getElementById("progress-fill"),
    counts: document.getElementById("counts"),
    discovery: document.getElementById("discovery"),
    preload: document.getElementById("preload"),
    stopReason: document.getElementById("stop-reason"),
    eventCount: document.getElementById("event-count"),
    events: document.getElementById("events")
  };

  let lastCheckpointId = "";

  function send(type, payload = {}) {
    return chrome.runtime.sendMessage({ type, ...payload }).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
  }

  function readOptions() {
    const maxPostsRaw = Number(els.maxPosts.value);
    const preloadTabsRaw = Number(els.preloadTabs.value);
    const maxPostMinutesRaw = Number(els.maxPostMinutes.value);
    const noNewRoundsRaw = Number(els.noNewRounds.value);
    const coverageMaxCommentsRaw = Number(els.coverageMaxComments.value);
    const coverageMaxMinutesRaw = Number(els.coverageMaxMinutes.value);
    const coverageMinRateRaw = Number(els.coverageMinRate.value);
    const target = els.creatorTarget.value.trim() || "thedogist";
    return {
      creatorHandle: target,
      profileUrl: target,
      maxPosts: Number.isInteger(maxPostsRaw) && maxPostsRaw > 0 ? maxPostsRaw : null,
      preloadTabs: Number.isInteger(preloadTabsRaw) && preloadTabsRaw > 0 ? Math.min(preloadTabsRaw, 5) : 1,
      postConcurrency: Number.isInteger(preloadTabsRaw) && preloadTabsRaw > 0 ? Math.min(preloadTabsRaw, 5) : 1,
      scrapeMode: els.scrapeMode.value === "coverage" ? "coverage" : "exhaustive",
      maxPostMs: Number.isFinite(maxPostMinutesRaw) && maxPostMinutesRaw > 0 ? Math.round(maxPostMinutesRaw * 60 * 1000) : 480000,
      noNewCommentRounds: Number.isInteger(noNewRoundsRaw) && noNewRoundsRaw > 0 ? noNewRoundsRaw : 8,
      coverageMaxComments: Number.isInteger(coverageMaxCommentsRaw) && coverageMaxCommentsRaw > 0 ? coverageMaxCommentsRaw : 250,
      coverageMaxMinutes: Number.isFinite(coverageMaxMinutesRaw) && coverageMaxMinutesRaw > 0 ? coverageMaxMinutesRaw : 4,
      coverageMinRate: Number.isFinite(coverageMinRateRaw) && coverageMinRateRaw > 0 ? Math.min(coverageMinRateRaw, 1) : 0.5,
      retryFailed: els.retryFailures.checked,
      retryPartial: true,
      skipCoveredPosts: true,
      skipUnknownTargetPosts: false
    };
  }

  function pct(checkpoint) {
    const counts = checkpoint?.counts ?? {};
    const total = counts.discovered_posts || 0;
    if (total === 0) return 0;
    const done = (counts.completed_posts || 0) + (counts.partial_posts || 0) + (counts.failed_posts || 0);
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  function render(response) {
    const checkpoint = response?.checkpoint;
    const live = response?.live ?? {};
    const events = response?.events ?? [];
    const running = checkpoint?.status === "running";
    const counts = checkpoint?.counts ?? {};
    const discovery = checkpoint?.discovery ?? {};

    if (checkpoint && checkpoint.run_id !== lastCheckpointId) {
      lastCheckpointId = checkpoint.run_id;
      syncInputsFromCheckpoint(checkpoint);
    }

    const creator = checkpoint?.creator_handle || checkpoint?.target || "thedogist";
    els.statusLine.textContent = checkpoint
      ? `${creator} · ${checkpoint.status}${checkpoint.phase ? ` · ${checkpoint.phase}` : ""}${checkpoint.run_mode ? ` · ${checkpoint.run_mode}` : ""}`
      : response?.error ? `Error: ${response.error}` : "Ready for a new Instagram target";

    els.freshness.textContent = live?.freshness_label || "idle";
    els.freshness.dataset.state = live?.freshness_label || "idle";
    els.savedComments.textContent = formatNumber(live.total_saved_comments ?? counts.comments_captured ?? 0);
    els.activePost.textContent = live.active_shortcode || checkpoint?.last_attempted_post || "None";
    els.activeCapture.textContent = `${formatNumber(live.active_captured_comments || 0)} / ${live.active_target_comment_count ? formatNumber(live.active_target_comment_count) : "?"}`;
    els.rateLine.textContent = `${formatNumber(live.comments_per_hour || 0)} comments/hr · ${live.posts_per_hour || 0} posts/hr`;
    els.phaseLabel.textContent = checkpoint ? `${checkpoint.phase || "idle"} · ${checkpoint.status}` : "No run";
    els.durationLabel.textContent = live.run_duration_ms ? formatDuration(live.run_duration_ms) : "0m";
    els.progressFill.style.width = `${pct(checkpoint)}%`;

    els.counts.textContent = checkpoint
      ? [
          `${formatNumber(counts.discovered_posts || 0)} discovered`,
          `${formatNumber(counts.attempted_posts || 0)} attempted`,
          `${formatNumber(counts.in_progress_posts || 0)} active`,
          `${formatNumber(counts.completed_posts || 0)} complete`,
          `${formatNumber(counts.partial_posts || 0)} partial`,
          `${formatNumber(counts.failed_posts || 0)} failed`
        ].join(" · ")
      : "No queue loaded";

    els.discovery.textContent = checkpoint
      ? [
          `Discovery ${discovery.completed ? "done" : checkpoint.phase === "discovery" ? "running" : "pending"}`,
          `${formatNumber(discovery.rounds || discovery.scroll_rounds || 0)} rounds`,
          discovery.stop_reason ? `stop ${discovery.stop_reason}` : ""
        ].filter(Boolean).join(" · ")
      : "";

    els.preload.textContent = checkpoint
      ? [
          `${checkpoint.active_workers || 0} active`,
          `${checkpoint.effective_preload_tabs || checkpoint.effective_concurrency || checkpoint.options?.preloadTabs || 1} preload effective`,
          `${checkpoint.options?.preloadTabs || checkpoint.options?.postConcurrency || 1} configured`
        ].join(" · ")
      : "";

    els.stopReason.textContent = checkpoint?.stop_reason
      ? formatStopReason(checkpoint.stop_reason)
      : response?.error
        ? `Error: ${response.error}`
        : "";

    els.eventCount.textContent = String(events.length);
    els.events.innerHTML = events.slice(-16).reverse().map((event) => {
      const detail = event.detail ? ` ${escapeHtml(JSON.stringify(event.detail).slice(0, 220))}` : "";
      return `<div class="event"><strong>${escapeHtml(event.type)}</strong><br><span>${escapeHtml(event.ts || "")}</span>${detail ? `<code>${detail}</code>` : ""}</div>`;
    }).join("");

    els.startBtn.disabled = running;
    els.discoverOnlyBtn.disabled = running;
    els.scrapeQueueBtn.disabled = running || !checkpoint || (counts.discovered_posts || 0) === 0;
    els.resumeBtn.disabled = running || !checkpoint;
    els.stopBtn.disabled = !running;
    els.exportBtn.disabled = running || !checkpoint;
    els.exportQueueBtn.disabled = running || !checkpoint || (counts.discovered_posts || 0) === 0;
    els.importQueueBtn.disabled = running;
    els.clearBtn.disabled = running;
  }

  function syncInputsFromCheckpoint(checkpoint) {
    const options = checkpoint.options ?? {};
    els.creatorTarget.value = checkpoint.profile_url || checkpoint.creator_handle || checkpoint.target || "thedogist";
    els.preloadTabs.value = String(options.preloadTabs || options.postConcurrency || 1);
    els.scrapeMode.value = options.scrapeMode === "coverage" ? "coverage" : "exhaustive";
    els.maxPostMinutes.value = String(Math.round((options.maxPostMs || 480000) / 60000));
    els.noNewRounds.value = String(options.noNewCommentRounds || 8);
    els.coverageMaxComments.value = String(options.coverageMaxComments || 250);
    els.coverageMaxMinutes.value = String(options.coverageMaxMinutes || 4);
    els.coverageMinRate.value = String(options.coverageMinRate || 0.5);
    els.retryFailures.checked = Boolean(options.retryFailed);
  }

  function formatStopReason(reason) {
    if (reason === "worker_interrupted_resume_available") {
      return "Interrupted: background worker restarted. Resume available.";
    }
    if (reason === "worker_restarted_recovery") {
      return "Interrupted: background worker restarted. Resume available.";
    }
    return `Stop: ${reason}`;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  async function refresh() {
    const response = await send("DOGIST_GET_STATUS");
    render(response);
  }

  async function sendAndRefresh(type) {
    await send(type, { options: readOptions() });
    await refresh();
  }

  els.startBtn.addEventListener("click", () => sendAndRefresh("DOGIST_START"));
  els.discoverOnlyBtn.addEventListener("click", () => sendAndRefresh("DOGIST_DISCOVER_ONLY"));
  els.scrapeQueueBtn.addEventListener("click", () => sendAndRefresh("DOGIST_SCRAPE_QUEUE"));
  els.resumeBtn.addEventListener("click", () => sendAndRefresh("DOGIST_RESUME"));

  els.stopBtn.addEventListener("click", async () => {
    await send("DOGIST_STOP");
    await refresh();
  });

  els.exportBtn.addEventListener("click", async () => {
    await send("DOGIST_EXPORT");
    await refresh();
  });

  els.exportQueueBtn.addEventListener("click", async () => {
    await send("DOGIST_EXPORT_QUEUE");
    await refresh();
  });

  els.importQueueBtn.addEventListener("click", () => {
    els.queueFile.value = "";
    els.queueFile.click();
  });

  els.queueFile.addEventListener("change", async () => {
    const files = Array.from(els.queueFile.files ?? []);
    if (files.length === 0) return;
    const payload = {
      files: await Promise.all(files.map(async (file) => ({
        name: file.name,
        text: await file.text()
      })))
    };
    await send("DOGIST_IMPORT_QUEUE", { payload });
    await refresh();
  });

  els.clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear Blackhole Collector data from this extension?")) return;
    await send("DOGIST_CLEAR");
    await refresh();
  });

  refresh();
  setInterval(refresh, 1000);
})();
