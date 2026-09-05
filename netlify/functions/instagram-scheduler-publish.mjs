import { runInstagramScheduler } from "./instagram-scheduler.mjs";

// Publish the container prepared ten minutes earlier. Keeping preparation and
// publication in separate scheduled functions leaves ample room under
// Netlify's 30-second scheduled-function ceiling.
export default (req) => runInstagramScheduler(req, { window: "publish" });

export const config = {
  // 01:25 UTC is 18:25 Pacific on the prior UTC date during Aug/Sep PDT.
  schedule: "25 1 * * *"
};
