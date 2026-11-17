import { useEffect, useState } from 'react'
import Booth from './booth/Booth.tsx'
import Landing from './Landing.tsx'
import Navbar, { type Page } from './Navbar.tsx'
import PinScreen from './PinScreen.tsx'
import QrPage from './qr/QrPage.tsx'
import Settings from './Settings.tsx'
import UploadPage from './upload/UploadPage.tsx'
import { usePinSession } from './usePinSession.ts'

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

// A handful of pages, so plain links and the URL path are enough; no router needed.
// The tools live under /admin; a bare /admin (or an unknown tool) opens Upload.
function pageFromPath(path: string): Page {
  const match = /^\/admin(?:\/([^/]*))?\/?$/.exec(path)
  if (!match) return 'home'
  if (match[1] === 'booth' || match[1] === 'qr' || match[1] === 'settings') return match[1]
  if (match[1] !== 'upload') window.history.replaceState(null, '', '/admin/upload')
  return 'upload'
}

const page = pageFromPath(window.location.pathname)

function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const { status, unlock, lock } = usePinSession()

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
      <Navbar
        page={page}
        unlocked={status === 'unlocked'}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onLock={lock}
      />
      {page === 'home' ? (
        <main>
          <Landing />
        </main>
      ) : (
        <main className="tool">
          {status === 'unlocked' && page === 'upload' && <UploadPage onSessionExpired={lock} />}
          {status === 'unlocked' && page === 'booth' && <Booth onSessionExpired={lock} />}
          {status === 'unlocked' && page === 'qr' && <QrPage onSessionExpired={lock} />}
          {status === 'unlocked' && page === 'settings' && <Settings onSessionExpired={lock} />}
          {status === 'locked' && <PinScreen onUnlock={unlock} />}
        </main>
      )}
    </>
  )
}

export default App
