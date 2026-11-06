import { readFileSync } from 'fs';
import { env } from '../../../utils/env';
import { AnthropicReportExtractor } from './anthropic';
import { FakeReportExtractor, FakeDraftInput } from './fake';
import { ExtractionError, ExtractionResult, ReportExtractor } from './types';

export * from './types';
export { AnthropicReportExtractor } from './anthropic';
export type { AnthropicMessagesClient, AnthropicReportExtractorOptions, ExtractorLogger, ExtractionEffort } from './anthropic';
export { FakeReportExtractor, FAKE_MODEL } from './fake';
export type { FakeDraftInput, FakeExtractorCall } from './fake';
export { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage, neutraliseDelimiters } from './prompt';
export { findUnsupportedNumbers } from './provenance';
export { DAILY_REPORT_DRAFT_JSON_SCHEMA } from './draft-json-schema';

/** AI turned off: every extraction fails with AI_DISABLED and the report stays manual. */
export class DisabledReportExtractor implements ReportExtractor {
  async extract(): Promise<ExtractionResult> {
    throw new ExtractionError('AI_DISABLED');
  }
}

/**
 * The extractor for the configured provider (env.DAILY_REPORT_AI_PROVIDER):
 *  - 'disabled'  → DisabledReportExtractor (throws AI_DISABLED)
 *  - 'fake'      → FakeReportExtractor (deterministic, no network)
 *  - 'anthropic' → AnthropicReportExtractor with env model and timeout
 *
 * The Anthropic SDK is loaded only inside AnthropicReportExtractor.extract(),
 * via `await import('@anthropic-ai/sdk')`, so it is never loaded in fake or
 * disabled mode.
 */
export function getReportExtractor(): ReportExtractor {
  switch (env.DAILY_REPORT_AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicReportExtractor({
        model: env.DAILY_REPORT_AI_MODEL,
        timeoutMs: env.DAILY_REPORT_AI_TIMEOUT_MS,
      });
    case 'fake':
      // Local demos may supply a canned draft; production never runs 'fake' (env.ts).
      return env.DAILY_REPORT_AI_FAKE_DRAFT_FILE
        ? new FakeReportExtractor(JSON.parse(readFileSync(env.DAILY_REPORT_AI_FAKE_DRAFT_FILE, 'utf8')) as FakeDraftInput)
        : new FakeReportExtractor();
    case 'disabled':
    default:
      return new DisabledReportExtractor();
  }
}
