import test from "node:test";
import assert from "node:assert/strict";

import {
  applyItemFailure,
  canRetryItem,
  campaignQueue,
  nextItem,
  runInstagramScheduler,
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
import { config as studyPrepare } from "../netlify/functions/instagram-study-abroad-prepare.mts";
import { config as studyPublish } from "../netlify/functions/instagram-study-abroad-publish.mts";
import {
  parseDateParts,
  parseTimeParts,
  zonedIso
} from "../.agents/skills/magellan-etsy-instagram/scripts/schedule_instagram_posts.mjs";

test("scheduler uses separate prepare, publish, and recovery windows", () => {
  assert.equal(config.schedule, "15 1 * * *");
  assert.equal(publishConfig.schedule, "25 1 * * *");
  assert.equal(recoveryConfig.schedule, "40 1 * * *");
  assert.equal(studyPrepare.schedule, "0 1 * * *");
  assert.equal(studyPublish.schedule, "10 1 * * *");
  assert.equal(new Set([config.schedule,publishConfig.schedule,recoveryConfig.schedule,studyPrepare.schedule,studyPublish.schedule]).size,5);
});

test("campaign lanes preserve primary capacity even if Study Abroad is still processing", () => {
  const primary={id:"summer",instagram_status:"scheduled",date:"2026-01-01"};
  const study={id:"study",scheduler_lane:"study-abroad",instagram_status:"container_created"};
  const queue=[study,primary];
  assert.equal(nextItem(campaignQueue(queue,"primary"),new Date()).id,"summer");
  assert.equal(nextItem(campaignQueue(queue,"study-abroad"),new Date()).id,"study");
  assert.equal(campaignQueue(queue,"all").length,2);
});

test("both campaigns prepare and publish independently without altering other queue entries",async () => {
  const oldFetch=globalThis.fetch;
  const oldSiteUrl=process.env.NETLIFY_SITE_URL;
  process.env.NETLIFY_SITE_URL="https://example.com";
  const oldToken=process.env.META_PAGE_ACCESS_TOKEN,oldId=process.env.META_INSTAGRAM_BUSINESS_ID;
  process.env.META_PAGE_ACCESS_TOKEN="test-only";process.env.META_INSTAGRAM_BUSINESS_ID="test-only";
  const history={id:"history",instagram_status:"published",instagram_media_id:"old"};
  const make=(id,lane)=>({id,scheduler_lane:lane,instagram_status:"scheduled",approval_status:"approved",instagram_ready:true,date:"2026-01-01",instagram_image_url:"https://example.com/image.jpg",instagram_caption:id});
  const values=new Map([["monthly-queue",[history,make("summer","primary"),make("study","study-abroad")]]]);
  const store={get:async k=>structuredClone(values.get(k)),setJSON:async(k,v)=>{values.set(k,structuredClone(v));}};
  const calls=[];
  globalThis.fetch=async(url,opts={})=>{calls.push(String(url));return new Response(JSON.stringify(opts.method==="POST"?{id:String(url).endsWith("/media_publish")?"media-"+calls.length:"container-"+calls.length}:{status_code:"FINISHED"}),{status:200});};
  try{
    const run=async o=>(await runInstagramScheduler(new Request("https://example.com"),{...o,store})).json();
    assert.equal((await run({lane:"study-abroad",createOnly:true})).action,"container_created");
    assert.equal((await run({lane:"study-abroad",createOnly:true})).action,"already_prepared");
    assert(!calls.some(x=>x.endsWith("/media_publish")));
    assert.equal((await run({lane:"primary",createOnly:true})).action,"container_created");
    assert.equal((await run({lane:"study-abroad"})).action,"published");
    assert.equal((await run({lane:"primary"})).action,"published");
    assert.equal((await run({window:"recovery"})).action,"idle");
    assert.deepEqual(values.get("monthly-queue")[0],history);
    assert.equal(calls.filter(x=>x.endsWith("/media_publish")).length,2);
    values.set("monthly-queue",[history,...[make("summer-recovery","primary"),make("study-recovery","study-abroad")].map(r=>({...r,instagram_status:"container_created",instagram_container_id:r.id}))]);
    const recovered=await run({window:"recovery"});
    assert.equal(recovered.action,"recovery_batch");
    assert.equal(recovered.results.length,2);
    assert(values.get("monthly-queue").every(r=>r.instagram_status==="published"));
    values.set("monthly-queue",[history,make("failure","study-abroad")]);
    let mediaAttempts=0,forms=0;
    globalThis.fetch=async(url,opts={})=>{
      if(String(url).startsWith("https://graph.facebook.com/")){mediaAttempts++;return new Response(JSON.stringify({error:{message:"temporary failure"}}),{status:503});}
      forms++;return new Response("ok",{status:200});
    };
    const failed=await run({lane:"study-abroad",createOnly:true});
    assert.equal(failed.ok,false);assert.equal(mediaAttempts,2);assert.equal(forms,1);
    assert.equal(values.get("monthly-queue")[1].instagram_status,"failed");
  }finally{globalThis.fetch=oldFetch;if(oldSiteUrl===undefined)delete process.env.NETLIFY_SITE_URL;else process.env.NETLIFY_SITE_URL=oldSiteUrl;if(oldToken===undefined)delete process.env.META_PAGE_ACCESS_TOKEN;else process.env.META_PAGE_ACCESS_TOKEN=oldToken;if(oldId===undefined)delete process.env.META_INSTAGRAM_BUSINESS_ID;else process.env.META_INSTAGRAM_BUSINESS_ID=oldId;}
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
