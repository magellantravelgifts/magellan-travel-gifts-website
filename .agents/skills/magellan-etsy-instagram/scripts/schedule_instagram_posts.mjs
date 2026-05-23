#!/usr/bin/env node
import fs from "node:fs/promises";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function parseDate(dateText) {
  const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date "${dateText}". Use YYYY-MM-DD.`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}

function parseTimeForDate(timeText, date) {
  const match = String(timeText).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time "${timeText}". Use HH:MM local time.`);
  const scheduled = new Date(date);
  scheduled.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return scheduled;
}

function isoWithOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00${sign}${hours}:${minutes}`;
}

const queuePath = arg("queue");
const timesText = arg("times");
const startDateText = arg("start-date");
const days = Number(arg("days", "1"));

if (!queuePath || !timesText) {
  console.error("Usage: node schedule_instagram_posts.mjs --queue outputs/instagram/YYYY-MM/instagram-posts.json --times HH:MM,HH:MM --start-date YYYY-MM-DD --days 30");
  process.exit(2);
}

const startDate = startDateText ? parseDate(startDateText) : new Date();
startDate.setHours(0, 0, 0, 0);
const schedule = [];
for (let day = 0; day < days; day += 1) {
  const date = new Date(startDate);
  date.setDate(startDate.getDate() + day);
  for (const time of timesText.split(",")) {
    schedule.push(isoWithOffset(parseTimeForDate(time.trim(), date)));
  }
}
const queue = JSON.parse(await fs.readFile(queuePath, "utf8"));
const remaining = queue.filter((item) => item.instagram_status !== "published");

remaining.forEach((item, index) => {
  item.instagram_scheduled_publish_time = schedule[index % schedule.length];
  item.instagram_status = "scheduled";
});

await fs.writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

for (const item of remaining) {
  console.log(`${item.id}: ${item.instagram_scheduled_publish_time}`);
}
