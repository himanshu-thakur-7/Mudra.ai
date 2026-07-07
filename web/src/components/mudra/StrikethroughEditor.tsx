import { motion, AnimatePresence } from 'framer-motion'
import type { Session, Violation } from '../../lib/convex'

// Live Strikethrough editor: renders the draft sentence-by-sentence. As each
// violation broadcasts (reactive Convex push), the offending sentence is
// crossed out and washed blood-red; when the Remediator finishes, the compliant
// rewrite fades in below.

const SEV_WASH: Record<string, string> = {
  critical: 'bg-red-500/15 decoration-red-400',
  major: 'bg-amber-500/12 decoration-amber-400',
  minor: 'bg-sky-500/10 decoration-sky-400',
}

export default function StrikethroughEditor({ session, violations }: { session: Session | null; violations: Violation[] }) {
  if (!session) {
    return <div className="glass rounded-2xl p-5 text-sm text-slate-500">Submit a draft to begin the interrogation.</div>
  }
  // Map sentence index -> worst violation touching it.
  const bySentence = new Map<number, Violation>()
  for (const v of violations) {
    if (v.sentenceIndex == null) continue
    const cur = bySentence.get(v.sentenceIndex)
    if (!cur || sevRank(v.severity) < sevRank(cur.severity)) bySentence.set(v.sentenceIndex, v)
  }
  const flaggedSpans = violations.filter((v) => v.sentenceIndex == null && v.offendingText && !v.offendingText.startsWith('('))

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Your draft, under interrogation</h3>
        <StatusPill status={session.status} />
      </div>

      <div className="rounded-xl bg-black/20 p-4 text-[15px] leading-relaxed">
        {session.draftSentences.map((sentence, i) => {
          const vio = bySentence.get(i) ?? matchSpan(sentence, flaggedSpans)
          return (
            <motion.span key={i} className="relative">
              {vio ? (
                <motion.span
                  initial={{ backgroundColor: 'transparent' }}
                  animate={{ backgroundColor: 'currentColor' }}
                  className={`rounded px-0.5 line-through decoration-2 ${SEV_WASH[vio.severity] ?? ''}`}
                  style={{ color: 'inherit' }}
                >
                  <span className="text-slate-400/80">{sentence} </span>
                </motion.span>
              ) : (
                <span className="text-slate-200">{sentence} </span>
              )}
            </motion.span>
          )
        })}
      </div>

      <AnimatePresence>
        {session.rewrittenText && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            transition={{ duration: 0.5 }}
            className="mt-4 overflow-hidden rounded-xl border border-brand-500/25 bg-brand-500/[0.07]"
          >
            <div className="flex items-center gap-2 border-b border-brand-500/20 px-4 py-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-[10px] text-emerald-950">✓</span>
              <span className="text-sm font-semibold text-brand-200">Compliant rewrite</span>
            </div>
            <p className="whitespace-pre-wrap px-4 py-3.5 text-[15px] leading-relaxed text-slate-100">
              {session.rewrittenText}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function matchSpan(sentence: string, spans: Violation[]): Violation | undefined {
  return spans.find((s) => s.offendingText && sentence.toLowerCase().includes(s.offendingText.toLowerCase().slice(0, 24)))
}
function sevRank(s: string): number { return s === 'critical' ? 0 : s === 'major' ? 1 : 2 }

function StatusPill({ status }: { status: Session['status'] }) {
  const live = status !== 'COMPLETED' && status !== 'ERROR'
  const label = status.replace(/_/g, ' ').toLowerCase()
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${live ? 'bg-brand-500/15 text-brand-300' : 'bg-white/5 text-slate-400'}`}>
      {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />}
      {label}
    </span>
  )
}
