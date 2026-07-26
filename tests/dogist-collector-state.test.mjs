import test from "node:test";
import assert from "node:assert/strict";
import state from "../collector/state.js";

test("fresh running heartbeat is treated as recoverable worker activity", () => {
  const nowMs = Date.parse("2026-06-20T12:01:00.000Z");
  const checkpoint = {
    status: "running",
    heartbeat_at: "2026-06-20T12:00:15.000Z"
  };

  assert.equal(
    state.classifyRunningCheckpointRecovery(checkpoint, { nowMs, graceMs: 90_000 }),
    "recent_heartbeat"
  );
});

test("stale running heartbeat becomes a resumable interruption", () => {
  const nowMs = Date.parse("2026-06-20T12:03:00.000Z");
  const checkpoint = {
    status: "running",
    heartbeat_at: "2026-06-20T12:00:15.000Z"
  };

  assert.equal(
    state.classifyRunningCheckpointRecovery(checkpoint, { nowMs, graceMs: 90_000 }),
    "stale_heartbeat"
  );
});

test("manual stopped checkpoints are not recovered as worker restarts", () => {
  const checkpoint = {
    status: "stopped",
    stop_reason: "user_stop_requested",
    heartbeat_at: "2026-06-20T12:00:15.000Z"
  };

  assert.equal(state.classifyRunningCheckpointRecovery(checkpoint), "not_running");
});

test("late messages from old run sessions are rejected", () => {
  const checkpoint = {
    status: "running",
    active_run_session_id: "new-session"
  };

  assert.equal(state.isMessageFromCurrentRun("old-session", checkpoint), false);
  assert.equal(state.isMessageFromCurrentRun("new-session", checkpoint), true);
});

test("messages from stopped sessions are rejected even when ids match", () => {
  const checkpoint = {
    status: "stopped",
    active_run_session_id: "old-session"
  };

  assert.equal(state.isMessageFromCurrentRun("old-session", checkpoint), false);
});

test("interruption marker preserves resume-oriented reason", () => {
  const checkpoint = { status: "running", stop_reason: null, active_workers: 2 };

  state.markCheckpointInterrupted(checkpoint, "2026-06-20T12:03:00.000Z");

  assert.equal(checkpoint.status, "stopped");
  assert.equal(checkpoint.stop_reason, state.WORKER_INTERRUPTED_REASON);
  assert.equal(checkpoint.recovery_state, "interrupted_resume_available");
  assert.equal(checkpoint.active_workers, 0);
});
