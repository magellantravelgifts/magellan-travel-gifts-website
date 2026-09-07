import { runInstagramScheduler, PREPARE_LEAD_MS } from "./instagram-scheduler.mjs";

export default (req: Request) => runInstagramScheduler(req, {
  window: "study-abroad-prepare",
  lane: "study-abroad",
  leadMs: PREPARE_LEAD_MS,
  createOnly: true
});

// 18:00 PDT. Existing Euro Summer preparation stays at 18:15.
export const config = { schedule: "0 1 * * *" };
