import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import FindingCard from '../components/FindingCard'
import VerdictBanner from '../components/VerdictBanner'
import { downloadAuditPdf, getReview, type Review } from '../lib/api'

export default function ReviewResultPage() {
  const { id } = useParams<{ id: string }>()
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    getReview(id)
      .then(setReview)
      .catch((e) => setError(e.message))
  }, [id])

  if (error)
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error} — <Link className="underline" to="/">back to checker</Link>
      </p>
    )
  if (!review) return <p className="text-sm text-slate-500">Loading review…</p>

  async function copyRewrite() {
    if (!review?.rewrite) return
    await navigator.clipboard.writeText(review.rewrite)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <VerdictBanner verdict={review.verdict} summary={review.summary} />
        <button
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
          onClick={() => downloadAuditPdf(review.id)}
        >
          ⬇ Audit PDF
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Original ({review.channel} · {review.audience.toUpperCase()})
          </h2>
          <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 font-sans text-sm shadow-sm">
            {review.content}
          </pre>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Compliant rewrite
          </h2>
          {review.rewrite ? (
            <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 shadow-sm">
              <pre className="whitespace-pre-wrap font-sans text-sm">{review.rewrite}</pre>
              <button
                className="mt-3 rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800"
                onClick={copyRewrite}
              >
                {copied ? 'Copied ✓' : 'Copy rewrite'}
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
              {review.verdict === 'pass'
                ? 'No rewrite needed — content passed the pre-check.'
                : 'No rewrite available.'}
            </p>
          )}
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Findings ({review.findings.length})
        </h2>
        {review.findings.length === 0 ? (
          <p className="text-sm text-slate-500">No violations found.</p>
        ) : (
          <div className="space-y-3">
            {review.findings.map((f, i) => (
              <FindingCard key={f.id} finding={f} index={i + 1} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Review {review.id} · SHA-256 {review.content_sha256.slice(0, 16)}… ·{' '}
        {new Date(review.created_at).toLocaleString()}
      </p>
    </div>
  )
}
