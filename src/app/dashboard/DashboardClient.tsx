"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type DetailStatus = {
  latestRun: null | {
    id: string;
    mode: string;
    status: string;
    totalQueued: number;
    processedCount: number;
    successCount: number;
    failedCount: number;
    retryCount: number;
    rateLimitCount: number;
    progressPercentage: number;
    estimatedSeconds: number;
    lastHeartbeatAt?: string;
  };
};

type DirectoryStatus = {
  latestRun: null | { status: string; totalReceived: number; validProgrammes: number; invalidProgrammes: number };
  merchants: { total: number; active: number; missing: number; pendingDetails: number; completedDetails: number; failedDetails: number };
};

type Merchant = {
  id: string;
  advertiserId: number;
  programmeName?: string;
  membershipStatus?: string;
  countryCode?: string;
  currencyCode?: string;
  syncStatus: string;
  commissionMin?: number;
  commissionMax?: number;
  commissionType?: string;
  detailsFetchedAt?: string;
  lastSyncError?: string;
};

function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function DashboardClient() {
  const [apiKey, setApiKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [directory, setDirectory] = useState<DirectoryStatus | null>(null);
  const [details, setDetails] = useState<DetailStatus | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        headers: {
          "x-admin-api-key": apiKey,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const errorMessage =
          typeof data === "object" && data && "error" in data
            ? (data as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(errorMessage ?? `Request failed (${response.status})`);
      }
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
        api(`/api/awin/merchants?${params}`),
      ]);
      setDirectory(directoryData as DirectoryStatus);
      setDetails(detailData as DetailStatus);
      const listed = merchantData as { merchants: Merchant[]; pagination: { pages: number } };
      setMerchants(listed.merchants);
      setPages(listed.pagination.pages);
      setAuthenticated(true);
      sessionStorage.setItem("awin-admin-api-key", apiKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load dashboard");
      setAuthenticated(false);
    }
  }, [api, apiKey, page, search, statusFilter]);

  useEffect(() => {
    const saved = sessionStorage.getItem("awin-admin-api-key");
    if (saved) setApiKey(saved);
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    const timer = window.setTimeout(() => void refresh(), 100);
    return () => window.clearTimeout(timer);
  }, [apiKey, page, statusFilter, refresh]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [authenticated, refresh]);

  async function runAction(label: string, callback: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await callback();
      setMessage(`${label} successful`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  function login(event: FormEvent) {
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
        <form onSubmit={login} className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-7 shadow-2xl">
          <p className="text-sm font-medium text-emerald-400">Awin Commission Rates</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Admin dashboard</h1>
          <p className="mt-3 text-sm text-zinc-400">Enter the ADMIN_API_KEY configured on the server.</p>
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

  const run = details?.latestRun;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-500">Awin Commission Rates</p>
          <h1 className="text-3xl font-semibold text-zinc-100">Merchant synchronization</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => void runAction("Directory import", () => api("/api/awin/import-programmes", { method: "POST", body: JSON.stringify({ includeHidden: true }) }))} className="btn-secondary">Import directory</button>
          <button disabled={busy} onClick={() => void runAction("Missing detail sync", () => api("/api/awin/detail-sync/start", { method: "POST", body: JSON.stringify({ mode: "missing" }) }))} className="btn-primary">Sync missing details</button>
          <button disabled={busy} onClick={() => void runAction("Stale detail sync", () => api("/api/awin/detail-sync/start", { method: "POST", body: JSON.stringify({ mode: "stale", staleAfterDays: 30 }) }))} className="btn-secondary">Refresh stale</button>
          <button disabled={busy} onClick={() => void exportCsv()} className="btn-secondary">Export CSV</button>
        </div>
      </div>

      {message && <div className="mt-5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Directory merchants" value={directory?.merchants.total ?? 0} />
        <Stat label="Active programmes" value={directory?.merchants.active ?? 0} />
        <Stat label="Details completed" value={directory?.merchants.completedDetails ?? 0} />
        <Stat label="Detail failures" value={directory?.merchants.failedDetails ?? 0} />
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500">Current detail run</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{run ? `${run.mode} · ${run.status}` : "No run created"}</h2>
          </div>
          {run && ["pending", "running", "paused"].includes(run.status) && (
            <div className="flex gap-2">
              {run.status === "paused" ? (
                <button disabled={busy} onClick={() => void runAction("Resume", () => api("/api/awin/detail-sync/control", { method: "POST", body: JSON.stringify({ action: "resume", runId: run.id }) }))} className="btn-primary">Resume</button>
              ) : (
                <button disabled={busy} onClick={() => void runAction("Pause", () => api("/api/awin/detail-sync/control", { method: "POST", body: JSON.stringify({ action: "pause", runId: run.id }) }))} className="btn-secondary">Pause</button>
              )}
              <button disabled={busy} onClick={() => void runAction("Cancel", () => api("/api/awin/detail-sync/control", { method: "POST", body: JSON.stringify({ action: "cancel", runId: run.id }) }))} className="btn-danger">Cancel</button>
            </div>
          )}
        </div>
        {run && (
          <>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, run.progressPercentage)}%` }} />
            </div>
            <div className="mt-3 grid gap-3 text-sm text-zinc-400 sm:grid-cols-3 lg:grid-cols-6">
              <span>{run.processedCount}/{run.totalQueued} processed</span>
              <span>{run.successCount} successful</span>
              <span>{run.failedCount} failed</span>
              <span>{run.retryCount} retries</span>
              <span>{run.rateLimitCount} rate limits</span>
              <span>ETA {duration(run.estimatedSeconds)}</span>
            </div>
          </>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className="flex flex-wrap gap-3 border-b border-zinc-800 p-4">
          <form onSubmit={(event) => { event.preventDefault(); setPage(1); void refresh(); }} className="flex min-w-64 flex-1 gap-2">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant or advertiser ID" className="input" />
            <button className="btn-secondary">Search</button>
          </form>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} className="input max-w-48">
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
              <tr><th className="table-cell">ID</th><th className="table-cell">Programme</th><th className="table-cell">Country</th><th className="table-cell">Relationship</th><th className="table-cell">Commission</th><th className="table-cell">Sync</th><th className="table-cell">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {merchants.map((merchant) => (
                <tr key={merchant.id} className="text-zinc-300">
                  <td className="table-cell font-mono">{merchant.advertiserId}</td>
                  <td className="table-cell"><div className="font-medium text-white">{merchant.programmeName ?? "Unnamed"}</div><div className="max-w-xs truncate text-xs text-red-400">{merchant.lastSyncError}</div></td>
                  <td className="table-cell">{merchant.countryCode ?? "—"}</td>
                  <td className="table-cell">{merchant.membershipStatus ?? "—"}</td>
                  <td className="table-cell">{merchant.commissionMin !== undefined ? `${merchant.commissionMin}–${merchant.commissionMax ?? merchant.commissionMin} ${merchant.commissionType ?? ""}` : "—"}</td>
                  <td className="table-cell"><span className={`status status-${merchant.syncStatus}`}>{merchant.syncStatus}</span></td>
                  <td className="table-cell">{merchant.detailsFetchedAt ? new Date(merchant.detailsFetchedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {merchants.length === 0 && <tr><td className="table-cell text-zinc-500" colSpan={7}>No merchants found.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800 p-4 text-sm text-zinc-400">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="btn-secondary">Previous</button><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="btn-secondary">Next</button></div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-3xl font-semibold text-white">{value.toLocaleString()}</p></div>;
}
