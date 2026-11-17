import { useEffect, useState } from 'react'
import PhotoUpload from './PhotoUpload.tsx'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage unavailable; fall back to the system setting
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // Ignore; the theme just won't be remembered
    }
  }, [theme])

  return (
    <>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
      </button>
      <h1>CS Social Media</h1>
      <PhotoUpload />
    </>
  )
}

export default App
