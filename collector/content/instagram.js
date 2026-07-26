(function () {
  if (globalThis.__dogistCollectorContentScriptLoaded) return;
  globalThis.__dogistCollectorContentScriptLoaded = true;
  const POST_DETAIL_STEP_DEFAULT_MS = 20000;
  const postDetailSessions = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message.type === "DOGIST_PROFILE_DISCOVERY_ROUND") {
        sendResponse(await profileDiscoveryRound(message));
        return;
      }
      if (message.type === "DOGIST_PROFILE_INDEX" || message.type === "DOGIST_DISCOVERY_ROUND") {
        sendResponse(await profileIndex(message));
        return;
      }
      if (message.type === "DOGIST_POST_HYDRATE") {
        sendResponse(await postHydrate(message));
        return;
      }
      if (message.type === "DOGIST_POST_DETAIL_STEP") {
        sendResponse(await postDetailStep(message));
        return;
      }
      if (message.type === "DOGIST_POST_DETAIL_ABORT") {
        postDetailSessions.delete(postDetailSessionKey(message));
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "DOGIST_POST_DETAIL" || message.type === "DOGIST_POST_ROUND") {
        sendResponse(await postDetail(message));
      }
    })().catch((error) => {
      sendResponse({
        limitation: "content_script_error",
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return true;
  });

  async function profileIndex(message) {
    const limitation = detectLimitation();
    if (limitation) return { limitation, posts: [], hrefs: [], seen: 0 };

    const waitMs = Math.max(Number(message.waitMs) || 5000, 0);
    await waitFor(() => collectProfileLinks().posts.length > 0, waitMs, 250);

    const result = collectProfileLinks();
    return {
      limitation: null,
      posts: result.posts,
      hrefs: result.hrefs,
      seen: result.posts.length,
      scroll_top: window.scrollY,
      scroll_height: document.body?.scrollHeight ?? 0
    };
  }

  async function profileDiscoveryRound(message) {
    const limitation = detectLimitation();
    if (limitation) return { limitation, posts: [], hrefs: [], seen: 0 };

    const waitMs = Math.max(Number(message.waitMs) || 5000, 0);
    await waitFor(() => collectProfileLinks().posts.length > 0, waitMs, 250);

    const before = collectProfileLinks();
    const scrollTopBefore = window.scrollY;
    const scrollHeightBefore = document.body?.scrollHeight ?? 0;
    const scrollByPx = Number(message.scrollByPx) || Math.round(window.innerHeight * 1.35);

    window.scrollBy({ top: scrollByPx, behavior: "smooth" });
    await sleep(Number(message.scrollDelayMs) || 1600);

    const after = collectProfileLinks();
    const merged = mergePosts(before.posts, after.posts);
    return {
      limitation: detectLimitation(),
      posts: merged,
      hrefs: [...before.hrefs, ...after.hrefs].slice(0, 40),
      seen: merged.length,
      scroll_top_before: scrollTopBefore,
      scroll_height_before: scrollHeightBefore,
      scroll_top_after: window.scrollY,
      scroll_height_after: document.body?.scrollHeight ?? 0
    };
  }

  async function postHydrate(message) {
    const limitation = detectLimitation();
    if (limitation) return { limitation, detail: null, diagnostics: hydrateDiagnostics(null, null) };

    const hydrateMs = Math.max(500, Number(message.hydrateMs) || 3000);
    await waitForPostReady(hydrateMs);
    const expandResult = await clickViewAllComments(3);
    const scrollContainer = findCommentScrollContainer();
    const containerSelector = scrollContainer ? generateUniqueSelector(scrollContainer) : undefined;
    const targetInfo = extractDisplayedCommentCountInfo(expandResult.visibleCount);
    const detail = extractInstagramDetail({
      selectorPathUsed: containerSelector || "window",
      expandAttempts: expandResult.attempts,
      extractionMode: "hydrate",
      displayedCommentCountHint: targetInfo.count,
      displayedCommentCountSource: targetInfo.source
    });
    detail.quality = {
      ...(detail.quality || {}),
      visibility_state: document.visibilityState,
      scroll_target: containerSelector ? "comment_container" : "window",
      target_comment_count: reliableTargetCount(targetInfo) ?? detail.quality?.target_comment_count ?? null,
      target_comment_source: targetInfo.source ?? detail.quality?.target_comment_source ?? null
    };

    await emitCommentBatch({ detail, workerId: message.workerId, runSessionId: message.run_session_id ?? message.runSessionId, batchId: "hydrate-0" });
    return {
      limitation: detectLimitation(),
      detail,
      diagnostics: hydrateDiagnostics(detail, containerSelector)
    };
  }

  async function postDetail(message) {
    const limitation = detectLimitation();
    if (limitation) return { limitation, detail: null };

    await waitForPostReady(message.mode === "retry" ? 3500 : 2200);
    const expandResult = await clickViewAllComments(4);
    const scrollContainer = findCommentScrollContainer();
    const containerSelector = scrollContainer ? generateUniqueSelector(scrollContainer) : undefined;
    const targetInfo = extractDisplayedCommentCountInfo(expandResult.visibleCount);

    const captureResult = await captureCommentsExhaustively({
      maxPostMs: Number(message.maxPostMs) || 480000,
      noNewCommentRounds: Number(message.noNewCommentRounds) || 8,
      scrollDelayMs: Number(message.scrollDelayMs) || 1200,
      scrollDelayFastMs: Number(message.scrollDelayFastMs) || 250,
      scrollDelaySlowMs: Number(message.scrollDelaySlowMs) || 1200,
      settlementMs: 250,
      requireVisible: Boolean(message.requireVisible),
      workerId: message.workerId,
      scrapeMode: message.scrapeMode === "coverage" ? "coverage" : "exhaustive",
      coverageMaxComments: Number(message.coverageMaxComments) || 250,
      coverageMaxMs: Number(message.coverageMaxMs) || 240000,
      coverageMinRate: Number(message.coverageMinRate) || 0.5,
      detailOptions: {
        selectorPathUsed: containerSelector || "window",
        expandAttempts: expandResult.attempts,
        extractionMode: message.mode || "exhaustive",
        displayedCommentCountHint: targetInfo.count,
        displayedCommentCountSource: targetInfo.source
      }
    });

    const detail = captureResult.detail;
    detail.quality = {
      ...(detail.quality || {}),
      scroll_target: captureResult.scrollResult.selector === "window" ? "window" : "comment_container",
      scroll_result: captureResult.scrollResult,
      stop_reason: captureResult.stopReason,
      target_comment_count: reliableTargetCount(targetInfo) ?? detail.quality?.target_comment_count ?? null,
      target_comment_source: targetInfo.source ?? detail.quality?.target_comment_source ?? null
    };
    return { limitation: null, detail };
  }

  async function postDetailStep(message) {
    const limitation = detectLimitation();
    if (limitation) return { limitation, detail: null, done: true, stopReason: limitation };

    const key = postDetailSessionKey(message);
    let session = postDetailSessions.get(key);
    if (!session) {
      session = await createPostDetailSession(message, key);
      postDetailSessions.set(key, session);
    }

    const result = await runPostDetailSessionStep(session, message);
    if (result.done) postDetailSessions.delete(key);
    return result;
  }

  function postDetailSessionKey(message) {
    const runSessionId = message.run_session_id ?? message.runSessionId ?? "legacy";
    const workerId = message.workerId ?? message.worker_id ?? "worker";
    const shortcode = message.postShortcode || parseCurrentPostPath().shortcode || "post";
    return `${runSessionId}:${workerId}:${shortcode}`;
  }

  async function createPostDetailSession(message, key) {
    await waitForPostReady(message.mode === "retry" ? 3500 : 2200);
    const expandResult = await clickViewAllComments(4);
    const scrollContainer = findCommentScrollContainer();
    const containerSelector = scrollContainer ? generateUniqueSelector(scrollContainer) : undefined;
    const targetInfo = extractDisplayedCommentCountInfo(expandResult.visibleCount);
    const detailOptions = {
      selectorPathUsed: containerSelector || "window",
      expandAttempts: expandResult.attempts,
      extractionMode: message.mode || "exhaustive",
      displayedCommentCountHint: targetInfo.count,
      displayedCommentCountSource: targetInfo.source
    };

    return {
      key,
      runSessionId: message.run_session_id ?? message.runSessionId ?? null,
      workerId: message.workerId ?? message.worker_id ?? null,
      postShortcode: message.postShortcode || parseCurrentPostPath().shortcode || null,
      started: Date.now(),
      maxPostMs: Number(message.maxPostMs) || 480000,
      noNewCommentRounds: Number(message.noNewCommentRounds) || 8,
      scrollDelayMs: Number(message.scrollDelayMs) || 1200,
      scrollDelayFastMs: Number(message.scrollDelayFastMs) || 250,
      scrollDelaySlowMs: Number(message.scrollDelaySlowMs) || 1200,
      settlementMs: 250,
      requireVisible: Boolean(message.requireVisible),
      scrapeMode: message.scrapeMode === "coverage" ? "coverage" : "exhaustive",
      coverageMaxComments: Number(message.coverageMaxComments) || 250,
      coverageMaxMs: Number(message.coverageMaxMs) || 240000,
      coverageMinRate: Number(message.coverageMinRate) || 0.5,
      detailOptions,
      merged: new Map(),
      snapshots: [],
      latestDetail: null,
      noNewRounds: 0,
      scrolls: 0,
      stopReason: "comments_exhausted_bottom_reached",
      lastSelector: detailOptions.selectorPathUsed || "window",
      lastScrollState: getScrollState(findCommentScrollContainer()),
      lastDomProgress: getCommentDomProgress(findCommentScrollContainer())
    };
  }

  async function runPostDetailSessionStep(session, message) {
    const stepStarted = Date.now();
    const stepMaxMs = Math.max(5000, Number(message.stepMaxMs) || POST_DETAIL_STEP_DEFAULT_MS);
    const stepComments = [];
    let done = false;

    while (Date.now() - session.started < session.maxPostMs && Date.now() - stepStarted < stepMaxMs) {
      const limitation = detectLimitation();
      if (limitation) {
        session.stopReason = limitation;
        done = true;
        break;
      }

      const currentScrollContainer = findCommentScrollContainer();
      const currentSelector = currentScrollContainer ? generateUniqueSelector(currentScrollContainer) : "window";
      session.lastSelector = currentSelector;
      const currentScrollState = getScrollState(currentScrollContainer);
      const currentDomProgress = getCommentDomProgress(currentScrollContainer);
      session.latestDetail = extractInstagramDetail({
        ...session.detailOptions,
        selectorPathUsed: currentSelector
      });

      if (session.requireVisible && document.visibilityState !== "visible") {
        session.stopReason = "active_visibility_lost";
        const snapshot = buildPostDetailSnapshot(session, currentScrollState, currentDomProgress, 0, {
          stop_reason: session.stopReason
        });
        session.snapshots.push(snapshot);
        await emitScrollSnapshot(snapshot, session.workerId, session.runSessionId);
        done = true;
        break;
      }

      const newComments = mergeDetailComments(session.merged, session.latestDetail);
      if (newComments.length > 0) {
        stepComments.push(...newComments);
        await emitCommentBatch({
          detail: { ...session.latestDetail, comments_data: newComments },
          workerId: session.workerId,
          runSessionId: session.runSessionId,
          batchId: `step-${session.scrolls}`
        });
      }

      const target = session.latestDetail.quality?.target_comment_count;
      const displayedTarget = session.latestDetail.quality?.displayed_comment_count_if_available ?? session.latestDetail.engagement?.comments ?? target ?? null;
      const snapshotBase = buildPostDetailSnapshot(session, currentScrollState, currentDomProgress, newComments.length, {
        displayed_comment_count: displayedTarget ?? null
      });

      if (target && session.merged.size >= target) {
        session.stopReason = "target_reached";
        const snapshot = { ...snapshotBase, stop_reason: session.stopReason, no_new_comment_rounds: session.noNewRounds };
        session.snapshots.push(snapshot);
        await emitScrollSnapshot(snapshot, session.workerId, session.runSessionId);
        done = true;
        break;
      }

      if (session.scrapeMode === "coverage") {
        const coverageTargetReached = Number.isFinite(Number(session.coverageMaxComments)) && session.merged.size >= Number(session.coverageMaxComments);
        const coverageRuntimeReached = Date.now() - session.started >= Math.min(session.maxPostMs, Number(session.coverageMaxMs) || session.maxPostMs);
        const coverageRateReached = target && Number.isFinite(Number(session.coverageMinRate)) && session.merged.size / target >= Number(session.coverageMinRate);
        if (coverageTargetReached || coverageRuntimeReached || coverageRateReached) {
          session.stopReason = coverageTargetReached
            ? "coverage_max_comments_reached"
            : coverageRateReached
              ? "coverage_min_rate_reached"
              : "coverage_max_runtime_reached";
          const snapshot = { ...snapshotBase, stop_reason: session.stopReason, no_new_comment_rounds: session.noNewRounds };
          session.snapshots.push(snapshot);
          await emitScrollSnapshot(snapshot, session.workerId, session.runSessionId);
          done = true;
          break;
        }
      }

      await clickViewAllComments(4);
      const scrollResult = scrollCommentTarget(currentScrollContainer, {
        displayedTarget,
        capturedCount: session.merged.size,
        noNewRounds: session.noNewRounds
      });
      session.scrolls++;
      const preMeasureDelay = newComments.length > 0 || currentDomProgress.permalinkCount > session.lastDomProgress.permalinkCount || scrollResult.didMove
        ? Math.max(100, Number(session.scrollDelayFastMs) || Math.min(session.scrollDelayMs, 250))
        : Math.max(session.scrollDelayMs, Number(session.scrollDelaySlowMs) || session.scrollDelayMs);
      await waitForCommentDomProgress(currentDomProgress, preMeasureDelay + session.settlementMs);

      const nextScrollContainer = findCommentScrollContainer();
      const nextScrollState = getScrollState(nextScrollContainer);
      const nextDomProgress = getCommentDomProgress(nextScrollContainer);
      const scrollTopChanged = Math.abs(nextScrollState.top - currentScrollState.top) > 2;
      const scrollHeightChanged = nextScrollState.height > currentScrollState.height + 2;
      const permalinkCountChanged = nextDomProgress.permalinkCount > currentDomProgress.permalinkCount;
      const rowCountChanged = nextDomProgress.rowCount > currentDomProgress.rowCount;
      const extractedChanged = newComments.length > 0;
      const scrollChanged = scrollResult.didMove || scrollTopChanged || scrollHeightChanged;
      const anyDomProgress = extractedChanged || permalinkCountChanged || rowCountChanged || scrollHeightChanged;
      session.lastScrollState = nextScrollState;
      session.lastDomProgress = nextDomProgress;

      if (anyDomProgress) {
        session.noNewRounds = 0;
      } else {
        session.noNewRounds++;
      }

      const snapshot = {
        ...snapshotBase,
        scroll_result: scrollResult,
        scroll_changed: scrollChanged,
        scroll_top_changed: scrollTopChanged,
        scroll_height_changed: scrollHeightChanged,
        permalink_count_changed: permalinkCountChanged,
        row_count_changed: rowCountChanged,
        adaptive_delay_ms: preMeasureDelay,
        next_scroll_top: nextScrollState.top,
        next_scroll_height: nextScrollState.height,
        next_distance_to_bottom: nextScrollState.distanceToBottom,
        next_near_bottom: nextScrollState.nearBottom,
        next_permalink_count: nextDomProgress.permalinkCount,
        next_row_count: nextDomProgress.rowCount,
        no_new_comment_rounds: session.noNewRounds
      };
      session.snapshots.push(snapshot);
      await emitScrollSnapshot(snapshot, session.workerId, session.runSessionId);

      if (session.noNewRounds >= session.noNewCommentRounds && nextScrollState.nearBottom && !scrollChanged && !permalinkCountChanged && !rowCountChanged) {
        session.stopReason = "comments_exhausted_bottom_reached";
        done = true;
        break;
      }
      if (session.noNewRounds >= session.noNewCommentRounds * 3 && !scrollChanged && !nextScrollState.nearBottom) {
        session.stopReason = "partial_scroll_stalled_before_bottom";
        done = true;
        break;
      }
    }

    if (!done && Date.now() - session.started >= session.maxPostMs) {
      session.stopReason = "max_post_runtime_reached";
      done = true;
    }

    const detail = buildPostDetailStepDetail(session, stepComments, done);
    if (done && session.lastSelector === "window") {
      window.scrollTo({ top: 0 });
      await sleep(300);
    }

    return {
      limitation: null,
      done,
      stopReason: done ? session.stopReason : "step_complete",
      detail,
      new_comments: stepComments.length,
      total_comments: session.merged.size,
      run_session_id: session.runSessionId,
      workerId: session.workerId,
      postShortcode: session.postShortcode
    };
  }

  function buildPostDetailSnapshot(session, scrollState, domProgress, newComments, extra = {}) {
    return {
      round: session.scrolls,
      shortcode: session.latestDetail?.shortcode ?? session.postShortcode,
      active_required: session.requireVisible,
      visibility_state: document.visibilityState,
      has_scroll_container: Boolean(findCommentScrollContainer()),
      selector: session.lastSelector,
      visible_comments: session.latestDetail?.comments_data?.length ?? 0,
      new_comments: newComments,
      merged_comments: session.merged.size,
      target_comment_count: session.latestDetail?.quality?.target_comment_count ?? null,
      displayed_comment_count: session.latestDetail?.quality?.displayed_comment_count_if_available ?? session.latestDetail?.engagement?.comments ?? null,
      permalink_count: domProgress.permalinkCount,
      permalink_delta: domProgress.permalinkCount - session.lastDomProgress.permalinkCount,
      row_count: domProgress.rowCount,
      scroll_top: scrollState.top,
      scroll_height: scrollState.height,
      scroll_client_height: scrollState.client,
      distance_to_bottom: scrollState.distanceToBottom,
      near_bottom: scrollState.nearBottom,
      ...extra
    };
  }

  function buildPostDetailStepDetail(session, stepComments, done) {
    session.latestDetail ||= extractInstagramDetail(session.detailOptions);
    const detail = {
      ...session.latestDetail,
      comments_data: stepComments
    };
    detail.quality = {
      ...(detail.quality || {}),
      comments_found: session.merged.size,
      stop_reason: done ? session.stopReason : "step_complete",
      scroll_result: {
        scrolls: session.scrolls,
        no_new_comment_rounds: session.noNewRounds,
        snapshots: done ? session.snapshots : session.snapshots.slice(-5),
        selector: session.lastSelector || "window",
        visibility_states: Array.from(new Set(session.snapshots.map((snapshot) => snapshot.visibility_state).filter(Boolean))),
        last_scroll_top: session.lastScrollState.top,
        last_scroll_height: session.lastScrollState.height,
        last_scroll_client_height: session.lastScrollState.client,
        last_distance_to_bottom: session.lastScrollState.distanceToBottom,
        last_near_bottom: session.lastScrollState.nearBottom,
        last_permalink_count: session.lastDomProgress.permalinkCount,
        last_row_count: session.lastDomProgress.rowCount
      }
    };
    detail.comments_data_total = session.merged.size;
    return detail;
  }

  function hydrateDiagnostics(detail, selectorPathUsed) {
    return {
      visibility_state: document.visibilityState,
      has_article: Boolean(document.querySelector("article")),
      has_scroll_container: Boolean(findCommentScrollContainer()),
      selector_path_used: selectorPathUsed || detail?.quality?.selector_path_used || null,
      likes: detail?.engagement?.likes ?? null,
      displayed_comment_count: detail?.quality?.target_comment_count ?? detail?.quality?.displayed_comment_count_if_available ?? null,
      repost_count: detail?.engagement?.reposts ?? null,
      comments_found: detail?.comments_data?.length ?? 0
    };
  }

  function collectProfileLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'));
    const hrefs = anchors.map((anchor) => anchor.href || anchor.getAttribute("href") || "").filter(Boolean);
    const byShortcode = new Map();
    hrefs.forEach((href, index) => {
      const parsed = parseInstagramPostUrl(href);
      if (!parsed || byShortcode.has(parsed.shortcode)) return;
      parsed.visible_index = index;
      byShortcode.set(parsed.shortcode, parsed);
    });
    return {
      posts: Array.from(byShortcode.values()),
      hrefs: hrefs.slice(0, 20)
    };
  }

  function mergePosts(...postLists) {
    const byShortcode = new Map();
    for (const posts of postLists) {
      for (const post of posts) {
        if (!post?.shortcode || byShortcode.has(post.shortcode)) continue;
        byShortcode.set(post.shortcode, post);
      }
    }
    return Array.from(byShortcode.values());
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

  function parseCurrentPostPath() {
    const parsed = parseInstagramPostUrl(window.location.href);
    if (parsed) return parsed;
    const match = window.location.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return { kind: "post", shortcode: "" };
    const kind = match[1] === "reels" ? "reel" : match[1];
    return { kind, shortcode: match[2], url: `https://www.instagram.com/${kind}/${match[2]}/` };
  }

  function detectLimitation() {
    const text = (document.body?.innerText || "").toLowerCase();
    const path = window.location.pathname.toLowerCase();
    if (path.includes("/accounts/login")) return "login_wall";
    if (path.includes("/challenge")) return "challenge_required";
    if (text.includes("log in to instagram") && !document.querySelector("article")) return "login_wall";
    if (text.includes("sorry, this page isn't available")) return "post_unavailable";
    if (text.includes("try again later")) return "rate_limited_try_again_later";
    if (text.includes("we restrict certain activity")) return "rate_limited_activity_restricted";
    if (text.includes("please wait a few minutes")) return "rate_limited_wait";
    return null;
  }

  async function waitForPostReady(timeoutMs) {
    const started = Date.now();
    let clicked = false;
    await waitFor(() => Boolean(document.querySelector("article")), Math.min(timeoutMs, 3000), 150);
    while (Date.now() - started < timeoutMs) {
      if (!clicked) {
        await clickViewAllComments(1);
        clicked = true;
      }
      const detail = extractInstagramDetail({ extractionMode: "readiness_probe" });
      const hasArticle = Boolean(document.querySelector("article"));
      const hasEngagement = Number(detail.engagement?.likes || 0) > 0 || Number(detail.engagement?.reposts || 0) > 0 || Number(detail.quality?.target_comment_count || 0) > 0;
      const hasComments = (detail.comments_data ?? []).length > 0;
      const hasCaption = normalizeText(detail.content_text).length > 0;
      if (hasArticle && (hasComments || (hasCaption && hasEngagement))) return true;
      await sleep(180);
    }
    return Boolean(document.querySelector("article"));
  }

  async function clickViewAllComments(maxClicks = 4) {
    const viewAllPattern = /view all\s+[\d,.]+[KMB]?\s+(comments?|replies)|view\s+[\d,.]+[KMB]?\s+replies|load more comments?/i;
    let attempts = 0;
    let visibleCount;

    for (let round = 0; round < maxClicks; round++) {
      let clickedThisRound = false;
      const clickables = document.querySelectorAll("a, button, span, div[role='button']");

      for (const el of clickables) {
        const text = normalizeText(el.textContent);
        if (!viewAllPattern.test(text)) continue;

        const commentCountMatch = text.match(/view all\s+([\d,.]+[KMB]?)\s+comments?/i);
        if (commentCountMatch?.[1]) {
          const parsed = parseShortNumber(commentCountMatch[1]);
          if (parsed > 0) visibleCount = parsed;
        }

        let target = el;
        if (el.tagName === "SPAN") target = el.closest("a, button, div[role='button']") || el;
        if (!target || target.dataset?.dogistExpandClicked === "1") continue;
        if (target.dataset) target.dataset.dogistExpandClicked = "1";
        target.click();
        attempts++;
        clickedThisRound = true;
        await sleep(1200);
        if (attempts >= maxClicks) break;
      }

      if (!clickedThisRound) break;
    }

    return { attempts, visibleCount };
  }

  async function captureCommentsExhaustively(opts) {
    const {
      maxPostMs,
      noNewCommentRounds,
      scrollDelayMs,
      scrollDelayFastMs,
      scrollDelaySlowMs,
      settlementMs,
      requireVisible,
      detailOptions,
      workerId,
      scrapeMode,
      coverageMaxComments,
      coverageMaxMs,
      coverageMinRate
    } = opts;
    const started = Date.now();
    const merged = new Map();
    const snapshots = [];
    let latestDetail = null;
    let noNewRounds = 0;
    let scrolls = 0;
    let stopReason = "comments_exhausted_bottom_reached";
    let lastSelector = detailOptions.selectorPathUsed || "window";
    let lastScrollState = getScrollState(findCommentScrollContainer());
    let lastDomProgress = getCommentDomProgress(findCommentScrollContainer());

    while (Date.now() - started < maxPostMs) {
      const limitation = detectLimitation();
      if (limitation) {
        stopReason = limitation;
        break;
      }

      const currentScrollContainer = findCommentScrollContainer();
      const currentSelector = currentScrollContainer ? generateUniqueSelector(currentScrollContainer) : "window";
      lastSelector = currentSelector;
      const currentScrollState = getScrollState(currentScrollContainer);
      const currentDomProgress = getCommentDomProgress(currentScrollContainer);
      latestDetail = extractInstagramDetail({
        ...detailOptions,
        selectorPathUsed: currentSelector
      });

      if (requireVisible && document.visibilityState !== "visible") {
        stopReason = "active_visibility_lost";
        const snapshot = {
          round: scrolls,
          shortcode: latestDetail.shortcode,
          active_required: requireVisible,
          visibility_state: document.visibilityState,
          has_scroll_container: Boolean(currentScrollContainer),
          selector: currentSelector,
          visible_comments: latestDetail.comments_data.length,
          new_comments: 0,
          merged_comments: merged.size,
          target_comment_count: latestDetail.quality?.target_comment_count ?? null,
          displayed_comment_count: latestDetail.quality?.displayed_comment_count_if_available ?? latestDetail.engagement?.comments ?? null,
          permalink_count: currentDomProgress.permalinkCount,
          distance_to_bottom: currentScrollState.distanceToBottom,
          near_bottom: currentScrollState.nearBottom,
          scroll_top: currentScrollState.top,
          scroll_height: currentScrollState.height,
          stop_reason: stopReason,
          no_new_comment_rounds: noNewRounds
        };
        snapshots.push(snapshot);
        await emitScrollSnapshot(snapshot, workerId);
        break;
      }

      const newComments = mergeDetailComments(merged, latestDetail);
      if (newComments.length > 0) {
        await emitCommentBatch({
          detail: { ...latestDetail, comments_data: newComments },
          workerId,
          batchId: `batch-${scrolls}`
        });
      }

      const target = latestDetail.quality?.target_comment_count;
      const displayedTarget = latestDetail.quality?.displayed_comment_count_if_available ?? latestDetail.engagement?.comments ?? target ?? null;
      const snapshotBase = {
        round: scrolls,
        shortcode: latestDetail.shortcode,
        active_required: requireVisible,
        visibility_state: document.visibilityState,
        has_scroll_container: Boolean(currentScrollContainer),
        selector: currentSelector,
        visible_comments: latestDetail.comments_data.length,
        new_comments: newComments.length,
        merged_comments: merged.size,
        target_comment_count: target ?? null,
        displayed_comment_count: displayedTarget ?? null,
        permalink_count: currentDomProgress.permalinkCount,
        permalink_delta: currentDomProgress.permalinkCount - lastDomProgress.permalinkCount,
        row_count: currentDomProgress.rowCount,
        scroll_top: currentScrollState.top,
        scroll_height: currentScrollState.height,
        scroll_client_height: currentScrollState.client,
        distance_to_bottom: currentScrollState.distanceToBottom,
        near_bottom: currentScrollState.nearBottom
      };

      if (target && merged.size >= target) {
        stopReason = "target_reached";
        const snapshot = { ...snapshotBase, stop_reason: stopReason, no_new_comment_rounds: noNewRounds };
        snapshots.push(snapshot);
        await emitScrollSnapshot(snapshot, workerId);
        break;
      }

      if (scrapeMode === "coverage") {
        const coverageTargetReached = Number.isFinite(Number(coverageMaxComments)) && merged.size >= Number(coverageMaxComments);
        const coverageRuntimeReached = Date.now() - started >= Math.min(maxPostMs, Number(coverageMaxMs) || maxPostMs);
        const coverageRateReached = target && Number.isFinite(Number(coverageMinRate)) && merged.size / target >= Number(coverageMinRate);
        if (coverageTargetReached || coverageRuntimeReached || coverageRateReached) {
          stopReason = coverageTargetReached
            ? "coverage_max_comments_reached"
            : coverageRateReached
              ? "coverage_min_rate_reached"
              : "coverage_max_runtime_reached";
          const snapshot = { ...snapshotBase, stop_reason: stopReason, no_new_comment_rounds: noNewRounds };
          snapshots.push(snapshot);
          await emitScrollSnapshot(snapshot, workerId);
          break;
        }
      }

      await clickViewAllComments(4);
      const scrollResult = scrollCommentTarget(currentScrollContainer, {
        displayedTarget,
        capturedCount: merged.size,
        noNewRounds
      });
      scrolls++;
      const preMeasureDelay = newComments.length > 0 || currentDomProgress.permalinkCount > lastDomProgress.permalinkCount || scrollResult.didMove
        ? Math.max(100, Number(scrollDelayFastMs) || Math.min(scrollDelayMs, 250))
        : Math.max(scrollDelayMs, Number(scrollDelaySlowMs) || scrollDelayMs);
      await waitForCommentDomProgress(currentDomProgress, preMeasureDelay + settlementMs);

      const nextScrollContainer = findCommentScrollContainer();
      const nextScrollState = getScrollState(nextScrollContainer);
      const nextDomProgress = getCommentDomProgress(nextScrollContainer);
      const scrollTopChanged = Math.abs(nextScrollState.top - currentScrollState.top) > 2;
      const scrollHeightChanged = nextScrollState.height > currentScrollState.height + 2;
      const permalinkCountChanged = nextDomProgress.permalinkCount > currentDomProgress.permalinkCount;
      const rowCountChanged = nextDomProgress.rowCount > currentDomProgress.rowCount;
      const extractedChanged = newComments.length > 0;
      const scrollChanged = scrollResult.didMove || scrollTopChanged || scrollHeightChanged;
      const anyDomProgress = extractedChanged || permalinkCountChanged || rowCountChanged || scrollHeightChanged;
      lastScrollState = nextScrollState;
      lastDomProgress = nextDomProgress;

      if (anyDomProgress) {
        noNewRounds = 0;
      } else {
        noNewRounds++;
      }

      const snapshot = {
        ...snapshotBase,
        scroll_result: scrollResult,
        scroll_changed: scrollChanged,
        scroll_top_changed: scrollTopChanged,
        scroll_height_changed: scrollHeightChanged,
        permalink_count_changed: permalinkCountChanged,
        row_count_changed: rowCountChanged,
        adaptive_delay_ms: preMeasureDelay,
        next_scroll_top: nextScrollState.top,
        next_scroll_height: nextScrollState.height,
        next_distance_to_bottom: nextScrollState.distanceToBottom,
        next_near_bottom: nextScrollState.nearBottom,
        next_permalink_count: nextDomProgress.permalinkCount,
        next_row_count: nextDomProgress.rowCount,
        no_new_comment_rounds: noNewRounds
      };
      snapshots.push(snapshot);
      await emitScrollSnapshot(snapshot, workerId);

      if (noNewRounds >= noNewCommentRounds && nextScrollState.nearBottom && !scrollChanged && !permalinkCountChanged && !rowCountChanged) {
        stopReason = "comments_exhausted_bottom_reached";
        break;
      }
      if (noNewRounds >= noNewCommentRounds * 3 && !scrollChanged && !nextScrollState.nearBottom) {
        stopReason = "partial_scroll_stalled_before_bottom";
        break;
      }
    }

    if (Date.now() - started >= maxPostMs) stopReason = "max_post_runtime_reached";
    latestDetail ||= extractInstagramDetail(detailOptions);
    latestDetail.comments_data = Array.from(merged.values());
    latestDetail.quality = {
      ...(latestDetail.quality || {}),
      comments_found: latestDetail.comments_data.length,
      stop_reason: stopReason
    };

    if (lastSelector === "window") {
      window.scrollTo({ top: 0 });
      await sleep(300);
    }

    return {
      detail: latestDetail,
      stopReason,
      scrollResult: {
        scrolls,
        no_new_comment_rounds: noNewRounds,
        snapshots,
        selector: lastSelector || "window",
        visibility_states: Array.from(new Set(snapshots.map((snapshot) => snapshot.visibility_state).filter(Boolean))),
        last_scroll_top: lastScrollState.top,
        last_scroll_height: lastScrollState.height,
        last_scroll_client_height: lastScrollState.client,
        last_distance_to_bottom: lastScrollState.distanceToBottom,
        last_near_bottom: lastScrollState.nearBottom,
        last_permalink_count: lastDomProgress.permalinkCount,
        last_row_count: lastDomProgress.rowCount
      }
    };
  }

  async function emitCommentBatch({ detail, workerId, runSessionId, batchId }) {
    if (!detail?.comments_data?.length) return;
    try {
      await chrome.runtime.sendMessage({
        type: "DOGIST_COMMENT_BATCH",
        shortcode: detail.shortcode,
        worker_id: workerId ?? null,
        run_session_id: runSessionId ?? null,
        batch_id: batchId,
        detail
      });
    } catch {
      // The final response still contains the merged comments, so a transient
      // batch message failure should not abort the post.
    }
  }

  async function emitScrollSnapshot(snapshot, workerId, runSessionId) {
    if (!snapshot) return;
    if (snapshot.round > 5 && snapshot.new_comments === 0 && snapshot.round % 5 !== 0 && !snapshot.stop_reason) return;
    try {
      await chrome.runtime.sendMessage({
        type: "DOGIST_POST_SCROLL_SNAPSHOT",
        shortcode: snapshot.shortcode ?? null,
        worker_id: workerId ?? null,
        run_session_id: runSessionId ?? null,
        snapshot
      });
    } catch {
      // Snapshot diagnostics are useful but should never interrupt scraping.
    }
  }

  function mergeDetailComments(merged, detail) {
    const added = [];
    for (const comment of detail?.comments_data ?? []) {
      const author = normalizeText(comment.author);
      const text = normalizeText(comment.text);
      if (!author || !text) continue;
      const signature = `${author.toLowerCase()}:::${text.toLowerCase()}`;
      if (merged.has(signature)) continue;
      merged.set(signature, comment);
      added.push(comment);
    }
    return added;
  }

  function extractInstagramDetail(opts = {}) {
    const current = parseCurrentPostPath();
    const articleEl = document.querySelector("article");
    const scrollContainer = findCommentScrollContainer();
    const comments = [];
    let caption = "";
    let author = "";
    let postVerified = false;
    let postedAt = normalizeText(document.querySelector("time[datetime]")?.getAttribute("datetime"));
    let selectorUsed = "";
    let failureReason;
    const commentCountInfo = extractDisplayedCommentCountInfo(opts.displayedCommentCountHint);

    if (articleEl) {
      const authorLink = articleEl.querySelector('a[href*="/"][role="link"], header a');
      if (authorLink) {
        const cleaned = cleanVerified(usernameFromLink(authorLink));
        author = cleaned.text;
        postVerified = cleaned.verified;
      }
      caption = normalizeText(articleEl.querySelector("h1")?.textContent || articleEl.querySelector('span[dir="auto"]')?.textContent);
    }

    author ||= extractAuthorFromMeta();
    const likes = extractPostLikeCount(articleEl, scrollContainer);
    const repostInfo = extractRepostCount(articleEl, scrollContainer, likes, commentCountInfo.count);

    try {
      if (scrollContainer) {
        const innerWrapper = scrollContainer.children?.[0];
        if (innerWrapper && innerWrapper.children.length >= 1) {
          const captionDiv = innerWrapper.children[0];
          const captionSpan = captionDiv?.querySelector('span[dir="auto"]');
          const rawCaption = captionSpan ? normalizeText(captionSpan.textContent) : "";

          if (!author && captionDiv) {
            for (const link of Array.from(captionDiv.querySelectorAll('a[href^="/"]'))) {
              const text = normalizeText(link.textContent);
              if (!isUsername(text)) continue;
              const cleaned = cleanVerified(usernameFromLink(link));
              author = cleaned.text;
              postVerified = cleaned.verified;
              break;
            }
          }
          if (rawCaption) caption = cleanCaptionText(rawCaption, author);

          const seenSignatures = new Set();
          for (let i = 1; i < innerWrapper.children.length; i++) {
            const commentsSection = innerWrapper.children[i];
            for (const comment of extractCommentsFromSection(commentsSection, author, caption)) {
              if (!comment) continue;
              const signature = `${comment.author.toLowerCase()}:::${comment.text.toLowerCase()}`;
              if (seenSignatures.has(signature)) continue;
              seenSignatures.add(signature);
              comments.push(comment);
            }
          }
        }
      }

      if (comments.length === 0 && articleEl) {
        const commentUl = findCommentUl(articleEl);
        if (commentUl) {
          selectorUsed = "article ul li";
          if (!caption) {
            caption = normalizeText(articleEl.querySelector("h1")?.textContent || articleEl.querySelector('span[dir="auto"]')?.textContent);
          }
          const seenSignatures = new Set();
          for (const li of Array.from(commentUl.querySelectorAll(":scope > li, :scope > div > li"))) {
            const liText = normalizeText(li.textContent);
            if (/^(load more|view \d+ repl|view replies|view all)/i.test(liText)) continue;
            if (liText.length < 3) continue;

            let commentAuthor = "unknown";
            let commentVerified = false;
            for (const link of Array.from(li.querySelectorAll('a[href^="/"]'))) {
              const linkText = normalizeText(link.textContent);
              if (!isUsername(linkText)) continue;
              const cleaned = cleanVerified(usernameFromLink(link));
              commentAuthor = cleaned.text;
              commentVerified = cleaned.verified;
              break;
            }

            let commentText = "";
            for (const span of Array.from(li.querySelectorAll('span[dir="auto"]'))) {
              const text = normalizeText(span.textContent);
              if (text === commentAuthor) continue;
              if (/^\d+[dhwmy]$/i.test(text)) continue;
              if (text.length > commentText.length) commentText = text;
            }

            if (!commentText) continue;
            if (commentAuthor === author && commentText === caption) continue;
            const signature = `${commentAuthor.toLowerCase()}:::${commentText.toLowerCase()}`;
            if (seenSignatures.has(signature)) continue;
            seenSignatures.add(signature);
            comments.push({ author: commentAuthor, text: commentText, likes: 0, verified: commentVerified || undefined });
          }
        }
      }
    } catch {
      failureReason = "comments_visible_but_not_extracted";
    }

    if (!failureReason && commentCountInfo.count != null && commentCountInfo.count > 0 && comments.length === 0) {
      failureReason = "comments_visible_but_not_extracted";
    }

    return {
      shortcode: current.shortcode,
      kind: current.kind,
      url: current.shortcode ? `https://www.instagram.com/${current.kind}/${current.shortcode}/` : window.location.href,
      author: author || "unknown",
      verified: postVerified || undefined,
      content_text: caption,
      posted_at: postedAt || null,
      engagement: {
        likes: likes || 0,
        comments: commentCountInfo.count ?? null,
        reposts: repostInfo.count ?? null
      },
      comments_data: comments,
      quality: {
        comments_found: comments.length,
        displayed_comment_count_if_available: commentCountInfo.count ?? null,
        target_comment_count: reliableTargetCount(commentCountInfo),
        target_comment_source: commentCountInfo.source ?? null,
        repost_count_source: repostInfo.source ?? null,
        selector_path_used: opts.selectorPathUsed || selectorUsed || undefined,
        expand_attempts: opts.expandAttempts,
        extraction_mode: opts.extractionMode || "exhaustive",
        failure_reason: failureReason,
        has_scroll_container: Boolean(scrollContainer)
      }
    };
  }

  function extractCommentsFromSection(section, postAuthor, caption) {
    const comments = [];
    const seenRows = new WeakSet();
    const permalinkAnchors = Array.from(section.querySelectorAll('a[href*="/c/"]'));
    let lastTopLevelCommentId = null;

    for (const permalink of permalinkAnchors) {
      const row = findCommentRowFromPermalink(permalink);
      if (!row || seenRows.has(row)) continue;
      seenRows.add(row);

      const comment = extractCommentFromRow(row, permalink, postAuthor, caption);
      if (!comment) continue;
      if (comment.depth > 0 && lastTopLevelCommentId && !comment.parent_comment_id) {
        comment.parent_comment_id = lastTopLevelCommentId;
      }
      if (!comment.depth && comment.native_comment_id) {
        lastTopLevelCommentId = comment.native_comment_id;
      }
      comments.push(comment);
    }

    if (comments.length > 0) return comments;

    return Array.from(section.querySelectorAll(":scope > div"))
      .map((wrapper) => extractCommentFromWrapper(wrapper, postAuthor, caption))
      .filter(Boolean);
  }

  function findCommentRowFromPermalink(permalink) {
    let node = permalink.parentElement;
    while (node && node !== document.body) {
      const permalinkCount = node.querySelectorAll('a[href*="/c/"]').length;
      if (permalinkCount === 1 && findCommentAuthorLink(node, permalink) && findCommentTextInRow(node, permalink)) {
        return node;
      }
      if (permalinkCount > 1) return null;
      node = node.parentElement;
    }
    return null;
  }

  function extractCommentFromRow(row, permalink, postAuthor, caption) {
    const authorLink = findCommentAuthorLink(row, permalink);
    if (!authorLink) return null;

    const cleaned = cleanVerified(usernameFromLink(authorLink));
    const commentAuthor = cleaned.text;
    if (!commentAuthor || commentAuthor === "unknown") return null;

    const commentText = findCommentTextInRow(row, permalink, commentAuthor);
    if (!commentText) return null;
    if (commentAuthor === postAuthor && commentText === caption) return null;

    const nativeCommentId = extractNativeCommentId(permalink);

    return {
      author: commentAuthor,
      text: commentText,
      likes: extractCommentLikes(row),
      verified: cleaned.verified || undefined,
      native_comment_id: nativeCommentId || undefined,
      comment_permalink: absoluteUrl(permalink.getAttribute("href") || permalink.href) || undefined,
      depth: inferCommentDepth(row),
      parent_comment_id: undefined
    };
  }

  function findCommentAuthorLink(row, permalink) {
    const links = Array.from(row.querySelectorAll('a[href^="/"]'));
    const beforePermalink = links.filter((link) => {
      if (link === permalink) return false;
      if (isCommentPermalink(link)) return false;
      const href = link.getAttribute("href") || "";
      if (!/^\/[A-Za-z0-9._]{1,30}\/?$/.test(href)) return false;
      const text = normalizeText(link.textContent);
      if (text.startsWith("@")) return false;
      if (!isUsername(text || usernameFromLink(link))) return false;
      return Boolean(link.compareDocumentPosition(permalink) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    return beforePermalink[0] || null;
  }

  function findCommentTextInRow(row, permalink, commentAuthor = "") {
    let commentText = "";
    for (const span of Array.from(row.querySelectorAll('span[dir="auto"]'))) {
      const text = normalizeText(span.textContent);
      if (!isCommentTextCandidate(text, commentAuthor)) continue;
      if (span.closest("a") && span.closest("a") !== permalink && !text.startsWith("@")) continue;
      if (!(permalink.compareDocumentPosition(span) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (text.length > commentText.length) commentText = text;
    }
    return commentText;
  }

  function isCommentTextCandidate(text, commentAuthor = "") {
    if (!text) return false;
    if (text === commentAuthor) return false;
    if (cleanVerified(text).text === commentAuthor) return false;
    if (/^\d+[dhwmy]$/i.test(text)) return false;
    if (/^\d+ likes?$/i.test(text)) return false;
    if (/^(reply|see translation)$/i.test(text)) return false;
    if (/^(view all|hide all)\s+\d+/i.test(text)) return false;
    return true;
  }

  function extractCommentLikes(row) {
    for (const span of Array.from(row.querySelectorAll("span"))) {
      const text = normalizeText(span.textContent);
      const match = text.match(/^(\d[\d,]*)\s*likes?$/i);
      if (match?.[1]) return Number.parseInt(match[1].replace(/,/g, ""), 10);
    }
    return 0;
  }

  function inferCommentDepth(row) {
    const scrollContainer = findCommentScrollContainer();
    if (!scrollContainer) return 0;
    const rowLeft = row.getBoundingClientRect().left;
    const containerLeft = scrollContainer.getBoundingClientRect().left;
    return rowLeft - containerLeft > 80 ? 1 : 0;
  }

  function isCommentPermalink(link) {
    const href = link.getAttribute("href") || "";
    return /\/c\/\d+\/?/.test(href);
  }

  function extractNativeCommentId(permalink) {
    const href = permalink?.getAttribute("href") || permalink?.href || "";
    return href.match(/\/c\/([^/?#]+)\/?/)?.[1] ?? "";
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, window.location.origin).href;
    } catch {
      return href;
    }
  }

  function extractCommentFromWrapper(wrapper, postAuthor, caption) {
    const wrapperText = normalizeText(wrapper.textContent);
    if (wrapperText.length < 3) return null;

    let commentAuthor = "unknown";
    let rawAuthorText = "";
    let commentVerified = false;
    for (const link of Array.from(wrapper.querySelectorAll('a[href^="/"]'))) {
      const linkText = normalizeText(link.textContent);
      if (!isUsername(linkText)) continue;
      const cleaned = cleanVerified(usernameFromLink(link));
      commentAuthor = cleaned.text;
      rawAuthorText = linkText;
      commentVerified = cleaned.verified;
      break;
    }

    let commentText = "";
    for (const span of Array.from(wrapper.querySelectorAll('span[dir="auto"]'))) {
      const text = normalizeText(span.textContent);
      if (text === rawAuthorText) continue;
      if (!isCommentTextCandidate(text, commentAuthor)) continue;
      if (text.length > commentText.length) commentText = text;
    }

    if (!commentText) return null;
    if (commentAuthor === postAuthor && commentText === caption) return null;

    return {
      author: commentAuthor,
      text: commentText,
      likes: extractCommentLikes(wrapper),
      verified: commentVerified || undefined,
      depth: 0
    };
  }

  function findCommentScrollContainer() {
    const candidates = Array.from(document.querySelectorAll("div"))
      .filter((div) => {
        const style = getComputedStyle(div);
        const canScroll = div.scrollHeight > div.clientHeight + 20 || style.overflowY === "auto" || style.overflowY === "scroll";
        return (
          canScroll &&
          div.clientHeight > 180 &&
          div.clientHeight <= window.innerHeight &&
          div.querySelector('span[dir="auto"]') &&
          div.querySelector("time[datetime]")
        );
      })
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    if (candidates[0]) return candidates[0];
    return findScrollableContainer("time[datetime]");
  }

  function findScrollableContainer(nearSelector) {
    const near = document.querySelector(nearSelector);
    if (near) {
      let el = near.parentElement;
      while (el && el !== document.body) {
        const style = getComputedStyle(el);
        if ((style.overflowY === "auto" || style.overflowY === "scroll" || el.scrollHeight > el.clientHeight + 20) && el.clientHeight > 180) {
          return el;
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  async function waitForCommentDomProgress(previous, timeoutMs) {
    const timeout = Math.max(100, Number(timeoutMs) || 300);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const current = getCommentDomProgress(findCommentScrollContainer());
      if (current.permalinkCount > previous.permalinkCount || current.rowCount > previous.rowCount || current.height > previous.height + 2) {
        return true;
      }
      await sleep(80);
    }
    return false;
  }

  function getCommentDomProgress(scrollContainer) {
    const root = scrollContainer || findCommentScrollContainer();
    const scope = root || document;
    const permalinkCount = new Set(Array.from(scope.querySelectorAll('a[href*="/c/"]')).map((anchor) => anchor.href || anchor.getAttribute("href") || "")).size;
    const rowCount = root?.children?.[0]
      ? Array.from(root.children[0].children ?? []).slice(1).reduce((count, section) => count + section.querySelectorAll(":scope > div").length, 0)
      : permalinkCount;
    const state = getScrollState(root);
    return {
      permalinkCount,
      rowCount,
      top: state.top,
      height: state.height,
      client: state.client,
      distanceToBottom: state.distanceToBottom,
      nearBottom: state.nearBottom
    };
  }

  function scrollCommentTarget(scrollContainer, opts = {}) {
    if (!scrollContainer) {
      const before = window.scrollY;
      const delta = Math.round(window.innerHeight * 1.35);
      window.scrollBy({ top: delta, behavior: "auto" });
      window.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: delta }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", code: "PageDown", bubbles: true, cancelable: true }));
      return { didMove: window.scrollY !== before, before, after: window.scrollY, target: "window", delta, bursts: 1 };
    }

    const before = scrollContainer.scrollTop;
    const displayedTarget = Number(opts.displayedTarget || 0);
    const capturedCount = Number(opts.capturedCount || 0);
    const remaining = Number.isFinite(displayedTarget) && displayedTarget > capturedCount ? displayedTarget - capturedCount : 0;
    const multiplier = displayedTarget >= 1000 || remaining >= 1000
      ? 2.6
      : displayedTarget >= 500 || remaining >= 500
        ? 2.2
        : displayedTarget >= 200 || remaining >= 200
          ? 1.8
          : 1.35;
    const bursts = displayedTarget >= 1000 || remaining >= 1000
      ? 3
      : displayedTarget >= 300 || remaining >= 300
        ? 2
        : 1;
    const delta = Math.max(540, Math.round(scrollContainer.clientHeight * multiplier));
    if (!scrollContainer.hasAttribute("tabindex")) scrollContainer.setAttribute("tabindex", "-1");
    try {
      scrollContainer.focus({ preventScroll: true });
    } catch {
      scrollContainer.focus();
    }
    for (let i = 0; i < bursts; i++) {
      scrollContainer.scrollBy?.({ top: delta, behavior: "auto" });
      scrollContainer.scrollTop = Math.min(scrollContainer.scrollHeight, scrollContainer.scrollTop + delta);
      scrollContainer.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: delta }));
      scrollContainer.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", code: "PageDown", bubbles: true, cancelable: true }));
    }
    const after = scrollContainer.scrollTop;
    return {
      didMove: after !== before,
      before,
      after,
      target: "comment_container",
      delta,
      bursts,
      scroll_height: scrollContainer.scrollHeight,
      client_height: scrollContainer.clientHeight
    };
  }

  function getScrollState(scrollContainer) {
    if (!scrollContainer) {
      const height = document.body?.scrollHeight ?? 0;
      const client = window.innerHeight || 0;
      const distanceToBottom = Math.max(0, height - client - window.scrollY);
      return { top: window.scrollY, height, client, distanceToBottom, nearBottom: distanceToBottom <= Math.max(120, client * 0.25) };
    }
    const distanceToBottom = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop);
    return {
      top: scrollContainer.scrollTop,
      height: scrollContainer.scrollHeight,
      client: scrollContainer.clientHeight,
      distanceToBottom,
      nearBottom: distanceToBottom <= Math.max(120, scrollContainer.clientHeight * 0.3)
    };
  }

  function generateUniqueSelector(el) {
    if (el.id) return `#${cssEscape(el.id)}`;
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      const children = Array.from(parent.children);
      const index = children.indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      current = parent;
    }
    return parts.join(" > ");
  }

  function findCommentUl(articleEl) {
    const uls = articleEl.querySelectorAll("ul");
    for (const ul of uls) {
      if (ul.closest("header") || ul.closest("nav")) continue;
      if (Array.from(ul.querySelectorAll("li")).some((li) => li.querySelector('span[dir="auto"]'))) {
        return ul;
      }
    }
    return null;
  }

  function extractDisplayedCommentCountInfo(hint) {
    if (Number.isFinite(Number(hint)) && Number(hint) > 0) {
      return { count: Number(hint), source: "view_all_comments_button" };
    }

    const text = document.body?.innerText || "";
    const viewAll = text.match(/view all\s+([\d,.]+[KMB]?)\s+comments?/i);
    if (viewAll?.[1]) return { count: parseShortNumber(viewAll[1]), source: "view_all_comments_text" };

    const ogDesc = normalizeText(document.querySelector('meta[property="og:description"]')?.getAttribute("content"));
    const meta = ogDesc.match(/([\d,.]+[KMB]?)\s+Comments?/i);
    if (meta?.[1]) return { count: parseShortNumber(meta[1]), source: "og_description_mixed_platform" };

    return { count: null, source: null };
  }

  function reliableTargetCount(info) {
    if (!info?.source) return null;
    if (info.source === "view_all_comments_button" || info.source === "view_all_comments_text") {
      return info.count ?? null;
    }
    return null;
  }

  function extractPostLikeCount(articleEl, scrollContainer) {
    const ogDesc = normalizeText(document.querySelector('meta[property="og:description"]')?.getAttribute("content"));
    const meta = ogDesc.match(/^([\d,.]+[KMB]?)\s+Likes?/i);
    if (meta?.[1]) return parseShortNumber(meta[1]);

    if (articleEl) {
      const sectionText = normalizeText(articleEl.querySelector("section")?.textContent);
      const legacyLikeMatch = sectionText.match(/([\d,.]+[KMB]?)\s*likes?/i);
      if (legacyLikeMatch?.[1]) return parseShortNumber(legacyLikeMatch[1]);
    }

    for (const span of Array.from(document.querySelectorAll("span"))) {
      if (scrollContainer?.contains(span)) continue;
      const text = normalizeText(span.textContent);
      const match = text.match(/^([\d,.]+[KMB]?)\s*likes?$/i);
      if (match?.[1]) return parseShortNumber(match[1]);
    }

    return 0;
  }

  function extractRepostCount(articleEl, scrollContainer, likes, comments) {
    const roots = [
      ...(articleEl ? Array.from(articleEl.querySelectorAll("section")) : []),
      ...Array.from(document.querySelectorAll("main section"))
    ].filter((root) => root && !scrollContainer?.contains(root));

    for (const root of roots) {
      const numbers = collectShortNumbers(normalizeText(root.textContent));
      for (let i = 0; i <= numbers.length - 3; i++) {
        if (roughlyEqual(numbers[i], likes) && roughlyEqual(numbers[i + 1], comments)) {
          return { count: numbers[i + 2], source: "engagement_bar_sequence" };
        }
      }
    }

    const bodyNumbers = collectShortNumbers(normalizeText(document.body?.innerText || ""));
    for (let i = 0; i <= bodyNumbers.length - 3; i++) {
      if (roughlyEqual(bodyNumbers[i], likes) && roughlyEqual(bodyNumbers[i + 1], comments)) {
        return { count: bodyNumbers[i + 2], source: "body_metric_sequence" };
      }
    }

    return { count: null, source: null };
  }

  function collectShortNumbers(text) {
    const numbers = [];
    const regex = /(^|[^\w.])(\d[\d,.]*\s*[KMB]?)(?=$|[^\w.])/gi;
    let match;
    while ((match = regex.exec(text))) {
      const parsed = parseShortNumber(match[2]);
      if (parsed > 0) numbers.push(parsed);
    }
    return numbers;
  }

  function roughlyEqual(a, b) {
    if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || Number(b) <= 0) return false;
    const diff = Math.abs(Number(a) - Number(b));
    return diff <= Math.max(50, Number(b) * 0.08);
  }

  function extractAuthorFromMeta() {
    const ogDesc = normalizeText(document.querySelector('meta[property="og:description"]')?.getAttribute("content"));
    const onMatch = ogDesc.match(/-\s*([A-Za-z0-9._]{1,30})\s+on\s+Instagram:/i);
    if (onMatch?.[1]) return onMatch[1];
    const byMatch = ogDesc.match(/^\d[\d,.]*\s+Likes,\s*\d[\d,.]*\s+Comments\s*-\s*([A-Za-z0-9._]{1,30})\s+on\s+Instagram:/i);
    if (byMatch?.[1]) return byMatch[1];
    return "";
  }

  function usernameFromLink(link) {
    const text = normalizeText(link.textContent);
    if (text.length > 0) return text;
    const href = link.getAttribute("href") || "";
    const match = href.match(/^\/([^/]+)\/?$/);
    return match ? match[1] : "unknown";
  }

  function isUsername(text) {
    const clean = normalizeText(text).replace(/Verified$/i, "");
    return (
      clean.length > 0 &&
      clean.length <= 30 &&
      !/\s/.test(clean) &&
      !/^\d+[dhwmy]$/i.test(clean) &&
      !/^\d+ likes?$/i.test(clean) &&
      !/^(reply|see translation|view all)$/i.test(clean)
    );
  }

  function cleanVerified(text) {
    const raw = normalizeText(text);
    const verified = /Verified$/i.test(raw);
    return {
      text: raw.replace(/Verified$/i, "").trim(),
      verified
    };
  }

  function cleanCaptionText(value, author) {
    let text = normalizeText(value);
    const cleanAuthor = normalizeText(author);
    if (cleanAuthor) {
      text = text.replace(new RegExp(`^${escapeRegExp(cleanAuthor)}(?:Verified)?\\s*\\d+[smhdwmy]\\s*`, "i"), "");
    }
    return text;
  }

  function parseShortNumber(value) {
    const text = normalizeText(value).replace(/,/g, "").replace(/\s+/g, "");
    const match = text.match(/([\d.]+)\s*([KMB])?/i);
    if (!match) return 0;
    const base = Number.parseFloat(match[1]);
    if (!Number.isFinite(base)) return 0;
    const suffix = (match[2] || "").toUpperCase();
    const multiplier = suffix === "K" ? 1000 : suffix === "M" ? 1000000 : suffix === "B" ? 1000000000 : 1;
    return Math.round(base * multiplier);
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(predicate, timeoutMs, intervalMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return true;
      await sleep(intervalMs);
    }
    return predicate();
  }
})();
