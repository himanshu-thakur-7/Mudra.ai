import { motion, AnimatePresence } from 'framer-motion'
import { AGENT_ORDER, type AgentNode, type MonologueEntry, type Session } from '../../lib/convex'

// The Multi-Agent War Room: a node graph (Reviewer → Linkup → Adjudicator →
// Remediator → Voice) that lights the active node and streams its monologue.
// Presentational — driven by the reactive session + monologue from Convex.

const NODE_META: Record<AgentNode, { label: string; glyph: string; color: string }> = {
  Reviewer: { label: 'Reviewer', glyph: '🔍', color: '#22d3ee' },
  LinkupSearch: { label: 'Linkup', glyph: '🌐', color: '#a78bfa' },
  Adjudicator: { label: 'Adjudicator', glyph: '⚖️', color: '#f59e0b' },
  Remediator: { label: 'Remediator', glyph: '✍️', color: '#34d399' },
  VoiceOfficer: { label: 'Voice', glyph: '🔊', color: '#f472b6' },
}

export default function WarRoomCanvas({ session, monologue }: { session: Session | null; monologue: MonologueEntry[] }) {
  const active = session?.activeAgent
  const done = new Set(monologue.filter((m) => m.status === 'done').map((m) => m.agent))
  const running = session && session.status !== 'COMPLETED' && session.status !== 'ERROR' && session.status !== 'QUEUED'

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Multi-Agent War Room</h3>
        <span className="text-[11px] font-medium text-slate-400">
          {session?.provider ? `via ${session.provider === 'hermes' ? 'Nous Hermes' : 'OpenAI'}` : 'idle'}
        </span>
      </div>

      {/* node graph */}
      <div className="flex items-center justify-between">
        {AGENT_ORDER.map((node, i) => {
          const meta = NODE_META[node]
          const isActive = active === node
          const isDone = done.has(node) && !isActive
          return (
            <div key={node} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <motion.div
                  animate={isActive ? { scale: [1, 1.12, 1], boxShadow: `0 0 24px ${meta.color}` } : { scale: 1 }}
                  transition={{ duration: 1.2, repeat: isActive ? Infinity : 0 }}
                  className="relative flex h-12 w-12 items-center justify-center rounded-2xl text-lg"
                  style={{
                    background: isActive ? `${meta.color}22` : isDone ? '#10b98118' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${isActive ? meta.color : isDone ? '#10b98155' : 'rgba(255,255,255,.1)'}`,
                  }}
                >
                  {isDone ? <span className="text-brand-400">✓</span> : meta.glyph}
                  {isActive && (
                    <motion.span
                      className="absolute inset-0 rounded-2xl"
                      style={{ border: `1px solid ${meta.color}` }}
                      animate={{ opacity: [0.8, 0], scale: [1, 1.5] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  )}
                </motion.div>
                <span className={`text-[11px] font-medium ${isActive ? 'text-white' : isDone ? 'text-brand-300' : 'text-slate-500'}`}>
                  {meta.label}
                </span>
              </div>
              {i < AGENT_ORDER.length - 1 && (
                <div className="mx-1 h-px flex-1 overflow-hidden bg-white/10">
                  <motion.div
                    className="h-full bg-gradient-to-r from-transparent via-brand-400 to-transparent"
                    initial={{ x: '-100%' }}
                    animate={done.has(node) || isActive ? { x: '100%' } : { x: '-100%' }}
                    transition={{ duration: 1.1, repeat: done.has(node) && running ? Infinity : 0 }}
                    style={{ width: '60%' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* streaming monologue */}
      <div className="mt-5 max-h-52 space-y-1.5 overflow-y-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-5">
        <AnimatePresence initial={false}>
          {monologue.slice(-40).map((m, i) => {
            const meta = NODE_META[m.agent]
            return (
              <motion.div key={`${m.at}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                className="flex gap-2">
                <span style={{ color: meta?.color }}>{m.status === 'thinking' ? '▸' : m.status === 'error' ? '✕' : '✓'}</span>
                <span className="shrink-0 text-slate-500">[{m.agent}]</span>
                <span className={m.status === 'error' ? 'text-rose-300' : 'text-slate-300'}>{m.message}</span>
              </motion.div>
            )
          })}
          {monologue.length === 0 && <span className="text-slate-600">Awaiting interrogation…</span>}
        </AnimatePresence>
      </div>
    </div>
  )
}
