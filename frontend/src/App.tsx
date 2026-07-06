import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'
  }`

export default function App() {
  const { t, i18n } = useTranslation()
  const toggleLang = () => i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en')
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              Compliance<span className="text-indigo-600">Copilot</span>
            </span>
            <p className="text-xs text-slate-500">{t('tagline')}</p>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Checker
            </NavLink>
            <NavLink to="/reviews" className={navClass}>
              History
            </NavLink>
            <button
              onClick={toggleLang}
              className="ml-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title="Switch language"
            >
              {i18n.language === 'en' ? 'हिं' : 'EN'}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-4">
        <p className="mx-auto max-w-4xl px-4 text-center text-xs text-slate-400">
          {t('disclaimer')}
        </p>
      </footer>
    </div>
  )
}
