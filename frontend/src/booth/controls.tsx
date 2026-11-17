import type { ReactNode } from 'react'

// Settings-panel pieces shared by the Booth and the QR codes page

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="booth-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="booth-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="booth-switch-track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  )
}
