import { runInstagramScheduler } from "./instagram-scheduler.mjs";

export default (req: Request) => runInstagramScheduler(req, {
  window: "study-abroad-publish",
  lane: "study-abroad"
});

// 18:10 PDT. Existing Euro Summer publishing stays at 18:25.
export const config = { schedule: "10 1 * * *" };
