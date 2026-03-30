import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ErrorBoundary } from './components'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'

// Lazy load pages - only load when needed
const App = lazy(() => import('./App'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SharedSession = lazy(() => import('./pages/SharedSession'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={null}>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<AuthPage />} />
                <Route path="/register" element={<AuthPage />} />
                <Route path="/shared/:shareToken" element={<SharedSession />} />

                {/* Protected routes */}
                <Route
                  element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<App />} />
                  <Route path="/sessions/:sessionId" element={<App />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/status" element={<StatusPage />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>
)
