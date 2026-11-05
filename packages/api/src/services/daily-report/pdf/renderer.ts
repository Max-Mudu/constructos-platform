/**
 * Daily Site Report PDF renderer (V1).
 *
 * Pure: takes the human-reviewed content, photos and header data, returns the
 * PDF bytes. No DB, no storage, no clock, no randomness.
 *
 * V1 prints only the reviewed content and the photos with captions. It never
 * prints a system snapshot or any money (the content schema cannot carry it).
 *
 * Determinism: CreationDate/ModDate come from `finalisedAt`; pdfkit derives the
 * trailer /ID from the info dictionary (MD5), the font subset tag from the
 * internal font id and image names from a per-document counter, and zlib is
 * deterministic for the same input. The same input therefore yields a
 * byte-identical buffer (covered by tests).
 */
import PDFDocument from 'pdfkit';
import { SECTION_KEYS, SectionKey } from '../content.schema';
import type { DailyReportPdfInput, RenderDailyReportPdf } from './types';
import { FONT_BOLD, FONT_REGULAR, loadNotoSans, notoSansPaths } from './fonts';
import { COLORS, Column, PAGE, ReportLayout, STYLE, TextStyle } from './layout';
import {
  DELAY_CAUSE_LABELS, GlyphCoverage, INCIDENT_TYPE_LABELS, WEATHER_LABELS,
  formatDateTime, formatNumber, formatQuantity, formatReportDate, label, oneLine,
  safeTimeZone, yesNo,
} from './text';

/** Internal knobs for tests; the public signature stays `RenderDailyReportPdf`. */
export interface RenderOptions {
  /** Deflate content streams (default true). Tests turn it off to read the text. */
  compress?: boolean;
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  weather: 'Weather',
  manpower: 'Manpower',
  workCompleted: 'Work completed',
  delays: 'Delays',
  safety: 'Safety',
  materialsDeliveries: 'Materials and deliveries',
  visitorsInstructions: 'Visitors and instructions',
  tomorrowPlan: "Tomorrow's plan",
  remarks: 'Remarks',
};

const HEADER = { logoW: 120, logoH: 40, top: 30 };
const PHOTO = { gap: 12, aspect: 0.75, captionLines: 2 };

type Content = DailyReportPdfInput['content'];

/** A drawable piece of a section; `lead` is the height that must stay with the heading. */
interface Block { lead: () => number; draw: () => void }

const has = (s: string | null | undefined): boolean => !!s && s.trim() !== '';

function fontCoverage(doc: PDFKit.PDFDocument): GlyphCoverage[] {
  const out: GlyphCoverage[] = [];
  for (const name of [FONT_REGULAR, FONT_BOLD]) {
    doc.font(name);
    // pdfkit exposes the fontkit font on the internal `_font.font` field.
    const f = (doc as unknown as { _font?: { font?: Partial<GlyphCoverage> } })._font?.font;
    if (f && typeof f.hasGlyphForCodePoint === 'function') {
      out.push({ hasGlyphForCodePoint: (cp: number) => (f.hasGlyphForCodePoint as (c: number) => boolean).call(f, cp) });
    }
  }
  return out;
}

interface OpenedImage { width: number; height: number }

function openImage(doc: PDFKit.PDFDocument, data: Buffer | null | undefined): OpenedImage | null {
  if (!data || !Buffer.isBuffer(data) || data.length === 0) return null;
  try {
    const img = (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(data);
    return img && img.width > 0 && img.height > 0 ? img : null;
  } catch {
    return null;
  }
}

function drawImage(doc: PDFKit.PDFDocument, img: OpenedImage, x: number, y: number, w: number, h: number, align: 'left' | 'center'): void {
  // Passing the opened image object (not the Buffer) embeds it once, even when
  // drawn on every page (the logo).
  doc.image(img as unknown as Buffer, x, y, { fit: [w, h], align, valign: 'center' } as PDFKit.Mixins.ImageOption);
}

// ── Section emptiness ─────────────────────────────────────────────────────

const workItemHasData = (w: Content['workCompleted'][number]) =>
  has(w.description) || has(w.location) || w.quantity !== null || w.progressPercent !== null;
const manpowerEntryHasData = (m: Content['manpower']['entries'][number]) =>
  has(m.trade) || m.count !== null || has(m.employer) || has(m.notes);
const delayHasData = (d: Content['delays'][number]) =>
  has(d.description) || d.hoursLost !== null || has(d.responsibleParty) || !!d.cause;
const materialHasData = (m: Content['materialsDeliveries'][number]) =>
  has(m.material) || m.quantity !== null || has(m.supplier) || has(m.notes);
const visitorHasData = (v: Content['visitorsInstructions'][number]) =>
  has(v.name) || has(v.organisation) || has(v.purposeOrInstruction);

function sectionIsEmpty(c: Content, key: SectionKey): boolean {
  switch (key) {
    case 'weather':
      return c.weather.conditions.length === 0 && c.weather.temperatureC === null
        && c.weather.workStoppedByWeather === null && !has(c.weather.notes);
    case 'manpower':
      return !c.manpower.entries.some(manpowerEntryHasData) && c.manpower.totalOnSite === null && !has(c.manpower.notes);
    case 'workCompleted':
      return !c.workCompleted.some(workItemHasData);
    case 'delays':
      return !c.delays.some(delayHasData);
    case 'safety':
      return c.safety.incidentsReported === null && c.safety.incidents.length === 0
        && !has(c.safety.toolboxTalk) && !has(c.safety.notes);
    case 'materialsDeliveries':
      return !c.materialsDeliveries.some(materialHasData);
    case 'visitorsInstructions':
      return !c.visitorsInstructions.some(visitorHasData);
    case 'tomorrowPlan':
      return !c.tomorrowPlan.some((p) => has(p.description));
    case 'remarks':
      return !has(c.remarks);
  }
}

// ── Summary values ────────────────────────────────────────────────────────

function weatherSummary(c: Content): string {
  const parts: string[] = [];
  if (c.weather.conditions.length) parts.push(c.weather.conditions.map((w) => label(WEATHER_LABELS, w)).join(', '));
  if (c.weather.temperatureC !== null) parts.push(`${formatNumber(c.weather.temperatureC)} °C`);
  return parts.length ? parts.join(' · ') : 'Not stated';
}

function incidentsSummary(c: Content): string {
  const n = c.safety.incidents.length;
  if (n > 0) return `Yes (${n})`;
  return yesNo(c.safety.incidentsReported);
}

// ── Renderer ──────────────────────────────────────────────────────────────

class DailyReportPdf {
  private readonly L: ReportLayout;
  private readonly tz: string;
  private readonly finalisedText: string;
  private readonly logo: OpenedImage | null;

  constructor(private readonly doc: PDFKit.PDFDocument, private readonly input: DailyReportPdfInput) {
    this.L = new ReportLayout(doc);
    const fonts = loadNotoSans();
    doc.registerFont(FONT_REGULAR, fonts.regular);
    doc.registerFont(FONT_BOLD, fonts.bold);
    this.L.setGlyphCoverage(fontCoverage(doc));
    this.tz = safeTimeZone(input.report.timezone);
    this.finalisedText = `${formatDateTime(input.finalisedAt, this.tz)} (${this.tz})`;
    this.logo = openImage(doc, input.company.logo);
  }

  render(): void {
    const { L } = this;
    L.y = L.top;
    this.summary();
    SECTION_KEYS.forEach((key, i) => this.section(key, i + 1));
    this.photos();
    this.signOff();
    this.headersAndFooters();
  }

  // ── Summary strip ──

  private summary(): void {
    const { L, input } = this;
    const c = input.content;
    if (has(input.site.address)) {
      L.paragraph(`Site address: ${oneLine(input.site.address ?? '')}`, STYLE.meta, { gapAfter: 6 });
    }
    const cells: Array<[string, string]> = [
      ['WEATHER', weatherSummary(c)],
      ['MANPOWER ON SITE', c.manpower.totalOnSite !== null ? formatNumber(c.manpower.totalOnSite) : '—'],
      ['DELAYS', String(c.delays.filter(delayHasData).length)],
      ['INCIDENTS', incidentsSummary(c)],
    ];
    const pad = 8;
    const cw = L.width / cells.length;
    const labelStyle: TextStyle = { size: 7, weight: 'bold', color: COLORS.muted };
    const valueStyle: TextStyle = { size: 10.5, weight: 'bold', color: COLORS.text, lineGap: 0.5 };
    const labelH = L.lineHeight(labelStyle);
    const values = cells.map(([, v]) => L.clean(v));
    const valueH = Math.max(...values.map((v) => L.measure(v, cw - 2 * pad, valueStyle)));
    const h = pad + labelH + 2 + valueH + pad;
    L.ensureSpace(h + 16);
    const y = L.y;
    L.rect(L.left, y, L.width, h);
    cells.forEach(([lab], i) => {
      const x = L.left + i * cw;
      if (i > 0) this.doc.save().moveTo(x, y + 6).lineTo(x, y + h - 6).lineWidth(0.75).strokeColor(COLORS.border).stroke().restore();
      L.textAt(lab, x + pad, y + pad, cw - 2 * pad, labelStyle);
      L.textAt(values[i], x + pad, y + pad + labelH + 2, cw - 2 * pad, valueStyle);
    });
    L.y = y + h + 18;
  }

  // ── Sections ──
  //
  // Each section is a list of blocks. A block knows the height that must stay
  // with the section heading (`lead`) so a heading never ends a page alone.

  private section(key: SectionKey, n: number): void {
    const { L } = this;
    const blocks = sectionIsEmpty(this.input.content, key)
      ? [this.block(() => L.lineHeight(STYLE.bodyMuted) + 2, () => L.notReported())]
      : this.blocksFor(key);
    L.heading(String(n).padStart(2, '0'), SECTION_TITLES[key], blocks.length ? blocks[0].lead() : 0);
    blocks.forEach((b) => b.draw());
    L.y += 12;
  }

  private block(lead: () => number, draw: () => void): Block {
    return { lead, draw };
  }

  private kvBlock(labelText: string, value: string): Block {
    // A label/value row moves to the next page as a whole, so all of it is lead.
    return this.block(() => this.L.keyValueHeight(value), () => this.L.keyValue(labelText, value));
  }

  private tableBlock(cols: Column[], rows: string[][]): Block {
    return this.block(() => this.L.tableLeadHeight(cols, rows), () => this.L.table(cols, rows));
  }

  private listBlock(marker: string, parts: Array<{ text: string; style: TextStyle }>): Block {
    // Items that fit on a page are kept together; longer ones start with 3 lines.
    return this.block(
      () => {
        const h = this.L.listItemHeight(parts);
        return h <= this.L.bodyHeight ? h : this.L.lineHeight(STYLE.body) * 3;
      },
      () => this.L.listItem(marker, parts),
    );
  }

  private blocksFor(key: SectionKey): Block[] {
    const { L } = this;
    const c = this.input.content;
    const out: Block[] = [];
    switch (key) {
      case 'weather': {
        const w = c.weather;
        if (w.conditions.length) out.push(this.kvBlock('Conditions', w.conditions.map((x) => label(WEATHER_LABELS, x)).join(', ')));
        if (w.temperatureC !== null) out.push(this.kvBlock('Temperature', `${formatNumber(w.temperatureC)} °C`));
        if (w.workStoppedByWeather !== null) out.push(this.kvBlock('Work stopped by weather', yesNo(w.workStoppedByWeather)));
        if (has(w.notes)) out.push(this.kvBlock('Notes', w.notes));
        break;
      }
      case 'manpower': {
        const m = c.manpower;
        const entries = m.entries.filter(manpowerEntryHasData);
        if (entries.length) {
          out.push(this.tableBlock(
            [
              { header: 'Trade', width: 0.28 },
              { header: 'Employer', width: 0.27 },
              { header: 'Workers', width: 0.12, align: 'right' },
              { header: 'Notes', width: 0.33 },
            ],
            entries.map((e) => [e.trade, e.employer, e.count !== null ? formatNumber(e.count) : '—', e.notes]),
          ));
        }
        // Total exactly as entered by the supervisor; never summed here.
        out.push(this.kvBlock('Total on site (as entered)', m.totalOnSite !== null ? formatNumber(m.totalOnSite) : '—'));
        if (has(m.notes)) out.push(this.kvBlock('Notes', m.notes));
        break;
      }
      case 'workCompleted':
        c.workCompleted.filter(workItemHasData).forEach((w, i) => {
          const meta: string[] = [];
          if (has(w.location)) meta.push(`Location: ${oneLine(w.location)}`);
          const q = formatQuantity(w.quantity, w.unit);
          if (q) meta.push(`Quantity: ${q}`);
          if (w.progressPercent !== null) meta.push(`Progress: ${formatNumber(w.progressPercent)}%`);
          out.push(this.listBlock(`${i + 1}.`, [
            { text: w.description, style: STYLE.body },
            { text: meta.join('  ·  '), style: STYLE.meta },
          ]));
        });
        break;
      case 'delays':
        out.push(this.tableBlock(
          [
            { header: 'Cause', width: 0.22 },
            { header: 'Description', width: 0.46 },
            { header: 'Time lost', width: 0.12, align: 'right' },
            { header: 'Responsible', width: 0.2 },
          ],
          c.delays.filter(delayHasData).map((d) => [
            label(DELAY_CAUSE_LABELS, d.cause),
            d.description,
            d.hoursLost !== null ? `${formatNumber(d.hoursLost)} h` : '—',
            d.responsibleParty,
          ]),
        ));
        break;
      case 'safety': {
        const s = c.safety;
        out.push(this.kvBlock('Incidents reported', s.incidents.length > 0 && s.incidentsReported === null ? 'Yes' : yesNo(s.incidentsReported)));
        s.incidents.forEach((inc, i) => out.push(this.listBlock(`${i + 1}.`, [
          { text: label(INCIDENT_TYPE_LABELS, inc.type), style: { ...STYLE.body, weight: 'bold' } },
          { text: inc.description, style: STYLE.body },
        ])));
        if (has(s.toolboxTalk)) out.push(this.kvBlock('Toolbox talk', s.toolboxTalk));
        if (has(s.notes)) out.push(this.kvBlock('Notes', s.notes));
        break;
      }
      case 'materialsDeliveries':
        out.push(this.tableBlock(
          [
            { header: 'Material', width: 0.3 },
            { header: 'Quantity', width: 0.16, align: 'right' },
            { header: 'Supplier', width: 0.24 },
            { header: 'Notes', width: 0.3 },
          ],
          c.materialsDeliveries.filter(materialHasData).map((m) => [m.material, formatQuantity(m.quantity, m.unit) || '—', m.supplier, m.notes]),
        ));
        break;
      case 'visitorsInstructions':
        out.push(this.tableBlock(
          [
            { header: 'Name', width: 0.22 },
            { header: 'Organisation', width: 0.24 },
            { header: 'Purpose or instruction', width: 0.54 },
          ],
          c.visitorsInstructions.filter(visitorHasData).map((v) => [v.name, v.organisation, v.purposeOrInstruction]),
        ));
        break;
      case 'tomorrowPlan':
        c.tomorrowPlan.filter((p) => has(p.description))
          .forEach((p) => out.push(this.listBlock('•', [{ text: p.description, style: STYLE.body }])));
        break;
      case 'remarks':
        out.push(this.block(
          () => {
            // Mirrors ReportLayout.paragraph: ≤ 4 lines move as a whole, longer text splits after 2 lines.
            const h = L.measure(L.clean(c.remarks).trim(), L.width, STYLE.body);
            const lh = L.lineHeight(STYLE.body);
            return h <= lh * 4 + 0.5 ? h : lh * 2;
          },
          () => L.paragraph(c.remarks, STYLE.body, { gapAfter: 2 }),
        ));
        break;
    }
    return out;
  }

  // ── Photos ──

  private photos(): void {
    const { L, doc } = this;
    const photos = this.input.photos ?? [];
    const cellW = (L.width - PHOTO.gap) / 2;
    const imgH = cellW * PHOTO.aspect;
    const captionLH = L.lineHeight(STYLE.caption);
    const captions = photos.map((p, i) => {
      const c = L.clean(p.caption ?? '').replace(/\s+/g, ' ').trim();
      const text = c ? `${i + 1}. ${c}` : `Photo ${i + 1}`;
      return L.truncateToLines(text, cellW, PHOTO.captionLines, STYLE.caption);
    });
    const rowH = (i: number) => {
      const capH = Math.max(
        L.measure(captions[i], cellW, STYLE.caption),
        i + 1 < photos.length ? L.measure(captions[i + 1], cellW, STYLE.caption) : 0,
        captionLH,
      );
      return imgH + 5 + capH;
    };

    L.heading(null, 'Site photos', photos.length ? rowH(0) : L.lineHeight(STYLE.body));
    if (photos.length === 0) {
      L.paragraph('No photos attached', STYLE.bodyMuted, { gapAfter: 2 });
      L.y += 12;
      return;
    }
    for (let i = 0; i < photos.length; i += 2) {
      const h = rowH(i);
      if (L.y + h > L.bottom + 0.01) {
        L.newPage();
        L.textAt('Site photos (continued)', L.left, L.y, L.width, STYLE.meta);
        L.y += L.lineHeight(STYLE.meta) + 6;
      }
      const y = L.y;
      for (let j = 0; j < 2 && i + j < photos.length; j++) {
        const x = L.left + j * (cellW + PHOTO.gap);
        const img = openImage(doc, photos[i + j].data);
        if (img) {
          drawImage(doc, img, x, y, cellW, imgH, 'center');
        } else {
          L.textAt('Photo could not be displayed', x, y + imgH / 2 - 6, cellW, STYLE.caption, 'center');
        }
        L.rect(x, y, cellW, imgH);
        L.textAt(captions[i + j], x, y + imgH + 5, cellW, STYLE.caption);
      }
      L.y = y + h + 14;
    }
  }

  // ── Sign-off ──

  private signOff(): void {
    const { L, input } = this;
    const colW = (L.width - 24) / 2;
    const nameStyle: TextStyle = { size: 10.5, weight: 'bold', color: COLORS.text };
    const prepared = L.clean(oneLine(input.preparedBy)) || '—';
    const finalised = L.clean(oneLine(input.finalisedBy)) || '—';
    const ref = L.clean(oneLine(input.contentHash));
    const refText = ref ? `Content reference: ${ref}` : '';
    const labelH = L.lineHeight(STYLE.label);
    const preparedH = L.measure(prepared, colW, nameStyle);
    const finalisedH = L.measure(finalised, colW, nameStyle) + 1 + L.measure(this.finalisedText, colW, STYLE.meta);
    const colsH = labelH + Math.max(preparedH, finalisedH) + 10;
    // Keep the whole block (heading, both columns, reference) on one page.
    L.ensureSpace(L.headingHeight() + colsH + L.measure(refText, L.width, STYLE.caption));
    L.heading(null, 'Sign-off', 0);
    const y = L.y;
    const col = (x: number, title: string, name: string, line: string) => {
      L.textAt(title, x, y, colW, STYLE.label);
      const yy = y + labelH + L.textAt(name, x, y + labelH, colW, nameStyle);
      if (line) L.textAt(line, x, yy + 1, colW, STYLE.meta);
    };
    col(L.left, 'Prepared by', prepared, '');
    col(L.left + colW + 24, 'Finalised by', finalised, this.finalisedText);
    L.y = y + colsH;
    if (refText) L.paragraph(refText, STYLE.caption);
  }

  // ── Header and footer on every page ──

  private headersAndFooters(): void {
    const { L, doc, input } = this;
    const range = doc.bufferedPageRange();
    const total = range.count;
    const titleStyle: TextStyle = { size: 14, weight: 'bold', color: COLORS.accent };
    const lineStyle: TextStyle = { size: 9, weight: 'bold', color: COLORS.text };
    const subStyle: TextStyle = { size: 8.5, color: COLORS.secondary };
    const footStyle: TextStyle = { size: 7.5, color: COLORS.muted };
    const wordmarkStyle: TextStyle = { size: 13, weight: 'bold', color: COLORS.text };

    const reportLine = L.clean(
      `${oneLine(input.report.number)} · Rev ${input.report.revision} · ${formatReportDate(input.report.reportDate, this.tz)}`,
    );
    const project = oneLine(input.project.name) + (has(input.project.code) ? ` (${oneLine(input.project.code ?? '')})` : '');
    const placeLine = L.clean([project, oneLine(input.site.name)].filter(Boolean).join(' · '));
    const company = L.clean(oneLine(input.company.name));
    const ref = L.clean(oneLine(input.contentHash).slice(0, 12));
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const rightX = L.left + HEADER.logoW + 16;
    const rightW = L.width - HEADER.logoW - 16;

    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i);
      // Header
      const top = HEADER.top;
      if (this.logo) {
        drawImage(doc, this.logo, L.left, top, HEADER.logoW, HEADER.logoH, 'left');
      } else {
        const lh = L.lineHeight(wordmarkStyle);
        L.lineAt(company, L.left, top + (HEADER.logoH - lh) / 2, HEADER.logoW + 40, wordmarkStyle);
      }
      L.lineAt('Daily Site Report', rightX, top - 2, rightW, titleStyle, 'right');
      L.lineAt(reportLine, rightX, top + 19, rightW, lineStyle, 'right');
      L.lineAt(placeLine, rightX, top + 32, rightW, subStyle, 'right');
      L.rule(top + 50, COLORS.accent, 1);

      // Footer
      const fy = pageH - 42;
      L.rule(fy - 6, COLORS.border, 0.75);
      const pageText = `Page ${i + 1} of ${total}`;
      const pageTextW = L.widthOf(pageText, footStyle);
      L.lineAt(pageText, pageW - doc.page.margins.right - pageTextW - 1, fy, pageTextW + 1, footStyle, 'right');
      L.lineAt(this.footerLeft(L.width - pageTextW - 16, footStyle, ref), L.left, fy, L.width - pageTextW - 16, footStyle);
    }
  }

  /** "Prepared by X · Finalised by Y, <date> (<tz>) · Ref <hash12>", names shortened first if needed. */
  private footerLeft(width: number, style: TextStyle, ref: string): string {
    const { L, input } = this;
    const prepared = L.clean(oneLine(input.preparedBy)) || '—';
    const finalised = L.clean(oneLine(input.finalisedBy)) || '—';
    const tail = `, ${this.finalisedText}${ref ? ` · Ref ${ref}` : ''}`;
    const full = `Prepared by ${prepared} · Finalised by ${finalised}${tail}`;
    if (L.widthOf(full, style) <= width) return full;
    const fixed = L.widthOf(`Prepared by  · Finalised by ${tail}`, style);
    const each = Math.max(30, (width - fixed) / 2);
    return `Prepared by ${L.fitLine(prepared, each, style)} · Finalised by ${L.fitLine(finalised, each, style)}${tail}`;
  }
}

/** Renders with internal options (tests use `compress: false`). */
export function renderDailyReportPdfWithOptions(input: DailyReportPdfInput, options: RenderOptions = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let doc: PDFKit.PDFDocument;
    try {
      const title = `Daily Site Report ${oneLine(input.report.number)} Rev ${input.report.revision}`;
      doc = new PDFDocument({
        size: PAGE.size,
        margins: PAGE.margins,
        bufferPages: true,
        autoFirstPage: true,
        compress: options.compress ?? true,
        font: notoSansPaths().regular,
        lang: 'en-GB',
        displayTitle: true,
        info: {
          Title: `${title} - ${oneLine(input.project.name)}`,
          Author: oneLine(input.company.name),
          Subject: `${oneLine(input.site.name)}, ${oneLine(input.report.reportDate)}`,
          Creator: 'ConstructOS',
          Producer: 'ConstructOS',
          CreationDate: input.finalisedAt,
          ModDate: input.finalisedAt,
        },
      });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      new DailyReportPdf(doc, input).render();
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export const renderDailyReportPdf: RenderDailyReportPdf = (input) => renderDailyReportPdfWithOptions(input);
