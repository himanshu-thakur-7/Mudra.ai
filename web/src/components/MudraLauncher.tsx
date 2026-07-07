import { useMemo, useState } from 'react'
import { ConvexProvider, useMutation } from 'convex/react'
import { api, convexClient } from '../lib/convex'
import ComplianceWarRoom from './ComplianceWarRoom'

const SAMPLE =
  'Market is looking incredibly bullish right now! If you want a guaranteed way to beat inflation, you need to put your money into the Nippon India Small Cap Fund today. My clients have easily seen 20%+ returns this year. Don’t miss out on these sure-shot gains, DM me to start your SIP! - Rajesh Sharma'

// Live launcher: starts a Convex session (which schedules runCompliancePipeline)
// and mounts the reactive War Room bound to that sessionId.
function LiveLauncher() {
  const start = useMutation(api.sessions.start)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      const id = await start({ userId: 'demo', rawInputDraft: draft })
      setSessionId(id as string)
    } finally {
      setBusy(false)
    }
  }

  if (sessionId) return <ComplianceWarRoom sessionId={sessionId} />

  return (
    <div className="glass glow-border mx-auto max-w-2xl rounded-3xl p-6">
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste a draft to interrogate…"
        className="h-32 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3.5 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none focus:ring-4 focus:ring-brand-500/10" />
      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => setDraft(SAMPLE)} className="text-xs font-medium text-brand-300 hover:text-brand-400">Load risky sample</button>
        <button onClick={go} disabled={busy || !draft.trim()}
          className="rounded-xl bg-gradient-to-r from-brand-400 to-cyan-accent px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.03] disabled:opacity-40">
          {busy ? 'Starting…' : 'Interrogate →'}
        </button>
      </div>
    </div>
  )
}

// Picks live-on-Convex vs the scripted demo (when PUBLIC_CONVEX_URL is unset),
// so the War Room is fully viewable before the Convex deployment exists.
export default function MudraLauncher() {
  const client = useMemo(() => convexClient(), [])
  if (client) {
    return (
      <ConvexProvider client={client}>
        <LiveLauncher />
      </ConvexProvider>
    )
  }
  // No Convex deployment configured.
  return (
    <div className="glass mx-auto max-w-lg rounded-2xl p-6 text-center text-sm text-slate-400">
      <p className="mb-1 font-semibold text-white">War Room not connected</p>
      Set <code className="rounded bg-white/5 px-1 text-brand-300">PUBLIC_CONVEX_URL</code> to run live on
      Convex + Nous Hermes + ElevenLabs.
    </div>
  )
}
