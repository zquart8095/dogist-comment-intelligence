if (typeof importScripts === "function") importScripts("state.js");

const CHECKPOINT_KEY = "dogist_checkpoint";
const DB_NAME = "dogist_collector";
const DB_VERSION = 2;
const PLATFORM = "instagram";
const DEFAULT_CREATOR_HANDLE = "thedogist";
const DEFAULT_PROFILE_URL = profileUrlFromHandle(DEFAULT_CREATOR_HANDLE);
const BACKOFF_STEPS = [5, 3, 1];
const UNKNOWN_TARGET_COMPLETE_MIN_COMMENTS = 50;
const SKIP_CAPTURE_RATE = 0.9;
const STATE = globalThis.DogistCollectorState;
const WORKER_INTERRUPTED_REASON = STATE?.WORKER_INTERRUPTED_REASON || "worker_interrupted_resume_available";
const WORKER_RECOVERY_GRACE_MS = STATE?.WORKER_RECOVERY_GRACE_MS || 90 * 1000;
const RELIABLE_TARGET_SOURCES = new Set([
  "view_all_comments_button",
  "view_all_comments_text",
  "hydrated_engagement_bar",
  "engagement_bar_sequence"
]);
const HARD_ACCOUNT_LIMITATIONS = new Set([
  "login_wall",
  "challenge_required",
  "rate_limited_try_again_later",
  "rate_limited_activity_restricted",
  "rate_limited_wait"
]);

const DEFAULT_OPTIONS = {
  maxPosts: null,
  creatorHandle: DEFAULT_CREATOR_HANDLE,
  profileUrl: DEFAULT_PROFILE_URL,
  platform: PLATFORM,
  preloadTabs: 1,
  postConcurrency: 1,
  scrapeMode: "exhaustive",
  coverageMaxComments: 250,
  coverageMaxMinutes: 4,
  coverageMinRate: 0.5,
  profileIndexWaitMs: 5000,
  profileScrollDelayMs: 1600,
  profileNoNewRounds: 30,
  profileMaxRounds: 5000,
  noNewCommentRounds: 8,
  maxPostMs: 480000,
  postStepMaxMs: 20000,
  activeHydrateMs: 2500,
  tabTimeoutMs: 60000,
  scrollDelayMs: 650,
  scrollDelayFastMs: 250,
  scrollDelaySlowMs: 1200,
  betweenBatchDelayMs: 500,
  retryFailed: false,
  retryPartial: true,
  skipCoveredPosts: true,
  skipUnknownTargetPosts: false,
  staleLeaseMs: 30 * 60 * 1000
};

let activeRun = null;
let runTokenCounter = 0;
let abortRequested = false;
let profileTabId = null;
const activePostTabs = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "DOGIST_COMMENT_BATCH") {
      const result = await persistCommentBatchMessage(message);
      sendResponse(result);
      return;
    }
    if (message.type === "DOGIST_POST_SCROLL_SNAPSHOT") {
      const checkpoint = await loadCheckpoint();
      const runSessionId = getMessageRunSessionId(message);
      if (!isMessageFromCurrentRun(runSessionId, checkpoint)) {
        await addEvent("stale_run_session_message_ignored", {
          type: message.type,
          run_session_id: runSessionId,
          active_run_session_id: checkpoint?.active_run_session_id ?? null,
          status: checkpoint?.status ?? null
        });
        sendResponse({ ok: false, reason: "stale_run_session" });
        return;
      }
      await touchRunHeartbeat(checkpoint, runSessionId);
      await addEvent("post_scroll_snapshot", {
        shortcode: message.shortcode ?? null,
        worker_id: message.worker_id ?? message.workerId ?? null,
        run_session_id: runSessionId,
        snapshot: message.snapshot ?? null
      });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "DOGIST_GET_STATUS") {
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_START") {
      await startRun(true, message.options ?? {}, "full");
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_DISCOVER_ONLY") {
      await startRun(true, message.options ?? {}, "discover_only");
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_SCRAPE_QUEUE") {
      await startRun(false, message.options ?? {}, "scrape_queue");
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_RESUME") {
      await startRun(false, message.options ?? {}, "resume");
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_STOP") {
      abortRequested = true;
      runTokenCounter++;
      activeRun = null;
      await addEvent("stop_requested", {});
      await stopRunImmediately("user_stop_requested");
      await closeActivePostTabs();
      sendResponse(await getStatusPayload());
      return;
    }
    if (message.type === "DOGIST_EXPORT") {
      const result = await exportBundle();
      sendResponse({ ...(await getStatusPayload()), export: result });
      return;
    }
    if (message.type === "DOGIST_EXPORT_QUEUE") {
      const result = await exportQueue();
      sendResponse({ ...(await getStatusPayload()), export: result });
      return;
    }
    if (message.type === "DOGIST_IMPORT_QUEUE") {
      const result = await importQueue(message.payload);
      sendResponse({ ...(await getStatusPayload()), import: result });
      return;
    }
    if (message.type === "DOGIST_CLEAR") {
      abortRequested = true;
      runTokenCounter++;
      activeRun = null;
      await closeActivePostTabs();
      await clearAll();
      sendResponse(await getStatusPayload());
      return;
    }
    sendResponse({ error: `Unknown message type: ${message.type}` });
  })().catch(async (error) => {
    await addEvent("runtime_error", { message: errorMessage(error) }).catch(() => {});
    sendResponse({ error: errorMessage(error), ...(await getStatusPayload().catch(() => ({}))) });
  });
  return true;
});

async function startRun(fresh, rawOptions, requestedMode) {
  if (activeRun) {
    await addEvent("run_already_active", {});
    return;
  }

  abortRequested = false;
  const options = normalizeOptions(rawOptions);
  options.retryPartial = requestedMode === "resume" && rawOptions.retryPartial !== false;

  if (fresh) {
    await clearAll();
  }

  const runToken = ++runTokenCounter;
  const runSessionId = makeRunSessionId(options.creatorHandle, runToken);
  let checkpoint = await loadCheckpoint();
  if (!checkpoint) checkpoint = makeCheckpoint(options);
  checkpoint = normalizeCheckpoint(checkpoint, options);
  await releaseStaleLeases(checkpoint, true);
  await releaseLegacyPreloadFailures(checkpoint);

  const runMode = requestedMode === "resume" ? checkpoint.run_mode || "full" : requestedMode || "full";
  checkpoint.run_mode = runMode;
  checkpoint.platform = options.platform;
  checkpoint.creator_handle = options.creatorHandle;
  checkpoint.target = options.creatorHandle;
  checkpoint.profile_url = options.profileUrl;
  if (runMode === "scrape_queue") {
    checkpoint.discovery.completed = true;
    checkpoint.discovery.completed_at ||= nowIso();
    checkpoint.discovery.stop_reason ||= "queue_loaded";
  }

  checkpoint.status = "running";
  checkpoint.phase = runMode === "scrape_queue" || checkpoint.discovery.completed ? "scraping" : "discovery";
  checkpoint.stop_reason = null;
  checkpoint.recovery_state = "running";
  checkpoint.active_run_session_id = runSessionId;
  checkpoint.heartbeat_at = nowIso();
  checkpoint.interrupted_at = null;
  checkpoint.options = options;
  checkpoint.effective_concurrency = clampPreloadTabs(checkpoint.effective_concurrency || options.preloadTabs, options.preloadTabs);
  checkpoint.effective_preload_tabs = checkpoint.effective_concurrency;
  await saveCheckpoint(checkpoint);
  await addEvent(fresh ? "run_started" : requestedMode === "resume" ? "run_resumed" : "run_started", { options, run_mode: runMode, run_session_id: runSessionId });

  const runState = { token: runToken, runSessionId, promise: null };
  activeRun = runState;
  runState.promise = runScrape(checkpoint, options, runMode, runToken, runSessionId).finally(() => {
    if (activeRun?.token === runToken) activeRun = null;
  });
}

function isRunCurrent(runToken) {
  return activeRun?.token === runToken;
}

function makeRunSessionId(handle, runToken) {
  return `${normalizeCreatorHandle(handle) || DEFAULT_CREATOR_HANDLE}:${Date.now()}:${runToken}:${Math.random().toString(16).slice(2, 8)}`;
}

function getMessageRunSessionId(message) {
  return STATE?.normalizeRunSessionId?.(message?.run_session_id ?? message?.runSessionId) || null;
}

function isMessageFromCurrentRun(runSessionId, checkpoint) {
  if (STATE?.isMessageFromCurrentRun) return STATE.isMessageFromCurrentRun(runSessionId, checkpoint);
  if (!runSessionId) return true;
  return checkpoint?.status === "running" && checkpoint?.active_run_session_id === runSessionId;
}

function classifyRunningCheckpointRecovery(checkpoint, hasActiveRun) {
  if (STATE?.classifyRunningCheckpointRecovery) {
    return STATE.classifyRunningCheckpointRecovery(checkpoint, {
      hasActiveRun,
      graceMs: WORKER_RECOVERY_GRACE_MS
    });
  }
  if (!checkpoint || checkpoint.status !== "running") return "not_running";
  if (hasActiveRun) return "active_run";
  const heartbeatMs = Date.parse(checkpoint.heartbeat_at || checkpoint.updated_at || "");
  return Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs <= WORKER_RECOVERY_GRACE_MS
    ? "recent_heartbeat"
    : "stale_heartbeat";
}

async function touchRunHeartbeat(checkpoint, runSessionId) {
  if (!checkpoint || !runSessionId) return;
  if (checkpoint.active_run_session_id !== runSessionId) return;
  if (checkpoint.status !== "running") return;
  checkpoint.heartbeat_at = nowIso();
  checkpoint.recovery_state = "running";
  await saveCheckpoint(checkpoint);
}

async function stopRunImmediately(reason) {
  const checkpoint = await loadCheckpoint();
  if (!checkpoint) return null;

  checkpoint.status = "stopped";
  checkpoint.stop_reason = reason;
  checkpoint.recovery_state = reason === WORKER_INTERRUPTED_REASON ? "interrupted_resume_available" : "stopped";
  checkpoint.interrupted_at = reason === WORKER_INTERRUPTED_REASON ? nowIso() : null;
  checkpoint.active_workers = 0;
  if (reason !== WORKER_INTERRUPTED_REASON) {
    checkpoint.active_run_session_id = null;
  }
  if (checkpoint.phase === "discovery") {
    checkpoint.discovery ||= {};
    checkpoint.discovery.stop_reason = reason;
  }

  for (const post of Object.values(checkpoint.posts ?? {})) {
    if (post.status !== "in_progress") continue;
    const captured = await countCommentsForPost(post.shortcode).catch(() => Number(post.captured_comments || 0));
    post.captured_comments = Math.max(Number(post.captured_comments || 0), Number(captured || 0));
    post.status = post.captured_comments > 0 ? "partial" : "queued";
    post.stop_reason = reason;
    post.exhaustion_reason = reason;
    post.lease_started_at = null;
    post.worker_id = null;
    post.active_scrape_finished_at ||= post.active_scrape_started_at ? nowIso() : null;
    await putRecord("posts", post);
  }

  await addEvent("run_stopped", { phase: checkpoint.phase || "unknown", reason, immediate: true });
  await rebuildCountsAndSave(checkpoint);
  return checkpoint;
}

async function runScrape(checkpoint, options, runMode, runToken, runSessionId) {
  try {
    if (runMode !== "scrape_queue" && !checkpoint.discovery.completed) {
      checkpoint = await discoverFullProfile(checkpoint, options, runToken);
      if (!isRunCurrent(runToken)) return;
      if (checkpoint.status === "stopped") {
        await rebuildCountsAndSave(checkpoint);
        return;
      }
    }

    if (runMode === "discover_only") {
      checkpoint.status = "stopped";
      checkpoint.phase = "discovery";
      checkpoint.stop_reason = checkpoint.discovery.stop_reason || "discovery_only_complete";
      await addEvent("run_stopped", { phase: "discovery", reason: checkpoint.stop_reason, run_mode: runMode });
      await rebuildCountsAndSave(checkpoint);
      return;
    }

    if (checkpoint.discovered_post_queue.length === 0) {
      checkpoint.status = "stopped";
      checkpoint.stop_reason = "no_discovered_posts";
      await addEvent("run_stopped", { reason: checkpoint.stop_reason });
      await rebuildCountsAndSave(checkpoint);
      return;
    }

    checkpoint.phase = "scraping";
    await touchRunHeartbeat(checkpoint, runSessionId);
    await rebuildCountsAndSave(checkpoint);
    await runPostBatches(checkpoint, options, runToken, runSessionId);
  } catch (error) {
    if (errorMessage(error) === "run_cancelled") return;
    const latest = await loadCheckpoint();
    if (latest) {
      latest.status = "stopped";
      latest.stop_reason = `runtime_error:${errorMessage(error).slice(0, 160)}`;
      await rebuildCountsAndSave(latest);
    }
    await addEvent("runtime_error", { message: errorMessage(error) });
  }
}

async function discoverFullProfile(checkpoint, options, runToken) {
  checkpoint.phase = "discovery";
  checkpoint.discovery.started_at ||= nowIso();
  checkpoint.discovery.completed = false;
  checkpoint.discovery.stop_reason = null;
  checkpoint.discovery.rounds ||= 0;
  checkpoint.discovery.no_new_rounds ||= 0;
  checkpoint.discovery.scroll_stuck_rounds ||= 0;
  await saveCheckpoint(checkpoint);

  const nav = await navigateProfileTab(checkpoint.profile_url || options.profileUrl || DEFAULT_PROFILE_URL, options.tabTimeoutMs);
  if (!isRunCurrent(runToken)) return checkpoint;
  if (!nav.ok) {
    checkpoint.status = "stopped";
    checkpoint.discovery.stop_reason = nav.reason;
    checkpoint.stop_reason = `profile_discovery_${nav.reason}`;
    await addEvent("discovery_failed", { reason: checkpoint.stop_reason });
    return checkpoint;
  }

  let previousScrollTop = -1;
  while (!abortRequested && isRunCurrent(runToken) && checkpoint.discovery.rounds < options.profileMaxRounds) {
    const response = await sendTabMessage(profileTabId, {
      type: "DOGIST_PROFILE_DISCOVERY_ROUND",
      waitMs: options.profileIndexWaitMs,
      scrollDelayMs: options.profileScrollDelayMs
    });
    if (!isRunCurrent(runToken)) return checkpoint;

    if (response?.limitation) {
      checkpoint.discovery.stop_reason = response.limitation;
      if (HARD_ACCOUNT_LIMITATIONS.has(response.limitation)) {
        checkpoint.status = "stopped";
        checkpoint.stop_reason = `profile_discovery_${response.limitation}`;
        await addEvent("discovery_limited", { reason: checkpoint.stop_reason });
        return checkpoint;
      }
      break;
    }

    let added = 0;
    for (const post of response?.posts ?? []) {
      if (addDiscoveredPost(checkpoint, post)) {
        await putRecord("posts", checkpoint.posts[post.shortcode]);
        added++;
      }
    }

    checkpoint.discovery.rounds++;
    checkpoint.discovery.no_new_rounds = added > 0 ? 0 : checkpoint.discovery.no_new_rounds + 1;

    const scrollTop = Number(response?.scroll_top_after ?? response?.scroll_top ?? 0);
    if (scrollTop <= previousScrollTop + 2 && added === 0) {
      checkpoint.discovery.scroll_stuck_rounds++;
    } else {
      checkpoint.discovery.scroll_stuck_rounds = 0;
    }
    previousScrollTop = scrollTop;

    await addEvent("profile_discovery_round", {
      round: checkpoint.discovery.rounds,
      seen: response?.seen ?? response?.posts?.length ?? 0,
      added,
      total: checkpoint.discovered_post_queue.length,
      scroll_y: scrollTop,
      scroll_height: response?.scroll_height_after ?? response?.scroll_height ?? null,
      sample_hrefs: (response?.hrefs ?? []).slice(0, 8)
    });
    await rebuildCountsAndSave(checkpoint);

    if (options.maxPosts && checkpoint.discovered_post_queue.length >= options.maxPosts) {
      checkpoint.discovery.stop_reason = `max_posts_discovery_limit_${options.maxPosts}`;
      break;
    }
    if (checkpoint.discovery.no_new_rounds >= options.profileNoNewRounds) {
      checkpoint.discovery.stop_reason = `no_new_posts_after_${options.profileNoNewRounds}_rounds`;
      break;
    }
    if (checkpoint.discovery.scroll_stuck_rounds >= 8) {
      checkpoint.discovery.stop_reason = "profile_scroll_stuck";
      break;
    }
  }

  if (abortRequested) {
    checkpoint.status = "stopped";
    checkpoint.stop_reason = "user_stop_requested";
    checkpoint.discovery.stop_reason = "user_stop_requested";
    await addEvent("run_stopped", { phase: "discovery", reason: checkpoint.stop_reason });
    return checkpoint;
  }

  if (checkpoint.discovery.rounds >= options.profileMaxRounds) {
    checkpoint.discovery.stop_reason = `profile_max_rounds_reached_${options.profileMaxRounds}`;
  }

  checkpoint.discovery.completed = true;
  checkpoint.discovery.completed_at = nowIso();
  checkpoint.discovery.stop_reason ||= "profile_scroll_exhausted";
  await addEvent("discovery_complete", {
    total: checkpoint.discovered_post_queue.length,
    rounds: checkpoint.discovery.rounds,
    reason: checkpoint.discovery.stop_reason
  });
  await rebuildCountsAndSave(checkpoint);
  return checkpoint;
}

async function runPostBatches(checkpoint, options, runToken, runSessionId) {
  let attemptedThisRun = 0;

  while (!abortRequested && isRunCurrent(runToken)) {
    await releaseStaleLeases(checkpoint, false);
    await releaseLegacyPreloadFailures(checkpoint);

    if (options.maxPosts && attemptedThisRun >= options.maxPosts) {
      checkpoint.status = "stopped";
      checkpoint.stop_reason = `max_posts_reached_${options.maxPosts}`;
      await addEvent("run_stopped", { phase: "scraping", reason: checkpoint.stop_reason });
      await rebuildCountsAndSave(checkpoint);
      return;
    }

    const remainingBudget = options.maxPosts ? Math.max(0, options.maxPosts - attemptedThisRun) : Number.POSITIVE_INFINITY;
    const batchSize = Math.min(checkpoint.effective_preload_tabs || checkpoint.effective_concurrency || options.preloadTabs, remainingBudget);
    const batch = await claimPostBatch(checkpoint, options, batchSize);
    if (batch.length === 0) {
      checkpoint.status = "complete";
      checkpoint.stop_reason = "no_queued_posts_remaining";
      await addEvent("run_complete", { reason: checkpoint.stop_reason });
      await rebuildCountsAndSave(checkpoint);
      return;
    }

    attemptedThisRun += batch.length;
    checkpoint.active_workers = batch.length;
    await addEvent("post_batch_started", {
      size: batch.length,
      effective_preload_tabs: checkpoint.effective_preload_tabs || checkpoint.effective_concurrency,
      shortcodes: batch.map((entry) => entry.post.shortcode)
    });
    await rebuildCountsAndSave(checkpoint);

    const outcomes = await runActiveHydrateBatch(checkpoint, batch, options, runToken, runSessionId);
    if (!isRunCurrent(runToken)) return;
    checkpoint.active_workers = 0;
    await applyConcurrencyFeedback(checkpoint, options, outcomes);
    await rebuildCountsAndSave(checkpoint);

    if (!abortRequested) {
      await sleep(options.betweenBatchDelayMs);
    }
  }

  if (isRunCurrent(runToken)) {
    checkpoint.status = "stopped";
    checkpoint.stop_reason = "user_stop_requested";
    await addEvent("run_stopped", { phase: "scraping", reason: checkpoint.stop_reason });
    await rebuildCountsAndSave(checkpoint);
  }
}

async function claimPostBatch(checkpoint, options, requestedSize) {
  const batch = [];
  const size = Math.max(1, Number.isFinite(requestedSize) ? requestedSize : options.preloadTabs);
  const allowPartialRetry = Boolean(options.retryPartial && !hasQueuedPosts(checkpoint));
  for (const shortcode of checkpoint.discovered_post_queue) {
    if (batch.length >= size) break;
    const post = checkpoint.posts[shortcode];
    if (!post) continue;
    if (await applySkipLedgerIfCovered(checkpoint, post, options)) continue;
    if (!isPostClaimable(post, options, allowPartialRetry)) continue;

    const workerId = `worker-${String(batch.length + 1).padStart(2, "0")}`;
    post.status = "in_progress";
    post.attempts = (post.attempts || 0) + 1;
    post.started_at ||= nowIso();
    post.lease_started_at = nowIso();
    post.worker_id = workerId;
    post.effective_concurrency = checkpoint.effective_preload_tabs || checkpoint.effective_concurrency || options.preloadTabs;
    post.effective_preload_tabs = post.effective_concurrency;
    post.last_error = null;
    checkpoint.last_attempted_post = post.shortcode;
    await putRecord("posts", post);
    batch.push({ post, workerId });
  }
  return batch;
}

function hasQueuedPosts(checkpoint) {
  for (const shortcode of checkpoint.discovered_post_queue ?? []) {
    if (checkpoint.posts?.[shortcode]?.status === "queued") return true;
  }
  return false;
}

function isPostClaimable(post, options, allowPartialRetry = false) {
  if (post.status === "queued") return true;
  if (allowPartialRetry && post.status === "partial" && (post.attempts || 0) < 2) return true;
  if (allowPartialRetry && post.status === "partial_unknown_target" && (post.attempts || 0) < 2) return true;
  if (post.status === "failed" && options.retryFailed) return true;
  return false;
}

async function applySkipLedgerIfCovered(checkpoint, post, options) {
  if (!options.skipCoveredPosts || post.status !== "queued") return false;
  const target = Number(post.target_comment_count ?? post.displayed_comment_count);
  const source = post.target_comment_source || "";
  const captured = Math.max(Number(post.captured_comments || 0), await countCommentsForPost(post.shortcode));
  const targetKnown = Number.isFinite(target) && target > 0;
  const targetReliable = targetKnown && RELIABLE_TARGET_SOURCES.has(source);
  const unknownTargetSkip = !targetKnown && options.skipUnknownTargetPosts && captured >= UNKNOWN_TARGET_COMPLETE_MIN_COMMENTS;
  const covered = targetReliable && captured / target >= SKIP_CAPTURE_RATE;
  if (!covered && !unknownTargetSkip) return false;

  post.status = "complete";
  post.stop_reason = covered ? `skip_ledger_capture_rate_${SKIP_CAPTURE_RATE}` : "skip_ledger_unknown_target_threshold";
  post.exhaustion_reason = post.stop_reason;
  post.completed_at ||= nowIso();
  post.lease_started_at = null;
  post.worker_id = null;
  post.captured_comments = captured;
  post.capture_rate_estimate = targetKnown ? Number((captured / target).toFixed(4)) : null;
  checkpoint.posts[post.shortcode] = post;
  await putRecord("posts", post);
  await addEvent("post_skipped_by_ledger", {
    shortcode: post.shortcode,
    captured_comments: captured,
    target_comment_count: targetKnown ? target : null,
    target_comment_source: source || null,
    capture_rate_estimate: post.capture_rate_estimate,
    reason: post.stop_reason
  });
  return true;
}

async function runActiveHydrateBatch(checkpoint, batch, options, runToken, runSessionId) {
  const opened = await Promise.all(batch.map((entry) => openPostTabForBatch(checkpoint, entry.post, options, entry.workerId, runToken)));
  if (!isRunCurrent(runToken)) return [];
  const outcomes = opened.filter((entry) => entry.outcome).map((entry) => entry.outcome);
  const liveEntries = opened.filter((entry) => entry.tabId && !entry.finished);

  for (const entry of liveEntries) {
    if (abortRequested || !isRunCurrent(runToken)) break;
    const hydrateOutcome = await hydratePostTab(checkpoint, entry, options, runToken, runSessionId);
    if (hydrateOutcome) outcomes.push(hydrateOutcome);
    if (entry.finished) await closePostTabEntry(entry);
    if (entry.finished || abortRequested || !isRunCurrent(runToken)) continue;
    outcomes.push(await scrapeHydratedPostTab(checkpoint, entry, options, runToken, runSessionId));
  }

  if (!isRunCurrent(runToken)) return outcomes;

  for (const entry of liveEntries.filter((item) => !item.finished)) {
    await finishPost(checkpoint, entry.post, null, "user_stop_requested", 0, entry.workerId);
    entry.finished = true;
    outcomes.push({ shortcode: entry.post.shortcode, reason: "user_stop_requested", ok: false, durationMs: Date.now() - entry.startedAt });
    await closePostTabEntry(entry);
  }

  return outcomes;
}

async function openPostTabForBatch(checkpoint, post, options, workerId, runToken) {
  const startedAt = Date.now();
  let tabId = null;
  try {
    await addEvent("post_started", { shortcode: post.shortcode, attempt: post.attempts, worker_id: workerId, url: post.url });
    const tab = await chrome.tabs.create({ url: post.url, active: false });
    if (!tab?.id) {
      await finishPost(checkpoint, post, null, "tab_create_failed", 0, workerId);
      return {
        post,
        workerId,
        startedAt,
        finished: true,
        outcome: { shortcode: post.shortcode, reason: "tab_create_failed", ok: false, durationMs: Date.now() - startedAt }
      };
    }

    tabId = tab.id;
    const entry = { post, workerId, tabId, startedAt, finished: false };
    activePostTabs.add(tabId);
    await addEvent("post_tab_opened", { shortcode: post.shortcode, worker_id: workerId, tab_id: tabId, active: false });
    await waitForTabLoad(tabId, options.tabTimeoutMs);
    if (!isRunCurrent(runToken)) {
      return {
        post,
        workerId,
        tabId,
        startedAt,
        finished: true,
        outcome: { shortcode: post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - startedAt }
      };
    }
    await addEvent("post_tab_loaded", {
      shortcode: post.shortcode,
      worker_id: workerId,
      tab_id: tabId,
      load_ms: Date.now() - startedAt
    });
    return entry;
  } catch (error) {
    if (tabId) {
      activePostTabs.delete(tabId);
      await chrome.tabs.remove(tabId).catch(() => {});
    }
    if (!isRunCurrent(runToken)) {
      return {
        post,
        workerId,
        startedAt,
        finished: true,
        outcome: { shortcode: post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - startedAt }
      };
    }
    const reason = classifyNavigationError(error);
    await finishPost(checkpoint, post, null, reason, 0, workerId);
    return {
      post,
      workerId,
      startedAt,
      finished: true,
      outcome: { shortcode: post.shortcode, reason, ok: false, durationMs: Date.now() - startedAt }
    };
  }
}

async function hydratePostTab(checkpoint, entry, options, runToken, runSessionId) {
  const hydrateStarted = Date.now();
  try {
    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
    await chrome.tabs.update(entry.tabId, { active: true });
    await addEvent("post_tab_activated", {
      shortcode: entry.post.shortcode,
      worker_id: entry.workerId,
      tab_id: entry.tabId,
      hydrate_ms: options.activeHydrateMs
    });

    const response = await withTimeout(
      sendTabMessage(entry.tabId, {
        type: "DOGIST_POST_HYDRATE",
        mode: "hydrate",
        workerId: entry.workerId,
        run_session_id: runSessionId,
        postShortcode: entry.post.shortcode,
        hydrateMs: options.activeHydrateMs,
        scrollDelayMs: options.scrollDelayMs,
        scrapeMode: options.scrapeMode
      }),
      options.activeHydrateMs + 30000,
      "post_hydrate_timeout"
    );
    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };

    if (response?.limitation) {
      await finishPost(checkpoint, entry.post, null, response.limitation, 0, entry.workerId);
      entry.finished = true;
      return { shortcode: entry.post.shortcode, reason: response.limitation, ok: false, durationMs: Date.now() - entry.startedAt };
    }

    const detail = response?.detail ?? null;
    const hydrateNew = await persistDetailComments(entry.post, detail, {
      workerId: entry.workerId,
      batchId: "hydrate",
      source: "hydrate_response"
    });
    await recordHydrateResult(entry.post, detail, response?.diagnostics ?? null, Date.now() - hydrateStarted);
    await addEvent("post_tab_hydrated", {
      shortcode: entry.post.shortcode,
      worker_id: entry.workerId,
      tab_id: entry.tabId,
      hydrate_ms: Date.now() - hydrateStarted,
      visibility_state: response?.diagnostics?.visibility_state ?? detail?.quality?.visibility_state ?? null,
      has_article: response?.diagnostics?.has_article ?? Boolean(detail),
      has_scroll_container: response?.diagnostics?.has_scroll_container ?? detail?.quality?.has_scroll_container ?? null,
      selector_path_used: response?.diagnostics?.selector_path_used ?? detail?.quality?.selector_path_used ?? null,
      likes: detail?.engagement?.likes ?? null,
      displayed_comment_count: detail?.quality?.target_comment_count ?? detail?.quality?.displayed_comment_count_if_available ?? null,
      repost_count: detail?.engagement?.reposts ?? null,
      comments_found: detail?.comments_data?.length ?? 0,
      persisted_new_comments: hydrateNew
    });
    return null;
  } catch (error) {
    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
    const reason = classifyNavigationError(error);
    await finishPost(checkpoint, entry.post, null, reason, 0, entry.workerId);
    entry.finished = true;
    return { shortcode: entry.post.shortcode, reason, ok: false, durationMs: Date.now() - entry.startedAt };
  }
}

async function scrapeHydratedPostTab(checkpoint, entry, options, runToken, runSessionId) {
  try {
    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
    await chrome.tabs.update(entry.tabId, { active: true });
    entry.post.active_scrape_started_at = nowIso();
    entry.post.run_session_id = runSessionId;
    await putRecord("posts", entry.post);
    await addEvent("post_active_scrape_started", {
      shortcode: entry.post.shortcode,
      worker_id: entry.workerId,
      run_session_id: runSessionId,
      tab_id: entry.tabId,
      target_comment_count: entry.post.target_comment_count ?? null,
      captured_comments: await countCommentsForPost(entry.post.shortcode)
    });

    let finalNew = 0;
    let step = 0;
    let detail = null;
    let stopReason = "detail_extracted";

    while (!abortRequested && isRunCurrent(runToken)) {
      await touchRunHeartbeat(checkpoint, runSessionId);
      const response = await withTimeout(
        sendTabMessage(entry.tabId, {
          type: "DOGIST_POST_DETAIL_STEP",
          mode: options.scrapeMode,
          scrapeMode: options.scrapeMode,
          workerId: entry.workerId,
          run_session_id: runSessionId,
          postShortcode: entry.post.shortcode,
          requireVisible: true,
          scrollDelayMs: options.scrollDelayMs,
          scrollDelayFastMs: options.scrollDelayFastMs,
          scrollDelaySlowMs: options.scrollDelaySlowMs,
          noNewCommentRounds: options.noNewCommentRounds,
          maxPostMs: options.maxPostMs,
          stepMaxMs: options.postStepMaxMs,
          coverageMaxComments: options.coverageMaxComments,
          coverageMaxMs: Math.max(30000, Number(options.coverageMaxMinutes || 0) * 60 * 1000),
          coverageMinRate: options.coverageMinRate
        }),
        Math.min(29000, options.postStepMaxMs + 8000),
        "post_detail_step_timeout"
      );
      step++;
      if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
      await touchRunHeartbeat(checkpoint, runSessionId);

      if (response?.limitation) {
        entry.post.active_scrape_finished_at = nowIso();
        await finishPost(checkpoint, entry.post, null, response.limitation, 0, entry.workerId);
        await addEvent("post_active_scrape_finished", {
          shortcode: entry.post.shortcode,
          worker_id: entry.workerId,
          run_session_id: runSessionId,
          reason: response.limitation,
          status: entry.post.status,
          captured_comments: await countCommentsForPost(entry.post.shortcode)
        });
        return { shortcode: entry.post.shortcode, reason: response.limitation, ok: false, durationMs: Date.now() - entry.startedAt };
      }

      detail = response?.detail ?? detail;
      finalNew += await persistDetailComments(entry.post, response?.detail ?? null, {
        workerId: entry.workerId,
        batchId: response?.done ? "final" : `step-${step}`,
        source: response?.done ? "final_step_response" : "step_response"
      });

      await addEvent("post_detail_step_finished", {
        shortcode: entry.post.shortcode,
        worker_id: entry.workerId,
        run_session_id: runSessionId,
        step,
        done: Boolean(response?.done),
        stop_reason: response?.stopReason ?? response?.detail?.quality?.stop_reason ?? null,
        new_comments: response?.new_comments ?? response?.detail?.comments_data?.length ?? 0,
        total_comments: response?.total_comments ?? response?.detail?.quality?.comments_found ?? null
      });

      if (response?.done) {
        stopReason = response.stopReason || detail?.quality?.stop_reason || detail?.quality?.failure_reason || "detail_extracted";
        break;
      }
    }

    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
    if (abortRequested) return { shortcode: entry.post.shortcode, reason: "user_stop_requested", ok: false, durationMs: Date.now() - entry.startedAt };

    entry.post.active_scrape_finished_at = nowIso();
    await finishPost(checkpoint, entry.post, detail, stopReason, finalNew, entry.workerId);
    await addEvent("post_active_scrape_finished", {
      shortcode: entry.post.shortcode,
      worker_id: entry.workerId,
      run_session_id: runSessionId,
      reason: stopReason,
      status: entry.post.status,
      captured_comments: await countCommentsForPost(entry.post.shortcode),
      target_comment_count: entry.post.target_comment_count ?? null,
      active_visibility_states: entry.post.active_visibility_states ?? []
    });
    return {
      shortcode: entry.post.shortcode,
      reason: stopReason,
      ok: stopReason === "target_reached" || stopReason === "comments_exhausted_bottom_reached" || stopReason === "comments_exhausted_no_new_rounds",
      durationMs: Date.now() - entry.startedAt
    };
  } catch (error) {
    if (!isRunCurrent(runToken)) return { shortcode: entry.post.shortcode, reason: "run_cancelled", ok: false, durationMs: Date.now() - entry.startedAt };
    const reason = classifyNavigationError(error);
    entry.post.active_scrape_finished_at = nowIso();
    await abortPostDetailSession(entry.tabId, runSessionId, entry.workerId, entry.post.shortcode);
    await finishPost(checkpoint, entry.post, null, reason, 0, entry.workerId);
    await addEvent("post_active_scrape_finished", {
      shortcode: entry.post.shortcode,
      worker_id: entry.workerId,
      run_session_id: runSessionId,
      reason,
      status: entry.post.status,
      captured_comments: await countCommentsForPost(entry.post.shortcode)
    });
    return { shortcode: entry.post.shortcode, reason, ok: false, durationMs: Date.now() - entry.startedAt };
  } finally {
    await abortPostDetailSession(entry.tabId, runSessionId, entry.workerId, entry.post.shortcode);
    entry.finished = true;
    await closePostTabEntry(entry);
  }
}

async function recordHydrateResult(post, detail, diagnostics, hydrateMs) {
  post.active_hydrated_at = nowIso();
  post.active_hydrate_ms = hydrateMs;
  post.hydrate_visibility_state = diagnostics?.visibility_state ?? detail?.quality?.visibility_state ?? null;
  post.hydrate_comments_found = detail?.comments_data?.length ?? diagnostics?.comments_found ?? 0;
  post.hydrate_target_comment_count = detail?.quality?.target_comment_count ?? detail?.quality?.displayed_comment_count_if_available ?? null;

  if (detail) {
    const target = reliableTargetFromDetail(detail, post);
    const hasTarget = Number.isFinite(Number(target)) && Number(target) > 0;
    post.caption_preview = normalize(detail.content_text).slice(0, 160) || post.caption_preview || "";
    post.posted_at = detail.posted_at ?? post.posted_at ?? null;
    post.like_count = detail.engagement?.likes ?? post.like_count ?? 0;
    post.repost_count = detail.engagement?.reposts ?? post.repost_count ?? null;
    post.displayed_comment_count = detail.quality?.displayed_comment_count_if_available ?? detail.engagement?.comments ?? post.displayed_comment_count ?? null;
    post.target_comment_count = hasTarget ? Number(target) : post.target_comment_count ?? null;
    post.target_comment_source = detail.quality?.target_comment_source ?? post.target_comment_source ?? null;
  }

  await putRecord("posts", post);
}

async function closePostTabEntry(entry) {
  if (!entry?.tabId) return;
  activePostTabs.delete(entry.tabId);
  await chrome.tabs.remove(entry.tabId).catch(() => {});
  entry.tabId = null;
}

async function abortPostDetailSession(tabId, runSessionId, workerId, shortcode) {
  if (!tabId || !runSessionId) return;
  await sendTabMessage(tabId, {
    type: "DOGIST_POST_DETAIL_ABORT",
    run_session_id: runSessionId,
    workerId,
    postShortcode: shortcode
  }, 1).catch(() => {});
}

async function finishPost(checkpoint, post, detail, stopReason, totalNew, workerId) {
  const captured = await countCommentsForPost(post.shortcode);
  const target = reliableTargetFromDetail(detail, post);
  const targetSource = detail?.quality?.target_comment_source ?? post.target_comment_source ?? null;
  const hasTarget = Number.isFinite(Number(target)) && Number(target) > 0;
  const targetReached = hasTarget && captured >= Number(target);
  const exhaustedWithoutTarget = !hasTarget && isDomExhaustedReason(stopReason);
  const unknownTargetComplete = exhaustedWithoutTarget && captured >= UNKNOWN_TARGET_COMPLETE_MIN_COMMENTS;
  const hardFailure = isHardFailureReason(stopReason);
  const status = targetReached || unknownTargetComplete
    ? "complete"
    : !hasTarget && captured > 0 && !hardFailure
      ? "partial_unknown_target"
      : captured > 0 && !hardFailure
        ? "partial"
        : "failed";

  post.status = status;
  post.completed_at = nowIso();
  post.lease_started_at = null;
  post.worker_id = workerId;
  post.stop_reason = stopReason;
  post.exhaustion_reason = targetReached ? "target_reached" : unknownTargetComplete ? `unknown_target_exhausted_min_${UNKNOWN_TARGET_COMPLETE_MIN_COMMENTS}` : stopReason;
  post.captured_comments = captured;
  post.displayed_comment_count = hasTarget ? Number(target) : post.displayed_comment_count ?? null;
  post.target_comment_count = hasTarget ? Number(target) : null;
  post.target_comment_source = targetSource;
  post.capture_rate_estimate = hasTarget ? Number((captured / Number(target)).toFixed(4)) : null;
  if (detail) {
    const scrollResult = detail.quality?.scroll_result ?? null;
    const visibilityStates = Array.from(new Set((scrollResult?.snapshots ?? []).map((snapshot) => snapshot.visibility_state).filter(Boolean)));
    post.caption_preview = normalize(detail.content_text).slice(0, 160);
    post.posted_at = detail.posted_at ?? post.posted_at ?? null;
    post.like_count = detail.engagement?.likes ?? post.like_count ?? 0;
    post.repost_count = detail.engagement?.reposts ?? post.repost_count ?? null;
    post.exhaustive_scroll = scrollResult ?? post.exhaustive_scroll ?? null;
    post.active_scroll_rounds = scrollResult?.scrolls ?? post.active_scroll_rounds ?? null;
    post.active_visibility_states = visibilityStates.length ? visibilityStates : post.active_visibility_states ?? [];
    post.background_scroll_visibility_states = visibilityStates.length ? visibilityStates : post.background_scroll_visibility_states ?? [];
  }

  await putRecord("posts", post);
  await putRecord("raw_post_records", {
    id: `${post.shortcode}:final:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    scraped_at: nowIso(),
    post_status: status,
    stop_reason: stopReason,
    exhaustion_reason: post.exhaustion_reason,
    persisted_comments_this_attempt: totalNew,
    shortcode: post.shortcode,
    url: post.url,
    platform: post.platform || checkpoint.platform || PLATFORM,
    creator_handle: post.creator_handle || checkpoint.creator_handle || checkpoint.target || DEFAULT_CREATOR_HANDLE,
    target: post.target || checkpoint.target || checkpoint.creator_handle || DEFAULT_CREATOR_HANDLE,
    worker_id: workerId,
    active_hydrated_at: post.active_hydrated_at ?? null,
    active_hydrate_ms: post.active_hydrate_ms ?? null,
    hydrate_visibility_state: post.hydrate_visibility_state ?? null,
    hydrate_comments_found: post.hydrate_comments_found ?? null,
    hydrate_target_comment_count: post.hydrate_target_comment_count ?? null,
    active_scrape_started_at: post.active_scrape_started_at ?? null,
    active_scrape_finished_at: post.active_scrape_finished_at ?? null,
    active_scroll_rounds: post.active_scroll_rounds ?? null,
    active_visibility_states: post.active_visibility_states ?? [],
    background_scroll_visibility_states: post.background_scroll_visibility_states ?? [],
    target_comment_count: post.target_comment_count,
    captured_comments: captured,
    repost_count: post.repost_count,
    detail: compactDetail(detail)
  });
  await addEvent("post_finished", {
    shortcode: post.shortcode,
    status,
    stop_reason: stopReason,
    captured_comments: captured,
    target_comment_count: post.target_comment_count,
    capture_rate_estimate: post.capture_rate_estimate,
    repost_count: post.repost_count,
    worker_id: workerId,
    active_scroll_rounds: post.active_scroll_rounds ?? null,
    active_visibility_states: post.active_visibility_states ?? []
  });
}

async function persistCommentBatchMessage(message) {
  const detail = message.detail ?? null;
  const shortcode = message.shortcode || detail?.shortcode;
  if (!shortcode) return { ok: false, reason: "missing_shortcode" };

  const checkpoint = await loadCheckpoint();
  const runSessionId = getMessageRunSessionId(message);
  if (!isMessageFromCurrentRun(runSessionId, checkpoint)) {
    await addEvent("stale_run_session_message_ignored", {
      type: message.type,
      shortcode,
      run_session_id: runSessionId,
      active_run_session_id: checkpoint?.active_run_session_id ?? null,
      status: checkpoint?.status ?? null
    });
    return { ok: false, reason: "stale_run_session" };
  }

  const post = (await getRecord("posts", shortcode)) || {
    shortcode,
    kind: detail?.kind ?? "post",
    url: detail?.url ?? "",
    status: "in_progress"
  };
  const saved = await persistDetailComments(post, detail, {
    workerId: message.worker_id ?? message.workerId ?? null,
    batchId: message.batch_id ?? message.batchId ?? null,
    source: "content_batch"
  });
  const captured = await countCommentsForPost(shortcode);
  post.captured_comments = captured;
  post.caption_preview = normalize(detail?.content_text).slice(0, 160) || post.caption_preview || "";
  post.posted_at = detail?.posted_at ?? post.posted_at ?? null;
  post.like_count = detail?.engagement?.likes ?? post.like_count ?? 0;
  post.repost_count = detail?.engagement?.reposts ?? post.repost_count ?? null;
  post.displayed_comment_count = detail?.quality?.target_comment_count ?? detail?.quality?.displayed_comment_count_if_available ?? detail?.engagement?.comments ?? post.displayed_comment_count ?? null;
  post.target_comment_count = reliableTargetFromDetail(detail, post);
  post.target_comment_source = detail?.quality?.target_comment_source ?? post.target_comment_source ?? null;
  post.run_session_id = runSessionId ?? post.run_session_id ?? null;
  await putRecord("posts", post);
  if (checkpoint) {
    checkpoint.posts ||= {};
    checkpoint.posts[shortcode] = post;
    await touchRunHeartbeat(checkpoint, runSessionId);
  }
  await addEvent("comment_batch_persisted", {
    shortcode,
    worker_id: message.worker_id ?? message.workerId ?? null,
    run_session_id: runSessionId,
    batch_id: message.batch_id ?? message.batchId ?? null,
    saved,
    captured,
    target_comment_count: post.target_comment_count
  });
  return { ok: true, saved, captured };
}

async function persistDetailComments(post, detail, meta = {}) {
  const comments = detail?.comments_data ?? [];
  if (comments.length === 0) return 0;

  const rows = comments.map((comment) => ({
      comment_id: makeCommentId(post.shortcode, comment),
      scraped_at: nowIso(),
      platform: PLATFORM,
      creator_handle: post.creator_handle ?? detail?.author ?? null,
      post_shortcode: post.shortcode,
      post_url: post.url || detail?.url || "",
      post_kind: post.kind || detail?.kind || "post",
      comment_author: comment.author ?? "unknown",
      comment_text: comment.text ?? "",
      comment_likes: comment.likes ?? 0,
      comment_verified: comment.verified ?? false,
      comment_posted_at: comment.posted_at ?? null,
      native_comment_id: comment.native_comment_id ?? null,
      comment_permalink: comment.comment_permalink ?? null,
      comment_depth: Number.isFinite(Number(comment.depth)) ? Number(comment.depth) : 0,
      parent_comment_id: comment.parent_comment_id ?? null,
      worker_id: meta.workerId ?? null,
      batch_id: meta.batchId ?? null,
      extraction_source: meta.source ?? null
    }));

  const before = await countCommentsForPost(post.shortcode);
  await putRecords("comments", rows);
  const after = await countCommentsForPost(post.shortcode);
  return Math.max(0, after - before);
}

async function applyConcurrencyFeedback(checkpoint, options, outcomes) {
  const reasons = outcomes.map((outcome) => outcome.reason).filter(Boolean);
  const limiting = reasons.filter((reason) => isBackoffReason(reason));
  checkpoint.concurrency ||= { configured: options.preloadTabs, effective: checkpoint.effective_preload_tabs || checkpoint.effective_concurrency, stable_batches: 0, last_backoff_at: null };

  if (limiting.length >= 3 || (outcomes.length > 0 && limiting.length / outcomes.length >= 0.25)) {
    const previous = checkpoint.effective_preload_tabs || checkpoint.effective_concurrency || options.preloadTabs;
    const next = nextLowerConcurrency(previous);
    checkpoint.effective_concurrency = next;
    checkpoint.effective_preload_tabs = next;
    checkpoint.concurrency.effective = next;
    checkpoint.concurrency.stable_batches = 0;
    checkpoint.concurrency.last_backoff_at = nowIso();
    if (next < previous) {
      await addEvent("concurrency_backoff", { previous, next, limiting_reasons: limiting.slice(0, 10) });
    }
    return;
  }

  checkpoint.concurrency.stable_batches = (checkpoint.concurrency.stable_batches || 0) + 1;
  if (checkpoint.concurrency.stable_batches >= 3) {
    const previous = checkpoint.effective_preload_tabs || checkpoint.effective_concurrency || options.preloadTabs;
    const next = nextHigherConcurrency(previous, options.preloadTabs);
    checkpoint.effective_concurrency = next;
    checkpoint.effective_preload_tabs = next;
    checkpoint.concurrency.effective = next;
    checkpoint.concurrency.stable_batches = next > previous ? 0 : checkpoint.concurrency.stable_batches;
    if (next > previous) {
      await addEvent("concurrency_restore", { previous, next });
    }
  }
}

function isBackoffReason(reason) {
  return (
    HARD_ACCOUNT_LIMITATIONS.has(reason) ||
    reason === "tab_load_timeout" ||
    reason === "post_hydrate_timeout" ||
    reason === "post_detail_timeout" ||
    reason === "no_response" ||
    String(reason).startsWith("navigation_error:")
  );
}

function nextLowerConcurrency(value) {
  for (const step of BACKOFF_STEPS) {
    if (value > step) return step;
  }
  return BACKOFF_STEPS[BACKOFF_STEPS.length - 1];
}

function nextHigherConcurrency(value, configured) {
  const capped = Math.max(1, configured);
  const sorted = [...BACKOFF_STEPS].sort((a, b) => a - b).filter((step) => step <= capped);
  for (const step of sorted) {
    if (step > value) return step;
  }
  return capped;
}

function isHardFailureReason(reason) {
  return (
    !reason ||
    reason === "tab_create_failed" ||
    reason === "content_script_error" ||
    reason === "post_unavailable" ||
    reason === "login_wall" ||
    reason === "challenge_required"
  );
}

function reliableTargetFromDetail(detail, post = null) {
  const detailSource = detail?.quality?.target_comment_source;
  const detailTarget = Number(detail?.quality?.target_comment_count);
  if (RELIABLE_TARGET_SOURCES.has(detailSource) && Number.isFinite(detailTarget) && detailTarget > 0) {
    return detailTarget;
  }
  const postSource = post?.target_comment_source;
  const postTarget = Number(post?.target_comment_count);
  if (RELIABLE_TARGET_SOURCES.has(postSource) && Number.isFinite(postTarget) && postTarget > 0) {
    return postTarget;
  }
  return null;
}

function isDomExhaustedReason(reason) {
  return reason === "comments_exhausted_bottom_reached" || reason === "comments_exhausted_no_new_rounds";
}

async function releaseStaleLeases(checkpoint, force) {
  const now = Date.now();
  let released = 0;
  for (const post of Object.values(checkpoint.posts ?? {})) {
    if (post.status !== "in_progress") continue;
    const leaseMs = Date.parse(post.lease_started_at || post.started_at || 0);
    if (!force && Number.isFinite(leaseMs) && now - leaseMs < (checkpoint.options?.staleLeaseMs ?? DEFAULT_OPTIONS.staleLeaseMs)) continue;
    post.status = post.captured_comments > 0 ? "partial" : "queued";
    post.stop_reason = force ? "resume_released_stale_lease" : "stale_lease_released";
    post.lease_started_at = null;
    post.worker_id = null;
    await putRecord("posts", post);
    released++;
  }
  if (released > 0) {
    await addEvent("stale_leases_released", { released, force });
    await rebuildCountsAndSave(checkpoint);
  }
}

async function releaseLegacyPreloadFailures(checkpoint) {
  let released = 0;
  for (const post of Object.values(checkpoint.posts ?? {})) {
    if (!isLegacyPreloadOnlyFailure(post)) continue;
    post.status = "queued";
    post.attempts = 0;
    post.stop_reason = "legacy_preload_failure_requeued";
    post.exhaustion_reason = null;
    post.completed_at = null;
    post.lease_started_at = null;
    post.worker_id = null;
    post.last_error = null;
    checkpoint.posts[post.shortcode] = post;
    await putRecord("posts", post);
    released++;
  }
  if (released > 0) {
    await addEvent("legacy_preload_failures_requeued", { released });
    await rebuildCountsAndSave(checkpoint);
  }
}

function isLegacyPreloadOnlyFailure(post) {
  if (!post || post.status !== "failed") return false;
  if (Number(post.captured_comments || 0) > 0) return false;
  if (post.active_scrape_started_at || post.active_scrape_finished_at || post.active_hydrated_at) return false;
  return post.stop_reason === "tab_load_timeout";
}

function addDiscoveredPost(checkpoint, post) {
  if (!post?.shortcode) return false;
  if (!checkpoint.posts[post.shortcode]) {
    checkpoint.posts[post.shortcode] = {
      shortcode: post.shortcode,
      kind: post.kind,
      url: post.url,
      canonical_url: post.canonical_url ?? null,
      platform: checkpoint.platform || PLATFORM,
      creator_handle: checkpoint.creator_handle || checkpoint.target || DEFAULT_CREATOR_HANDLE,
      profile_url: checkpoint.profile_url || DEFAULT_PROFILE_URL,
      target: checkpoint.target || DEFAULT_CREATOR_HANDLE,
      status: "queued",
      attempts: 0,
      discovered_at: nowIso(),
      discovery_round: checkpoint.discovery.rounds || 0,
      visible_index: post.visible_index ?? null,
      started_at: null,
      completed_at: null,
      lease_started_at: null,
      worker_id: null,
      captured_comments: 0,
      displayed_comment_count: null,
      target_comment_count: null,
      target_comment_source: null,
      like_count: null,
      repost_count: null,
      active_hydrated_at: null,
      active_hydrate_ms: null,
      hydrate_visibility_state: null,
      hydrate_comments_found: 0,
      hydrate_target_comment_count: null,
      active_scrape_started_at: null,
      active_scrape_finished_at: null,
      active_scroll_rounds: null,
      active_visibility_states: [],
      background_scroll_visibility_states: [],
      last_error: null,
      stop_reason: null,
      exhaustion_reason: null
    };
  }
  if (!checkpoint.discovered_post_queue.includes(post.shortcode)) {
    checkpoint.discovered_post_queue.push(post.shortcode);
    return true;
  }
  return false;
}

function makeCheckpoint(options) {
  const ts = nowIso();
  const creatorHandle = options.creatorHandle || DEFAULT_CREATOR_HANDLE;
  return {
    version: 3,
    platform: PLATFORM,
    creator_handle: creatorHandle,
    target: creatorHandle,
    profile_url: options.profileUrl || profileUrlFromHandle(creatorHandle),
    run_id: `blackhole-instagram-${creatorHandle}-${ts.slice(0, 10)}-${Math.random().toString(16).slice(2, 8)}`,
    created_at: ts,
    updated_at: ts,
    status: "running",
    phase: "discovery",
    run_mode: "full",
    stop_reason: null,
    recovery_state: "running",
    active_run_session_id: null,
    heartbeat_at: ts,
    interrupted_at: null,
    options,
    effective_concurrency: options.preloadTabs,
    effective_preload_tabs: options.preloadTabs,
    active_workers: 0,
    concurrency: {
      configured: options.preloadTabs,
      effective: options.preloadTabs,
      stable_batches: 0,
      last_backoff_at: null
    },
    discovery: {
      completed: false,
      started_at: null,
      completed_at: null,
      rounds: 0,
      scroll_rounds: 0,
      no_new_rounds: 0,
      scroll_stuck_rounds: 0,
      stop_reason: null
    },
    discovered_post_queue: [],
    completed_shortcodes: [],
    partial_shortcodes: [],
    failed_shortcodes: [],
    posts: {},
    last_attempted_post: null,
    counts: {
      discovered_posts: 0,
      attempted_posts: 0,
      completed_posts: 0,
      partial_posts: 0,
      failed_posts: 0,
      comments_captured: 0
    }
  };
}

function normalizeCheckpoint(checkpoint, options) {
  checkpoint.version = Math.max(Number(checkpoint.version || 1), 3);
  checkpoint.platform ||= PLATFORM;
  checkpoint.creator_handle ||= normalizeCreatorHandle(options.creatorHandle || checkpoint.target || DEFAULT_CREATOR_HANDLE);
  checkpoint.target ||= checkpoint.creator_handle;
  checkpoint.profile_url ||= options.profileUrl || profileUrlFromHandle(checkpoint.creator_handle);
  checkpoint.run_mode ||= "full";
  checkpoint.phase ||= checkpoint.discovery?.completed ? "scraping" : "discovery";
  checkpoint.recovery_state ||= checkpoint.status === "running" ? "running" : null;
  checkpoint.active_run_session_id ||= null;
  checkpoint.heartbeat_at ||= checkpoint.updated_at || checkpoint.created_at || nowIso();
  checkpoint.interrupted_at ||= null;
  checkpoint.discovery ||= {};
  checkpoint.discovery.rounds ||= checkpoint.discovery.scroll_rounds || 0;
  checkpoint.discovery.no_new_rounds ||= 0;
  checkpoint.discovery.scroll_stuck_rounds ||= 0;
  checkpoint.discovered_post_queue ||= [];
  checkpoint.completed_shortcodes ||= [];
  checkpoint.partial_shortcodes ||= [];
  checkpoint.failed_shortcodes ||= [];
  checkpoint.posts ||= {};
  checkpoint.counts ||= {};
  checkpoint.effective_concurrency = clampPreloadTabs(checkpoint.effective_concurrency || checkpoint.effective_preload_tabs || options.preloadTabs, options.preloadTabs);
  checkpoint.effective_preload_tabs = checkpoint.effective_concurrency;
  checkpoint.concurrency ||= {
    configured: options.preloadTabs,
    effective: checkpoint.effective_concurrency,
    stable_batches: 0,
    last_backoff_at: null
  };
  checkpoint.concurrency.configured = options.preloadTabs;
  checkpoint.concurrency.effective = checkpoint.effective_preload_tabs;
  return checkpoint;
}

async function rebuildCountsAndSave(checkpoint) {
  const persistedPosts = await getAllRecords("posts");
  for (const post of persistedPosts) checkpoint.posts[post.shortcode] = post;
  const posts = Object.values(checkpoint.posts);
  checkpoint.completed_shortcodes = posts.filter((p) => p.status === "complete").map((p) => p.shortcode);
  checkpoint.partial_shortcodes = posts.filter((p) => p.status === "partial" || p.status === "partial_unknown_target").map((p) => p.shortcode);
  checkpoint.failed_shortcodes = posts.filter((p) => p.status === "failed").map((p) => p.shortcode);
  const meaningfulAttempts = posts.filter(isMeaningfulAttempt);
  const claimedOnlyPosts = posts.filter((post) => (post.attempts || 0) > 0 && !isMeaningfulAttempt(post));
  checkpoint.counts = {
    discovered_posts: checkpoint.discovered_post_queue.length,
    attempted_posts: meaningfulAttempts.length,
    claimed_posts: posts.filter((p) => (p.attempts || 0) > 0).length,
    claimed_only_posts: claimedOnlyPosts.length,
    completed_posts: checkpoint.completed_shortcodes.length,
    partial_posts: checkpoint.partial_shortcodes.length,
    failed_posts: checkpoint.failed_shortcodes.length,
    in_progress_posts: posts.filter((p) => p.status === "in_progress").length,
    comments_captured: await countStore("comments")
  };
  checkpoint.updated_at = nowIso();
  await saveCheckpoint(checkpoint);
}

function isMeaningfulAttempt(post) {
  if (!post) return false;
  if (Number(post.captured_comments || 0) > 0) return true;
  if (post.active_hydrated_at || post.active_scrape_started_at || post.active_scrape_finished_at) return true;
  if (post.status === "failed" && !isLegacyPreloadOnlyFailure(post)) return true;
  return false;
}

async function navigateProfileTab(url, timeoutMs) {
  try {
    const tab = profileTabId
      ? await chrome.tabs.update(profileTabId, { url, active: true })
      : await chrome.tabs.create({ url, active: true });
    profileTabId = tab.id;
    await waitForTabLoad(profileTabId, timeoutMs);
    await sleep(1500);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: classifyNavigationError(error) };
  }
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab_load_timeout"));
    }, timeoutMs);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendTabMessage(tabId, message, attempts = 6) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      if (isMissingReceiverError(error)) {
        await injectContentScript(tabId);
      }
      await sleep(500 + i * 300);
    }
  }
  throw lastError ?? new Error("send_tab_message_failed");
}

async function injectContentScript(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/instagram.js"]
    });
    await addEvent("content_script_injected", { tab_id: tabId });
  } catch (error) {
    await addEvent("content_script_injection_failed", {
      tab_id: tabId,
      message: errorMessage(error)
    });
  }
}

function isMissingReceiverError(error) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("receiving end does not exist") ||
    message.includes("could not establish connection") ||
    message.includes("extension context invalidated")
  );
}

function classifyNavigationError(error) {
  const message = errorMessage(error);
  if (message.includes("ERR_INTERNET_DISCONNECTED")) return "internet_disconnected";
  if (message.includes("ERR_NAME_NOT_RESOLVED")) return "dns_name_not_resolved";
  if (message.includes("ERR_CONNECTION_TIMED_OUT")) return "connection_timed_out";
  if (message.includes("tab_load_timeout")) return "tab_load_timeout";
  if (message.includes("post_hydrate_timeout")) return "post_hydrate_timeout";
  if (message.includes("post_detail_step_timeout")) return "post_detail_step_timeout";
  if (message.includes("post_detail_timeout")) return "post_detail_timeout";
  return `navigation_error:${message.slice(0, 120)}`;
}

async function exportBundle() {
  const checkpoint = await loadCheckpoint();
  if (!checkpoint) return { ok: false, reason: "no_checkpoint" };
  await addEvent("bundle_export_requested", { run_id: checkpoint.run_id });
  await chrome.tabs.create({ url: chrome.runtime.getURL("export.html"), active: true });
  return { ok: true, opened: "export.html" };
}

async function exportQueue() {
  const checkpoint = await loadCheckpoint();
  if (!checkpoint) return { ok: false, reason: "no_checkpoint" };
  await addEvent("queue_export_requested", { run_id: checkpoint.run_id, discovered_posts: checkpoint.discovered_post_queue?.length ?? 0 });
  await chrome.tabs.create({ url: chrome.runtime.getURL("export.html?mode=queue"), active: true });
  return { ok: true, opened: "export.html?mode=queue" };
}

async function importQueue(payload) {
  let parsed;
  try {
    parsed = await parseImportPayload(payload);
  } catch (error) {
    return { ok: false, reason: `invalid_json:${errorMessage(error).slice(0, 120)}` };
  }

  const importedPosts = extractQueuePosts(parsed);
  if (importedPosts.length === 0) {
    return { ok: false, reason: "no_posts_in_queue_file" };
  }

  let checkpoint = await loadCheckpoint();
  const options = normalizeOptions(checkpoint?.options ?? {});
  if (!checkpoint) checkpoint = makeCheckpoint(options);
  checkpoint = normalizeCheckpoint(checkpoint, options);
  checkpoint.status = "stopped";
  checkpoint.phase = "scraping";
  checkpoint.run_mode = "scrape_queue";
  checkpoint.stop_reason = "queue_imported";
  checkpoint.discovery.completed = true;
  checkpoint.discovery.completed_at ||= nowIso();
  checkpoint.discovery.stop_reason = "queue_imported";

  let added = 0;
  let updated = 0;
  let commentsImported = 0;
  let rawImported = 0;
  let eventsImported = 0;
  for (let i = 0; i < importedPosts.length; i++) {
    const imported = normalizeQueuePost(importedPosts[i], i);
    if (!imported) continue;

    const existing = checkpoint.posts[imported.shortcode] || (await getRecord("posts", imported.shortcode));
    if (existing) {
      const merged = mergeImportedPost(existing, imported);
      if (merged.status === "in_progress") {
        merged.status = merged.captured_comments > 0 ? "partial" : "queued";
        merged.stop_reason = "queue_import_released_stale_lease";
        merged.lease_started_at = null;
        merged.worker_id = null;
      }
      checkpoint.posts[imported.shortcode] = merged;
      await putRecord("posts", merged);
      updated++;
    } else {
      checkpoint.posts[imported.shortcode] = imported;
      await putRecord("posts", imported);
      added++;
    }

    if (!checkpoint.discovered_post_queue.includes(imported.shortcode)) {
      checkpoint.discovered_post_queue.push(imported.shortcode);
    }
  }

  if (Array.isArray(parsed.comments) && parsed.comments.length > 0) {
    await putRecords("comments", parsed.comments.map(normalizeImportedComment).filter(Boolean));
    commentsImported = parsed.comments.length;
  }
  if (Array.isArray(parsed.raw_post_records) && parsed.raw_post_records.length > 0) {
    await putRecords("raw_post_records", parsed.raw_post_records.filter(Boolean));
    rawImported = parsed.raw_post_records.length;
  }
  if (Array.isArray(parsed.events) && parsed.events.length > 0) {
    await putRecords("events", parsed.events.filter((event) => event?.id));
    eventsImported = parsed.events.length;
  }

  await addEvent("queue_imported", {
    source_type: parsed?.type ?? (parsed?.checkpoint ? "dogist_scrape_bundle" : "unknown"),
    imported: importedPosts.length,
    added,
    updated,
    comments_imported: commentsImported,
    raw_imported: rawImported,
    events_imported: eventsImported,
    total: checkpoint.discovered_post_queue.length
  });
  await rebuildCountsAndSave(checkpoint);
  return { ok: true, imported: importedPosts.length, added, updated, commentsImported, rawImported, eventsImported, total: checkpoint.discovered_post_queue.length };
}

async function parseImportPayload(payload) {
  if (typeof payload === "string") return JSON.parse(payload);
  if (!payload?.files) return payload;

  const files = new Map(payload.files.map((file) => [file.name, file.text]));
  const manifestFile = payload.files.find((file) => /manifest\.json$/i.test(file.name));
  if (!manifestFile) {
    const jsonFile = payload.files.find((file) => /\.json$/i.test(file.name));
    if (!jsonFile) throw new Error("No JSON file selected");
    return JSON.parse(jsonFile.text);
  }

  const manifest = JSON.parse(manifestFile.text);
  const named = (key) => {
    const name = manifest.files?.[key];
    return name && files.has(name) ? files.get(name) : null;
  };
  const checkpoint = named("checkpoint") ? JSON.parse(named("checkpoint")) : null;
  const queue = named("post_queue") ? JSON.parse(named("post_queue")) : null;
  return {
    version: manifest.version,
    type: manifest.type,
    exported_at: manifest.exported_at,
    checkpoint,
    posts: parseNdjson(named("posts")),
    comments: parseNdjson(named("comments")).map(stripImportedCommentBloat),
    raw_post_records: parseNdjson(named("raw_post_records")),
    events: parseNdjson(named("events")),
    post_queue: queue
  };
}

function parseNdjson(text) {
  if (!text) return [];
  const rows = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

function extractQueuePosts(input) {
  if (!input || typeof input !== "object") return [];
  if ((input.type === "dogist_post_queue" || input.type === "blackhole_instagram_post_queue") && Array.isArray(input.posts)) return input.posts;
  if (input.post_queue?.posts) return input.post_queue.posts;
  if (Array.isArray(input.posts) && input.checkpoint) {
    const queue = input.checkpoint.discovered_post_queue ?? [];
    const byShortcode = new Map(input.posts.map((post) => [post.shortcode, post]));
    return queue.map((shortcode) => byShortcode.get(shortcode)).filter(Boolean);
  }
  if (Array.isArray(input.posts)) return input.posts;
  return [];
}

function mergeImportedPost(existing, imported) {
  const betterImported = statusRank(imported.status) > statusRank(existing.status);
  const base = betterImported ? { ...existing, ...imported } : { ...imported, ...existing };
  base.kind = existing.kind || imported.kind;
  base.url = existing.url || imported.url;
  base.canonical_url = existing.canonical_url || imported.canonical_url;
  base.discovered_at = existing.discovered_at || imported.discovered_at;
  base.discovery_round = existing.discovery_round ?? imported.discovery_round;
  base.visible_index = existing.visible_index ?? imported.visible_index;
  base.captured_comments = Math.max(Number(existing.captured_comments || 0), Number(imported.captured_comments || 0));
  base.target_comment_count = existing.target_comment_count ?? imported.target_comment_count ?? null;
  base.displayed_comment_count = existing.displayed_comment_count ?? imported.displayed_comment_count ?? null;
  base.target_comment_source = existing.target_comment_source ?? imported.target_comment_source ?? null;
  return base;
}

function statusRank(status) {
  if (status === "complete") return 4;
  if (status === "partial" || status === "partial_unknown_target") return 3;
  if (status === "failed") return 2;
  if (status === "in_progress") return 1;
  return 0;
}

function normalizeQueuePost(input, index) {
  if (!input || typeof input !== "object") return null;
  const parsed = parseInstagramPostUrl(input.url || input.canonical_url || "");
  const shortcode = normalize(input.shortcode || parsed?.shortcode);
  if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
  const kind = normalize(input.kind || parsed?.kind || "post");
  const url = normalize(input.url || parsed?.url || `https://www.instagram.com/${kind}/${shortcode}/`);
  const canonicalUrl = normalize(input.canonical_url || parsed?.canonical_url || `https://www.instagram.com/${kind}/${shortcode}/`);
  return {
    shortcode,
    kind,
    url,
    canonical_url: canonicalUrl,
    platform: input.platform || PLATFORM,
    creator_handle: input.creator_handle || input.target || DEFAULT_CREATOR_HANDLE,
    profile_url: input.profile_url || profileUrlFromHandle(input.creator_handle || input.target || DEFAULT_CREATOR_HANDLE),
    target: input.target || input.creator_handle || DEFAULT_CREATOR_HANDLE,
    status: input.status && input.status !== "in_progress" ? input.status : "queued",
    attempts: Number(input.attempts || 0),
    discovered_at: input.discovered_at || nowIso(),
    discovery_round: input.discovery_round ?? null,
    visible_index: input.visible_index ?? input.position ?? index,
    started_at: null,
    completed_at: null,
    lease_started_at: null,
    worker_id: null,
    captured_comments: Number(input.captured_comments || 0),
    displayed_comment_count: input.displayed_comment_count ?? null,
    target_comment_count: input.target_comment_count ?? input.displayed_comment_count ?? null,
    target_comment_source: input.target_comment_source ?? null,
    like_count: input.like_count ?? null,
    repost_count: input.repost_count ?? null,
    active_hydrated_at: null,
    active_hydrate_ms: null,
    hydrate_visibility_state: null,
    hydrate_comments_found: 0,
    hydrate_target_comment_count: null,
    active_scrape_started_at: null,
    active_scrape_finished_at: null,
    active_scroll_rounds: null,
    active_visibility_states: [],
    background_scroll_visibility_states: [],
    last_error: null,
    stop_reason: input.stop_reason ?? null,
    exhaustion_reason: input.exhaustion_reason ?? null
  };
}

function normalizeImportedComment(comment) {
  const stripped = stripImportedCommentBloat(comment);
  if (!stripped?.comment_id || !stripped?.post_shortcode) return null;
  return stripped;
}

function stripImportedCommentBloat(comment) {
  if (!comment || typeof comment !== "object") return null;
  const rest = { ...comment };
  delete rest.extraction_quality;
  delete rest.post_caption;
  return rest;
}

async function getStatusPayload() {
  let checkpoint = await loadCheckpoint();
  if (checkpoint?.status === "running" && !activeRun) {
    const recovery = classifyRunningCheckpointRecovery(checkpoint, false);
    if (recovery === "stale_heartbeat") {
      checkpoint = await stopRunImmediately(WORKER_INTERRUPTED_REASON);
    } else if (recovery === "recent_heartbeat") {
      checkpoint.recovery_state = "worker_recovering";
      checkpoint.stop_reason = null;
    }
  }
  const events = (await getAllRecords("events")).slice(-40);
  return {
    checkpoint,
    live: await buildLiveStatus(checkpoint, events),
    events
  };
}

async function buildLiveStatus(checkpoint, events) {
  if (!checkpoint) return null;
  const totalComments = await countStore("comments");
  const posts = Object.values(checkpoint.posts ?? {});
  const activePost = posts.find((post) => post.status === "in_progress") || posts.find((post) => post.shortcode === checkpoint.last_attempted_post) || null;
  const activeCaptured = activePost?.shortcode ? await countCommentsForPost(activePost.shortcode) : 0;
  const startedAt = Date.parse(checkpoint.created_at || checkpoint.discovery?.started_at || 0);
  const activeStartedAt = Date.parse(activePost?.active_scrape_started_at || activePost?.lease_started_at || 0);
  const now = Date.now();
  const runHours = Number.isFinite(startedAt) && startedAt > 0 ? Math.max((now - startedAt) / 3600000, 1 / 3600) : null;
  const collectionHours = Number.isFinite(activeStartedAt) && activeStartedAt > 0 ? Math.max((now - activeStartedAt) / 3600000, 1 / 3600) : null;
  const finishedPosts = posts.filter((post) => ["complete", "partial", "partial_unknown_target", "failed"].includes(post.status)).length;
  const lastEventTs = events.at(-1)?.ts || checkpoint.updated_at || null;
  return {
    active_shortcode: activePost?.shortcode ?? checkpoint.last_attempted_post ?? null,
    active_status: activePost?.status ?? null,
    active_captured_comments: activeCaptured,
    active_target_comment_count: activePost?.target_comment_count ?? activePost?.displayed_comment_count ?? null,
    active_target_comment_source: activePost?.target_comment_source ?? null,
    active_capture_rate_estimate: activePost?.target_comment_count ? Number((activeCaptured / activePost.target_comment_count).toFixed(4)) : null,
    total_saved_comments: totalComments,
    run_duration_ms: runHours ? Math.round(runHours * 3600000) : null,
    collection_duration_ms: collectionHours ? Math.round(collectionHours * 3600000) : null,
    comments_per_hour: runHours ? Math.round(totalComments / runHours) : null,
    posts_per_hour: runHours ? Number((finishedPosts / runHours).toFixed(2)) : null,
    finished_posts: finishedPosts,
    last_event_at: lastEventTs,
    freshness_label: freshnessLabel(lastEventTs)
  };
}

function freshnessLabel(isoTs) {
  const parsed = Date.parse(isoTs || "");
  if (!Number.isFinite(parsed)) return "unknown";
  const ageMs = Date.now() - parsed;
  if (ageMs < 5000) return "live";
  if (ageMs < 30000) return "fresh";
  if (ageMs < 120000) return "quiet";
  return "stale";
}

async function clearAll() {
  await Promise.all([
    clearStore("posts"),
    clearStore("comments"),
    clearStore("raw_post_records"),
    clearStore("events")
  ]);
  await chrome.storage.local.remove(CHECKPOINT_KEY);
  profileTabId = null;
}

async function closeActivePostTabs() {
  const tabIds = Array.from(activePostTabs);
  activePostTabs.clear();
  await Promise.all(tabIds.map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
}

async function loadCheckpoint() {
  const result = await chrome.storage.local.get(CHECKPOINT_KEY);
  return result[CHECKPOINT_KEY] ?? null;
}

async function saveCheckpoint(checkpoint) {
  checkpoint.updated_at = nowIso();
  await chrome.storage.local.set({ [CHECKPOINT_KEY]: checkpoint });
}

async function addEvent(type, detail) {
  await putRecord("events", {
    id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
    ts: nowIso(),
    type,
    detail
  });
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

async function putRecord(storeName, record) {
  return withStore(storeName, "readwrite", (store) => requestToPromise(store.put(record)));
}

async function putRecords(storeName, records) {
  if (!records.length) return;
  return withStore(storeName, "readwrite", (store) => {
    for (const record of records) store.put(record);
    return undefined;
  });
}

async function getRecord(storeName, key) {
  return withStore(storeName, "readonly", (store) => requestToPromise(store.get(key)));
}

async function getAllRecords(storeName) {
  return withStore(storeName, "readonly", (store) => requestToPromise(store.getAll()));
}

async function clearStore(storeName) {
  return withStore(storeName, "readwrite", (store) => requestToPromise(store.clear()));
}

async function countStore(storeName) {
  return withStore(storeName, "readonly", (store) => requestToPromise(store.count()));
}

async function countCommentsForPost(shortcode) {
  return withStore("comments", "readonly", (store) => {
    if (store.indexNames.contains("post_shortcode")) {
      return requestToPromise(store.index("post_shortcode").count(shortcode));
    }
    return requestToPromise(store.getAll()).then((comments) => comments.filter((comment) => comment.post_shortcode === shortcode).length);
  });
}

function makeCommentId(shortcode, comment) {
  return `dogist_${shortcode}_${hashText([
    shortcode,
    normalize(comment.author),
    normalize(comment.text),
    normalize(comment.posted_at)
  ].join("\n")).slice(0, 16)}`;
}

function compactDetail(detail) {
  if (!detail) return null;
  const comments = detail.comments_data ?? [];
  const total = Number(detail.comments_data_total ?? detail.quality?.comments_found ?? comments.length);
  return {
    ...detail,
    comments_data: comments.slice(0, 5),
    comments_data_truncated: Math.max(0, comments.length - 5),
    comments_data_total: Number.isFinite(total) ? total : comments.length
  };
}

function normalizeOptions(rawOptions) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const handleFromProfile = normalizeCreatorHandle(options.profileUrl || "");
  options.creatorHandle = normalizeCreatorHandle(options.creatorHandle || handleFromProfile || DEFAULT_CREATOR_HANDLE);
  options.profileUrl = normalizeProfileUrl(options.profileUrl, options.creatorHandle);
  options.platform = PLATFORM;
  options.maxPosts = Number.isInteger(Number(options.maxPosts)) && Number(options.maxPosts) > 0 ? Number(options.maxPosts) : null;
  const rawPreload = options.preloadTabs ?? options.postConcurrency;
  options.preloadTabs = clampPreloadTabs(rawPreload, 5);
  options.postConcurrency = options.preloadTabs;
  options.scrapeMode = options.scrapeMode === "coverage" ? "coverage" : "exhaustive";
  options.coverageMaxComments = Math.max(1, Number(options.coverageMaxComments) || DEFAULT_OPTIONS.coverageMaxComments);
  options.coverageMaxMinutes = Math.max(1, Number(options.coverageMaxMinutes) || DEFAULT_OPTIONS.coverageMaxMinutes);
  options.coverageMinRate = Math.max(0, Math.min(1, Number(options.coverageMinRate) || DEFAULT_OPTIONS.coverageMinRate));
  options.noNewCommentRounds = Math.max(1, Number(options.noNewCommentRounds) || DEFAULT_OPTIONS.noNewCommentRounds);
  options.maxPostMs = Math.max(30000, Number(options.maxPostMs) || DEFAULT_OPTIONS.maxPostMs);
  options.postStepMaxMs = Math.max(5000, Math.min(25000, Number(options.postStepMaxMs) || DEFAULT_OPTIONS.postStepMaxMs));
  options.activeHydrateMs = Math.max(500, Number(options.activeHydrateMs) || DEFAULT_OPTIONS.activeHydrateMs);
  options.scrollDelayFastMs = Math.max(100, Number(options.scrollDelayFastMs) || DEFAULT_OPTIONS.scrollDelayFastMs);
  options.scrollDelaySlowMs = Math.max(options.scrollDelayFastMs, Number(options.scrollDelaySlowMs) || DEFAULT_OPTIONS.scrollDelaySlowMs);
  options.scrollDelayMs = Math.max(options.scrollDelayFastMs, Number(options.scrollDelayMs) || DEFAULT_OPTIONS.scrollDelayMs);
  options.profileNoNewRounds = Math.max(5, Number(options.profileNoNewRounds) || DEFAULT_OPTIONS.profileNoNewRounds);
  options.skipCoveredPosts = rawOptions.skipCoveredPosts !== false;
  options.skipUnknownTargetPosts = rawOptions.skipUnknownTargetPosts === true;
  return options;
}

function clampPreloadTabs(value, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(DEFAULT_OPTIONS.preloadTabs, max);
  return Math.max(1, Math.min(Math.round(parsed), max));
}

function normalizeCreatorHandle(value) {
  const text = normalize(value).replace(/^@/, "");
  if (!text) return "";
  try {
    const url = new URL(text, "https://www.instagram.com");
    if (url.hostname.includes("instagram.com")) {
      const first = url.pathname.split("/").filter(Boolean)[0];
      if (first && !["p", "reel", "reels", "tv", "explore", "accounts"].includes(first)) {
        return first.toLowerCase();
      }
    }
  } catch {
    // Fall through to plain handle parsing.
  }
  const match = text.match(/[A-Za-z0-9._]{1,30}/);
  return match ? match[0].toLowerCase() : "";
}

function normalizeProfileUrl(value, creatorHandle) {
  const handle = normalizeCreatorHandle(value) || normalizeCreatorHandle(creatorHandle) || DEFAULT_CREATOR_HANDLE;
  return profileUrlFromHandle(handle);
}

function profileUrlFromHandle(handle) {
  return `https://www.instagram.com/${normalizeCreatorHandle(handle) || DEFAULT_CREATOR_HANDLE}/`;
}

function withTimeout(promise, timeoutMs, code) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseInstagramPostUrl(href) {
  try {
    const url = new URL(href, "https://www.instagram.com");
    const parts = url.pathname.split("/").filter(Boolean);
    const kindIndex = parts.findIndex((part) => part === "p" || part === "reel" || part === "reels" || part === "tv");
    if (kindIndex === -1) return null;
    const kind = parts[kindIndex] === "reels" ? "reel" : parts[kindIndex];
    const shortcode = parts[kindIndex + 1];
    if (!shortcode || !/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
    const navigationPath = `/${parts.slice(0, kindIndex + 2).join("/")}/`;
    return {
      kind,
      shortcode,
      url: `https://www.instagram.com${navigationPath}`,
      canonical_url: `https://www.instagram.com/${kind}/${shortcode}/`
    };
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
