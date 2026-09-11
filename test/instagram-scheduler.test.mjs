import test from "node:test";
import assert from "node:assert/strict";
import { setEnvironmentContext } from "@netlify/blobs";

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

test("catch-up posts use the existing recovery run, not either campaign's normal slot", () => {
  const catchup = { id: "catchup", scheduler_lane: "catch-up", instagram_status: "scheduled", instagram_scheduled_publish_time: "2026-09-12T18:45:00-07:00" };
  assert.equal(campaignQueue([catchup], "primary").length, 0);
  assert.equal(campaignQueue([catchup], "study-abroad").length, 0);
  assert.equal(nextItem(campaignQueue([catchup], "all"), new Date("2026-09-12T18:40:00-07:00")).id, "catchup");
  assert.equal(nextItem([catchup], new Date("2026-09-11T18:40:00-07:00")), undefined);
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
    values.set("monthly-queue",[history,make("leave-untouched","primary"),make("target","study-abroad")]);
    const manual = await run({ window:"manual", lane:"all", targetId:"target" });
    assert.equal(manual.id,"target");
    assert.equal(manual.action,"published");
    assert.equal(values.get("monthly-queue")[1].instagram_status,"scheduled");
    const catchupToday = { ...make("catchup-today","catch-up"), instagram_scheduled_publish_time: new Date(Date.now()+29*60000).toISOString() };
    const catchupTomorrow = { ...make("catchup-tomorrow","catch-up"), instagram_scheduled_publish_time: new Date(Date.now()+24*60*60000).toISOString() };
    values.set("monthly-queue",[history,make("primary-prep","primary"),catchupToday,catchupTomorrow]);
    const countBeforePrep = calls.filter(x=>x.endsWith("/media_publish")).length;
    await run({ lane:"primary", createOnly:true });
    assert.equal(values.get("monthly-queue")[1].instagram_status,"container_created");
    assert.equal(values.get("monthly-queue")[2].instagram_status,"container_created");
    assert.deepEqual(values.get("monthly-queue")[3],catchupTomorrow);
    assert.equal(calls.filter(x=>x.endsWith("/media_publish")).length,countBeforePrep);
    await run({ lane:"primary" });
    assert.equal(values.get("monthly-queue")[1].instagram_status,"published");
    assert.equal(values.get("monthly-queue")[2].instagram_status,"container_created");
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

test("real Blobs SDK uses uncached reads so a fresh lock can be acquired and released", async () => {
  const oldFetch = globalThis.fetch;
  const saved = Object.fromEntries(["NETLIFY_BLOBS_CONTEXT", "META_PAGE_ACCESS_TOKEN", "META_INSTAGRAM_BUSINESS_ID"].map(k => [k, process.env[k]]));
  setEnvironmentContext({ siteID: "test-site", token: "test-only", edgeURL: "https://cached.example", uncachedEdgeURL: "https://strong.example" });
  process.env.META_PAGE_ACCESS_TOKEN = "test-only";
  process.env.META_INSTAGRAM_BUSINESS_ID = "test-only";
  const values = new Map([["monthly-queue", [{ id: "test-post", instagram_status: "scheduled", instagram_ready: true, date: "2026-01-01", instagram_image_url: "https://example.com/photo.jpg", instagram_caption: "test" }]]]);
  const reads = [];
  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(input);
    if (url.hostname === "graph.facebook.com") return Response.json({ id: "test-container" });
    const key = decodeURIComponent(url.pathname.split("/").at(-1));
    if (opts.method === "put") { values.set(key, JSON.parse(opts.body)); return new Response(null, { status: 200 }); }
    reads.push(url.hostname);
    // Simulate the CDN not having observed the latest lock write.
    const value = url.hostname === "cached.example" && key === "scheduler-run-lock" ? null : values.get(key);
    return value == null ? new Response(null, { status: 404 }) : Response.json(value);
  };
  try {
    const result = await (await runInstagramScheduler(new Request("https://example.com"), { createOnly: true })).json();
    assert.equal(result.action, "container_created");
    assert(reads.length > 0);
    assert(reads.every(host => host === "strong.example"));
    assert(values.get("scheduler-run-lock").released_at);
    assert.equal(values.get("monthly-queue")[0].instagram_container_id, "test-container");
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("a blocked invocation cannot mutate stale queue work owned by another run", async () => {
  const saved = [process.env.META_PAGE_ACCESS_TOKEN, process.env.META_INSTAGRAM_BUSINESS_ID];
  process.env.META_PAGE_ACCESS_TOKEN = "test-only"; process.env.META_INSTAGRAM_BUSINESS_ID = "test-only";
  const queue = [{ id: "stale", instagram_status: "container_checking", instagram_work_started_at: "2026-01-01" }];
  const values = new Map([["monthly-queue", queue], ["scheduler-run-lock", { id: "other-run", started_at: new Date().toISOString() }]]);
  const writes = [];
  const store = { get: async k => structuredClone(values.get(k)), setJSON: async (k, v) => { writes.push(k); values.set(k, structuredClone(v)); } };
  try {
    const result = await (await runInstagramScheduler(new Request("https://example.com"), { store })).json();
    assert.equal(result.action, "skipped");
    assert(!writes.includes("monthly-queue"));
    assert.deepEqual(values.get("monthly-queue"), queue);
  } finally {
    for (const [i, k] of ["META_PAGE_ACCESS_TOKEN", "META_INSTAGRAM_BUSINESS_ID"].entries()) { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }
  }
});
