import { createDb } from "@coprhub/shared";
import { syncFromDump } from "./dump-sync.js";
import { syncAllStars } from "./stars-sync.js";
import { syncAllDiscourseStats } from "./discourse-sync.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const DUMP_SYNC_INTERVAL_HOURS = parseInt(process.env.DUMP_SYNC_INTERVAL_HOURS || "24", 10);
const STARS_SYNC_INTERVAL_HOURS = parseInt(process.env.STARS_SYNC_INTERVAL_HOURS || "12", 10);
const DISCOURSE_SYNC_INTERVAL_HOURS = parseInt(process.env.DISCOURSE_SYNC_INTERVAL_HOURS || "24", 10);

const db = createDb(DATABASE_URL);

async function runDumpSync() {
  try {
    await syncFromDump(db);
  } catch (err) {
    console.error("Dump sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db);
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

async function runDiscourseSync() {
  try {
    await syncAllDiscourseStats(db);
  } catch (err) {
    console.error("Discourse sync failed:", err);
  }
}

console.log("Sync worker starting...");
console.log(
  `Intervals — Dump: ${DUMP_SYNC_INTERVAL_HOURS}h, Stars: ${STARS_SYNC_INTERVAL_HOURS}h, Discourse: ${DISCOURSE_SYNC_INTERVAL_HOURS}h`
);

await runDumpSync();
await runStarSync();
await runDiscourseSync();

setInterval(runDumpSync, DUMP_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runDiscourseSync, DISCOURSE_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
