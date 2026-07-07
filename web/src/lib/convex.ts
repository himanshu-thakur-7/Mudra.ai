// Convex client for the Astro React islands. `anyApi` is Convex's documented
// untyped-access proxy — it lets the frontend reference api.sessions.start etc.
// without the generated types (which live in the separate convex/ package and
// are produced by `npx convex dev`). Point PUBLIC_CONVEX_URL at the deployment.
import { ConvexReactClient } from 'convex/react'
import { anyApi } from 'convex/server'

export const api = anyApi

let _client: ConvexReactClient | null = null
export function convexClient(): ConvexReactClient | null {
  const url = import.meta.env.PUBLIC_CONVEX_URL
  if (!url) return null
  if (!_client) _client = new ConvexReactClient(url)
  return _client
}

// ---- UI-facing types (mirror the Convex tables) ----------------------------
export type AgentNode = 'Reviewer' | 'LinkupSearch' | 'Adjudicator' | 'Remediator' | 'VoiceOfficer'
export type SessionStatus =
  | 'QUEUED' | 'PARSING' | 'REVIEWING' | 'SEARCHING_LIVE' | 'ADJUDICATING'
  | 'REMEDIATING' | 'VOICE_STREAMING' | 'COMPLETED' | 'ERROR'
export type Severity = 'critical' | 'major' | 'minor'

export interface MonologueEntry { agent: AgentNode; status: 'thinking' | 'done' | 'error'; message: string; at: number }
export interface Violation {
  clauseId: string; severity: Severity; category: string; offendingText: string
  sentenceIndex?: number; rationale: string; suggestedFix: string; exposureWeight: number; confidence: number
}
export interface Session {
  draft: string; draftSentences: string[]; status: SessionStatus; activeAgent?: AgentNode
  verdict?: 'pass' | 'needs_changes' | 'fail' | 'error'; rewrittenText?: string; summary?: string
  riskScore: number; exposureInr: number; provider: string
}

export const AGENT_ORDER: AgentNode[] = ['Reviewer', 'LinkupSearch', 'Adjudicator', 'Remediator', 'VoiceOfficer']
