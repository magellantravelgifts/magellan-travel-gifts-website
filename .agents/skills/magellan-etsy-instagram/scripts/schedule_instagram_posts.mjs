#!/usr/bin/env node
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

export function parseDateParts(dateText) {
  const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date "${dateText}". Use YYYY-MM-DD.`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function parseTimeParts(timeText) {
  const match = String(timeText).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time "${timeText}". Use HH:MM local time.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${timeText}". Use HH:MM local time.`);
  return { hour, minute };
}

function zonedPartsAt(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function offsetMinutesAt(timestamp, timeZone) {
  const parts = zonedPartsAt(timestamp, timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((representedAsUtc - timestamp) / 60000);
}

export function zonedIso(dateParts, timeParts, timeZone) {
  const localAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0
  );
  let offsetMinutes = offsetMinutesAt(localAsUtc, timeZone);
  let timestamp = localAsUtc - offsetMinutes * 60000;
  offsetMinutes = offsetMinutesAt(timestamp, timeZone);
  timestamp = localAsUtc - offsetMinutes * 60000;

  const check = zonedPartsAt(timestamp, timeZone);
  if (
    check.year !== dateParts.year ||
    check.month !== dateParts.month ||
    check.day !== dateParts.day ||
    check.hour !== timeParts.hour ||
    check.minute !== timeParts.minute
  ) {
    throw new Error(`The local time does not exist in ${timeZone}: ${JSON.stringify({ ...dateParts, ...timeParts })}`);
  }

  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${String(dateParts.year).padStart(4, "0")}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}T${String(timeParts.hour).padStart(2, "0")}:${String(timeParts.minute).padStart(2, "0")}:00${sign}${hours}:${minutes}`;
}

export async function main() {
  const queuePath = arg("queue");
  const timesText = arg("times", "09:30,12:30,15:30,18:30");
  const timeZone = arg("time-zone", "America/Los_Angeles");
  const startDateText = arg("start-date");
  const days = Number(arg("days", "1"));

  if (!queuePath) {
    console.error("Usage: node schedule_instagram_posts.mjs --queue outputs/instagram/YYYY-MM/instagram-posts.json --start-date YYYY-MM-DD --days 30 [--times 09:30,12:30,15:30,18:30] [--time-zone America/Los_Angeles]");
    process.exitCode = 2;
    return;
  }

  const timeParts = timesText.split(",").map((time) => parseTimeParts(time.trim()));
  if (timeParts.length < 1 || timeParts.length > 4) {
    throw new Error("Use one to four predictable daily posting times.");
  }

  const today = new Date();
  const startDate = startDateText
    ? parseDateParts(startDateText)
    : { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
  const schedule = [];
  for (let day = 0; day < days; day += 1) {
    const cursor = new Date(Date.UTC(startDate.year, startDate.month - 1, startDate.day + day));
    const dateParts = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate()
    };
    for (const time of timeParts) {
      schedule.push(zonedIso(dateParts, time, timeZone));
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
