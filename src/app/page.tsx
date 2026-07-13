export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
        Awin Merchant Sync
      </h1>
      <p className="mt-4 text-lg text-zinc-600">Phase 2 configured</p>
      <div className="mt-8 space-y-4">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Import all programmes
          </p>
          <p className="mt-2 font-mono text-sm text-zinc-800">
            POST /api/awin/import-programmes
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Check import status
          </p>
          <p className="mt-2 font-mono text-sm text-zinc-800">
            GET /api/awin/import-programmes/status
          </p>
        </div>
      </div>
    </main>
  );
}
