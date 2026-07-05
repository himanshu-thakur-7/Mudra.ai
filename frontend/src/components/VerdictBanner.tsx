import { useTranslation } from 'react-i18next'
import type { Verdict } from '../lib/api'

const STYLES: Record<Verdict, { box: string; icon: string }> = {
  pass: { box: 'border-green-300 bg-green-50 text-green-800', icon: '✅' },
  needs_changes: { box: 'border-amber-300 bg-amber-50 text-amber-800', icon: '⚠️' },
  fail: { box: 'border-red-300 bg-red-50 text-red-800', icon: '🚫' },
  error: { box: 'border-slate-300 bg-slate-100 text-slate-700', icon: 'ℹ️' },
  pending: { box: 'border-slate-300 bg-slate-100 text-slate-700', icon: '⏳' },
}

export default function VerdictBanner({ verdict, summary }: { verdict: Verdict; summary: string }) {
  const { t } = useTranslation()
  const s = STYLES[verdict] ?? STYLES.pending
  return (
    <div className={`rounded-lg border px-4 py-3 ${s.box}`}>
      <p className="text-base font-semibold">
        {s.icon} {t(`verdict.${verdict}`)}
      </p>
      {summary && <p className="mt-1 text-sm opacity-90">{summary}</p>}
    </div>
  )
}
