import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ErrorBoundary } from './components'
import Layout from './components/Layout'

// Lazy load pages - only load when needed
const App = lazy(() => import('./App'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SharedSession = lazy(() => import('./pages/SharedSession'))
const StatusPage = lazy(() => import('./pages/StatusPage'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<App />} />
              <Route path="/sessions/:sessionId" element={<App />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/status" element={<StatusPage />} />
            </Route>
            <Route path="/shared/:shareToken" element={<SharedSession />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
