import { DailyReportDraftV1 } from '../content.schema';

/** Names and the date only: no wages, no other records. */
export interface ExtractionContext {
  projectName: string;
  siteName:    string;
  reportDate:  string; // YYYY-MM-DD
  timezone:    string;
}

export interface ExtractionUsage {
  inputTokens:              number;
  outputTokens:             number;
  cacheReadInputTokens:     number;
  cacheCreationInputTokens: number;
  latencyMs:                number;
  stopReason:               string | null;
  requestId:                string | null;
}

export interface UnsupportedNumber {
  path:  string; // e.g. "workCompleted[0].quantity"
  value: number;
}

export interface ExtractionResult {
  draft:         DailyReportDraftV1;
  /** Numbers in the draft that do not appear in the supervisor's notes. */
  unsupportedNumbers: UnsupportedNumber[];
  model:         string;
  promptVersion: string;
  usage:         ExtractionUsage;
}

export interface ReportExtractor {
  extract(input: { rawInput: string; context: ExtractionContext }): Promise<ExtractionResult>;
}

export type ExtractionErrorCode = 'AI_DISABLED' | 'AI_UNAVAILABLE' | 'AI_BUSY' | 'AI_NO_DRAFT' | 'AI_ERROR';

/** Every extraction failure. The message is the code; never model text or user input. */
export class ExtractionError extends Error {
  constructor(public readonly code: ExtractionErrorCode) {
    super(code);
    this.name = 'ExtractionError';
  }
}
