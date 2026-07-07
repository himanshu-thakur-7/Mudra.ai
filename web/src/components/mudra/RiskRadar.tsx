import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'
import type { Violation } from '../../lib/convex'

// The ₹546 Crore Panic Button: a radial gauge that consumes the live violations
// array, shows the running financial-exposure estimate, and shifts aggressively
// from calm green to glowing blood-red as severity accumulates.

function colorFor(score: number): string {
  if (score >= 80) return '#ef4444'
  if (score >= 55) return '#f59e0b'
  if (score >= 25) return '#eab308'
  return '#34d399'
}

function inr(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export default function RiskRadar({ riskScore, exposureInr, violations }: {
  riskScore: number; exposureInr: number; violations: Violation[]
}) {
  const R = 78
  const CIRC = 2 * Math.PI * R
  const spring = useSpring(0, { stiffness: 60, damping: 18 })
  useEffect(() => { spring.set(Math.min(100, riskScore)) }, [riskScore, spring])
  const dash = useTransform(spring, (s) => `${(s / 100) * CIRC} ${CIRC}`)
  const color = colorFor(riskScore)
  const critical = violations.filter((v) => v.severity === 'critical').length
  const hot = riskScore >= 80

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      {hot && (
        <motion.div className="pointer-events-none absolute inset-0"
          animate={{ opacity: [0.15, 0.35, 0.15] }} transition={{ duration: 1.6, repeat: Infinity }}
          style={{ background: 'radial-gradient(60% 60% at 50% 40%, #ef444455, transparent 70%)' }} />
      )}
      <div className="relative flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Risk Radar</h3>
        {hot && (
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
            className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300 ring-1 ring-red-500/40">
            ⚠ HIGH EXPOSURE
          </motion.span>
        )}
      </div>

      <div className="relative mx-auto mt-3 h-48 w-48">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="12" />
          <motion.circle cx="90" cy="90" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            style={{ strokeDasharray: dash as any, filter: `drop-shadow(0 0 8px ${color})` }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span key={Math.round(riskScore)} initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="text-4xl font-extrabold" style={{ color }}>
            {Math.round(riskScore)}
          </motion.span>
          <span className="text-[11px] uppercase tracking-wider text-slate-500">risk score</span>
        </div>
      </div>

      <div className="relative mt-3 rounded-xl bg-black/30 p-3 text-center">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Estimated regulatory exposure</div>
        <motion.div key={exposureInr} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          className="text-2xl font-bold" style={{ color }}>
          {inr(exposureInr)}
        </motion.div>
        <div className="mt-1 text-[11px] text-slate-500">
          {violations.length} violation{violations.length !== 1 ? 's' : ''}{critical > 0 && ` · ${critical} critical`}
        </div>
      </div>
      <p className="relative mt-2 text-center text-[10px] leading-tight text-slate-600">
        Modelled on real SEBI/RBI enforcement (finfluencer crackdowns, FY24-25 penalty waves). Indicative, not legal advice.
      </p>
    </div>
  )
}
