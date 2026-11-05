import type { z } from 'zod';
import { DailyReportDraftV1 } from '../content.schema';
import { PROMPT_VERSION } from './prompt';
import { findUnsupportedNumbers } from './provenance';
import {
  ExtractionContext,
  ExtractionError,
  ExtractionErrorCode,
  ExtractionResult,
  ReportExtractor,
} from './types';

export const FAKE_MODEL = 'fake-report-extractor';

const ERROR_CODES: readonly ExtractionErrorCode[] = ['AI_DISABLED', 'AI_UNAVAILABLE', 'AI_BUSY', 'AI_NO_DRAFT', 'AI_ERROR'];

/** Input accepted as a fixed draft: anything DailyReportDraftV1 parses (defaults fill gaps). */
export type FakeDraftInput = z.input<typeof DailyReportDraftV1>;

export interface FakeExtractorCall {
  rawInput: string;
  context: ExtractionContext;
}

/**
 * Deterministic extractor for tests and local development. Makes no network
 * calls and never loads the Anthropic SDK.
 *
 *  - `new FakeReportExtractor()`            → a draft with the notes in `remarks`
 *  - `new FakeReportExtractor(fixtureDraft)` → that draft on every call
 *  - `new FakeReportExtractor('AI_BUSY')`    → throws ExtractionError('AI_BUSY')
 *
 * Every call is recorded in `calls`. unsupportedNumbers is computed with the
 * real provenance check, so callers see the same flags as in production.
 */
export class FakeReportExtractor implements ReportExtractor {
  readonly calls: FakeExtractorCall[] = [];
  private readonly fixed: DailyReportDraftV1 | null;
  private readonly errorCode: ExtractionErrorCode | null;

  constructor(fixedDraftOrError?: FakeDraftInput | ExtractionErrorCode) {
    if (typeof fixedDraftOrError === 'string') {
      if (!ERROR_CODES.includes(fixedDraftOrError)) {
        throw new Error('FakeReportExtractor: unknown error code');
      }
      this.errorCode = fixedDraftOrError;
      this.fixed = null;
    } else {
      this.errorCode = null;
      // Parse once so an invalid fixture fails at construction, not mid-test.
      this.fixed = fixedDraftOrError === undefined ? null : DailyReportDraftV1.parse(fixedDraftOrError);
    }
  }

  async extract(input: { rawInput: string; context: ExtractionContext }): Promise<ExtractionResult> {
    this.calls.push({ rawInput: input.rawInput, context: { ...input.context } });
    if (this.errorCode) throw new ExtractionError(this.errorCode);

    const draft: DailyReportDraftV1 = this.fixed
      ? structuredClone(this.fixed)
      : DailyReportDraftV1.parse({ remarks: input.rawInput.trim().slice(0, 4000) });

    return {
      draft,
      unsupportedNumbers: findUnsupportedNumbers(draft, input.rawInput),
      model: FAKE_MODEL,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        latencyMs: 0,
        stopReason: 'end_turn',
        requestId: null,
      },
    };
  }
}
