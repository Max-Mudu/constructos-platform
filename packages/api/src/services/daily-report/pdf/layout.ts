/**
 * Layout primitives for the Daily Site Report PDF. All flow decisions are
 * made by measuring first (heightOfString / widthOfString) and drawing second,
 * so nothing is drawn past the bottom margin by accident. Only paragraphs
 * longer than the remaining space are left to pdfkit's own line wrapper, which
 * continues them on a new page at the top margin.
 */
import { FONT_BOLD, FONT_REGULAR } from './fonts';
import { GlyphCoverage, sanitizeForFont } from './text';

export const COLORS = {
  text: '#111827',
  secondary: '#4B5563',
  muted: '#667085',
  border: '#E3E6EB',
  accent: '#94650F',
} as const;

export const PAGE = {
  size: 'A4' as const,
  margins: { top: 100, bottom: 60, left: 40, right: 40 },
};

export type FontWeight = 'regular' | 'bold';

export interface TextStyle {
  size: number;
  weight?: FontWeight;
  color?: string;
  lineGap?: number;
}

export const STYLE = {
  body:       { size: 9.5, color: COLORS.text, lineGap: 1.5 },
  bodyMuted:  { size: 9.5, color: COLORS.muted, lineGap: 1.5 },
  meta:       { size: 8.5, color: COLORS.secondary, lineGap: 1 },
  cell:       { size: 8.5, color: COLORS.text, lineGap: 1 },
  cellHead:   { size: 7.5, weight: 'bold', color: COLORS.secondary, lineGap: 0.5 },
  label:      { size: 8.5, weight: 'bold', color: COLORS.secondary, lineGap: 1 },
  heading:    { size: 11.5, weight: 'bold', color: COLORS.text, lineGap: 0 },
  headingNum: { size: 9, weight: 'bold', color: COLORS.accent, lineGap: 0 },
  caption:    { size: 8, color: COLORS.secondary, lineGap: 1 },
} satisfies Record<string, TextStyle>;

export interface Column {
  header: string;
  /** Fraction of the table width; fractions should sum to 1. */
  width: number;
  align?: 'left' | 'right';
}

const ELLIPSIS = '…';

export class ReportLayout {
  readonly left: number;
  readonly width: number;
  private glyphs: GlyphCoverage[] = [];

  constructor(readonly doc: PDFKit.PDFDocument) {
    this.left = doc.page.margins.left;
    this.width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  /** Called once the fonts are registered so text can be sanitised. */
  setGlyphCoverage(glyphs: GlyphCoverage[]): void {
    this.glyphs = glyphs;
  }

  get top(): number { return this.doc.page.margins.top; }
  get bottom(): number { return this.doc.page.height - this.doc.page.margins.bottom; }
  /** Usable body height of a full page. */
  get bodyHeight(): number { return this.bottom - this.top; }
  get y(): number { return this.doc.y; }
  set y(v: number) { this.doc.y = v; }
  get remaining(): number { return this.bottom - this.doc.y; }

  /** Font-safe version of user or system text. */
  clean(text: string): string {
    return sanitizeForFont(text ?? '', this.glyphs);
  }

  use(style: TextStyle): this {
    this.doc
      .font(style.weight === 'bold' ? FONT_BOLD : FONT_REGULAR)
      .fontSize(style.size)
      .fillColor(style.color ?? COLORS.text);
    return this;
  }

  lineHeight(style: TextStyle): number {
    this.use(style);
    return this.doc.currentLineHeight(true) + (style.lineGap ?? 0);
  }

  /** Height `text` occupies at `width` in `style` (text must already be clean). */
  measure(text: string, width: number, style: TextStyle): number {
    if (!text) return 0;
    this.use(style);
    return this.doc.heightOfString(text, { width, lineGap: style.lineGap ?? 0 });
  }

  widthOf(text: string, style: TextStyle): number {
    this.use(style);
    return this.doc.widthOfString(text);
  }

  /** Starts a new page when fewer than `h` points remain. */
  ensureSpace(h: number): void {
    if (this.doc.y + h > this.bottom + 0.01) this.newPage();
  }

  newPage(): void {
    this.doc.addPage();
    this.doc.x = this.left;
    this.doc.y = this.top;
  }

  /** Draws pre-measured text at an absolute position; never triggers a page break. */
  textAt(text: string, x: number, y: number, width: number, style: TextStyle, align: 'left' | 'right' | 'center' = 'left'): number {
    if (!text) return 0;
    const h = this.measure(text, width, style);
    this.use(style);
    this.doc.text(text, x, y, { width, align, lineGap: style.lineGap ?? 0, height: h + 1 });
    this.doc.x = this.left;
    return h;
  }

  /**
   * Draws a single line clipped to `width` with an ellipsis. Used in the
   * header/footer, which lie in the margins, so pdfkit must not paginate.
   */
  lineAt(text: string, x: number, y: number, width: number, style: TextStyle, align: 'left' | 'right' = 'left'): void {
    const s = this.fitLine(text, width, style);
    if (!s) return;
    this.use(style);
    const savedBottom = this.doc.page.margins.bottom;
    this.doc.page.margins.bottom = 0;
    this.doc.text(s, x, y, { width, align, lineBreak: false });
    this.doc.page.margins.bottom = savedBottom;
    this.doc.x = this.left;
  }

  /** Longest prefix of `text` (plus "…") whose width fits. */
  fitLine(text: string, width: number, style: TextStyle): string {
    const s = text.replace(/\s+/g, ' ').trim();
    if (this.widthOf(s, style) <= width) return s;
    const chars = Array.from(s);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.widthOf(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS, style) <= width) lo = mid;
      else hi = mid - 1;
    }
    return lo === 0 ? '' : chars.slice(0, lo).join('').trimEnd() + ELLIPSIS;
  }

  /** `text` cut to at most `maxLines` lines at `width`, ending with "…" when cut. */
  truncateToLines(text: string, width: number, maxLines: number, style: TextStyle): string {
    const s = text.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const maxH = this.lineHeight(style) * maxLines + 0.5;
    if (this.measure(s, width, style) <= maxH) return s;
    const chars = Array.from(s);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS, width, style) <= maxH) lo = mid;
      else hi = mid - 1;
    }
    let cut = chars.slice(0, lo).join('');
    // Prefer a word boundary when one is close to the cut.
    const space = cut.lastIndexOf(' ');
    if (space > 0 && cut.length - space <= 18) cut = cut.slice(0, space);
    return cut.trimEnd().replace(/[\s,;:.\-–—·]+$/, '') + ELLIPSIS;
  }

  /**
   * Draws a paragraph in the flow. Short paragraphs (≤ 4 lines) are kept
   * together; longer ones start on the current page when at least two lines
   * fit, and pdfkit continues them on following pages.
   */
  paragraph(raw: string, style: TextStyle, opts: { x?: number; width?: number; gapAfter?: number } = {}): void {
    const text = this.clean(raw).trim();
    if (!text) return;
    const x = opts.x ?? this.left;
    const width = opts.width ?? this.width - (x - this.left);
    const h = this.measure(text, width, style);
    const lh = this.lineHeight(style);
    if (h > this.remaining + 0.01) {
      if (h <= lh * 4 + 0.5 || this.remaining < lh * 2) this.newPage();
    }
    this.use(style);
    this.doc.text(text, x, this.doc.y, { width, lineGap: style.lineGap ?? 0 });
    this.doc.x = this.left;
    this.doc.y += opts.gapAfter ?? 0;
  }

  rule(y: number, color: string = COLORS.border, lineWidth = 0.75, x1 = this.left, x2 = this.left + this.width): void {
    this.doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(lineWidth).strokeColor(color).stroke().restore();
  }

  rect(x: number, y: number, w: number, h: number, color: string = COLORS.border, lineWidth = 0.75): void {
    this.doc.save().rect(x, y, w, h).lineWidth(lineWidth).strokeColor(color).stroke().restore();
  }

  /** Height of a section heading block (title, rule and gap). */
  headingHeight(): number {
    return this.lineHeight(STYLE.heading) + 9;
  }

  /**
   * Section heading: accent number, bold title, hairline rule. `keepWith` is
   * the height of the first block that must stay on the same page.
   */
  heading(num: string | null, title: string, keepWith: number): void {
    const h = this.headingHeight();
    this.ensureSpace(h + Math.min(keepWith, this.bodyHeight - h));
    const y = this.doc.y;
    const lhTitle = this.lineHeight(STYLE.heading);
    let tx = this.left;
    if (num) {
      const lhNum = this.lineHeight(STYLE.headingNum);
      this.textAt(num, this.left, y + (lhTitle - lhNum) - 0.5, 24, STYLE.headingNum);
      tx += 22;
    }
    this.textAt(this.clean(title), tx, y, this.width - (tx - this.left), STYLE.heading);
    this.rule(y + lhTitle + 2.5);
    this.doc.y = y + h;
  }

  /** Label/value row: label column on the left, wrapped value on the right. */
  keyValueHeight(value: string, labelWidth = 150): number {
    const v = this.clean(value);
    return Math.max(this.lineHeight(STYLE.label), this.measure(v, this.width - labelWidth, STYLE.body)) + 3;
  }

  keyValue(labelText: string, value: string, labelWidth = 150): void {
    const v = this.clean(value).trim();
    if (!v) return;
    const h = this.keyValueHeight(v, labelWidth);
    if (h > this.bodyHeight) {
      // Extremely long value: label on its own line, value flows.
      this.ensureSpace(this.lineHeight(STYLE.label) * 3);
      this.textAt(this.clean(labelText), this.left, this.doc.y, this.width, STYLE.label);
      this.doc.y += this.lineHeight(STYLE.label);
      this.paragraph(v, STYLE.body, { gapAfter: 3 });
      return;
    }
    this.ensureSpace(h);
    const y = this.doc.y;
    this.textAt(this.clean(labelText), this.left, y + 0.8, labelWidth - 8, STYLE.label);
    this.textAt(v, this.left + labelWidth, y, this.width - labelWidth, STYLE.body);
    this.doc.y = y + h;
  }

  /** "Not reported" line for an empty section. */
  notReported(): void {
    this.paragraph('Not reported', STYLE.bodyMuted, { gapAfter: 2 });
  }

  // ── Tables ──────────────────────────────────────────────────────────────

  private colX(cols: Column[]): Array<{ x: number; w: number }> {
    let x = this.left;
    return cols.map((c) => {
      const w = c.width * this.width;
      const r = { x, w };
      x += w;
      return r;
    });
  }

  private static PAD_X = 5;
  private static PAD_Y = 4;

  private rowHeight(cells: string[], cols: Column[], style: TextStyle): number {
    const geo = this.colX(cols);
    let h = this.lineHeight(style);
    cells.forEach((c, i) => {
      h = Math.max(h, this.measure(c, geo[i].w - 2 * ReportLayout.PAD_X, style));
    });
    return h + 2 * ReportLayout.PAD_Y;
  }

  private drawRow(cells: string[], cols: Column[], style: TextStyle, ruleColor: string, ruleWidth: number): void {
    const geo = this.colX(cols);
    const y = this.doc.y;
    const h = this.rowHeight(cells, cols, style);
    cells.forEach((c, i) => {
      this.textAt(c, geo[i].x + ReportLayout.PAD_X, y + ReportLayout.PAD_Y, geo[i].w - 2 * ReportLayout.PAD_X, style, cols[i].align ?? 'left');
    });
    this.rule(y + h, ruleColor, ruleWidth);
    this.doc.y = y + h;
  }

  /**
   * Simple ruled table. Every row is measured before drawing; a row that does
   * not fit starts a new page and the header row is repeated there. A row
   * taller than a whole page (not reachable with schema-valid content) is
   * printed as label/value lines so it can flow instead of being clipped.
   */
  /** Height of the header row plus the first body row (what must stay with a heading). */
  tableLeadHeight(cols: Column[], rawRows: string[][]): number {
    const header = cols.map((c) => this.clean(c.header).toUpperCase());
    const first = rawRows.length ? this.rowHeight(rawRows[0].map((c) => this.clean(c).trim()), cols, STYLE.cell) : 0;
    return this.rowHeight(header, cols, STYLE.cellHead) + first;
  }

  table(cols: Column[], rawRows: string[][]): void {
    const header = cols.map((c) => this.clean(c.header).toUpperCase());
    const rows = rawRows.map((r) => r.map((c) => this.clean(c).trim()));
    const headH = this.rowHeight(header, cols, STYLE.cellHead);
    const drawHeader = () => this.drawRow(header, cols, STYLE.cellHead, COLORS.secondary, 0.6);

    const firstH = rows.length ? this.rowHeight(rows[0], cols, STYLE.cell) : 0;
    this.ensureSpace(headH + Math.min(firstH, this.bodyHeight - headH));
    drawHeader();
    for (const row of rows) {
      const h = this.rowHeight(row, cols, STYLE.cell);
      if (h > this.bodyHeight - headH) {
        this.ensureSpace(this.lineHeight(STYLE.body) * 3);
        row.forEach((c, i) => this.keyValue(cols[i].header, c, 110));
        this.rule(this.doc.y, COLORS.border, 0.5);
        continue;
      }
      if (this.doc.y + h > this.bottom + 0.01) {
        this.newPage();
        drawHeader();
      }
      this.drawRow(row, cols, STYLE.cell, COLORS.border, 0.5);
    }
    this.doc.y += 4;
  }

  // ── Lists ───────────────────────────────────────────────────────────────

  /**
   * List item with a marker ("1.", "•") and one or more blocks of text that
   * share the hanging indent. Kept together when it fits on one page.
   */
  listItemHeight(blocks: Array<{ text: string; style: TextStyle }>): number {
    const w = this.width - ReportLayout.LIST_INDENT;
    const clean = blocks.map((b) => ({ text: this.clean(b.text).trim(), style: b.style })).filter((b) => b.text);
    return clean.length ? clean.reduce((a, b) => a + this.measure(b.text, w, b.style), 0) + 5 : 0;
  }

  private static LIST_INDENT = 18;

  listItem(marker: string, blocks: Array<{ text: string; style: TextStyle }>): void {
    const indent = ReportLayout.LIST_INDENT;
    const x = this.left + indent;
    const w = this.width - indent;
    const clean = blocks.map((b) => ({ text: this.clean(b.text).trim(), style: b.style })).filter((b) => b.text);
    if (clean.length === 0) return;
    const total = this.listItemHeight(clean);
    if (total <= this.bodyHeight) this.ensureSpace(total);
    else this.ensureSpace(this.lineHeight(clean[0].style) * 3);
    const y = this.doc.y;
    this.textAt(this.clean(marker), this.left, y, indent - 4, { ...clean[0].style, color: COLORS.secondary });
    this.doc.y = y;
    clean.forEach((b) => this.paragraph(b.text, b.style, { x, width: w }));
    this.doc.y += 5;
  }
}
