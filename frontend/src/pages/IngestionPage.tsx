import { useCallback, useEffect, useRef, useState } from 'react'
import { getIngestionStatus, triggerSweep, type IngestionStatus } from '../lib/api'

const REG_COLOR: Record<string, string> = {
  SEBI: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  AMFI: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  RBI: 'bg-amber-100 text-amber-700 border-amber-200',
  IRDAI: 'bg-rose-100 text-rose-700 border-rose-200',
}

const KIND_STYLE: Record<string, { color: string; icon: string }> = {
  sweep_start: { color: 'text-cyan-300', icon: '🛰' },
  unchanged: { color: 'text-slate-400', icon: '·' },
  changed: { color: 'text-amber-300', icon: '⚡' },
  stored: { color: 'text-emerald-300', icon: '⬇' },
  skipped: { color: 'text-slate-500', icon: '⊘' },
  fetch_failed: { color: 'text-rose-400', icon: '✗' },
  processed: { color: 'text-green-300', icon: '✂' },
  failed: { color: 'text-rose-400', icon: '☠' },
}

function StatCard({ label, value, accent, pulse }: { label: string; value: string | number; accent: string; pulse?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent} ${pulse ? 'animate-pulse' : ''}`}>{value}</p>
    </div>
  )
}

export default function IngestionPage() {
  const [status, setStatus] = useState<IngestionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(() => {
    getIngestionStatus()
      .then((s) => { setStatus(s); setError(null) })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    refresh()
    timer.current = setInterval(refresh, 2500)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [refresh])

  async function runSweep() {
    setStarting(true)
    try {
      await triggerSweep()
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  if (error && !status)
    return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  if (!status) return <p className="text-sm text-slate-500">Connecting to the fleet…</p>
  if (!status.redis)
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Redis is not reachable — start it with{' '}
        <code className="rounded bg-amber-100 px-1">redis-server --dir .redis</code> to bring the ingestion engine online.
      </p>
    )

  const sweeping = status.sweep_running
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Living regulatory knowledge base</h1>
          <p className="mt-1 text-sm text-slate-500">
            Go fleet · Redis token-bucket rate limiter · change detection · OCR cascade · legal chunker
          </p>
        </div>
        <button
          onClick={runSweep}
          disabled={sweeping || starting}
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors ${
            sweeping ? 'cursor-not-allowed bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {sweeping ? (
            <span className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
              </span>
              Sweep in progress…
            </span>
          ) : (
            '🛰 Run sweep now'
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Download queue" value={status.queues!.download} accent="text-indigo-600" pulse={status.queues!.download > 0} />
        <StatCard label="Process queue" value={status.queues!.process} accent="text-amber-600" pulse={status.queues!.process > 0} />
        <StatCard label="Dead-letter" value={status.queues!.failed} accent={status.queues!.failed > 0 ? 'text-rose-600' : 'text-slate-400'} />
        <StatCard label="Docs in object store" value={status.total_docs ?? 0} accent="text-emerald-600" />
        <StatCard label="Change events" value={status.total_change_events ?? 0} accent="text-slate-700" />
      </div>

      {status.doc_states && Object.keys(status.doc_states).length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Ingestion state machine
          </h2>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            {['DISCOVERED', 'DOWNLOADED', 'PARSED', 'CHUNKED', 'EMBEDDED', 'VERIFIED'].map((state, i) => (
              <div key={state} className="flex items-center gap-2">
                {i > 0 && <span className="text-slate-300">→</span>}
                <span
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    (status.doc_states![state] ?? 0) > 0
                      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                      : 'bg-slate-50 text-slate-400'
                  }`}
                >
                  {state}
                  <span className="ml-1.5 rounded bg-white/70 px-1 font-mono">{status.doc_states![state] ?? 0}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Watched regulator targets</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {status.targets?.map((t) => (
            <div key={t.url} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="relative flex h-3 w-3 shrink-0">
                {sweeping && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className={`relative inline-flex h-3 w-3 rounded-full ${sweeping ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
                <p className="truncate text-xs text-slate-400">{new URL(t.url).host}</p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${REG_COLOR[t.regulator] ?? ''}`}>
                {t.regulator}
              </span>
              <span className="text-xs text-slate-400" title="documents tracked">
                {t.seen} seen
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Live activity</h2>
          <div className="h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs shadow-inner">
            {!status.activity?.length && (
              <p className="text-slate-500">No fleet activity yet — run a sweep to watch the crawlers work.</p>
            )}
            {status.activity?.map((a, i) => {
              const s = KIND_STYLE[a.kind] ?? { color: 'text-slate-300', icon: '•' }
              return (
                <div key={`${a.ts}-${i}`} className="flex gap-2 py-0.5 leading-5">
                  <span className="shrink-0 text-slate-600">{a.ts.slice(11, 19)}</span>
                  <span className={`shrink-0 ${s.color}`}>{s.icon}</span>
                  <span className="shrink-0 text-slate-500">[{a.source}]</span>
                  {a.regulator && <span className="shrink-0 font-semibold text-slate-400">{a.regulator}</span>}
                  <span className={`${s.color} break-all`}>{a.detail}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Latest documents captured</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {!status.inbox?.length && <li className="p-3 text-xs text-slate-400">Object store is empty.</li>}
              {status.inbox?.map((f) => (
                <li key={f.file} className="flex items-center gap-2 px-3 py-2">
                  <span className={`rounded-full border px-1.5 text-[10px] font-semibold ${REG_COLOR[f.regulator] ?? ''}`}>
                    {f.regulator}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">{f.file}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{f.kb} KB</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent change events</h2>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {!status.recent_changes?.length && <li className="p-3 text-xs text-slate-400">No change events yet.</li>}
              {status.recent_changes?.map((c, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className={`rounded-full border px-1.5 text-[10px] font-semibold ${REG_COLOR[c.regulator] ?? ''}`}>
                    {c.regulator}
                  </span>
                  <span className="flex-1 text-slate-600">
                    {c.n_chunks} clauses chunked <span className="text-slate-400">({c.method})</span>
                    {(c.supersession_hints ?? 0) > 0 && (
                      <span className="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                        ⚠ {c.supersession_hints} supersession hint{c.supersession_hints! > 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
