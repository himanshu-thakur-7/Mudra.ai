// i18n: English + Hindi bundles. Components read every user-facing string via
// t(), so adding a language is a resources entry — no component changes.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const en = {
  translation: {
    appName: 'ComplianceCopilot',
    tagline: 'Pre-review co-pilot for SEBI / AMFI / RBI / IRDAI marketing content',
    disclaimer:
      'A pre-review layer, not a replacement for your compliance officer — final responsibility stays with the regulated entity.',
    checker: {
      title: 'Check your content before you post it',
      subtitle: 'Every flag cites the exact regulatory clause it comes from.',
      placeholder:
        'Paste your WhatsApp post, social caption or ad copy here…\n\ne.g. "Guaranteed 15% returns with XYZ Fund! DM me 🚀"',
      channel: 'Channel',
      audience: 'I am a…',
      audienceMfd: 'Mutual Fund Distributor (ARN)',
      audienceIaRa: 'Investment Adviser / Research Analyst',
      audienceNbfc: 'Digital Lender / LSP (RBI)',
      audienceInsurance: 'Insurer / Insurance Agent (IRDAI)',
      submit: 'Run compliance pre-check',
      running: 'Reviewing…',
      sample: 'Try a non-compliant sample',
    },
    pipeline: {
      deterministic: 'Running rule checks (identity, disclosures, prohibited claims)…',
      retrieval: 'Retrieving applicable regulatory clauses…',
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

const hi = {
  translation: {
    appName: 'ComplianceCopilot',
    tagline: 'SEBI / AMFI / RBI / IRDAI मार्केटिंग सामग्री के लिए प्री-रिव्यू सहायक',
    disclaimer:
      'यह एक प्री-रिव्यू परत है, आपके कंप्लायंस अधिकारी का विकल्प नहीं — अंतिम ज़िम्मेदारी विनियमित इकाई की ही रहती है।',
    checker: {
      title: 'पोस्ट करने से पहले अपनी सामग्री जाँचें',
      subtitle: 'हर आपत्ति में सटीक नियामकीय धारा का हवाला दिया जाता है।',
      placeholder:
        'अपना WhatsApp पोस्ट, सोशल कैप्शन या विज्ञापन यहाँ पेस्ट करें…\n\nउदा. "XYZ फ़ंड में 15% गारंटीड रिटर्न! DM करें 🚀"',
      channel: 'चैनल',
      audience: 'मैं हूँ…',
      audienceMfd: 'म्यूचुअल फ़ंड वितरक (ARN)',
      audienceIaRa: 'निवेश सलाहकार / रिसर्च एनालिस्ट',
      audienceNbfc: 'डिजिटल ऋणदाता / LSP (RBI)',
      audienceInsurance: 'बीमाकर्ता / बीमा एजेंट (IRDAI)',
      submit: 'कंप्लायंस प्री-चेक चलाएँ',
      running: 'समीक्षा हो रही है…',
      sample: 'गैर-अनुपालक नमूना आज़माएँ',
    },
    pipeline: {
      deterministic: 'नियम जाँच चल रही है (पहचान, प्रकटीकरण, निषिद्ध दावे)…',
      retrieval: 'लागू नियामकीय धाराएँ खोजी जा रही हैं…',
      reviewer: 'AI समीक्षक धाराओं से मिलान कर रहा है…',
      adjudicator: 'हर आपत्ति की पुष्टि हो रही है…',
      rewriter: 'अनुपालक संस्करण तैयार हो रहा है…',
    },
    verdict: {
      pass: 'अनुपालक लगता है',
      needs_changes: 'पोस्ट करने से पहले बदलाव ज़रूरी',
      fail: 'पोस्ट न करें — निषिद्ध सामग्री मिली',
      error: 'आंशिक समीक्षा — AI सेवा अनुपलब्ध',
      pending: 'समीक्षा लंबित',
    },
  },
}

i18n.use(initReactI18next).init({
  resources: { en, hi },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
