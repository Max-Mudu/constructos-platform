import { DailyReportContentV1 } from '../content.schema';

/** Everything the PDF needs. The renderer is pure: no DB, no storage. */
export interface DailyReportPdfInput {
  company: { name: string; logo: Buffer | null };
  project: { name: string; code: string | null };
  site:    { name: string; address: string | null };
  report:  { number: string; revision: number; reportDate: string; timezone: string };
  content: DailyReportContentV1;
  photos:  Array<{ data: Buffer; caption: string }>; // JPEG/PNG, already normalised, in display order
  preparedBy:  string;
  finalisedBy: string;
  finalisedAt: Date;
  contentHash: string;
}

export type RenderDailyReportPdf = (input: DailyReportPdfInput) => Promise<Buffer>;
