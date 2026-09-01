import instagramScheduler from "./instagram-scheduler.mjs";

// One predictable recovery check, fifteen minutes after the final primary
// window. It reuses the same queue, duplicate guard, retry, lock, and alerts.
export default instagramScheduler;

export const config = {
  // 01:40 UTC is 18:40 Pacific on the prior UTC date during Aug/Sep PDT.
  schedule: "40 1 * * *"
};
