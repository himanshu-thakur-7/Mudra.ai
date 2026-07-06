import { useState } from 'react'
import type { Issue } from '../lib/api'

const SEV: Record<string, { chip: string; bar: string; label: string }> = {
  critical: { chip: 'bg-red-100 text-red-700', bar: 'bg-red-500', label: 'Critical' },
  major: { chip: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', label: 'Major' },
  minor: { chip: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', label: 'Minor' },
}

const REG_DOT: Record<string, string> = {
  SEBI: 'bg-indigo-500',
  AMFI: 'bg-emerald-500',
  RBI: 'bg-amber-500',
  IRDAI: 'bg-rose-500',
}

export default function IssueCard({ issue, index }: { issue: Issue; index: number }) {
  const [showClauses, setShowClauses] = useState(false)
  const sev = SEV[issue.severity] ?? SEV.minor

  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex">
        <div className={`w-1 shrink-0 ${sev.bar}`} />
        <div className="min-w-0 flex-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-slate-300">{String(index).padStart(2, '0')}</span>
              <h3 className="text-base font-semibold text-slate-900">{issue.title}</h3>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${sev.chip}`}>
              {sev.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{issue.blurb}</p>

          {/* Offending spans, highlighted */}
          {issue.spans.length > 0 && (
            <div className="mt-3 space-y-2">
              {issue.spans.map((s, i) => (
                <div key={i} className="rounded-lg bg-red-50/60 px-3 py-2">
                  <p className="text-sm text-slate-800">
                    <mark className="rounded bg-red-200/70 px-1 py-0.5 font-medium text-red-900">
                      {s.text}
                    </mark>
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{s.explanation}</p>
                </div>
              ))}
            </div>
          )}

          {/* Missing requirement chips */}
          {issue.missing_requirements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {issue.missing_requirements.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
                >
                  <span className="text-amber-500">+</span> {r}
                </span>
              ))}
            </div>
          )}

          {/* Provenance chips — the courtroom-grade lineage */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {issue.citations.map((c) => (
              <div
                key={c.clause_id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs ring-1 ring-slate-200"
                title={`${c.doc_title}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${REG_DOT[c.regulator] ?? 'bg-slate-400'}`} />
                <span className="font-mono font-medium text-slate-700">{c.clause_id}</span>
                {c.source_page && <span className="text-slate-400">p.{c.source_page}</span>}
                <span
                  className={`rounded px-1 text-[10px] font-semibold ${
                    c.doc_status === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {c.doc_status}
                </span>
              </div>
            ))}
            <button
              onClick={() => setShowClauses((v) => !v)}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              {showClauses ? 'Hide' : 'View'} regulation text
            </button>
          </div>

          {showClauses && (
            <div className="mt-3 space-y-2">
              {issue.citations.map((c) => (
                <div key={c.clause_id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-slate-600">{c.clause_id}</span>
                    {c.source_url && (
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Source PDF ↗
                      </a>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">“{c.clause_quote}”</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
