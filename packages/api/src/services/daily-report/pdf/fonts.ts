import fs from 'fs';

/**
 * Noto Sans (regular + bold) for the Daily Site Report PDF.
 *
 * The files come from @fontsource/noto-sans (SIL Open Font License 1.1, see
 * FONTS-LICENSE.md next to this file). They are resolved through the package
 * exports with require.resolve, so the same code works from src/ (ts-jest,
 * tsx) and from dist/ (compiled) without copying assets.
 *
 * WOFF is used on purpose: fontkit 2 parses the WOFF2 files but fails while
 * subsetting them ("Offset is outside the bounds of the DataView"). WOFF
 * subsets cleanly, so only the glyphs actually used end up in the PDF.
 *
 * Coverage: the @fontsource "latin" subset (Basic Latin, Latin-1, general
 * punctuation incl. "…", "—", "·", "³", "°", "€" and combining diacritics such
 * as U+0303). Characters outside it are handled by `sanitizeForFont` in
 * text.ts (decomposed to base letter + combining mark when possible, else
 * U+FFFD), so the PDF never shows empty boxes.
 */

export const FONT_REGULAR = 'NotoSans';
export const FONT_BOLD = 'NotoSans-Bold';

const FILES = {
  regular: '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff',
  bold:    '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
} as const;

export interface NotoSansFonts {
  regular: Buffer;
  bold: Buffer;
}

let cached: NotoSansFonts | null = null;

/** Absolute paths of the font files (resolved through package exports). */
export function notoSansPaths(): { regular: string; bold: string } {
  try {
    return { regular: require.resolve(FILES.regular), bold: require.resolve(FILES.bold) };
  } catch (err) {
    throw new Error(
      `Daily report PDF fonts not found: install @fontsource/noto-sans (${(err as Error).message})`,
    );
  }
}

/** Font file contents, read once per process. */
export function loadNotoSans(): NotoSansFonts {
  if (!cached) {
    const p = notoSansPaths();
    cached = { regular: fs.readFileSync(p.regular), bold: fs.readFileSync(p.bold) };
  }
  return cached;
}
