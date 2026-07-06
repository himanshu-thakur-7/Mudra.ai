const TOKEN = import.meta.env.VITE_API_TOKEN ?? 'dev-token'

export type Severity = 'critical' | 'major' | 'minor'
export type Verdict = 'pass' | 'needs_changes' | 'fail' | 'error' | 'pending'

export interface Finding {
  id: string
  source: 'deterministic' | 'llm'
  severity: Severity
  clause_id: string | null
  clause_quote: string
  offending_text: string
  explanation: string
  suggested_fix: string
  adjudication: string
  confidence: number
}

export interface Review {
  id: string
  channel: string
  audience: string
  language: string
  content: string
  content_sha256: string
  verdict: Verdict
  rewrite: string | null
  summary: string
  created_at: string
  findings: Finding[]
}

export interface ReviewListItem {
  id: string
  channel: string
  verdict: Verdict
  summary: string
  created_at: string
  content_preview: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${detail || res.statusText}`)
  }
  return res.json()
}

export function createReview(body: {
  content: string
  channel: string
  audience: string
}): Promise<Review> {
  return request('/reviews', { method: 'POST', body: JSON.stringify(body) })
}

export function getReview(id: string): Promise<Review> {
  return request(`/reviews/${id}`)
}

export function listReviews(): Promise<ReviewListItem[]> {
  return request('/reviews')
}

export interface IngestionActivity {
  ts: string
  source: 'watcher' | 'downloader' | 'consumer'
  kind: string
  regulator?: string
  detail: string
}

export interface IngestionStatus {
  redis: boolean
  sweep_running?: boolean
  queues?: { download: number; process: number; failed: number }
  targets?: { regulator: string; name: string; url: string; seen: number }[]
  inbox?: { file: string; regulator: string; kb: number }[]
  total_docs?: number
  total_change_events?: number
  doc_states?: Record<string, number>
  recent_changes?: {
    regulator: string
    n_chunks: number
    method: string
    status: string
    created_at: string
    supersession_hints?: number
  }[]
  activity?: IngestionActivity[]
}

export function getIngestionStatus(): Promise<IngestionStatus> {
  return request('/ingestion/status')
}

export function triggerSweep(): Promise<{ started: boolean }> {
  return request('/ingestion/sweep', { method: 'POST' })
}

export async function downloadAuditPdf(reviewId: string): Promise<void> {
  const res = await fetch(`/api/audit/${reviewId}/pdf`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`PDF download failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-${reviewId.slice(0, 8)}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
