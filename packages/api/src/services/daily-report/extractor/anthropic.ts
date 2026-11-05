// Type-only imports: erased at compile time, so importing this file never
// loads the SDK. The runtime module is loaded lazily in loadSdk().
import type Anthropic from '@anthropic-ai/sdk';
import { DailyReportDraftV1 } from '../content.schema';
import { env } from '../../../utils/env';
import { DAILY_REPORT_DRAFT_JSON_SCHEMA } from './draft-json-schema';
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt';
import { findUnsupportedNumbers } from './provenance';
import {
  ExtractionContext,
  ExtractionError,
  ExtractionErrorCode,
  ExtractionResult,
  ReportExtractor,
} from './types';

type Sdk = typeof import('@anthropic-ai/sdk');
type RequestOptions = Anthropic.RequestOptions;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type MessageCreateParamsNonStreaming = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The slice of the Anthropic client this adapter uses; tests inject a stub. */
export interface AnthropicMessagesClient {
  beta: {
    messages: {
      create(
        body: MessageCreateParamsNonStreaming,
        options?: RequestOptions,
      ): PromiseLike<BetaMessage & { _request_id?: string | null }>;
    };
  };
}

export type ExtractionEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Structured log sink. Receives only an event name and metadata (codes, HTTP
 * status, request id, error class name, counts): never the prompt, the notes
 * or model output.
 */
export type ExtractorLogger = (event: string, meta: Record<string, string | number | null>) => void;

export interface AnthropicReportExtractorOptions {
  /** Injected client (tests). Default: a new SDK client, created on first use. */
  client?: AnthropicMessagesClient;
  /** Default: env.DAILY_REPORT_AI_MODEL. */
  model?: string;
  /** Per-request timeout in ms. Default: env.DAILY_REPORT_AI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** SDK retries for the default client (429 / 5xx / connection). Default 1. */
  maxRetries?: number;
  /** Default 16000. Non-streaming, so it stays well under SDK HTTP timeouts. */
  maxTokens?: number;
  /** output_config.effort; null omits it (model default). Default 'low'. */
  effort?: ExtractionEffort | null;
  /**
   * Server-side refusal fallback (`fallbacks: "default"`, beta header
   * server-side-fallback-2026-07-01). On a policy decline the API re-runs the
   * request on the server-defined fallback model within the same call, and
   * `response.model` reports the model that actually answered. Default true.
   * Set false to send neither the header nor the parameter.
   */
  serverSideFallback?: boolean;
  logger?: ExtractorLogger;
}

export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_MAX_TOKENS = 16_000;

let sdkPromise: Promise<Sdk> | null = null;
function loadSdk(): Promise<Sdk> {
  if (!sdkPromise) {
    sdkPromise = import('@anthropic-ai/sdk').catch((err: unknown) => {
      sdkPromise = null;
      throw err;
    });
  }
  return sdkPromise;
}

const defaultLogger: ExtractorLogger = (event, meta) => {
  console.warn(`[daily-report-ai] ${event}`, meta);
};

export class AnthropicReportExtractor implements ReportExtractor {
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxTokens: number;
  private readonly effort: ExtractionEffort | null;
  private readonly serverSideFallback: boolean;
  private readonly log: ExtractorLogger;
  private client: AnthropicMessagesClient | null;

  constructor(options: AnthropicReportExtractorOptions = {}) {
    this.client = options.client ?? null;
    this.model = options.model ?? env.DAILY_REPORT_AI_MODEL;
    this.timeoutMs = options.timeoutMs ?? env.DAILY_REPORT_AI_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? 1;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.effort = options.effort === undefined ? 'low' : options.effort;
    this.serverSideFallback = options.serverSideFallback ?? true;
    this.log = options.logger ?? defaultLogger;
  }

  /** The exact request body sent to the Messages API (exposed for tests). */
  buildRequest(rawInput: string, context: ExtractionContext): MessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: this.maxTokens,
      // Stable, versioned system prompt; the breakpoint caches it when it is
      // long enough for the model's minimum cacheable prefix.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      // A single user turn and nothing after it: no assistant prefill.
      messages: [{ role: 'user', content: buildUserMessage(rawInput, context) }],
      output_config: {
        ...(this.effort ? { effort: this.effort } : {}),
        format: { type: 'json_schema', schema: DAILY_REPORT_DRAFT_JSON_SCHEMA },
      },
      // No thinking, temperature, top_p or top_k: thinking is adaptive by
      // default on current models, and sampling parameters are rejected.
      ...(this.serverSideFallback
        ? { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: 'default' as const }
        : {}),
    };
  }

  async extract(input: { rawInput: string; context: ExtractionContext }): Promise<ExtractionResult> {
    let sdk: Sdk;
    try {
      sdk = await loadSdk();
    } catch (err) {
      this.log('sdk load failed', { code: 'AI_UNAVAILABLE', errorName: errorName(err) });
      throw new ExtractionError('AI_UNAVAILABLE');
    }

    let client: AnthropicMessagesClient;
    try {
      client = this.client ??= new sdk.default({ timeout: this.timeoutMs, maxRetries: this.maxRetries });
    } catch (err) {
      // e.g. no credentials configured. The message is not logged: it may
      // describe configuration, and errors are logged by class only.
      this.log('client init failed', { code: 'AI_UNAVAILABLE', errorName: errorName(err) });
      throw new ExtractionError('AI_UNAVAILABLE');
    }

    const request = this.buildRequest(input.rawInput, input.context);
    const startedAt = Date.now();
    let response: BetaMessage & { _request_id?: string | null };
    try {
      response = await client.beta.messages.create(request, { timeout: this.timeoutMs });
    } catch (err) {
      const code = mapSdkError(sdk, err);
      this.log('request failed', {
        code,
        status: err instanceof sdk.APIError && typeof err.status === 'number' ? err.status : null,
        requestId: err instanceof sdk.APIError ? (err.requestID ?? null) : null,
        errorName: errorName(err),
        latencyMs: Date.now() - startedAt,
      });
      throw new ExtractionError(code);
    }
    const latencyMs = Date.now() - startedAt;
    const requestId = response._request_id ?? null;
    const stopReason = response.stop_reason ?? null;

    const fail = (reason: string, extra: Record<string, string | number | null> = {}): never => {
      this.log('no draft', { code: 'AI_NO_DRAFT', reason, stopReason, requestId, model: response.model ?? null, ...extra });
      throw new ExtractionError('AI_NO_DRAFT');
    };

    if (stopReason !== 'end_turn' && stopReason !== 'stop_sequence') {
      // refusal (whole fallback chain declined), max_tokens (truncated JSON),
      // context window exceeded, or anything unexpected.
      fail('stop_reason', stopReason === 'refusal' ? { category: response.stop_details?.category ?? null } : {});
    }

    const text = finalText(response);
    if (text === null) fail('no_text');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text as string);
    } catch {
      fail('invalid_json');
    }

    const result = DailyReportDraftV1.safeParse(parsed);
    if (!result.success) {
      // Issue paths and codes are schema locations, not user or model text.
      fail('schema', {
        issues: result.error.issues.length,
        firstIssue: result.error.issues[0]
          ? `${result.error.issues[0].code}@${result.error.issues[0].path.join('.')}`
          : null,
      });
      throw new ExtractionError('AI_NO_DRAFT'); // unreachable; narrows `result`
    }

    const draft = result.data;
    const usage = response.usage;
    return {
      draft,
      unsupportedNumbers: findUnsupportedNumbers(draft, input.rawInput),
      // The model that actually answered (differs from this.model after a fallback).
      model: response.model || this.model,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
        latencyMs,
        stopReason,
        requestId,
      },
    };
  }
}

/**
 * Text of the answering model. After a server-side fallback the content can
 * hold a declined model's partial output, then a `fallback` block, then the
 * fallback model's answer: only text after the last `fallback` block counts.
 */
function finalText(response: BetaMessage): string | null {
  const blocks = response.content ?? [];
  let start = 0;
  blocks.forEach((block, i) => {
    if (block.type === 'fallback') start = i + 1;
  });
  const texts: string[] = [];
  for (const block of blocks.slice(start)) {
    if (block.type === 'text') texts.push(block.text);
  }
  return texts.length > 0 ? texts.join('') : null;
}

/** Most specific first. Timeouts are APIConnectionTimeoutError ⊂ APIConnectionError. */
function mapSdkError(sdk: Sdk, err: unknown): ExtractionErrorCode {
  if (err instanceof sdk.RateLimitError || err instanceof sdk.OverloadedError) return 'AI_BUSY';
  if (err instanceof sdk.APIConnectionError) return 'AI_UNAVAILABLE';
  if (err instanceof sdk.APIError) return 'AI_ERROR';
  return 'AI_ERROR';
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}
