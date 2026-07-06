import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './lib/i18n'
import App from './App.tsx'
import CheckerPage from './pages/CheckerPage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import IngestionPage from './pages/IngestionPage.tsx'
import ReviewResultPage from './pages/ReviewResultPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<CheckerPage />} />
          <Route path="reviews" element={<HistoryPage />} />
          <Route path="reviews/:id" element={<ReviewResultPage />} />
          <Route path="ingestion" element={<IngestionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
