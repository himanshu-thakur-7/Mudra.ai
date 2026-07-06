import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const REGULATORS = ['SEBI', 'AMFI', 'RBI', 'IRDAI']

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-slate-200">
      <Nav />
      <Hero />
      <TrustStrip />
      <Stats />
      <HowItWorks />
      <Features />
      <Moat />
      <FinalCTA />
      <Footer />
    </div>
  )
}

/* ---------------------------------------------------------------- Nav */
function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight text-white">
            Compliance<span className="text-brand-400">Copilot</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
          <a href="#how" className="transition-colors hover:text-white">How it works</a>
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#moat" className="transition-colors hover:text-white">Knowledge base</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/ingestion" className="hidden text-sm text-slate-400 transition-colors hover:text-white sm:block">
            Live engine
          </Link>
          <Link
            to="/check"
            className="rounded-lg bg-gradient-to-r from-brand-500 to-cyan-accent px-4 py-2 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition-transform hover:scale-[1.03]"
          >
            Try it free
          </Link>
        </div>
      </div>
    </header>
  )
}

function Logo() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-cyan-accent text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/30">
      ✓
    </span>
  )
}

/* ---------------------------------------------------------------- Hero */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* mesh blobs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="mesh-blob absolute -left-32 top-0 h-96 w-96 rounded-full bg-emerald-500/40" />
        <div className="mesh-blob absolute right-0 top-20 h-80 w-80 rounded-full bg-cyan-400/30" />
        <div className="mesh-blob absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-violet-500/25" />
      </div>
      <div className="hero-grid absolute inset-0" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-24 pt-16 lg:grid-cols-2 lg:pt-24">
        <div className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
            </span>
            Live rulebook · SEBI · AMFI · RBI · IRDAI
          </div>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Post it without <br />
            <span className="gradient-text">a compliance notice.</span>
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-400">
            The AI pre-review layer for Indian financial marketing. Paste any WhatsApp post,
            ad or caption — get every violation flagged to the exact regulation, plus one
            ready-to-publish compliant rewrite.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/check"
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-cyan-accent px-6 py-3.5 text-[15px] font-semibold text-emerald-950 shadow-xl shadow-emerald-500/25 transition-transform hover:scale-[1.03]"
            >
              Check your content
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              to="/ingestion"
              className="rounded-xl border border-white/10 px-6 py-3.5 text-[15px] font-medium text-slate-300 transition-colors hover:bg-white/5"
            >
              Watch the crawler live
            </Link>
          </div>

          <div className="mt-8 flex items-center gap-6 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="text-brand-400">✓</span> No signup to try</span>
            <span className="flex items-center gap-1.5"><span className="text-brand-400">✓</span> Human stays in the loop</span>
          </div>
        </div>

        <HeroMockup />
      </div>
    </section>
  )
}

/* An authentic mini-render of the product output: red input -> green rewrite */
function HeroMockup() {
  return (
    <div className="animate-floaty relative">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-brand-500/20 to-cyan-400/10 blur-2xl" />
      <div className="glass relative overflow-hidden rounded-2xl p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500 text-xs font-bold text-white">✕</span>
          <span className="text-sm font-semibold text-white">Do not post — 3 issues</span>
          <span className="ml-auto rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">1 critical</span>
        </div>

        <div className="rounded-xl bg-white/5 p-3 text-[13px] leading-relaxed text-slate-400">
          If you want a{' '}
          <mark className="rounded bg-red-500/25 px-1 text-red-200">guaranteed way to beat inflation</mark>, put your
          money into the Nippon India Small Cap Fund today. Sure-shot gains! — Rajesh
        </div>

        <div className="my-3 flex items-center gap-2 text-[11px] text-slate-500">
          <div className="h-px flex-1 bg-white/10" />
          synthesised into one compliant rewrite
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-500 text-[10px] font-bold text-emerald-950">✓</span>
            <span className="text-xs font-semibold text-brand-300">Ready-to-post</span>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-300">
            Small-cap funds carry high growth potential and high risk. Let’s check if they suit
            your goals. — Rajesh Sharma, ARN-12345, AMFI-registered Mutual Fund Distributor.
            <span className="text-slate-500"> Mutual fund investments are subject to market risks…</span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {['AMFI-COC-2022/4.g · p.5', 'AMFI-DOSDONTS/Q9 · p.3', 'MASTERCIR/1.3.6 · p.8'].map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              {c}
              <span className="rounded bg-brand-500/20 px-1 text-[9px] font-semibold text-brand-300">ACTIVE</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Trust strip */
function TrustStrip() {
  return (
    <section className="border-y border-white/5 bg-white/[0.02] py-8">
      <p className="mb-5 text-center text-xs font-medium uppercase tracking-widest text-slate-500">
        Grounded in the primary source rulebooks of
      </p>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-12 gap-y-4 px-6">
        {REGULATORS.map((r) => (
          <span key={r} className="text-2xl font-bold tracking-tight text-slate-600 grayscale transition-colors hover:text-slate-300">
            {r}
          </span>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- Stats */
const STATS = [
  { n: '1.71 lakh', l: 'MFDs who self-police their own content' },
  { n: '₹546 cr', l: 'impounded from one finfluencer academy' },
  { n: '4', l: 'regulators covered by one pipeline' },
  { n: '< 20s', l: 'from paste to compliant rewrite' },
]
function Stats() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.l} className="bg-ink-950 p-6">
            <div className="text-3xl font-extrabold text-white">{s.n}</div>
            <div className="mt-1 text-sm text-slate-500">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- How it works */
const STEPS = [
  { n: '01', t: 'Paste your draft', d: 'A WhatsApp forward, an ad, a reel caption — in English or Hinglish. Pick your regulator hat.' },
  { n: '02', t: 'AI reviews against live law', d: 'Deterministic rule checks + retrieval over the current rulebook + a reviewer→adjudicator agent pair that cites every flag.' },
  { n: '03', t: 'Ship the compliant version', d: 'One cohesive rewrite that fixes everything, plus a courtroom-grade audit-trail PDF for your compliance officer.' },
]
function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 py-20">
      <SectionHead eyebrow="How it works" title="From risky draft to publish-ready in three steps" />
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.n} className="group relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-6">
            <div className="mb-4 text-sm font-bold text-brand-400">{s.n}</div>
            <h3 className="text-lg font-semibold text-white">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.d}</p>
            {i < STEPS.length - 1 && (
              <span className="absolute -right-3 top-1/2 hidden text-slate-700 md:block">→</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- Features (bento) */
function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-20">
      <SectionHead eyebrow="Why it holds up" title="Built like a regulator would audit it" />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <BentoCard
          className="md:col-span-2"
          accent
          title="Every flag cites the exact clause — and the page"
          body="No vague ‘Source: SEBI’. Each issue links to a verbatim clause, its exact page in the source PDF, and an ACTIVE / SUPERSEDED status so a superseded rule can never trigger a false flag."
        >
          <div className="mt-5 flex flex-wrap gap-2">
            {['AMFI-COC-2022/4.g', 'p.5', 'ACTIVE', 'RBI-DLD-2025/6.iv', 'IRDAI-ADREG-2021/3.g'].map((c) => (
              <span key={c} className="rounded-md bg-black/30 px-2.5 py-1 font-mono text-xs text-brand-300 ring-1 ring-white/10">{c}</span>
            ))}
          </div>
        </BentoCard>
        <BentoCard title="One rewrite, not nine fixes" body="The agent returns a single publish-ready string that resolves every violation at once — in your original voice and language." />
        <BentoCard title="Living knowledge base" body="A Go crawler fleet watches all four regulator portals, detects new circulars, and flags supersessions — so the rulebook is never stale." />
        <BentoCard title="Courtroom-grade audit trail" body="Every review exports a timestamped PDF with content hash, clause quotes and a sign-off line — the answer to SEBI Reg 16C liability." />
        <BentoCard title="WhatsApp-native + vernacular" body="MFDs live on WhatsApp. Send a post to the bot, get the verdict and rewrite back. Hindi UI and same-language rewrites built in." />
      </div>
    </section>
  )
}

function BentoCard({ title, body, children, className = '', accent = false }: {
  title: string; body: string; children?: ReactNode; className?: string; accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border border-white/10 p-6 ${accent ? 'bg-gradient-to-br from-brand-500/10 to-cyan-400/5' : 'bg-white/[0.03]'} ${className}`}>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- Moat */
function Moat() {
  return (
    <section id="moat" className="relative overflow-hidden border-y border-white/5 bg-white/[0.02] py-20">
      <div className="mesh-blob absolute right-1/4 top-0 h-72 w-72 rounded-full bg-cyan-400/20" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
        <div>
          <SectionHead
            align="left"
            eyebrow="The moat"
            title="A rulebook that updates itself"
          />
          <p className="mt-5 text-slate-400">
            Indian regulators drop overlapping amendments into an unstructured ocean of PDFs.
            Our distributed ingestion engine treats it like version control for law:
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'Go goroutine fleet with a Redis token-bucket rate limiter, so no portal gets hammered',
              'Change detection by DOM hash — only new circulars are pulled',
              'Layout-aware parsing keeps tables and font-size mandates intact',
              'Temporal status flags hard-filter superseded clauses out of retrieval',
            ].map((f) => (
              <li key={f} className="flex gap-3 text-sm text-slate-300">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[10px] text-brand-300">✓</span>
                {f}
              </li>
            ))}
          </ul>
          <Link to="/ingestion" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-brand-300 hover:text-brand-400">
            Watch it crawl in real time →
          </Link>
        </div>

        {/* mini terminal */}
        <div className="glass overflow-hidden rounded-2xl">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-brand-400/70" />
            <span className="ml-2 text-[11px] text-slate-500">fleet · watch</span>
          </div>
          <div className="space-y-1.5 p-4 font-mono text-[11px] leading-5">
            <div className="text-cyan-300">🛰 sweeping 4 regulator targets</div>
            <div className="text-amber-300">⚡ SEBI circulars CHANGED: 25 candidate links</div>
            <div className="text-brand-300">⬇ stored 064c5883-1783077132079.pdf (385 KB)</div>
            <div className="text-brand-300">✂ SEBI: 22 clauses chunked (native) → review</div>
            <div className="text-rose-300">⚠ supersession detected: supersedes CIR/2022/177</div>
            <div className="text-slate-500">· AMFI: no change (hash 08c702d9…)</div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- Final CTA */
function FinalCTA() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/15 via-ink-900 to-cyan-400/10 px-8 py-16 text-center">
        <div className="mesh-blob absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-500/30" />
        <h2 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Check your next post before SEBI does.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-slate-400">
          A pre-review co-pilot, not a replacement for your compliance officer. Final
          responsibility always stays with you — we just make it impossible to miss a rule.
        </p>
        <Link
          to="/check"
          className="relative mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-cyan-accent px-7 py-3.5 text-[15px] font-semibold text-emerald-950 shadow-xl shadow-emerald-500/25 transition-transform hover:scale-[1.03]"
        >
          Start checking — free
          <span>→</span>
        </Link>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-sm font-semibold text-white">ComplianceCopilot</span>
        </div>
        <p className="text-xs text-slate-500">
          Pre-review layer for SEBI · AMFI · RBI · IRDAI marketing content. Not legal advice.
        </p>
      </div>
    </footer>
  )
}

/* ---------------------------------------------------------------- shared */
function SectionHead({ eyebrow, title, align = 'center' }: { eyebrow: string; title: string; align?: 'center' | 'left' }) {
  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <div className="text-xs font-semibold uppercase tracking-widest text-brand-400">{eyebrow}</div>
      <h2 className={`mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl ${align === 'center' ? 'mx-auto max-w-2xl' : 'max-w-md'}`}>
        {title}
      </h2>
    </div>
  )
}
