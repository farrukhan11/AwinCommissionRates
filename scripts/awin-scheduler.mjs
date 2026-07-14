import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ENABLED = process.env.AWIN_SCHEDULER_ENABLED === "true";
const BASE_URL = (process.env.APP_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const DIRECTORY_HOURS = positiveNumber(process.env.AWIN_DIRECTORY_SYNC_INTERVAL_HOURS, 24);
const DETAIL_HOURS = positiveNumber(process.env.AWIN_DETAIL_SYNC_INTERVAL_HOURS, 168);
const STALE_AFTER_DAYS = positiveNumber(process.env.AWIN_DETAIL_STALE_AFTER_DAYS, 30);
const STATE_FILE = path.resolve(
  process.env.AWIN_SCHEDULER_STATE_FILE ?? ".awin-scheduler-state.json",
);
const CHECK_INTERVAL_MS = 60_000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function post(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-api-key": ADMIN_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 409) {
    const message = data?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return { status: response.status, data };
}

async function runDirectory(state) {
  const result = await post("/api/awin/import-programmes", { includeHidden: true });
  state.lastDirectoryAttemptAt = new Date().toISOString();
  state.nextDirectoryAt = new Date(Date.now() + DIRECTORY_HOURS * 3600_000).toISOString();
  state.lastDirectoryResult = result.status === 409 ? "already-running" : "started";
  delete state.lastDirectoryError;
  console.log(`[scheduler] directory sync: ${state.lastDirectoryResult}`);
}

async function runDetails(state) {
  const result = await post("/api/awin/detail-sync/start", {
    mode: "stale",
    staleAfterDays: STALE_AFTER_DAYS,
  });
  state.lastDetailAttemptAt = new Date().toISOString();
  state.nextDetailAt = new Date(Date.now() + DETAIL_HOURS * 3600_000).toISOString();
  state.lastDetailResult = result.status === 409 ? "already-running" : "started";
  delete state.lastDetailError;
  console.log(`[scheduler] detail sync: ${state.lastDetailResult}`);
}

async function main() {
  if (!ENABLED) {
    console.log("[scheduler] disabled; set AWIN_SCHEDULER_ENABLED=true to enable");
    while (true) await sleep(3600_000);
  }
  if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY is not configured");

  const state = await readState();
  state.nextDirectoryAt ??= new Date().toISOString();
  state.nextDetailAt ??= new Date(Date.now() + 5 * 60_000).toISOString();
  await writeState(state);

  while (true) {
    const now = Date.now();

    if (new Date(state.nextDirectoryAt).getTime() <= now) {
      try {
        await runDirectory(state);
      } catch (error) {
        state.lastDirectoryError = error instanceof Error ? error.message : "Directory sync failed";
        state.nextDirectoryAt = new Date(Date.now() + 3600_000).toISOString();
        console.error(`[scheduler] directory error: ${state.lastDirectoryError}`);
      }
      await writeState(state);
    }

    if (new Date(state.nextDetailAt).getTime() <= now) {
      try {
        await runDetails(state);
      } catch (error) {
        state.lastDetailError = error instanceof Error ? error.message : "Detail sync failed";
        state.nextDetailAt = new Date(Date.now() + 3600_000).toISOString();
        console.error(`[scheduler] detail error: ${state.lastDetailError}`);
      }
      await writeState(state);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("[scheduler] fatal error", error instanceof Error ? error.message : "unknown");
  process.exit(1);
});
