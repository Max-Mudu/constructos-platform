import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { ReportData } from '../services/report.service';

// ─── CSV ──────────────────────────────────────────────────────────────────────

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCSV(data: ReportData): Buffer {
  const lines: string[] = [];

  // Title block
  lines.push(escapeCsv(data.title));
  lines.push(escapeCsv(data.subtitle));
  lines.push(`Generated At,${escapeCsv(data.generatedAt)}`);

  // Active filters
  const filterEntries = Object.entries(data.filters);
  if (filterEntries.length > 0) {
    lines.push('');
    lines.push('Filters');
    for (const [k, v] of filterEntries) {
      lines.push(`${escapeCsv(k)},${escapeCsv(v)}`);
    }
  }

  // Summary block
  if (data.summary.length > 0) {
    lines.push('');
    lines.push('Summary');
    for (const s of data.summary) {
      lines.push(`${escapeCsv(s.label)},${escapeCsv(s.value)}`);
    }
  }

  // Data table
  lines.push('');
  lines.push(data.columns.map(escapeCsv).join(','));
  for (const row of data.rows) {
    lines.push(row.map(escapeCsv).join(','));
  }

  return Buffer.from(lines.join('\r\n'), 'utf8');
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export async function toExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Construction Platform';
  wb.created = new Date();

  const ws = wb.addWorksheet('Report', {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  // ── Title ──────────────────────────────────────────────────────────────────
  ws.mergeCells('A1:E1');
  const titleCell = ws.getCell('A1');
  titleCell.value = data.title;
  titleCell.font  = { bold: true, size: 14 };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:E2');
  const subtitleCell = ws.getCell('A2');
  subtitleCell.value = data.subtitle;
  subtitleCell.font  = { italic: true, size: 10, color: { argb: 'FF666666' } };

  ws.getCell('A3').value = `Generated: ${new Date(data.generatedAt).toLocaleString()}`;
  ws.getCell('A3').font  = { size: 9, color: { argb: 'FF999999' } };

  let currentRow = 5;

  // ── Filters ────────────────────────────────────────────────────────────────
  const filterEntries = Object.entries(data.filters);
  if (filterEntries.length > 0) {
    const labelCell = ws.getCell(`A${currentRow}`);
    labelCell.value = 'Filters';
    labelCell.font  = { bold: true };
    currentRow++;

    for (const [k, v] of filterEntries) {
      ws.getCell(`A${currentRow}`).value = k;
      ws.getCell(`B${currentRow}`).value = v;
      currentRow++;
    }
    currentRow++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  if (data.summary.length > 0) {
    const summaryLabel = ws.getCell(`A${currentRow}`);
    summaryLabel.value = 'Summary';
    summaryLabel.font  = { bold: true };
    currentRow++;

    for (const s of data.summary) {
      ws.getCell(`A${currentRow}`).value = s.label;
      ws.getCell(`B${currentRow}`).value = s.value;
      currentRow++;
    }
    currentRow++;
  }

  // ── Column headers ─────────────────────────────────────────────────────────
  const headerRow = ws.getRow(currentRow);
  data.columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col;
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A9F' } };
    cell.alignment = { horizontal: 'center' };
  });
  headerRow.height = 20;
  currentRow++;

  // ── Data rows ──────────────────────────────────────────────────────────────
  for (const row of data.rows) {
    const wsRow = ws.getRow(currentRow);
    row.forEach((val, i) => { wsRow.getCell(i + 1).value = val; });
    currentRow++;
  }

  // Auto-fit columns (approximate)
  ws.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 2, 40);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export function toPDF(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];

    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end',  ()         => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W  = doc.page.width;
    const MARGIN  = 40;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ── Header band ───────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 60).fill('#1e3a5f');
    doc.fillColor('#ffffff')
       .fontSize(18)
       .font('Helvetica-Bold')
       .text(data.title, MARGIN, 15, { width: CONTENT_W });
    doc.fontSize(10)
       .font('Helvetica')
       .text(data.subtitle, MARGIN, 38, { width: CONTENT_W });

    doc.fillColor('#333333').fontSize(8)
       .text(
         `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
         MARGIN, 66,
       );

    let y = 84;

    // ── Filters ───────────────────────────────────────────────────────────
    const filterEntries = Object.entries(data.filters);
    if (filterEntries.length > 0) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
         .text('Filters:', MARGIN, y);
      y += 14;
      for (const [k, v] of filterEntries) {
        doc.font('Helvetica').fontSize(8)
           .text(`  ${k}: ${v}`, MARGIN, y);
        y += 12;
      }
      y += 6;
    }

    // ── Summary boxes ─────────────────────────────────────────────────────
    if (data.summary.length > 0) {
      const boxW = Math.min(120, CONTENT_W / data.summary.length);
      let boxX   = MARGIN;

      for (const s of data.summary) {
        doc.rect(boxX, y, boxW - 4, 36).fill('#f0f4f8').stroke('#c0d0e0');
        doc.fillColor('#555555').fontSize(7).font('Helvetica')
           .text(s.label, boxX + 4, y + 4, { width: boxW - 12 });
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
           .text(s.value, boxX + 4, y + 16, { width: boxW - 12 });
        boxX += boxW;
      }
      y += 46;
    }

    // ── Table ─────────────────────────────────────────────────────────────
    if (data.columns.length > 0) {
      const colCount = data.columns.length;
      const colW     = Math.floor(CONTENT_W / colCount);

      // Header row
      doc.rect(MARGIN, y, CONTENT_W, 18).fill('#2d6a9f');
      doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
      data.columns.forEach((col, i) => {
        doc.text(col, MARGIN + i * colW + 2, y + 4, { width: colW - 4, ellipsis: true });
      });
      y += 18;

      // Data rows
      doc.font('Helvetica').fontSize(7).fillColor('#222222');
      let rowNum = 0;
      for (const row of data.rows) {
        // New page check
        if (y > doc.page.height - MARGIN - 20) {
          doc.addPage({ layout: 'landscape' });
          y = MARGIN;
        }

        const fillColor = rowNum % 2 === 0 ? '#ffffff' : '#f7f9fb';
        doc.rect(MARGIN, y, CONTENT_W, 14).fill(fillColor);
        doc.fillColor('#222222');
        row.forEach((cell, i) => {
          doc.text(String(cell), MARGIN + i * colW + 2, y + 3, {
            width: colW - 4,
            ellipsis: true,
          });
        });

        y += 14;
        rowNum++;
      }
    }

    doc.end();
  });
}
