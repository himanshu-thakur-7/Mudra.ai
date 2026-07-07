import { useEffect, useState } from 'react'
import { getPartners, type Partner } from '../lib/api'

// The "powered by" stack — live from the backend, so a judge sees exactly which
// Buildathon partners are wired and active right now.
const FALLBACK: Partner[] = [
  { key: 'hermes', name: 'Nous Hermes', role: 'Core agent pipeline', live: false },
  { key: 'openai', name: 'OpenAI GPT-5.5', role: 'Vision / OCR preprocessing', live: false },
  { key: 'convex', name: 'Convex', role: 'Realtime DB · vector search', live: false },
  { key: 'linkup', name: 'Linkup', role: 'Live regulatory search', live: false },
  { key: 'cloudflare', name: 'Cloudflare AI Gateway', role: 'LLM routing · observability', live: false },
  { key: 'elevenlabs', name: 'ElevenLabs', role: 'Voice copilot', live: false },
  { key: 'razorpay', name: 'Razorpay', role: 'UPI AutoPay subscription', live: false },
]

export default function PartnerStack() {
  const [partners, setPartners] = useState<Partner[]>(FALLBACK)
  const [provider, setProvider] = useState<string>('')

  useEffect(() => {
    getPartners().then((d) => { setPartners(d.partners); setProvider(d.agent_provider) }).catch(() => {})
  }, [])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {partners.map((p) => (
          <div key={p.key} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{p.name}</span>
              <span className={`flex items-center gap-1 text-[10px] font-semibold ${p.live ? 'text-brand-300' : 'text-slate-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${p.live ? 'bg-brand-400 animate-pulse-dot' : 'bg-slate-600'}`} />
                {p.live ? 'LIVE' : 'KEY-READY'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{p.role}</p>
          </div>
        ))}
      </div>
      {provider && (
        <p className="mt-4 text-center text-xs text-slate-500">
          Agent pipeline currently served by <span className="font-semibold text-brand-300">{provider === 'hermes' ? 'Nous Hermes' : 'OpenAI (Hermes-ready)'}</span>
        </p>
      )}
    </div>
  )
}
