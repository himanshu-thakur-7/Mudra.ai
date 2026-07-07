// ============================================================================
//  Mudra.ai — Phase 4: the Compliance War Room (Astro React island).
//  Binds directly to the reactive Convex tables (session · monologue ·
//  violations). Every panel re-renders over WebSockets the instant the Convex
//  pipeline mutates state — no polling, no local orchestration.
// ============================================================================
import { useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion'
import { useQuery } from 'convex/react'
import { api } from '../lib/convex'

// ---- types mirroring the Convex tables -------------------------------------
type AgentNode = 'Embedder' | 'Retriever' | 'Adjudicator' | 'Remediator' | 'VoiceOfficer'
type Criticality = 'critical' | 'major' | 'minor'
interface Session {
  _id: string; rawInputDraft: string; sessionStatus: string
  remediatedText?: string; riskScore: number
}
interface Thought { _id: string; activeNode: AgentNode; thoughtDetails: string; timestamp: number }
interface Violation { _id: string; targetPhrase: string; criticality: Criticality; explanation: string; suggestedFix: string }

const NODES: { id: AgentNode; label: string; glyph: string; color: string }[] = [
  { id: 'Embedder', label: 'Embedder', glyph: '🧬', color: '#22d3ee' },
  { id: 'Retriever', label: 'Retriever', glyph: '🔍', color: '#60a5fa' },
  { id: 'Adjudicator', label: 'Adjudicator', glyph: '⚖️', color: '#f59e0b' },
  { id: 'Remediator', label: 'Remediator', glyph: '✍️', color: '#34d399' },
  { id: 'VoiceOfficer', label: 'Voice', glyph: '🔊', color: '#f472b6' },
]
const SEV_COLOR: Record<Criticality, string> = { critical: '#ef4444', major: '#f59e0b', minor: '#38bdf8' }

export default function ComplianceWarRoom({ sessionId }: { sessionId: string }) {
  const session = useQuery(api.sessions.getSession, sessionId ? { sessionId } : 'skip') as Session | null | undefined
  const monologue = (useQuery(api.monologue.getMonologue, sessionId ? { sessionId } : 'skip') ?? []) as Thought[]
  const violations = (useQuery(api.violations.getViolations, sessionId ? { sessionId } : 'skip') ?? []) as Violation[]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <TextCanvas session={session ?? null} violations={violations} />
        <AgentExecutionGrid monologue={monologue} status={session?.sessionStatus} />
      </div>
      <RiskRadar riskScore={session?.riskScore ?? 0} violations={violations} />
    </div>
  )
}

/* -------------------------------------------------- 546-Crore Risk Radar -- */
function RiskRadar({ riskScore, violations }: { riskScore: number; violations: Violation[] }) {
  const R = 78
  const CIRC = 2 * Math.PI * R
  const spring = useSpring(0, { stiffness: 60, damping: 18 })
  useEffect(() => { spring.set(Math.min(100, riskScore)) }, [riskScore, spring])
  const dash = useTransform(spring, (s) => `${(s / 100) * CIRC} ${CIRC}`)

  // Glowing red past 60%.
  const danger = riskScore > 60
  const color = danger ? '#ef4444' : riskScore > 35 ? '#f59e0b' : '#34d399'
  // Illustrative ₹ exposure anchored to real SEBI/RBI penalty scale.
  const exposureCr = ((riskScore / 100) * 546).toFixed(1)

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      {danger && (
        <motion.div className="pointer-events-none absolute inset-0"
          animate={{ opacity: [0.15, 0.4, 0.15] }} transition={{ duration: 1.3, repeat: Infinity }}
          style={{ background: 'radial-gradient(60% 60% at 50% 42%, #ef444455, transparent 70%)' }} />
      )}
      <div className="relative flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">₹546 Cr Risk Radar</h3>
        {danger && (
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.9, repeat: Infinity }}
            className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-500/40">
            ⚠ CRITICAL EXPOSURE
          </motion.span>
        )}
      </div>

      <div className="relative mx-auto mt-3 h-48 w-48">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="12" />
          <motion.circle cx="90" cy="90" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            style={{ strokeDasharray: dash as any, filter: `drop-shadow(0 0 8px ${color})` }} />
        </svg>
        <motion.div className="absolute inset-0 flex flex-col items-center justify-center"
          animate={danger ? { scale: [1, 1.05, 1] } : { scale: 1 }} transition={{ duration: 1.1, repeat: danger ? Infinity : 0 }}>
          <span className="text-4xl font-extrabold" style={{ color }}>{Math.round(riskScore)}</span>
          <span className="text-[11px] uppercase tracking-wider text-slate-500">risk score</span>
        </motion.div>
      </div>

      <div className="relative mt-3 rounded-xl bg-black/30 p-3 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Estimated regulatory exposure</div>
        <div className="text-2xl font-bold" style={{ color }}>₹{exposureCr} Cr</div>
        <div className="mt-1 text-[11px] text-slate-500">
          {violations.length} violation{violations.length !== 1 ? 's' : ''}
          {violations.filter((v) => v.criticality === 'critical').length > 0 &&
            ` · ${violations.filter((v) => v.criticality === 'critical').length} critical`}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------- Agent Execution Grid ------ */
function AgentExecutionGrid({ monologue, status }: { monologue: Thought[]; status?: string }) {
  const active = monologue.length ? monologue[monologue.length - 1].activeNode : undefined
  const seen = new Set(monologue.map((m) => m.activeNode))
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [monologue.length])

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Agent Execution Grid</h3>
        <span className="font-mono text-[11px] text-slate-500">{status ?? 'idle'}</span>
      </div>

      <div className="mb-4 flex items-center justify-between">
        {NODES.map((n, i) => {
          const isActive = active === n.id
          const isDone = seen.has(n.id) && !isActive
          return (
            <div key={n.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <motion.div
                  animate={isActive ? { scale: [1, 1.12, 1], boxShadow: `0 0 22px ${n.color}` } : { scale: 1 }}
                  transition={{ duration: 1.1, repeat: isActive ? Infinity : 0 }}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl text-base"
                  style={{
                    background: isActive ? `${n.color}22` : isDone ? '#10b98118' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${isActive ? n.color : isDone ? '#10b98155' : 'rgba(255,255,255,.1)'}`,
                  }}>
                  {isDone ? <span className="text-brand-400">✓</span> : n.glyph}
                </motion.div>
                <span className={`text-[10px] ${isActive ? 'text-white' : isDone ? 'text-brand-300' : 'text-slate-500'}`}>{n.label}</span>
              </div>
              {i < NODES.length - 1 && <div className="mx-1 h-px flex-1 bg-white/10" />}
            </div>
          )
        })}
      </div>

      {/* terminal-like stream of thoughts */}
      <div ref={scrollRef} className="max-h-52 space-y-1 overflow-y-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-5">
        <AnimatePresence initial={false}>
          {monologue.map((m) => {
            const meta = NODES.find((n) => n.id === m.activeNode)
            return (
              <motion.div key={m._id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                <span className="shrink-0 text-slate-600">{new Date(m.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                <span style={{ color: meta?.color }}>▸</span>
                <span className="shrink-0 text-slate-500">[{m.activeNode}]</span>
                <span className="text-slate-300">{m.thoughtDetails}</span>
              </motion.div>
            )
          })}
          {monologue.length === 0 && <span className="text-slate-600">Awaiting interrogation…</span>}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ----------------------------------------------- Text Canvas + Voice ------ */
function TextCanvas({ session, violations }: { session: Session | null; violations: Violation[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // When the pipeline enters VOICE_STREAMING, trigger the voice stream.
  useEffect(() => {
    if (session?.sessionStatus === 'VOICE_STREAMING') {
      if (!audioRef.current) {
        const a = new Audio(`/api/voice/stream?session=${session._id}`)
        audioRef.current = a
        a.play().catch(() => {/* autoplay blocked; user can click */})
      }
    } else if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }, [session?.sessionStatus, session?._id])

  // Highlight each offending phrase inside the draft.
  const highlighted = useMemo(() => {
    if (!session) return null
    let text = session.rawInputDraft
    const spans = violations.filter((v) => v.targetPhrase && !v.targetPhrase.startsWith('(')).map((v) => v.targetPhrase)
    if (!spans.length) return [{ text, sev: null as Criticality | null }]
    const parts: { text: string; sev: Criticality | null }[] = []
    let rest = text
    // Greedy pass: split around each target phrase, tagging its severity.
    for (const v of violations) {
      if (!v.targetPhrase || v.targetPhrase.startsWith('(')) continue
      const idx = rest.toLowerCase().indexOf(v.targetPhrase.toLowerCase())
      if (idx === -1) continue
      if (idx > 0) parts.push({ text: rest.slice(0, idx), sev: null })
      parts.push({ text: rest.slice(idx, idx + v.targetPhrase.length), sev: v.criticality })
      rest = rest.slice(idx + v.targetPhrase.length)
    }
    if (rest) parts.push({ text: rest, sev: null })
    return parts
  }, [session, violations])

  if (!session) return <div className="glass rounded-2xl p-5 text-sm text-slate-500">Submit a draft to open the War Room.</div>

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Draft under interrogation</h3>
        {session.sessionStatus === 'VOICE_STREAMING' && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-pink-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink-400" /> voice streaming
          </span>
        )}
      </div>
      <p className="rounded-xl bg-black/20 p-4 text-[15px] leading-relaxed">
        {highlighted?.map((p, i) =>
          p.sev ? (
            <motion.mark key={i} initial={{ backgroundColor: 'transparent' }} animate={{ backgroundColor: `${SEV_COLOR[p.sev]}33` }}
              className="rounded px-0.5 line-through decoration-2" style={{ color: '#e2e8f0', textDecorationColor: SEV_COLOR[p.sev] }}>
              {p.text}
            </motion.mark>
          ) : (
            <span key={i} className="text-slate-200">{p.text}</span>
          ),
        )}
      </p>

      <AnimatePresence>
        {session.remediatedText && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.5 }}
            className="mt-4 overflow-hidden rounded-xl border border-brand-500/25 bg-brand-500/[0.07]">
            <div className="flex items-center gap-2 border-b border-brand-500/20 px-4 py-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-[10px] text-emerald-950">✓</span>
              <span className="text-sm font-semibold text-brand-200">Compliant rewrite</span>
            </div>
            <p className="whitespace-pre-wrap px-4 py-3.5 text-[15px] leading-relaxed text-slate-100">{session.remediatedText}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
