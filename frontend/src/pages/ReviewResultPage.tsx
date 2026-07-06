import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import IssueCard from '../components/IssueCard'
import { downloadAuditPdf, getReview, type Review, type Verdict } from '../lib/api'

const VERDICT: Record<Verdict, { label: string; sub: string; ring: string; dot: string; icon: string }> = {
  pass: { label: 'Cleared to post', sub: 'No compliance issues found.', ring: 'ring-emerald-200 bg-emerald-50', dot: 'bg-emerald-500', icon: '✓' },
  needs_changes: { label: 'Needs changes', sub: 'Fix the issues below before posting.', ring: 'ring-amber-200 bg-amber-50', dot: 'bg-amber-500', icon: '!' },
  fail: { label: 'Do not post', sub: 'Prohibited content detected — use the compliant version below.', ring: 'ring-red-200 bg-red-50', dot: 'bg-red-500', icon: '✕' },
  error: { label: 'Partial review', sub: 'AI service was unavailable; rule checks still ran.', ring: 'ring-slate-200 bg-slate-50', dot: 'bg-slate-400', icon: 'i' },
  pending: { label: 'Pending', sub: '', ring: 'ring-slate-200 bg-slate-50', dot: 'bg-slate-300', icon: '…' },
}

export default function ReviewResultPage() {
  const { id } = useParams<{ id: string }>()
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    getReview(id).then(setReview).catch((e) => setError(e.message))
  }, [id])

  if (error)
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error} — <Link className="underline" to="/">back to checker</Link>
      </p>
    )
  if (!review)
    return (
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
        Loading review…
      </div>
    )

  const v = VERDICT[review.verdict]
  const counts = { critical: 0, major: 0, minor: 0 }
  review.issues.forEach((i) => (counts[i.severity] += 1))

  async function copyRewrite() {
    if (!review?.rewrite) return
    await navigator.clipboard.writeText(review.rewrite)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="space-y-6">
      {/* Verdict header */}
      <div className={`animate-rise flex items-center gap-4 rounded-2xl px-5 py-4 ring-1 ${v.ring}`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${v.dot}`}>
          {v.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">{v.label}</h1>
          <p className="text-sm text-slate-600">{v.sub}</p>
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          {counts.critical > 0 && <Pill n={counts.critical} label="critical" cls="bg-red-100 text-red-700" />}
          {counts.major > 0 && <Pill n={counts.major} label="major" cls="bg-amber-100 text-amber-700" />}
          {counts.minor > 0 && <Pill n={counts.minor} label="minor" cls="bg-blue-100 text-blue-700" />}
        </div>
      </div>

      {/* Rewrite hero — the primary remediation */}
      {review.rewrite && (
        <section className="animate-rise overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white shadow-sm">
          <div className="flex items-center justify-between border-b border-emerald-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500 text-xs font-bold text-white">✓</span>
              <h2 className="text-sm font-semibold text-emerald-900">Ready-to-post compliant version</h2>
            </div>
            <button
              onClick={copyRewrite}
              className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap px-5 py-4 font-sans text-[15px] leading-relaxed text-slate-800">
            {review.rewrite}
          </pre>
        </section>
      )}

      {/* Original + issues */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your original ({review.channel} · {review.audience.toUpperCase()})
          </h2>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-600">{review.content}</pre>
          </div>
          <button
            onClick={() => downloadAuditPdf(review.id)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            ⬇ Download audit trail (PDF)
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Review {review.id.slice(0, 8)} · SHA-256 {review.content_sha256.slice(0, 12)}… ·{' '}
            {new Date(review.created_at).toLocaleString()}
          </p>
        </div>

        <div className="lg:col-span-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {review.issues.length === 0 ? 'No issues' : `${review.issues.length} issue${review.issues.length > 1 ? 's' : ''} to resolve`}
          </h2>
          {review.issues.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 text-center text-sm text-emerald-700">
              This content is compliant with the applicable SEBI/AMFI/RBI/IRDAI rules.
            </div>
          ) : (
            <div className="space-y-3">
              {review.issues.map((issue, i) => (
                <IssueCard key={issue.key} issue={issue} index={i + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Pill({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {n} {label}
    </span>
  )
}
