// i18n scaffold — English only for the MVP. Stage 2 adds Hindi/vernacular
// bundles here; components already read every user-facing string via t().
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const en = {
  translation: {
    appName: 'ComplianceCopilot',
    tagline: 'Pre-review co-pilot for SEBI/AMFI marketing content',
    disclaimer:
      'A pre-review layer, not a replacement for your compliance officer — final responsibility stays with the regulated entity.',
    checker: {
      title: 'Check your content before you post it',
      placeholder:
        'Paste your WhatsApp post, social caption or ad copy here…\n\ne.g. "Guaranteed 15% returns with XYZ Fund! DM me 🚀"',
      channel: 'Channel',
      audience: 'I am a…',
      audienceMfd: 'Mutual Fund Distributor (ARN)',
      audienceIaRa: 'Investment Adviser / Research Analyst',
      submit: 'Run compliance pre-check',
      running: 'Reviewing…',
    },
    pipeline: {
      deterministic: 'Running rule checks (ARN, tagline, risk warning)…',
      retrieval: 'Retrieving applicable SEBI/AMFI clauses…',
      reviewer: 'AI reviewer scanning against clauses…',
      adjudicator: 'Adjudicator verifying every flag…',
      rewriter: 'Drafting compliant rewrite…',
    },
    verdict: {
      pass: 'Looks compliant',
      needs_changes: 'Needs changes before posting',
      fail: 'Do not post — prohibited content found',
      error: 'Partial review — AI service unavailable',
      pending: 'Review pending',
    },
  },
}

i18n.use(initReactI18next).init({
  resources: { en },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
