import { useMemo, useReducer, useRef, useState } from 'react'
import { ConvexProvider, useMutation, useQuery } from 'convex/react'
import { api, convexClient, type MonologueEntry, type Session, type Violation } from '../../lib/convex'
import WarRoomCanvas from './WarRoomCanvas'
import RiskRadar from './RiskRadar'
import StrikethroughEditor from './StrikethroughEditor'

const AUDIENCES = [
  { id: 'mfd', short: 'MFD', reg: 'SEBI · AMFI' },
  { id: 'ia-ra', short: 'IA / RA', reg: 'SEBI' },
  { id: 'nbfc-lsp', short: 'Lender', reg: 'RBI' },
  { id: 'insurance', short: 'Insurer', reg: 'IRDAI' },
]
const SAMPLE =
  'Market is looking incredibly bullish right now! If you want a guaranteed way to beat inflation, you need to put your money into the Nippon India Small Cap Fund today. My clients have easily seen 20%+ returns this year. Don’t miss out on these sure-shot gains, DM me to start your SIP! - Rajesh Sharma'

// Presentational shell: input + the three theater components.
function ConsoleView({ session, monologue, violations, onSubmit, busy }: {
  session: Session | null; monologue: MonologueEntry[]; violations: Violation[]
  onSubmit: (draft: string, audience: string) => void; busy: boolean
}) {
  const [draft, setDraft] = useState('')
  const [audience, setAudience] = useState('mfd')
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {!session && (
          <div className="glass glow-border rounded-2xl p-5">
            <div className="mb-3 grid grid-cols-4 gap-2">
              {AUDIENCES.map((a) => (
                <button key={a.id} onClick={() => setAudience(a.id)} disabled={busy}
                  className={`flex flex-col items-center rounded-xl px-2 py-2 transition-all ${audience === a.id ? 'bg-gradient-to-br from-brand-500 to-cyan-accent text-emerald-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                  <span className="text-sm font-bold">{a.short}</span>
                  <span className={`text-[10px] ${audience === a.id ? 'text-emerald-900' : 'text-slate-500'}`}>{a.reg}</span>
                </button>
              ))}
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy}
              placeholder="Paste a draft to interrogate…"
              className="h-32 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3.5 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none focus:ring-4 focus:ring-brand-500/10" />
            <div className="mt-3 flex items-center justify-between">
              <button onClick={() => setDraft(SAMPLE)} disabled={busy} className="text-xs font-medium text-brand-300 hover:text-brand-400">Load risky sample</button>
              <button onClick={() => onSubmit(draft, audience)} disabled={busy || !draft.trim()}
                className="rounded-xl bg-gradient-to-r from-brand-400 to-cyan-accent px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.03] disabled:opacity-40">
                Interrogate →
              </button>
            </div>
          </div>
        )}
        <StrikethroughEditor session={session} violations={violations} />
        <WarRoomCanvas session={session} monologue={monologue} />
      </div>
      <div className="lg:col-span-1">
        <RiskRadar riskScore={session?.riskScore ?? 0} exposureInr={session?.exposureInr ?? 0} violations={violations} />
      </div>
    </div>
  )
}

// ---- LIVE mode: bound to Convex reactive queries --------------------------
function LiveConsole() {
  const [sessionId, setSessionId] = useState<string | undefined>()
  const start = useMutation(api.sessions.start)
  const session = useQuery(api.sessions.get, sessionId ? { sessionId } : 'skip') as Session | null
  const monologue = (useQuery(api.monologue.stream, sessionId ? { sessionId } : 'skip') ?? []) as MonologueEntry[]
  const violations = (useQuery(api.violations.forSession, sessionId ? { sessionId } : 'skip') ?? []) as Violation[]
  const busy = !!session && session.status !== 'COMPLETED' && session.status !== 'ERROR'

  async function submit(draft: string, audience: string) {
    const id = await start({ orgId: 'demo', audience, channel: 'social', draft })
    setSessionId(id as string)
  }
  return <ConsoleView session={session ?? null} monologue={monologue} violations={violations} onSubmit={submit} busy={busy} />
}

// ---- DEMO mode: scripted theater when no Convex deployment is configured ---
type DemoState = { session: Session | null; monologue: MonologueEntry[]; violations: Violation[] }
function demoReducer(s: DemoState, a: Partial<DemoState>): DemoState { return { ...s, ...a } }

function DemoConsole() {
  const [state, patch] = useReducer(demoReducer, { session: null, monologue: [], violations: [] })
  const busy = useRef(false)

  function speak(text: string) {
    try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.03; window.speechSynthesis.speak(u) } catch { /* ignore */ }
  }

  async function submit(draft: string, audience: string) {
    if (busy.current) return
    busy.current = true
    const sentences = draft.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)
    const base: Session = { draft, draftSentences: sentences, status: 'REVIEWING', activeAgent: 'Reviewer', riskScore: 0, exposureInr: 0, provider: 'openai' }
    const mono: MonologueEntry[] = []
    const vios: Violation[] = []
    const push = (e: Omit<MonologueEntry, 'at'>) => { mono.push({ ...e, at: Date.now() }); patch({ monologue: [...mono] }) }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

    patch({ session: { ...base }, monologue: [], violations: [] })
    push({ agent: 'Reviewer', status: 'thinking', message: 'Reading the draft and pulling the applicable rulebook…' })
    await wait(1100)
    push({ agent: 'Reviewer', status: 'done', message: 'Retrieved 14 active clauses across 3 regulators (SEBI · AMFI).' })
    push({ agent: 'Reviewer', status: 'thinking', message: 'Scanning for plausible violations…' })
    await wait(1000)
    push({ agent: 'Reviewer', status: 'done', message: 'First-pass findings handed to the Adjudicator.' })
    patch({ session: { ...base, status: 'ADJUDICATING', activeAgent: 'Adjudicator' } })
    push({ agent: 'Adjudicator', status: 'thinking', message: 'Ruling on each finding against the verbatim clauses…' })
    await wait(1200)

    const demoVios: (Violation & { regulator: string })[] = [
      { clauseId: 'AMFI-COC-2022/4.g', severity: 'critical', category: 'assured_returns', offendingText: 'guaranteed way to beat inflation', sentenceIndex: 0, rationale: 'Implies assured, risk-free returns, which is expressly prohibited for mutual fund distributors.', suggestedFix: 'Remove any assurance of returns.', exposureWeight: 3_750_000, confidence: 0.95, regulator: 'AMFI' },
      { clauseId: 'AMFI-DOSDONTS-FAQ/Q10', severity: 'critical', category: 'scheme_specific', offendingText: 'put your money into the Nippon India Small Cap Fund today', sentenceIndex: 0, rationale: 'A scheme-specific recommendation to an unknown public audience without any suitability assessment.', suggestedFix: 'Keep it educational; do not name a specific scheme.', exposureWeight: 3_000_000, confidence: 0.9, regulator: 'AMFI' },
      { clauseId: 'AMFI-MASTERCIR-2026/1.3.6', severity: 'major', category: 'missing_disclosures', offendingText: '(missing: ARN + tagline + risk warning)', rationale: 'Mandatory ARN, the AMFI-registered tagline and the market-risk warning are absent.', suggestedFix: 'Add your ARN, tagline and the standard risk warning.', exposureWeight: 500_000, confidence: 0.99, regulator: 'AMFI' },
    ]
    let cum = 0
    for (const v of demoVios) {
      cum += v.exposureWeight
      vios.push(v); patch({ violations: [...vios] })
      const score = v.severity === 'critical' ? Math.max(84, Math.round((cum / 8_000_000) * 100)) : Math.round((cum / 8_000_000) * 100)
      patch({ session: { ...base, status: 'VOICE_STREAMING', activeAgent: 'VoiceOfficer', riskScore: Math.min(96, score), exposureInr: cum } })
      push({ agent: 'VoiceOfficer', status: 'thinking', message: `Reading out: ${v.clauseId}` })
      speak(`${v.severity} issue. ${v.rationale}`)
      await wait(1500)
    }
    push({ agent: 'Adjudicator', status: 'done', message: '3 violations upheld. Verdict: fail.' })
    patch({ session: { ...base, status: 'REMEDIATING', activeAgent: 'Remediator', riskScore: 96, exposureInr: cum } })
    push({ agent: 'Remediator', status: 'thinking', message: 'Drafting one cohesive compliant rewrite…' })
    await wait(1400)
    const rewrite = `Markets can be volatile and mutual funds carry risk — there are no guaranteed returns. If you'd like, I can help you understand how small-cap funds fit your goals and risk profile.\n\nRajesh Sharma · ARN-12345\nAMFI-registered Mutual Fund Distributor\nMutual fund investments are subject to market risks. Read all scheme related documents carefully before investing.`
    push({ agent: 'Remediator', status: 'done', message: 'Compliant version ready.' })
    speak('Here is a version you can post safely.')
    patch({ session: { ...base, status: 'COMPLETED', activeAgent: undefined, verdict: 'fail', rewrittenText: rewrite, riskScore: 96, exposureInr: cum, summary: `3 issues · ₹${(cum / 100000).toFixed(1)}L estimated exposure` } })
    busy.current = false
  }

  return <ConsoleView session={state.session} monologue={state.monologue} violations={state.violations} onSubmit={submit} busy={busy.current} />
}

export default function MudraConsole() {
  const client = useMemo(() => convexClient(), [])
  const [demo] = useState(!client)
  if (client && !demo) {
    return (
      <ConvexProvider client={client}>
        <LiveConsole />
      </ConvexProvider>
    )
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-2 text-[11px] text-slate-500">
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-300 ring-1 ring-amber-500/20">DEMO MODE</span>
        Set <code className="rounded bg-white/5 px-1">PUBLIC_CONVEX_URL</code> to run live on Convex + Hermes + ElevenLabs.
      </div>
      <DemoConsole />
    </div>
  )
}
