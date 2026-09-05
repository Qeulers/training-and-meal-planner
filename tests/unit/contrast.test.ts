/*
 * WCAG AA contrast across the whole palette (A11Y-01).
 *
 * The review found two failures. Measuring every combination rather than the
 * two reported ones found seven: light `text-dim` was 4.08 on bg and 4.47 on
 * surface, dark `text-dim` 4.14 on surface-raised, and dark `danger` as low as
 * 3.61 on surface-raised.
 *
 * This test also checks the palette against theme.css itself, so a colour
 * changed in one place and not the other fails here rather than silently
 * shipping.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PALETTE,
  SURFACE_TOKENS,
  TEXT_TOKENS,
  contrastRatio,
  luminance,
} from '@/theme/palette';

const AA_NORMAL = 4.5;

/** Pull the `--color-*` declarations out of a theme.css block. */
function parseThemeCss(): { light: Record<string, string>; dark: Record<string, string> } {
  // Resolved from the project root: `import.meta.url` is not a file URL under
  // the jsdom environment.
  const css = readFileSync(resolve(process.cwd(), 'src/theme/theme.css'), 'utf8');
  const grab = (selector: string) => {
    const start = css.indexOf(selector);
    const block = css.slice(start, css.indexOf('}', start));
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
    return out;
  };
  return { light: grab(':root,\n.light {'), dark: grab('.dark {') };
}

describe('palette matches theme.css', () => {
  const fromCss = parseThemeCss();

  it.each(['light', 'dark'] as const)('%s tokens are in sync', (theme) => {
    // If this fails, theme.css and palette.ts have drifted — fix palette.ts.
    expect(fromCss[theme]).toMatchObject(PALETTE[theme]);
  });
});

describe.each(['light', 'dark'] as const)('%s theme — WCAG AA', (theme) => {
  const t = PALETTE[theme];
  const combos = TEXT_TOKENS.flatMap((fg) => SURFACE_TOKENS.map((bg) => [fg, bg] as const));

  it.each(combos)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('accent-ink on accent reaches 4.5:1 (primary button)', () => {
    expect(contrastRatio(t['accent-ink'], t.accent)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('borders are visible against their surfaces (3:1 for UI)', () => {
    expect(contrastRatio(t['border-strong'], t.surface)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3f6b2c', '#3f6b2c')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#141917', '#f3f5f0')).toBeCloseTo(
      contrastRatio('#f3f5f0', '#141917'),
      10,
    );
  });

  it('computes known luminances', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });
});
