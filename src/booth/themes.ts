import type { IconType } from 'react-icons'
import {
  GiBat,
  GiDiploma,
  GiGhost,
  GiGraduateCap,
  GiLaurelCrown,
  GiPumpkin,
  GiSparkles,
  GiSpiderAlt,
  GiSpiderWeb,
  GiStarFormation,
} from 'react-icons/gi'

/**
 * Places a decoration can go on a strip or print. Positions live in booth.css (.decor-<spot>),
 * so a theme only picks which icon sits where and in what colour.
 */
export type DecorSpot = 'top-left' | 'top-right' | 'top-right-small' | 'middle-right' | 'middle-left' | 'bottom-left' | 'bottom-right'

export type Decor = { icon: IconType; color: string }

export type ThemeId = 'classic' | 'halloween' | 'graduation'

export type BoothTheme = {
  label: string
  /** Front decorations; empty means the theme has none */
  decor: Partial<Record<DecorSpot, Decor>>
  /** The back only has room for a couple, kept clear of the QR code */
  backDecor: Partial<Record<'top-right' | 'bottom-left', Decor>>
}

// Icons are Game Icons via react-icons (CC BY 3.0, game-icons.net). Fonts and colours are in booth.css.
export const THEMES: Record<ThemeId, BoothTheme> = {
  classic: {
    label: 'Classic',
    decor: {},
    backDecor: {},
  },
  halloween: {
    label: 'Halloween',
    decor: {
      'top-left': { icon: GiSpiderWeb, color: '#374151' },
      'top-right': { icon: GiBat, color: '#1f2937' },
      'top-right-small': { icon: GiBat, color: '#1f2937' },
      'middle-right': { icon: GiSpiderAlt, color: '#111827' },
      'middle-left': { icon: GiGhost, color: '#7c3aed' },
      'bottom-left': { icon: GiPumpkin, color: '#ea580c' },
      'bottom-right': { icon: GiPumpkin, color: '#ea580c' },
    },
    backDecor: {
      'top-right': { icon: GiBat, color: '#1f2937' },
      'bottom-left': { icon: GiPumpkin, color: '#ea580c' },
    },
  },
  graduation: {
    label: 'Graduation',
    decor: {
      'top-left': { icon: GiGraduateCap, color: '#1e3a8a' },
      'top-right': { icon: GiSparkles, color: '#ca8a04' },
      'middle-right': { icon: GiStarFormation, color: '#ca8a04' },
      'middle-left': { icon: GiSparkles, color: '#ca8a04' },
      'bottom-left': { icon: GiDiploma, color: '#1e3a8a' },
      'bottom-right': { icon: GiLaurelCrown, color: '#ca8a04' },
    },
    backDecor: {
      'top-right': { icon: GiGraduateCap, color: '#1e3a8a' },
      'bottom-left': { icon: GiLaurelCrown, color: '#ca8a04' },
    },
  },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]
export const isThemeId = (value: string | null): value is ThemeId => THEME_IDS.includes(value as ThemeId)
