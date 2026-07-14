import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <div className="w-full rounded-3xl border border-zinc-800 bg-zinc-950/90 p-8 shadow-2xl sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Awin Commission Rates
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Complete merchant directory and commission sync platform
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
          Imports all Awin programmes, queues programme details, respects the
          20-requests-per-minute limit, resumes after restarts, and exports the
          final merchant dataset.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">
            Open admin dashboard
          </Link>
          <a href="/api/health" className="btn-secondary">
            Health endpoint
          </a>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <Feature title="Phase 1–2" text="API client, MongoDB models, full programme directory import." />
          <Feature title="Phase 3" text="Resumable rate-limited background detail worker with retries." />
          <Feature title="Phase 4–5" text="Dashboard, controls, CSV export, PM2, scheduler, and CI." />
        </div>
      </div>
    </main>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{text}</p>
    </div>
  );
}
