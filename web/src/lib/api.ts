// Client for the FastAPI backend (proxied at /api).
const TOKEN = import.meta.env.PUBLIC_API_TOKEN ?? 'dev-token'

export type Severity = 'critical' | 'major' | 'minor'
export type Verdict = 'pass' | 'needs_changes' | 'fail' | 'error' | 'pending'

export interface ClauseCitation {
  clause_id: string
  clause_quote: string
  regulator: string
  doc_title: string
  source_page: number | null
  source_url: string
  doc_status: string
}
export interface OffendingSpan {
  text: string; explanation: string; source: string; confidence: number
}
export interface Issue {
  key: string; title: string; blurb: string; severity: Severity
  citations: ClauseCitation[]; spans: OffendingSpan[]; missing_requirements: string[]
}
export interface Review {
  id: string; channel: string; audience: string; language: string
  content: string; content_sha256: string; verdict: Verdict
  rewrite: string | null; summary: string; created_at: string
  issues: Issue[]
}
export interface NarrationSegment { kind: string; label: string; text: string }
export interface Narration { script: string; segments: NarrationSegment[]; tts: string; voice_available: boolean }
export interface Partner { key: string; name: string; role: string; live: boolean }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...init?.headers },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text().catch(() => '')) || res.statusText}`)
  return res.json()
}

export const createReview = (b: { content: string; channel: string; audience: string }) =>
  req<Review>('/reviews', { method: 'POST', body: JSON.stringify(b) })
export const getReview = (id: string) => req<Review>(`/reviews/${id}`)
export const getNarration = (id: string) => req<Narration>(`/reviews/${id}/narration`)
export const getPartners = () => req<{ agent_provider: string; partners: Partner[] }>('/system/partners')

export function voiceUrl(id: string) { return `/api/reviews/${id}/voice.mp3` }

export async function downloadAuditPdf(id: string) {
  const res = await fetch(`/api/audit/${id}/pdf`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) throw new Error(`PDF ${res.status}`)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = `audit-${id.slice(0, 8)}.pdf`; a.click()
  URL.revokeObjectURL(url)
}
