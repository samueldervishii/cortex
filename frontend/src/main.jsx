import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ErrorBoundary, AppLoader } from './components'

// Lazy load pages - only load when needed
const App = lazy(() => import('./App.jsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))
const SharedSession = lazy(() => import('./pages/SharedSession.jsx'))
const StatusPage = lazy(() => import('./pages/StatusPage.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<AppLoader />}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/sessions/:sessionId" element={<App />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/shared/:shareToken" element={<SharedSession />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
