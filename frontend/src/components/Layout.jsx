import { useState, useEffect, useCallback } from 'react'
import { Outlet } from 'react-router-dom'

const MOBILE_BREAKPOINT = 768

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('llm-council-sidebar') === 'open'
  })

  useEffect(() => {
    localStorage.setItem('llm-council-sidebar', sidebarOpen ? 'open' : 'closed')
    // Prevent background scroll on mobile when sidebar is open
    if (sidebarOpen && window.innerWidth <= MOBILE_BREAKPOINT) {
      document.body.classList.add('sidebar-open')
    } else {
      document.body.classList.remove('sidebar-open')
    }
    return () => document.body.classList.remove('sidebar-open')
  }, [sidebarOpen])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  // Close sidebar only on mobile-width screens (used after navigation actions)
  const closeSidebarOnMobile = useCallback(() => {
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      setSidebarOpen(false)
    }
  }, [])

  return <Outlet context={{ sidebarOpen, toggleSidebar, closeSidebarOnMobile }} />
}

export default Layout
