import { useEffect, useRef, useState } from 'react'
import { LuExternalLink, LuLock, LuMenu, LuMoon, LuSun, LuX } from 'react-icons/lu'
import { CLUB_URL } from './links.ts'
import './Navbar.css'

// Keep in sync with the menu breakpoint in Navbar.css
const PHONE_QUERY = '(max-width: 1024px)'

export type ToolPage = 'upload' | 'booth' | 'settings'
export type Page = 'home' | ToolPage

const TOOL_LINKS: { page: ToolPage; href: string; label: string }[] = [
  { page: 'upload', href: '/admin/upload', label: 'Upload' },
  { page: 'booth', href: '/admin/booth', label: 'Booth' },
  { page: 'settings', href: '/admin/settings', label: 'Settings' },
]

type Props = {
  page: Page
  unlocked: boolean
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLock: () => void
}

function Navbar({ page, unlocked, theme, onToggleTheme, onLock }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  // While the menu is open, close it on Escape, on a tap outside, or when the screen grows past phone size
  useEffect(() => {
    if (!menuOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const phone = window.matchMedia(PHONE_QUERY)
    function onBreakpoint() {
      if (!phone.matches) setMenuOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    phone.addEventListener('change', onBreakpoint)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      phone.removeEventListener('change', onBreakpoint)
    }
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <header className="navbar" ref={headerRef}>
      <a className="navbar-brand" href="/">
        <img src="/logo-badge.webp" alt="" width={40} height={40} />
        <span className="navbar-brand-text">
          <span className="navbar-brand-name">UGSM</span>
          <span className="navbar-brand-subtitle">University of Guyana Social Media Club</span>
        </span>
      </a>

      <nav id="navbar-menu" className={`navbar-links${menuOpen ? ' open' : ''}`} aria-label="Main">
        <a href="/" aria-current={page === 'home' ? 'page' : undefined} onClick={closeMenu}>
          Home
        </a>
        {/* Tool links stay hidden until unlocked so the public pages give nothing away */}
        {unlocked &&
          TOOL_LINKS.map(({ page: target, href, label }) => (
            <a key={target} href={href} aria-current={page === target ? 'page' : undefined} onClick={closeMenu}>
              {label}
            </a>
          ))}
        <a href={CLUB_URL} target="_blank" rel="noreferrer" onClick={closeMenu}>
          RankUoG <LuExternalLink aria-hidden="true" />
          <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      </nav>

      <div className="navbar-actions">
        {unlocked && (
          <button type="button" className="icon-button" onClick={onLock} aria-label="Lock" title="Lock">
            <LuLock aria-hidden="true" />
          </button>
        )}
        <button type="button" className="icon-button" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
          {theme === 'dark' ? <LuSun aria-hidden="true" /> : <LuMoon aria-hidden="true" />}
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button navbar-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="navbar-menu"
        >
          {menuOpen ? <LuX aria-hidden="true" /> : <LuMenu aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}

export default Navbar
