import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

const nav = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
    isActive
      ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200'
      : 'text-slate-500 hover:text-slate-900'
  }`

export default function App() {
  const { t, i18n } = useTranslation()
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <NavLink to="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold text-white shadow-sm">
              ✓
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-bold tracking-tight text-slate-900">
                Compliance<span className="text-indigo-600">Copilot</span>
              </span>
              <span className="mt-0.5 text-[11px] text-slate-400">SEBI · AMFI · RBI · IRDAI</span>
            </span>
          </NavLink>
          <nav className="flex items-center gap-1 rounded-xl bg-slate-100/70 p-1">
            <NavLink to="/" end className={nav}>
              Checker
            </NavLink>
            <NavLink to="/reviews" className={nav}>
              History
            </NavLink>
            <NavLink to="/ingestion" className={nav}>
              Ingestion
            </NavLink>
            <button
              onClick={toggleLang}
              className="ml-1 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
              title="Switch language"
            >
              {i18n.language === 'en' ? 'हिं' : 'EN'}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200/70 bg-white/60 py-4">
        <p className="mx-auto max-w-5xl px-5 text-center text-xs text-slate-400">{t('disclaimer')}</p>
      </footer>
    </div>
  )
}
