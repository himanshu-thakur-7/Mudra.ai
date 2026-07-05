import type { Finding } from '../lib/api'

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  major: 'bg-amber-100 text-amber-700',
  minor: 'bg-blue-100 text-blue-700',
}

export default function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-500">#{index}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${SEV_BADGE[finding.severity] ?? ''}`}
        >
          {finding.severity}
        </span>
        {finding.clause_id && (
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
            {finding.clause_id}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {finding.source === 'deterministic' ? 'rule check' : `AI · ${finding.adjudication}`}
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-800">{finding.explanation}</p>

      {finding.offending_text && !finding.offending_text.startsWith('(') && (
        <p className="mt-2 border-l-2 border-red-300 pl-3 text-sm italic text-slate-600">
          “{finding.offending_text}”
        </p>
      )}

      {finding.clause_quote && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600">
            Show clause text (verbatim)
          </summary>
          <p className="mt-1 rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-600">
            {finding.clause_quote}
          </p>
        </details>
      )}

      {finding.suggested_fix && (
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-medium text-green-700">Fix:</span> {finding.suggested_fix}
        </p>
      )}
    </div>
  )
}
