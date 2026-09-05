import test from "node:test";
import assert from "node:assert/strict";

import {
  applyItemFailure,
  canRetryItem,
  config,
  failureFormBody,
  isDueWithinLead,
  queueHasOverdueWork,
  queueNeedsWork,
  recoverStaleItems,
  statusCounts
} from "../netlify/functions/instagram-scheduler.mjs";
import { config as publishConfig } from "../netlify/functions/instagram-scheduler-publish.mjs";
import { config as recoveryConfig } from "../netlify/functions/instagram-scheduler-recovery.mjs";
import {
  parseDateParts,
  parseTimeParts,
  zonedIso
} from "../.agents/skills/magellan-etsy-instagram/scripts/schedule_instagram_posts.mjs";

test("scheduler uses separate prepare, publish, and recovery windows", () => {
  assert.equal(config.schedule, "15 1 * * *");
  assert.equal(publishConfig.schedule, "25 1 * * *");
  assert.equal(recoveryConfig.schedule, "40 1 * * *");
});

test("Pacific schedule timestamps preserve the intended local time and DST offset", () => {
  const time = parseTimeParts("09:30");
  assert.equal(
    zonedIso(parseDateParts("2026-08-25"), time, "America/Los_Angeles"),
    "2026-08-25T09:30:00-07:00"
  );
  assert.equal(
    zonedIso(parseDateParts("2026-12-15"), time, "America/Los_Angeles"),
    "2026-12-15T09:30:00-08:00"
  );
});

test("only due or in-progress work wakes the scheduler", () => {
  const now = new Date("2026-08-25T16:25:00Z");
  assert.equal(queueNeedsWork([{ instagram_status: "published" }], now), false);
  assert.equal(queueNeedsWork([{ instagram_status: "manual_review" }], now), false);
  assert.equal(queueNeedsWork([{
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T09:30:00-07:00"
  }], now), true);
  assert.equal(queueNeedsWork([{
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T12:30:00-07:00"
  }], now), false);
  assert.equal(queueNeedsWork([{ instagram_status: "container_created" }], now), true);
});

test("five-minute lead makes the next target actionable without waking later targets", () => {
  const now = new Date("2026-08-25T16:25:00Z");
  assert.equal(isDueWithinLead({
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T09:30:00-07:00"
  }, now), true);
  assert.equal(isDueWithinLead({
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T12:30:00-07:00"
  }, now), false);
});

test("recovery alerting distinguishes overdue work from future work", () => {
  const now = new Date("2026-08-25T16:40:00Z");
  assert.equal(queueHasOverdueWork([{
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T09:30:00-07:00"
  }], now), true);
  assert.equal(queueHasOverdueWork([{
    instagram_status: "scheduled",
    instagram_scheduled_publish_time: "2026-08-25T12:30:00-07:00"
  }], now), false);
  assert.equal(queueHasOverdueWork([{
    instagram_status: "container_created"
  }], now), true);
});

test("item failures stop after two attempts and ambiguous publishes require review", () => {
  const now = new Date("2026-08-25T16:30:00Z");
  const retryable = { instagram_status: "container_checking", instagram_container_id: "container-1" };
  assert.equal(applyItemFailure(retryable, new Error("temporary"), now), "container_created");
  assert.equal(retryable.instagram_failure_count, 1);

  assert.equal(applyItemFailure(retryable, new Error("again"), now), "failed");
  assert.equal(retryable.instagram_failure_count, 2);

  const ambiguous = { instagram_status: "publish_requested" };
  assert.equal(applyItemFailure(ambiguous, new Error("unknown publish result"), now), "manual_review");
});

test("only retry-safe failures receive the single automatic retry", () => {
  assert.equal(canRetryItem({ instagram_status: "scheduled" }, new Error("temporary")), true);
  assert.equal(canRetryItem({ instagram_status: "publish_requested" }, new Error("ambiguous")), false);
  assert.equal(canRetryItem({ instagram_status: "scheduled" }, { terminal: true }), false);
});

test("final failure email uses the detected Netlify form", () => {
  const body = new URLSearchParams(failureFormBody({
    event: "scheduler_failure",
    message: "Meta timed out",
    item_id: "post-1",
    status: "failed",
    failure_count: 2,
    circuit_status: "closed",
    created_at: "2026-08-25T16:30:00.000Z"
  }));
  assert.equal(body.get("form-name"), "instagram-scheduler-failure");
  assert.equal(body.get("attempts"), "2");
  assert.equal(body.get("item_id"), "post-1");
});

test("stale work has a hard recovery ceiling", () => {
  const now = new Date("2026-08-25T16:30:00Z");
  const queue = [{
    id: "post-1",
    instagram_status: "container_checking",
    instagram_work_started_at: "2026-08-25T12:00:00Z",
    instagram_recovery_count: 2
  }];
  assert.deepEqual(recoverStaleItems(queue, now), { recovered: [], failed: ["post-1"] });
  assert.equal(queue[0].instagram_status, "failed");
});

test("the recovery window reclaims work older than ten minutes", () => {
  const now = new Date("2026-08-26T01:40:00Z");
  const queue = [{
    id: "post-1",
    instagram_status: "container_checking",
    instagram_work_started_at: "2026-08-26T01:25:00Z",
    instagram_recovery_count: 0,
    instagram_container_id: "container-1"
  }];
  assert.deepEqual(recoverStaleItems(queue, now), { recovered: ["post-1"], failed: [] });
  assert.equal(queue[0].instagram_status, "container_created");
});

test("status counts include manual review and failed items", () => {
  assert.deepEqual(statusCounts([
    { instagram_status: "published" },
    { instagram_status: "manual_review" },
    { instagram_status: "failed" }
  ]), { published: 1, manual_review: 1, failed: 1 });
});
