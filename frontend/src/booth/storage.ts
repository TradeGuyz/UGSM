import { SHEET_H, SHEET_W, type SheetLayout } from './layouts.ts'

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


/**
 * Most printers can't print the outer edge of the paper, so a layout that runs to the edges
 * (strips, QR cards) is shrunk to fit inside this margin, in inches. 0 is for borderless printers.
 */
export const PRINT_MARGINS = [
  { value: 0, label: 'None · borderless printer' },
  { value: 0.125, label: '⅛ in' },
  { value: 0.25, label: '¼ in · most printers' },
  { value: 0.375, label: '⅜ in' },
  { value: 0.5, label: '½ in' },
]
const DEFAULT_MARGIN = 0.25
const MARGIN_KEY = 'print-margin'

export function loadPrintMargin(): number {
  const saved = readStorage(MARGIN_KEY)
  return PRINT_MARGINS.find((m) => saved !== null && m.value === Number(saved))?.value ?? DEFAULT_MARGIN
}

export function savePrintMargin(margin: number) {
  writeStorage(MARGIN_KEY, String(margin))
}

/** How much a full-sheet layout is shrunk, around the sheet's centre, to keep that margin on every side */
export function marginScale(margin: number): number {
  return Math.min((SHEET_W - 2 * margin) / SHEET_W, (SHEET_H - 2 * margin) / SHEET_H)
}

/** "2.00 × 5.18 in": a piece's printed size once shrunk */
export function printedSize(layout: SheetLayout, margin: number): string {
  const s = marginScale(margin)
  return `${(layout.w * s).toFixed(2)} × ${(layout.h * s).toFixed(2)} in`
}
