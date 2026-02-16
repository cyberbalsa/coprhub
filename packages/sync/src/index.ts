import { createDb } from "@coprhub/shared";
import { syncCoprProjects } from "./copr-sync.js";
import { syncAllStars } from "./stars-sync.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const COPR_SYNC_INTERVAL_HOURS = parseInt(process.env.COPR_SYNC_INTERVAL_HOURS || "6", 10);
const STARS_SYNC_INTERVAL_HOURS = parseInt(process.env.STARS_SYNC_INTERVAL_HOURS || "12", 10);

const db = createDb(DATABASE_URL);

async function runCoprSync() {
  try {
    await syncCoprProjects(db);
  } catch (err) {
    console.error("COPR sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db);
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

console.log("Sync worker starting...");
console.log(`COPR sync interval: ${COPR_SYNC_INTERVAL_HOURS}h, Star sync interval: ${STARS_SYNC_INTERVAL_HOURS}h`);

await runCoprSync();
await runStarSync();

setInterval(runCoprSync, COPR_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
