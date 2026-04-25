import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ErrorBoundary } from './components'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { UsageProvider } from './contexts/UsageContext'
import { ThemeProvider } from './contexts/ThemeContext'

// Lazy load pages - only load when needed
const App = lazy(() => import('./App'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SharedSession = lazy(() => import('./pages/SharedSession'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <UsageProvider>
            <ToastProvider>
              <BrowserRouter>
                <Suspense fallback={null}>
                  <Routes>
                    {/* Public routes */}
                    <Route path="/login" element={<AuthPage />} />
                    <Route path="/register" element={<AuthPage />} />
                    <Route path="/shared/:shareToken" element={<SharedSession />} />
                    <Route path="/status" element={<StatusPage />} />

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
                    </Route>
                    {/* 404 */}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </ToastProvider>
          </UsageProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
)
