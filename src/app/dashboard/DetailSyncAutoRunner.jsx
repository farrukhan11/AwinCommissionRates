"use client";

import { useEffect } from "react";

const ACTIVE_STATUSES = new Set(["pending", "running"]);

const sleep = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export default function DetailSyncAutoRunner() {
  useEffect(() => {
    let stopped = false;
    let controller = null;

    async function request(path, apiKey, init) {
      controller = new AbortController();
      const headers = new Headers(init?.headers);
      headers.set("x-admin-api-key", apiKey);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(path, {
        ...init,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || `Request failed (${response.status})`;
        throw new Error(message);
      }
      return payload;
    }

    async function runLoop() {
      while (!stopped) {
        const apiKey = sessionStorage.getItem("awin-admin-api-key");
        if (!apiKey) {
          await sleep(1000);
          continue;
        }

        try {
          const statusPayload = await request(
            "/api/awin/detail-sync/status",
            apiKey,
          );
          const status = statusPayload?.latestRun?.status;

          if (!ACTIVE_STATUSES.has(status)) {
            await sleep(status === "paused" ? 3000 : 5000);
            continue;
          }

          const tickPayload = await request(
            "/api/awin/detail-sync/tick",
            apiKey,
            { method: "POST" },
          );

          window.dispatchEvent(
            new CustomEvent("awin-detail-sync-updated", {
              detail: tickPayload,
            }),
          );

          await sleep(tickPayload?.processedThisTick > 0 ? 300 : 1500);
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.error("[Awin auto sync]", error);
          }
          await sleep(5000);
        }
      }
    }

    void runLoop();

    return () => {
      stopped = true;
      controller?.abort();
    };
  }, []);

  return null;
}
