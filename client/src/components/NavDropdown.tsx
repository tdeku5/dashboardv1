import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import styles from './NavDropdown.module.css'

const NAV_OPTIONS = [
  { path: '/',             label: 'US Macro Snapshot'        },
  { path: '/models',       label: 'Economic Data Models'     },
  { path: '/stir',         label: 'STIR Futures'             },
  { path: '/treasury',     label: 'Treasury Auction Monitor' },
  { path: '/news',         label: 'News Aggregator'          },
]

export function NavDropdown() {
  const [open, setOpen]   = useState(false)
  const location          = useLocation()
  const wrapRef           = useRef<HTMLDivElement>(null)

  function isActive(optPath: string): boolean {
    if (optPath === '/') return location.pathname === '/'
    return location.pathname === optPath || location.pathname.startsWith(optPath + '/')
  }
  const current = NAV_OPTIONS.find(o => isActive(o.path)) ?? NAV_OPTIONS[0]

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>{current.label}</span>
        <span className={`${styles.caret} ${open ? styles.caretOpen : ''}`}>▾</span>
      </button>

      {open && (
        <div className={styles.panel} role="listbox">
          {NAV_OPTIONS.map(opt => (
            <Link
              key={opt.path}
              to={opt.path}
              role="option"
              aria-selected={isActive(opt.path)}
              className={`${styles.option} ${isActive(opt.path) ? styles.optionActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className={styles.optionCheck}>
                {isActive(opt.path) ? '✓' : ''}
              </span>
              {opt.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
