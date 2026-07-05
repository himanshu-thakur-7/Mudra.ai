import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { createReview } from '../lib/api'

const CHANNELS = ['whatsapp', 'social', 'email', 'web'] as const

const PIPELINE_STEPS = [
  'pipeline.deterministic',
  'pipeline.retrieval',
  'pipeline.reviewer',
  'pipeline.adjudicator',
  'pipeline.rewriter',
]

const SAMPLE =
  'Guaranteed 15% returns with XYZ Midcap Fund! 🚀 Best fund of 2026. DM for free portfolio review!'

function PipelineProgress() {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  useEffect(() => {
    // Cosmetic pacing only — the API call is a single synchronous request.
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, PIPELINE_STEPS.length - 1)), 3500)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="mt-6 space-y-2">
      {PIPELINE_STEPS.map((key, i) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span>{i < step ? '✅' : i === step ? '⏳' : '·'}</span>
          <span className={i <= step ? 'text-slate-800' : 'text-slate-400'}>{t(key)}</span>
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
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t('checker.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every flag cites the exact SEBI/AMFI clause it comes from.
      </p>

      <textarea
        className="mt-5 h-44 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        placeholder={t('checker.placeholder')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={running}
      />
      <button
        className="mt-1 text-xs text-indigo-600 hover:underline"
        onClick={() => setContent(SAMPLE)}
        disabled={running}
      >
        Try a non-compliant sample
      </button>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('checker.channel')}</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('checker.audience')}</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            disabled={running}
          >
            <option value="mfd">{t('checker.audienceMfd')}</option>
            <option value="ia-ra">{t('checker.audienceIaRa')}</option>
          </select>
        </label>
        <button
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
          onClick={submit}
          disabled={running || !content.trim()}
        >
          {running ? t('checker.running') : t('checker.submit')}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {running && <PipelineProgress />}
    </div>
  )
}
