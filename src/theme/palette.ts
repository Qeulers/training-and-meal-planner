/*
 * The palette, mirrored from theme.css so contrast can be asserted in tests
 * (A11Y-01).
 *
 * theme.css remains the single source that the app renders from; this file
 * exists because a CSS custom property cannot be measured in a unit test, and
 * a contrast regression is invisible until someone with low vision hits it.
 * `tests/unit/contrast.test.ts` fails if these drift from theme.css.
 */

export type ThemeName = 'light' | 'dark';

export const PALETTE: Record<ThemeName, Record<string, string>> = {
  light: {
    bg: '#f3f5f0',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    border: '#e0e4db',
    'border-strong': '#c4cbbe',
    text: '#141917',
    'text-muted': '#556058',
    'text-dim': '#677168',
    accent: '#3f6b2c',
    'accent-ink': '#ffffff',
    success: '#3f6b2c',
    warning: '#8a6410',
    danger: '#a63a22',
    food: '#4c6070',
  },
  dark: {
    bg: '#0e1211',
    surface: '#161b19',
    'surface-raised': '#1e2523',
    border: '#2a322f',
    'border-strong': '#3a443f',
    text: '#eef0ea',
    'text-muted': '#a3ada5',
    'text-dim': '#858e85',
    accent: '#7fa86b',
    'accent-ink': '#0e1211',
    success: '#7fa86b',
    warning: '#d9a02b',
    danger: '#d2705c',
    food: '#8fa0ae',
  },
};

/** Foreground tokens used for text. */
export const TEXT_TOKENS = [
  'text',
  'text-muted',
  'text-dim',
  'accent',
  'success',
  'warning',
  'danger',
  'food',
] as const;

/** Backgrounds text is placed on. */
export const SURFACE_TOKENS = ['bg', 'surface', 'surface-raised'] as const;

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
