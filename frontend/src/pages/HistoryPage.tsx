import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listReviews, type ReviewListItem } from '../lib/api'

const VERDICT_DOT: Record<string, string> = {
  pass: 'bg-green-500',
  needs_changes: 'bg-amber-500',
  fail: 'bg-red-500',
  error: 'bg-slate-400',
  pending: 'bg-slate-300',
}

export default function HistoryPage() {
  const [items, setItems] = useState<ReviewListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listReviews().then(setItems).catch((e) => setError(e.message))
  }, [])

  if (error)
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
    )
  if (!items) return <p className="text-sm text-slate-500">Loading history…</p>

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Review history</h1>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          Nothing yet — <Link className="text-emerald-600 underline" to="/check">run your first pre-check</Link>.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                to={`/reviews/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${VERDICT_DOT[r.verdict]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{r.content_preview}</span>
                  <span className="block truncate text-xs text-slate-400">{r.summary}</span>
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {r.channel}
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
