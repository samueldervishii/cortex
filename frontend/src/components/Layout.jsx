import { useState, useEffect, useCallback } from 'react'
import { Outlet } from 'react-router-dom'

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('llm-council-sidebar') === 'open'
  })

  useEffect(() => {
    localStorage.setItem('llm-council-sidebar', sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev)
  }, [])

  return <Outlet context={{ sidebarOpen, toggleSidebar }} />
}

export default Layout
