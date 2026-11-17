import type { ReactNode } from 'react'
import { Select } from '../Select.tsx'
import { PRINT_MARGINS } from './storage.ts'

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

/** How far in from the paper's edges a full-sheet layout stays */
export function PrintMarginField({ value, onChange, disabled }: { value: number; onChange: (margin: number) => void; disabled?: boolean }) {
  return (
    <label className="booth-field">
      <span>Printer margin</span>
      <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled}>
        {PRINT_MARGINS.map((m) => (
          <option key={m.value} value={String(m.value)}>
            {m.label}
          </option>
        ))}
      </Select>
    </label>
  )
}
