/**
 * Daily Site Report PDF renderer. Pure unit tests: no DB, no storage.
 * All fixtures and images are synthetic (images generated with sharp).
 *
 * Text checks render with `compress: false` and decode the content streams
 * through each embedded font's ToUnicode CMap, so they assert on what a PDF
 * viewer would actually show, not on the input data.
 */
import sharp from 'sharp';
import { DailyReportContentV1, SECTION_KEYS } from '../src/services/daily-report/content.schema';
import type { DailyReportPdfInput } from '../src/services/daily-report/pdf/types';
import {
  SECTION_TITLES,
  renderDailyReportPdf,
  renderDailyReportPdfWithOptions,
} from '../src/services/daily-report/pdf/renderer';
import { PAGE } from '../src/services/daily-report/pdf/layout';

// ── Minimal PDF reader for pdfkit output (uncompressed) ───────────────────

interface TextOp { page: number; font: string; text: string; baselineFromTop: number; gids: number[] }
interface ParsedPdf { pages: number; ops: TextOp[]; text: string; info: string; imageCount: number }

const A4_HEIGHT = 841.89;

function parsePdf(buf: Buffer): ParsedPdf {
  const src = buf.toString('latin1');
  const objects = new Map<number, string>();
  const objRe = /(\d+) 0 obj\s*([\s\S]*?)\bendobj/g;
  for (let m = objRe.exec(src); m; m = objRe.exec(src)) objects.set(Number(m[1]), m[2]);

  const streamOf = (id: number): string => {
    const body = objects.get(id) ?? '';
    const s = body.indexOf('stream');
    const e = body.lastIndexOf('endstream');
    return s >= 0 && e > s ? body.slice(s + 'stream'.length, e).replace(/^\r?\n/, '') : '';
  };

  // Font resource name → gid → unicode string.
  const cmaps = new Map<string, Map<number, string>>();
  const fontRefRe = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
  for (const body of objects.values()) {
    for (let m = fontRefRe.exec(body); m; m = fontRefRe.exec(body)) {
      if (cmaps.has(m[1])) continue;
      const fontObj = objects.get(Number(m[2])) ?? '';
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObj);
      const map = new Map<number, string>();
      if (tu) {
        const cm = streamOf(Number(tu[1]));
        const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
        for (let r = rangeRe.exec(cm); r; r = rangeRe.exec(cm)) {
          const start = parseInt(r[1], 16);
          const entries = r[3].match(/<[^>]*>/g) ?? [];
          entries.forEach((entry, i) => {
            const units = entry.slice(1, -1).trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
            map.set(start + i, String.fromCharCode(...units));
          });
        }
      }
      cmaps.set(m[1], map);
    }
  }

  // Page content streams in page order.
  const pageIds: number[] = [];
  const pagesObj = [...objects.values()].find((b) => /\/Type\s*\/Pages\b/.test(b)) ?? '';
  const kids = /\/Kids\s*\[([^\]]*)\]/.exec(pagesObj);
  if (kids) for (const k of kids[1].matchAll(/(\d+)\s+0\s+R/g)) pageIds.push(Number(k[1]));

  const ops: TextOp[] = [];
  pageIds.forEach((pid, pageIndex) => {
    const page = objects.get(pid) ?? '';
    const contents = /\/Contents\s+(\d+)\s+0\s+R/.exec(page);
    if (!contents) return;
    const cs = streamOf(Number(contents[1]));
    let font = '';
    let baseline = 0;
    let firstTmInBlock = true;
    let newBlock = true;
    const tokenRe = /BT|1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-fA-F]*>|[^\]])*)\] TJ|<([0-9a-fA-F]*)> Tj/g;
    for (let t = tokenRe.exec(cs); t; t = tokenRe.exec(cs)) {
      if (t[0] === 'BT') { firstTmInBlock = true; newBlock = true; continue; }
      if (t[2] !== undefined) {
        // Only the first Tm of a BT block is the line origin; later ones are mark offsets.
        if (firstTmInBlock) baseline = A4_HEIGHT - Number(t[2]);
        firstTmInBlock = false;
        continue;
      }
      if (t[3]) { font = t[3]; continue; }
      const hexParts = t[4] !== undefined ? (t[4].match(/<([0-9a-fA-F]*)>/g) ?? []).map((h) => h.slice(1, -1)) : [t[5]];
      const gids: number[] = [];
      for (const hex of hexParts) for (let i = 0; i + 4 <= hex.length; i += 4) gids.push(parseInt(hex.slice(i, i + 4), 16));
      const map = cmaps.get(font) ?? new Map<number, string>();
      const text = gids.map((g) => map.get(g) ?? '�').join('');
      // pdfkit splits one line into several TJ runs when a combining mark is
      // offset; runs inside the same BT block are one line of text.
      const prev = ops[ops.length - 1];
      if (!newBlock && prev) {
        prev.text += text;
        prev.gids.push(...gids);
      } else {
        ops.push({ page: pageIndex + 1, font, text, baselineFromTop: baseline, gids });
      }
      newBlock = false;
    }
  });

  const infoRef = /\/Info\s+(\d+)\s+0\s+R/.exec(src);
  const infoDict = infoRef ? objects.get(Number(infoRef[1])) ?? '' : '';
  // Resolve the indirect string values (pdfkit stores each info value as its own object).
  const info = infoDict.replace(/(\d+)\s+0\s+R/g, (_, id: string) => (objects.get(Number(id)) ?? '').trim());
  return {
    pages: (src.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length,
    ops,
    text: ops.map((o) => o.text).join('\n').normalize('NFC'),
    info,
    imageCount: (src.match(/\/Subtype\s*\/Image\b/g) ?? []).length,
  };
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ── Synthetic fixtures ─────────────────────────────────────────────────────

async function jpeg(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .jpeg({ quality: 70 })
    .toBuffer();
}

async function png(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer();
}

function baseInput(content: DailyReportContentV1, extra: Partial<DailyReportPdfInput> = {}): DailyReportPdfInput {
  return {
    company: { name: 'Mfano Builders Ltd', logo: null },
    project: { name: 'Riverside Apartments', code: 'RSA-01' },
    site: { name: 'Block B', address: 'Plot 12, Riverside Drive, Nairobi' },
    report: { number: 'DR-0042', revision: 1, reportDate: '2026-11-05', timezone: 'Africa/Nairobi' },
    content,
    photos: [],
    preparedBy: 'Amina Njeri',
    finalisedBy: 'Peter Otieno',
    finalisedAt: new Date('2026-11-05T15:42:00.000Z'),
    contentHash: '3f9a1c0b2d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccdd',
    ...extra,
  };
}

const realisticContent = (): DailyReportContentV1 => DailyReportContentV1.parse({
  weather: { conditions: ['cloudy', 'light_rain'], temperatureC: 22, workStoppedByWeather: true, notes: 'Rain from 13:00 to 14:00; pour area covered with polythene.' },
  manpower: {
    entries: [
      { trade: 'Steel fixers', count: 10, employer: 'Own staff', notes: 'Slab and beam reinforcement' },
      { trade: 'Carpenters', count: 8, employer: 'Own staff', notes: 'Formwork to level 2 columns' },
      { trade: 'Labourers', count: 9, employer: 'Own staff', notes: '' },
    ],
    totalOnSite: 27,
    notes: '',
  },
  workCompleted: [
    { description: 'Poured level 2 slab, grade C30', location: 'Block B, level 2', quantity: 43, unit: 'm³', progressPercent: 100 },
    { description: 'Fixed column starter bars for level 3', location: 'Grid lines C to F', quantity: null, unit: '', progressPercent: 40 },
  ],
  delays: [
    { cause: 'late_materials', description: 'Concrete pump arrived 45 minutes after the agreed time.', hoursLost: 0.75, responsibleParty: 'Pump hire supplier' },
    { cause: 'weather', description: 'Rain stopped the pour for one hour.', hoursLost: 1, responsibleParty: '' },
  ],
  safety: { incidentsReported: false, incidents: [], toolboxTalk: 'Working near the pump boom and wet surfaces.', notes: '' },
  materialsDeliveries: [{ material: 'Ready-mix concrete C30', quantity: 43, unit: 'm³', supplier: 'Synthetic Readymix Co.', notes: 'Six truck loads' }],
  visitorsInstructions: [{ name: 'Eng. Grace Wambui', organisation: 'Synthetic Consulting Engineers', purposeOrInstruction: 'Inspected slab reinforcement before the pour and approved it.' }],
  tomorrowPlan: [{ description: 'Start blockwork on level 1, gridlines A to C.' }, { description: 'Strike level 1 slab soffit formwork.' }],
  remarks: 'Pour completed by 17:30. Curing to start tomorrow morning.',
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('renderDailyReportPdf', () => {
  it('returns a valid PDF buffer (public export, compressed)', async () => {
    const buf = await renderDailyReportPdf(baseInput(realisticContent()));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(parsePdf(buf).pages).toBeGreaterThanOrEqual(1);
    expect(buf.length).toBeLessThan(200_000); // fonts are subset
  });

  it('prints "Not reported" for every section when content is empty, and every section heading in order', async () => {
    const buf = await renderDailyReportPdfWithOptions(baseInput(DailyReportContentV1.parse({})), { compress: false });
    const pdf = parsePdf(buf);
    expect(count(pdf.text, 'Not reported')).toBe(SECTION_KEYS.length);
    let last = -1;
    for (const key of SECTION_KEYS) {
      const idx = pdf.text.indexOf(SECTION_TITLES[key]);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    expect(pdf.text).toContain('No photos attached');
    // Summary strip shows no invented values.
    expect(pdf.text).toContain('Not stated');
    expect(pdf.text).toContain('—');
  });

  it('prints real content and no "Not reported" for filled sections', async () => {
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent()), { compress: false }));
    expect(count(pdf.text, 'Not reported')).toBe(0);
    for (const s of ['Steel fixers', 'Carpenters', 'Labourers', '43 m³', '0.75 h', 'Late materials', 'Start blockwork on level 1, gridlines A to C.', 'Ready-mix concrete C30', 'Eng. Grace Wambui']) {
      expect(pdf.text).toContain(s);
    }
    expect(pdf.text).toContain('27'); // total as entered
    expect(pdf.text).toContain('Light rain');
    // Decoded text contains only characters that were in the input or in the labels.
    expect(pdf.text).toMatch(/Synthetic Consulting ?\nEngineers/);
  });

  it('draws the header and "Page n of m" footer on every page, with the date in the report timezone', async () => {
    const content = DailyReportContentV1.parse({
      remarks: 'Long remark sentence for flow. '.repeat(130).slice(0, 4000),
      tomorrowPlan: Array.from({ length: 40 }, (_, i) => ({ description: `Planned activity ${i + 1}: ${'continue works '.repeat(12)}` })),
    });
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(content), { compress: false }));
    expect(pdf.pages).toBeGreaterThan(1);
    expect(count(pdf.text, 'Daily Site Report')).toBe(pdf.pages);
    for (let p = 1; p <= pdf.pages; p++) expect(pdf.text).toContain(`Page ${p} of ${pdf.pages}`);
    expect(count(pdf.text, 'DR-0042 · Rev 1 · Thu 5 Nov 2026')).toBe(pdf.pages);
    expect(pdf.text).toContain('Riverside Apartments (RSA-01) · Block B');
    // 15:42 UTC is 18:42 in Nairobi (UTC+3).
    expect(pdf.text).toContain('Prepared by Amina Njeri · Finalised by Peter Otieno, 5 Nov 2026 18:42 (Africa/Nairobi) · Ref 3f9a1c0b2d4e');
  });

  it('falls back to UTC for an unknown timezone instead of throwing', async () => {
    const input = baseInput(realisticContent());
    input.report.timezone = 'Not/AZone';
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(input, { compress: false }));
    expect(pdf.text).toContain('5 Nov 2026 15:42 (UTC)');
  });

  it('adds pages for 12 photos compared with none, embedding each photo', async () => {
    const photos = await Promise.all(Array.from({ length: 12 }, async (_, i) => ({
      data: i % 3 === 0 ? await jpeg(1200, 1600, [40 + i * 10, 90, 120]) : await jpeg(1600, 1200, [120, 60 + i * 10, 40]),
      caption: `Synthetic photo ${i + 1}`,
    })));
    const none = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent()), { compress: false }));
    const many = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent(), { photos }), { compress: false }));
    expect(many.pages).toBeGreaterThan(none.pages);
    expect(many.imageCount).toBe(12);
    expect(many.text).toContain('Site photos');
    expect(many.text).toContain('12. Synthetic photo 12');
  });

  it('flows very long remarks and work items onto extra pages without drawing into the bottom margin', async () => {
    const long = 'Formwork, reinforcement and concrete works continued across the deck with checks at every bay. ';
    const content = DailyReportContentV1.parse({
      remarks: long.repeat(40).slice(0, 4000),
      workCompleted: Array.from({ length: 60 }, (_, i) => ({
        description: `${i + 1} ${long.repeat(8).slice(0, 900)}`, location: `Zone ${i}`, quantity: i + 0.5, unit: 'm²', progressPercent: 50,
      })),
      manpower: { entries: Array.from({ length: 50 }, (_, i) => ({ trade: `Trade ${i}`, count: i, employer: 'Own staff', notes: long.repeat(3).slice(0, 300) })) },
      delays: Array.from({ length: 30 }, () => ({ cause: 'other', description: 'W'.repeat(1000), hoursLost: 1, responsibleParty: 'X'.repeat(150) })),
      visitorsInstructions: Array.from({ length: 20 }, () => ({ name: 'Visitor', organisation: 'Org', purposeOrInstruction: long.repeat(11).slice(0, 1000) })),
    });
    const short = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent()), { compress: false }));
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(content), { compress: false }));
    expect(pdf.pages).toBeGreaterThan(short.pages + 5);
    expect(pdf.text).toContain('60 Formwork'); // last work item reached
    // Table header row is repeated after page breaks.
    expect(count(pdf.text, 'TRADE')).toBeGreaterThan(1);
    expect(count(pdf.text, 'DESCRIPTION')).toBeGreaterThan(1);

    const bodyBottom = A4_HEIGHT - PAGE.margins.bottom;
    const footerTop = A4_HEIGHT - 48; // footer rule sits at height - 48
    const intoMargin = pdf.ops.filter((o) => o.baselineFromTop > bodyBottom + 0.5 && o.baselineFromTop < footerTop);
    expect(intoMargin).toEqual([]);
    expect(pdf.ops.every((o) => o.baselineFromTop > 0 && o.baselineFromTop < A4_HEIGHT)).toBe(true);
    // Every page has body text below the header (no blank pages), and no page
    // ends with a section heading whose content starts on the next page.
    const headings = new Set<string>([...Object.values(SECTION_TITLES), 'Site photos', 'Sign-off']);
    for (let p = 1; p <= pdf.pages; p++) {
      const body = pdf.ops.filter((o) => o.page === p && o.baselineFromTop > PAGE.margins.top && o.baselineFromTop < bodyBottom);
      expect(body.length).toBeGreaterThan(0);
      const maxBaseline = Math.max(...body.map((o) => o.baselineFromTop));
      const lastLine = body.filter((o) => o.baselineFromTop > maxBaseline - 4).map((o) => o.text.trim());
      expect(lastLine.filter((t) => headings.has(t))).toEqual([]);
    }
  });

  it('renders with a null logo (company name as wordmark)', async () => {
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent()), { compress: false }));
    expect(count(pdf.text, 'Mfano Builders Ltd')).toBe(pdf.pages);
    expect(pdf.imageCount).toBe(0);
  });

  it('prints a long company name in full when the header has room for it', async () => {
    const name = 'Kilimani Heights Construction Company Ltd';
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(
      baseInput(realisticContent(), { company: { name, logo: null } }), { compress: false },
    ));
    expect(count(pdf.text, name)).toBe(pdf.pages);
  });

  it('shrinks, then truncates with an ellipsis, a company name too long for the header — the right-hand block stays intact', async () => {
    const name = 'Mwangi and Sons Building, Civil Engineering and General Construction Contractors of East Africa Limited';
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(
      baseInput(realisticContent(), { company: { name, logo: null } }), { compress: false },
    ));
    expect(pdf.text).not.toContain(name);
    expect(count(pdf.text, 'Mwangi and Sons Building')).toBe(pdf.pages);
    expect(count(pdf.text, '…')).toBeGreaterThanOrEqual(pdf.pages);
    expect(count(pdf.text, 'Daily Site Report')).toBe(pdf.pages);
  });

  it('weather summary reflects a weather stoppage instead of "Not stated" when no condition was given', async () => {
    const stopped = parsePdf(await renderDailyReportPdfWithOptions(baseInput(DailyReportContentV1.parse({
      weather: { conditions: [], temperatureC: null, workStoppedByWeather: true, notes: 'Rain stopped work for another hour.' },
      safety: { incidentsReported: false }, // so the INCIDENTS tile is not "Not stated" either
    })), { compress: false }));
    expect(stopped.text).toContain('Stopped work'); // the tile value, not the "Work stopped by weather" label
    expect(stopped.text).not.toContain('Not stated');
    const remarkOnly = parsePdf(await renderDailyReportPdfWithOptions(baseInput(DailyReportContentV1.parse({
      weather: { conditions: [], temperatureC: null, workStoppedByWeather: null, notes: 'Overcast in the morning.' },
    })), { compress: false }));
    expect(remarkOnly.text).toContain('See notes');
    // control: nothing about the weather at all is still "Not stated"
    const empty = parsePdf(await renderDailyReportPdfWithOptions(baseInput(DailyReportContentV1.parse({})), { compress: false }));
    expect(empty.text).toContain('Not stated');
  });

  it.each([
    ['PNG', () => png(600, 200, [148, 101, 15])],
    ['JPEG', () => jpeg(300, 300, [17, 24, 39])],
  ])('renders a %s logo once and reuses it on every page', async (_kind, make) => {
    const logo = await make();
    const content = DailyReportContentV1.parse({ remarks: 'Remark text. '.repeat(300), tomorrowPlan: Array.from({ length: 40 }, (_, i) => ({ description: `Activity ${i} ${'more words '.repeat(15)}` })) });
    const buf = await renderDailyReportPdfWithOptions(baseInput(content, { company: { name: 'Mfano Builders Ltd', logo } }), { compress: false });
    const pdf = parsePdf(buf);
    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.imageCount).toBe(1); // embedded once
    expect(count(buf.toString('latin1'), '/I1 Do')).toBe(pdf.pages); // drawn on every page
    expect(pdf.text).not.toContain('Mfano Builders Ltd'); // logo replaces the wordmark
  });

  it('falls back to the wordmark when the logo bytes are not an image', async () => {
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(
      baseInput(realisticContent(), { company: { name: 'Mfano Builders Ltd', logo: Buffer.from('not an image') } }),
      { compress: false },
    ));
    expect(pdf.text).toContain('Mfano Builders Ltd');
  });

  it('truncates long captions to two lines with an ellipsis', async () => {
    const tail = 'UNIQUE-TAIL-MARKER';
    const caption = `${'Very long synthetic caption describing the slab pour in detail '.repeat(8)}${tail}`;
    const photos = [{ data: await jpeg(800, 600, [90, 90, 90]), caption }];
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent(), { photos }), { compress: false }));
    const capOps = pdf.ops.filter((o) => o.text.includes('Very long synthetic caption') || (o.text.includes('…') && o.text.includes('caption')));
    expect(pdf.text).not.toContain(tail);
    expect(pdf.text).toContain('…');
    // Caption lines: at most 2 text lines that belong to the caption paragraph.
    const captionLines = pdf.ops.filter((o) => /synthetic caption|slab pour|in detail/.test(o.text));
    expect(captionLines.length).toBeLessThanOrEqual(2);
    expect(capOps.length).toBeGreaterThan(0);
  });

  it('contains no money words for a fixture whose free text has none (with a positive control)', async () => {
    const moneyRe = /rate|wage|cost|KES|USD/i;
    const clean = parsePdf(await renderDailyReportPdfWithOptions(baseInput(realisticContent()), { compress: false }));
    expect(clean.text.length).toBeGreaterThan(500);
    expect(clean.text).not.toMatch(moneyRe);
    expect(clean.info).toContain('/Author (Mfano Builders Ltd)'); // info values resolved
    expect(clean.info).not.toMatch(moneyRe);
    // Positive control: the same detector finds money text when the free text has it.
    const dirty = realisticContent();
    dirty.remarks = 'Paid KES 5,000 to the driver.';
    const control = parsePdf(await renderDailyReportPdfWithOptions(baseInput(dirty), { compress: false }));
    expect(control.text).toMatch(moneyRe);
  });

  it('is deterministic: the same input gives an identical buffer', async () => {
    const photos = [{ data: await jpeg(1600, 1200, [10, 120, 80]), caption: 'Deck after pour' }];
    const logo = await png(400, 120, [148, 101, 15]);
    const input = baseInput(realisticContent(), { photos, company: { name: 'Mfano Builders Ltd', logo } });
    const a = await renderDailyReportPdf(input);
    const b = await renderDailyReportPdf(input);
    expect(a.equals(b)).toBe(true);
    // CreationDate comes from finalisedAt, not the clock.
    const raw = (await renderDailyReportPdfWithOptions(input, { compress: false })).toString('latin1');
    const info = parsePdf(Buffer.from(raw, 'latin1')).info;
    expect(info).toMatch(/\/CreationDate \(D:20261105154200Z\)/);
    expect(info).toMatch(/\/ModDate \(D:20261105154200Z\)/);
  });

  it('never draws missing glyphs: unsupported characters are decomposed or replaced', async () => {
    const content = realisticContent();
    content.remarks = 'Foreman Wanjikũ Kĩmani confirmed. Emoji 🙂 here.';
    const pdf = parsePdf(await renderDailyReportPdfWithOptions(baseInput(content), { compress: false }));
    expect(pdf.ops.some((o) => o.gids.includes(0))).toBe(false); // gid 0 is .notdef
    expect(pdf.text).toContain('Wanjikũ'); // u + combining tilde, recomposed by NFC
    expect(pdf.text).toContain('Kĩmani');
    expect(pdf.text).toMatch(/Synthetic Consulting ?\nEngineers/);
    expect(pdf.text).toContain('Emoji � here.');
  });
});
