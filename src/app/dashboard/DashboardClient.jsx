"use client";

import { useCallback, useEffect, useState } from "react";

function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function errorMessage(data, status) {
  if (
    data &&
    typeof data === "object" &&
    data.error &&
    typeof data.error === "object" &&
    typeof data.error.message === "string"
  ) {
    return data.error.message;
  }
  return `Request failed (${status})`;
}

function fallbackCommission(merchant) {
  if (merchant.commissionMin === undefined || merchant.commissionMin === null) {
    return "—";
  }

  const min = merchant.commissionMin;
  const max = merchant.commissionMax ?? min;
  const type = String(merchant.commissionType ?? "").toLowerCase();

  if (type.includes("percentage")) {
    return min === max ? `${min}%` : `${min}% - ${max}%`;
  }

  const currency = merchant.currencyCode ? `${merchant.currencyCode} ` : "";
  return min === max
    ? `${currency}${min}`
    : `${currency}${min} - ${currency}${max}`;
}

function commissionText(merchant) {
  return merchant.commissionDisplay || fallbackCommission(merchant);
}

export default function DashboardClient() {
  const [apiKey, setApiKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [directory, setDirectory] = useState(null);
  const [run, setRun] = useState(null);
  const [merchants, setMerchants] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useCallback(
    async (path, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-admin-api-key", apiKey);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(path, {
        ...init,
        headers,
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) throw new Error(errorMessage(data, response.status));
      return data;
    },
    [apiKey],
  );

  const refresh = useCallback(async () => {
    if (!apiKey) return;

    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("syncStatus", statusFilter);

      const [directoryData, detailData, merchantData] = await Promise.all([
        api("/api/awin/import-programmes/status"),
        api("/api/awin/detail-sync/status"),
        api(`/api/awin/merchants?${params.toString()}`),
      ]);

      setDirectory(directoryData);
      setRun(detailData.latestRun);
      setMerchants(merchantData.merchants);
      setPages(merchantData.pagination.pages);
      setAuthenticated(true);
      setMessage("");
      sessionStorage.setItem("awin-admin-api-key", apiKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load dashboard");
      setAuthenticated(false);
    }
  }, [api, apiKey, page, search, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = sessionStorage.getItem("awin-admin-api-key");
      if (saved) setApiKey(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    const timer = window.setTimeout(() => void refresh(), 100);
    return () => window.clearTimeout(timer);
  }, [apiKey, page, statusFilter, refresh]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onSyncUpdate = () => void refresh();
    window.addEventListener("awin-detail-sync-updated", onSyncUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("awin-detail-sync-updated", onSyncUpdate);
    };
  }, [authenticated, refresh]);

  async function runAction(label, action) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(`${label} successful`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  function login(event) {
    event.preventDefault();
    void refresh();
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const response = await fetch("/api/awin/export", {
        headers: { "x-admin-api-key": apiKey },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `awin-merchants-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <form
          onSubmit={login}
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-7 shadow-2xl"
        >
          <p className="text-sm font-medium text-emerald-400">Awin Commission Rates</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Admin dashboard</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Enter the ADMIN_API_KEY configured on the server.
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-emerald-500"
            placeholder="Admin API key"
            autoComplete="current-password"
          />
          <button className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-zinc-950 hover:bg-emerald-400">
            Open dashboard
          </button>
          {message && <p className="mt-4 text-sm text-red-400">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[90rem] px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-500">Awin Commission Rates</p>
          <h1 className="text-3xl font-semibold text-zinc-100">Merchant synchronization</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            className="btn-secondary"
            onClick={() =>
              void runAction("Directory import", () =>
                api("/api/awin/import-programmes", {
                  method: "POST",
                  body: JSON.stringify({ includeHidden: true }),
                }),
              )
            }
          >
            Import directory
          </button>

          <button disabled={busy} className="btn-secondary" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
      </header>

      {message && (
        <div className="mt-5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
          {message}
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Directory merchants" value={directory?.merchants.total ?? 0} />
        <Stat label="Active programmes" value={directory?.merchants.active ?? 0} />
        <Stat label="Details completed" value={directory?.merchants.completedDetails ?? 0} />
        <Stat label="Detail failures" value={directory?.merchants.failedDetails ?? 0} />
      </section>



      <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className="flex flex-wrap gap-3 border-b border-zinc-800 p-4">
          <form
            className="flex min-w-64 flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void refresh();
            }}
          >
            <input
              className="input flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search merchant or advertiser ID"
            />
            <button className="btn-secondary">Search</button>
          </form>
          <select
            className="input max-w-48"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All detail statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="table-cell">ID</th>
                <th className="table-cell">Programme</th>
                <th className="table-cell">Country</th>
                <th className="table-cell">Relationship</th>
                <th className="table-cell">Commission</th>
                <th className="table-cell">Sync</th>
                <th className="table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {merchants.map((merchant) => {
                const commission = commissionText(merchant);
                const unavailable = merchant.commissionFetchStatus === "unavailable";
                return (
                  <tr key={merchant.id} className="text-zinc-300">
                    <td className="table-cell font-mono">{merchant.advertiserId}</td>
                    <td className="table-cell">
                      <div className="font-medium text-white">
                        {merchant.programmeName ?? "Unnamed"}
                      </div>
                      {merchant.lastSyncError && (
                        <div className="max-w-xs truncate text-xs text-red-400">
                          {merchant.lastSyncError}
                        </div>
                      )}
                    </td>
                    <td className="table-cell">{merchant.countryCode ?? "—"}</td>
                    <td className="table-cell">{merchant.membershipStatus ?? "—"}</td>
                    <td
                      className={`table-cell ${unavailable ? "text-amber-400" : "text-zinc-200"}`}
                      title={merchant.commissionUnavailableReason || commission}
                    >
                      {commission}
                    </td>
                    <td className="table-cell">
                      <span className={`status status-${merchant.syncStatus}`}>
                        {merchant.syncStatus}
                      </span>
                    </td>
                    <td className="table-cell">
                      {merchant.detailsFetchedAt
                        ? new Date(merchant.detailsFetchedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {merchants.length === 0 && (
                <tr>
                  <td className="table-cell text-zinc-500" colSpan={7}>
                    No merchants found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 p-4 text-sm text-zinc-400">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              className="btn-secondary"
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <button
              disabled={page >= pages}
              className="btn-secondary"
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value.toLocaleString()}</p>
    </div>
  );
}
