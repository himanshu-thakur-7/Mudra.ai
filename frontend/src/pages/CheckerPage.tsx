import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { createReview } from '../lib/api'

const CHANNELS = ['whatsapp', 'social', 'email', 'web'] as const

const AUDIENCES = [
  { id: 'mfd', short: 'MFD', tKey: 'checker.audienceMfd', reg: 'SEBI · AMFI' },
  { id: 'ia-ra', short: 'IA / RA', tKey: 'checker.audienceIaRa', reg: 'SEBI' },
  { id: 'nbfc-lsp', short: 'Lender', tKey: 'checker.audienceNbfc', reg: 'RBI' },
  { id: 'insurance', short: 'Insurer', tKey: 'checker.audienceInsurance', reg: 'IRDAI' },
] as const

const PIPELINE_STEPS = [
  'pipeline.deterministic',
  'pipeline.retrieval',
  'pipeline.reviewer',
  'pipeline.adjudicator',
  'pipeline.rewriter',
]

const SAMPLES: Record<string, string> = {
  mfd: 'Market is looking incredibly bullish right now! If you want a guaranteed way to beat inflation, you need to put your money into the Nippon India Small Cap Fund today. My clients have easily seen 20%+ returns this year. Don’t miss out on these sure-shot gains, DM me to start your SIP! - Rajesh Sharma',
  'ia-ra': 'Our research calls gave 40% profit last quarter — risk-free intraday tips, join now! We are the No.1 analysts in India.',
  'nbfc-lsp': 'Instant loan approval in 5 minutes! No credit check, no documents. Just 1.5% monthly interest. Only 20 slots left — apply now!',
  insurance: 'Get guaranteed bonus of ₹10 lakh with our IRDAI-approved plan. 100% safe investment, zero paperwork!',
}

function PipelineProgress() {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, PIPELINE_STEPS.length - 1)), 3200)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="mt-6 space-y-2.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {PIPELINE_STEPS.map((key, i) => (
        <div key={key} className="flex items-center gap-3 text-sm">
          <span className="flex h-5 w-5 items-center justify-center">
            {i < step ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-600">✓</span>
            ) : i === step ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            )}
          </span>
          <span className={i <= step ? 'font-medium text-slate-800' : 'text-slate-400'}>{t(key)}</span>
        </div>
      ))}
    </div>
  )
}

export default function CheckerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [channel, setChannel] = useState<string>('whatsapp')
  const [audience, setAudience] = useState<string>('mfd')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!content.trim() || running) return
    setRunning(true)
    setError(null)
    try {
      const review = await createReview({ content, channel, audience })
      navigate(`/reviews/${review.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Pre-review co-pilot
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">{t('checker.title')}</h1>
        <p className="mt-2 text-[15px] text-slate-500">{t('checker.subtitle')}</p>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {/* Audience segmented control */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('checker.audience')}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {AUDIENCES.map((a) => (
              <button
                key={a.id}
                onClick={() => setAudience(a.id)}
                disabled={running}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 text-center transition-all ${
                  audience === a.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className="text-sm font-semibold">{a.short}</span>
                <span className={`text-[10px] ${audience === a.id ? 'text-indigo-100' : 'text-slate-400'}`}>{a.reg}</span>
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="h-40 w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-[15px] leading-relaxed placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-100"
          placeholder={t('checker.placeholder')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={running}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <span className="text-xs font-medium">{t('checker.channel')}</span>
              <select
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={running}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-xs font-medium text-indigo-600 hover:underline"
              onClick={() => setContent(SAMPLES[audience] ?? SAMPLES.mfd)}
              disabled={running}
            >
              {t('checker.sample')}
            </button>
          </div>
          <button
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:opacity-40"
            onClick={submit}
            disabled={running || !content.trim()}
          >
            {running ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {t('checker.running')}
              </>
            ) : (
              <>{t('checker.submit')} →</>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {running && <PipelineProgress />}

      {!running && (
        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-400">
          <span>✓ Clause-cited flags</span>
          <span>✓ One compliant rewrite</span>
          <span>✓ Audit-trail PDF</span>
        </div>
      )}
    </div>
  )
}
