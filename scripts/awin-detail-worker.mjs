import process from "node:process";

const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || "3000"}`
).replace(/\/$/, "");
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const IDLE_POLL_MS = Math.max(
  1_000,
  Number.parseInt(process.env.AWIN_WORKER_IDLE_POLL_MS || "10000", 10) || 10_000,
);
const ERROR_RETRY_MS = Math.max(
  3_000,
  Number.parseInt(process.env.AWIN_WORKER_ERROR_RETRY_MS || "10000", 10) || 10_000,
);

if (!ADMIN_API_KEY) {
  throw new Error("ADMIN_API_KEY is not configured");
}

let shuttingDown = false;
let activeController = null;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, init = {}) {
  activeController = new AbortController();
  const timeoutMs = path.endsWith("/tick") ? 130_000 : 30_000;
  const timeout = setTimeout(() => activeController?.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("x-admin-api-key", ADMIN_API_KEY);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const response = await fetch(`${APP_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: activeController.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? payload?.error?.message || `HTTP ${response.status}`
          : String(payload || `HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
    activeController = null;
  }
}

async function main() {
  console.log(`[worker] using ${APP_BASE_URL}`);
  console.log("[worker] waiting for Awin detail sync runs");

  while (!shuttingDown) {
    try {
      const statusPayload = await request("/api/awin/detail-sync/status");
      const run = statusPayload?.latestRun;

      if (!run) {
        await sleep(IDLE_POLL_MS);
        continue;
      }

      if (run.status === "paused") {
        await sleep(5_000);
        continue;
      }

      if (!["pending", "running"].includes(run.status)) {
        await sleep(IDLE_POLL_MS);
        continue;
      }

      const tick = await request("/api/awin/detail-sync/tick", { method: "POST" });
      const fetched = Array.isArray(tick?.results)
        ? tick.results.filter((item) => item?.outcome === "commission_fetched").length
        : 0;

      console.log(
        `[worker] run=${tick?.runId || run.id} status=${tick?.status || run.status} ` +
          `processed=${tick?.processedThisTick || 0} commissions=${fetched}`,
      );

      if (tick?.status === "failed") {
        await sleep(ERROR_RETRY_MS);
      } else {
        await sleep(tick?.processedThisTick > 0 ? 300 : 1_500);
      }
    } catch (error) {
      if (shuttingDown || error?.name === "AbortError") break;
      console.error("[worker] tick failed:", error?.message || error);
      await sleep(ERROR_RETRY_MS);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    activeController?.abort();
    console.log(`[worker] received ${signal}, shutting down safely`);
  });
}

main().catch((error) => {
  console.error("[worker] fatal error:", error?.message || error);
  process.exitCode = 1;
});
