import type { SheetLayout } from './layouts.ts'

// Helpers shared by the Booth and the QR codes page

export const PX_PER_INCH = 96

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable; the setting just won't be remembered
  }
}

/** Cut-out slots on the current, partly used sheet */
export function loadUsed(layout: SheetLayout): Set<number> {
  try {
    const saved: unknown = JSON.parse(readStorage(layout.storageKey) ?? '[]')
    if (Array.isArray(saved)) return new Set(saved.filter((n): n is number => typeof n === 'number'))
  } catch {
    // Invalid saved value; start with a fresh sheet
  }
  return new Set()
}

/** Positions a piece on the sheet; sizes in inches */
export function place(x: number, y: number, w: number, h: number) {
  return { left: `${x}in`, top: `${y}in`, width: `${w}in`, height: `${h}in` }
}

