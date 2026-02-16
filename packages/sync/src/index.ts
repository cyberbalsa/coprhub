import { createDb } from "@coprhub/shared";
import { syncCoprProjects } from "./copr-sync.js";
import { syncAllStars } from "./stars-sync.js";
import { syncVotesAndDownloads } from "./votes-sync.js";
import { recomputeAllPopularityScores } from "./popularity.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const COPR_SYNC_INTERVAL_HOURS = parseInt(process.env.COPR_SYNC_INTERVAL_HOURS || "6", 10);
const STARS_SYNC_INTERVAL_HOURS = parseInt(process.env.STARS_SYNC_INTERVAL_HOURS || "12", 10);
const VOTES_SYNC_INTERVAL_HOURS = parseInt(process.env.VOTES_SYNC_INTERVAL_HOURS || "24", 10);

const db = createDb(DATABASE_URL);

async function runCoprSync() {
  try {
    await syncCoprProjects(db);
    await recomputeAllPopularityScores(db);
  } catch (err) {
    console.error("COPR sync failed:", err);
  }
}

async function runStarSync() {
  try {
    await syncAllStars(db);
    await recomputeAllPopularityScores(db);
  } catch (err) {
    console.error("Star sync failed:", err);
  }
}

async function runVotesSync() {
  try {
    await syncVotesAndDownloads(db);
  } catch (err) {
    console.error("Votes/downloads sync failed:", err);
  }
}

console.log("Sync worker starting...");
console.log(
  `Intervals — COPR: ${COPR_SYNC_INTERVAL_HOURS}h, Stars: ${STARS_SYNC_INTERVAL_HOURS}h, Votes: ${VOTES_SYNC_INTERVAL_HOURS}h`
);

await runCoprSync();
await runStarSync();
await runVotesSync();

setInterval(runCoprSync, COPR_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runStarSync, STARS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
setInterval(runVotesSync, VOTES_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

console.log("Sync worker running. Waiting for next interval...");
