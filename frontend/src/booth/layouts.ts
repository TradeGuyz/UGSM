// All sizes are in inches. The sheet is US Letter, 8.5 × 11 in.
export const SHEET_W = 8.5
export const SHEET_H = 11

export type Mode = 'strips' | 'prints' | 'cards'
export type Slot = { x: number; y: number }

export const MODES: { mode: Mode; label: string; detail: string }[] = [
  { mode: 'strips', label: 'Photo strips', detail: '4 photos per strip' },
  { mode: 'prints', label: '4 × 5 prints', detail: '1 photo each' },
  { mode: 'cards', label: 'Digital only', detail: 'Small QR card' },
]

/** A layout that can be printed a bit at a time on the same sheet, remembering what's cut out */
export type SheetLayout = {
  slots: Slot[]
  /** Slots printed together in one session, in the order they get used */
  groups: number[][]
  w: number
  h: number
  /** Remembers which slots on the current, partly cut sheet are used up */
  storageKey: string
}

// 4 × 2 strips of 2.125 × 5.5 in, numbered left to right, top row then bottom row.
// Each session prints two copies side by side. The bottom row fills first so the sheet's
// top (leading) edge stays whole for the printer.
export const STRIP_LAYOUT: SheetLayout = {
  slots: Array.from({ length: 8 }, (_, s) => ({ x: (s % 4) * 2.125, y: Math.floor(s / 4) * 5.5 })),
  groups: [
    [6, 7],
    [4, 5],
    [2, 3],
    [0, 1],
  ],
  w: 2.125,
  h: 5.5,
  storageKey: 'photo-strip-used-slots',
}

// 4 × 4 QR cards of 2.125 × 2.75 in for people who only want their photos digitally.
// One card per session, bottom row first for the same reason as the strips.
const CARD_COLS = 4
const CARD_ROWS = 4
export const CARD_LAYOUT: SheetLayout = {
  slots: Array.from({ length: CARD_COLS * CARD_ROWS }, (_, s) => ({
    x: (s % CARD_COLS) * 2.125,
    y: Math.floor(s / CARD_COLS) * 2.75,
  })),
  groups: Array.from({ length: CARD_COLS * CARD_ROWS }, (_, k) => [CARD_COLS * CARD_ROWS - 1 - k]),
  w: 2.125,
  h: 2.75,
  storageKey: 'photo-strip-used-cards',
}

// An 8 × 10 in block centred on Letter, cut 2 × 2 into 4 × 5 in prints
export const PRINT_W = 4
export const PRINT_H = 5
export const PRINT_SLOTS: Slot[] = [
  { x: 0.25, y: 0.5 },
  { x: 4.25, y: 0.5 },
  { x: 0.25, y: 5.5 },
  { x: 4.25, y: 5.5 },
]

export const PHOTOS_PER_SET = 4
