import { useEffect, useRef, useState } from 'react'
import { createReview, getNarration, voiceUrl, downloadAuditPdf, type Review, type Narration } from '../lib/api'

const AUDIENCES = [
  { id: 'mfd', short: 'MFD', reg: 'SEBI · AMFI' },
  { id: 'ia-ra', short: 'IA / RA', reg: 'SEBI' },
  { id: 'nbfc-lsp', short: 'Lender', reg: 'RBI' },
  { id: 'insurance', short: 'Insurer', reg: 'IRDAI' },
]
const SAMPLES: Record<string, string> = {
  mfd: 'Market is looking incredibly bullish right now! If you want a guaranteed way to beat inflation, you need to put your money into the Nippon India Small Cap Fund today. My clients have easily seen 20%+ returns this year. Don’t miss out on these sure-shot gains, DM me to start your SIP! - Rajesh Sharma',
  'ia-ra': 'Our research calls gave 40% profit last quarter — risk-free intraday tips, join now! We are the No.1 analysts in India.',
  'nbfc-lsp': 'Instant loan approval in 5 minutes! No credit check, no documents. Just 1.5% monthly interest. Only 20 slots left — apply now!',
  insurance: 'Get guaranteed bonus of ₹10 lakh with our IRDAI-approved plan. 100% safe investment, zero paperwork!',
}
const STEPS = ['Rule checks', 'Retrieving clauses', 'Hermes reviewer', 'Adjudicator', 'Rewriter']

const SEV: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 ring-red-500/30',
  major: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  minor: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
}
const REG_DOT: Record<string, string> = { SEBI: 'bg-violet-400', AMFI: 'bg-brand-400', RBI: 'bg-amber-400', IRDAI: 'bg-rose-400' }

export default function VoiceChecker() {
  const [audience, setAudience] = useState('mfd')
  const [channel, setChannel] = useState('social')
  const [content, setContent] = useState('')
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState(0)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!content.trim() || running) return
    setRunning(true); setError(null); setReview(null); setStep(0)
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600)
    try {
      const r = await createReview({ content, channel, audience })
      setReview(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      clearInterval(tick); setRunning(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {!review && (
        <div className="glass glow-border rounded-3xl p-6 shadow-2xl">
          <div className="mb-4 grid grid-cols-4 gap-2">
            {AUDIENCES.map((a) => (
              <button key={a.id} onClick={() => setAudience(a.id)} disabled={running}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 transition-all ${
                  audience === a.id ? 'bg-gradient-to-br from-brand-500 to-cyan-accent text-emerald-950 shadow-lg' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                <span className="text-sm font-bold">{a.short}</span>
                <span className={`text-[10px] ${audience === a.id ? 'text-emerald-900' : 'text-slate-500'}`}>{a.reg}</span>
              </button>
            ))}
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} disabled={running}
            placeholder="Paste your WhatsApp post, ad or caption…  e.g. 'Guaranteed 20% returns! DM me 🚀'"
            className="h-36 w-full resize-none rounded-2xl border border-white/10 bg-black/20 p-4 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none focus:ring-4 focus:ring-brand-500/10" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setContent(SAMPLES[audience])} disabled={running}
              className="text-xs font-medium text-brand-300 hover:text-brand-400">Try a risky sample</button>
            <button onClick={run} disabled={running || !content.trim()}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-cyan-accent px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.03] disabled:opacity-40">
              {running ? 'Reviewing…' : 'Check & hear the verdict →'}
            </button>
          </div>
          {running && (
            <div className="mt-5 space-y-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2.5 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center">
                    {i < step ? <span className="text-brand-400">✓</span>
                      : i === step ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-brand-400" />
                      : <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />}
                  </span>
                  <span className={i <= step ? 'text-slate-200' : 'text-slate-500'}>{s}</span>
                </div>
              ))}
            </div>
          )}
          {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>
      )}

      {review && <Result review={review} onReset={() => { setReview(null); setContent('') }} />}
    </div>
  )
}

const VERDICT: Record<string, { label: string; cls: string; icon: string }> = {
  fail: { label: 'Do not post', cls: 'from-red-500/20 text-red-200 ring-red-500/30', icon: '✕' },
  needs_changes: { label: 'Needs changes', cls: 'from-amber-500/20 text-amber-200 ring-amber-500/30', icon: '!' },
  pass: { label: 'Cleared to post', cls: 'from-brand-500/20 text-brand-200 ring-brand-500/30', icon: '✓' },
  error: { label: 'Partial review', cls: 'from-slate-500/20 text-slate-200 ring-slate-500/30', icon: 'i' },
  pending: { label: 'Pending', cls: 'from-slate-500/20 text-slate-200 ring-slate-500/30', icon: '…' },
}

function Result({ review, onReset }: { review: Review; onReset: () => void }) {
  const v = VERDICT[review.verdict] ?? VERDICT.pending
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (review.rewrite) { await navigator.clipboard.writeText(review.rewrite); setCopied(true); setTimeout(() => setCopied(false), 1500) } }

  return (
    <div className="animate-rise space-y-4">
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-3 rounded-2xl bg-gradient-to-r to-transparent px-4 py-2.5 ring-1 ${v.cls}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 font-bold">{v.icon}</span>
          <span className="font-bold">{v.label}</span>
          <span className="text-xs opacity-70">· {review.issues.length} issue{review.issues.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={onReset} className="text-sm text-slate-400 hover:text-white">← New check</button>
      </div>

      <VoicePlayer reviewId={review.id} />

      {review.rewrite && (
        <div className="overflow-hidden rounded-2xl border border-brand-500/25 bg-brand-500/[0.07]">
          <div className="flex items-center justify-between border-b border-brand-500/20 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-200">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-[10px] text-emerald-950">✓</span>
              Ready-to-post compliant version
            </span>
            <button onClick={copy} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-brand-400">
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="whitespace-pre-wrap px-4 py-3.5 text-[15px] leading-relaxed text-slate-200">{review.rewrite}</p>
        </div>
      )}

      <div className="space-y-2.5">
        {review.issues.map((issue, i) => (
          <div key={issue.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-white">{String(i + 1).padStart(2, '0')} · {issue.title}</h4>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ring-1 ${SEV[issue.severity]}`}>{issue.severity}</span>
            </div>
            {issue.spans.map((s, j) => (
              <div key={j} className="mt-2 rounded-lg bg-red-500/10 px-3 py-2">
                <span className="rounded bg-red-500/25 px-1 text-sm text-red-200">{s.text}</span>
                <p className="mt-1 text-xs text-slate-400">{s.explanation}</p>
              </div>
            ))}
            {issue.missing_requirements.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {issue.missing_requirements.map((r) => (
                  <span key={r} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 ring-1 ring-amber-500/20">+ {r}</span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {issue.citations.map((c) => (
                <span key={c.clause_id} className="inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-white/10" title={c.doc_title}>
                  <span className={`h-1.5 w-1.5 rounded-full ${REG_DOT[c.regulator] ?? 'bg-slate-500'}`} />
                  {c.clause_id}{c.source_page ? ` · p.${c.source_page}` : ''}
                  <span className={`rounded px-1 text-[9px] font-bold ${c.doc_status === 'ACTIVE' ? 'bg-brand-500/20 text-brand-300' : 'bg-slate-600/30 text-slate-400'}`}>{c.doc_status}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => downloadAuditPdf(review.id)}
        className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10">
        ⬇ Download courtroom-grade audit PDF
      </button>
    </div>
  )
}

/* Voice copilot: ElevenLabs audio when available, else browser Web Speech. */
function VoicePlayer({ reviewId }: { reviewId: string }) {
  const [narration, setNarration] = useState<Narration | null>(null)
  const [playing, setPlaying] = useState(false)
  const [seg, setSeg] = useState(-1)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { getNarration(reviewId).then(setNarration).catch(() => {}) }, [reviewId])

  function stop() {
    setPlaying(false); setSeg(-1)
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
  }

  async function play() {
    if (!narration) return
    setPlaying(true)
    if (narration.voice_available) {
      const a = new Audio(voiceUrl(reviewId)); audioRef.current = a
      a.onended = stop; a.play().catch(stop)
      return
    }
    // Browser Web Speech fallback — segment by segment for a live-highlight feel.
    const synth = window.speechSynthesis
    narration.segments.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s.text)
      u.rate = 1.02; u.pitch = 1
      u.onstart = () => setSeg(i)
      if (i === narration.segments.length - 1) u.onend = stop
      synth.speak(u)
    })
  }

  if (!narration) return null
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <button onClick={playing ? stop : play}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-cyan-accent text-emerald-950 shadow-lg shadow-emerald-500/30 transition-transform hover:scale-105 animate-pulse-dot">
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">🔊 Hear the compliance officer</p>
          <p className="text-xs text-slate-400">
            {narration.voice_available ? 'ElevenLabs natural voice' : 'Browser voice (add ElevenLabs key for natural voice)'}
            {playing && seg >= 0 && ` · ${narration.segments[seg]?.label}`}
          </p>
        </div>
      </div>
    </div>
  )
}
