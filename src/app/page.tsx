export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
        Awin Merchant Sync
      </h1>
      <p className="mt-4 text-lg text-zinc-600">Phase 1 configured</p>
      <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Test endpoint
        </p>
        <p className="mt-2 font-mono text-sm text-zinc-800">
          POST /api/awin/test-program
        </p>
      </div>
    </main>
  );
}
