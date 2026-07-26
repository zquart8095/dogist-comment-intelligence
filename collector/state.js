(function attachDogistCollectorState(root, factory) {
  const state = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = state;
  }
  root.DogistCollectorState = state;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildDogistCollectorState() {
  const WORKER_RECOVERY_GRACE_MS = 90 * 1000;
  const WORKER_INTERRUPTED_REASON = "worker_interrupted_resume_available";

  function normalizeRunSessionId(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function classifyRunningCheckpointRecovery(checkpoint, options = {}) {
    if (!checkpoint || checkpoint.status !== "running") return "not_running";
    if (options.hasActiveRun) return "active_run";

    const graceMs = Number.isFinite(Number(options.graceMs))
      ? Number(options.graceMs)
      : WORKER_RECOVERY_GRACE_MS;
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const heartbeatMs = Date.parse(checkpoint.heartbeat_at || checkpoint.updated_at || "");

    if (Number.isFinite(heartbeatMs) && nowMs - heartbeatMs <= graceMs) {
      return "recent_heartbeat";
    }
    return "stale_heartbeat";
  }

  function isMessageFromCurrentRun(runSessionId, checkpoint) {
    const incoming = normalizeRunSessionId(runSessionId);
    if (!incoming) return true;
    if (!checkpoint || checkpoint.status !== "running") return false;
    return normalizeRunSessionId(checkpoint.active_run_session_id) === incoming;
  }

  function markCheckpointInterrupted(checkpoint, interruptedAt) {
    if (!checkpoint) return checkpoint;
    checkpoint.status = "stopped";
    checkpoint.stop_reason = WORKER_INTERRUPTED_REASON;
    checkpoint.interrupted_at = interruptedAt;
    checkpoint.recovery_state = "interrupted_resume_available";
    checkpoint.active_workers = 0;
    return checkpoint;
  }

  return {
    WORKER_RECOVERY_GRACE_MS,
    WORKER_INTERRUPTED_REASON,
    classifyRunningCheckpointRecovery,
    isMessageFromCurrentRun,
    markCheckpointInterrupted,
    normalizeRunSessionId
  };
});
