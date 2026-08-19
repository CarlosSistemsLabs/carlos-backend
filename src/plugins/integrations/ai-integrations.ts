/**
 * AI-service and OCR integration contracts (task 35.3, Requirements 19.2, 20.3).
 *
 * Prepares the seams for LLM providers (OpenAI, Claude, Gemini) and an OCR
 * service (image/PDF → text/structured data). The LLM contracts extend the base
 * {@link import('../plugin.js').AIPlugin} complete/analyze surface; OCR gets its
 * own contract because its capability (document extraction) does not fit the
 * prompt-completion shape. Interface-only; no vendor SDK is imported and no
 * network call is made — the domain never depends on an LLM SDK.
 */

import type { AIPlugin, IPlugin } from '../plugin.js';
import type { IntegrationConfig } from './integration.js';

/**
 * Fields common to LLM provider configs: a model id and generation defaults.
 *
 * Concrete provider configs extend this with their credentials. Secrets are
 * resolved at load time from the documented env vars — never embedded in source.
 */
export interface LlmProviderConfig extends IntegrationConfig {
  /** The default model id to use (e.g. `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`). */
  readonly model: string;
  /** Optional default upper bound on generated tokens. */
  readonly maxTokens?: number;
  /** Optional default sampling temperature. */
  readonly temperature?: number;
}

/* -------------------------------------------------------------------------- */
/* OpenAI                                                                     */
/* -------------------------------------------------------------------------- */

/** Configuration for the OpenAI integration. */
export interface OpenAiConfig extends LlmProviderConfig {
  /** API key. Resolved from `OPENAI_API_KEY`. */
  readonly apiKey: string;
  /** Optional organization id. Resolved from `OPENAI_ORGANIZATION`. */
  readonly organization?: string;
}

/**
 * OpenAI integration (Requirement 19.2). Extends {@link AIPlugin}; the base
 * complete/analyze surface covers the platform's needs, so no vendor-specific
 * methods are added — the config selects the model. Request/response only.
 */
export interface OpenAiIntegration extends AIPlugin {
  /** The default model id this integration is configured with. */
  readonly model: string;
}

/* -------------------------------------------------------------------------- */
/* Claude (Anthropic)                                                         */
/* -------------------------------------------------------------------------- */

/** Configuration for the Anthropic Claude integration. */
export interface ClaudeConfig extends LlmProviderConfig {
  /** API key. Resolved from `ANTHROPIC_API_KEY`. */
  readonly apiKey: string;
}

/**
 * Anthropic Claude integration (Requirement 19.2). Extends {@link AIPlugin} with
 * the shared completion/analysis surface. Request/response only.
 */
export interface ClaudeIntegration extends AIPlugin {
  /** The default model id this integration is configured with. */
  readonly model: string;
}

/* -------------------------------------------------------------------------- */
/* Gemini (Google)                                                            */
/* -------------------------------------------------------------------------- */

/** Configuration for the Google Gemini integration. */
export interface GeminiConfig extends LlmProviderConfig {
  /** API key. Resolved from `GEMINI_API_KEY`. */
  readonly apiKey: string;
}

/**
 * Google Gemini integration (Requirement 19.2). Extends {@link AIPlugin} with
 * the shared completion/analysis surface. Request/response only.
 */
export interface GeminiIntegration extends AIPlugin {
  /** The default model id this integration is configured with. */
  readonly model: string;
}

/* -------------------------------------------------------------------------- */
/* OCR (document extraction)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * An OCR extraction contract.
 *
 * OCR turns an image or PDF into text and, optionally, structured fields (e.g.
 * lifting totals and line items off a supplier invoice). This does NOT fit the
 * {@link AIPlugin} prompt-completion shape — its input is a binary document, not
 * a prompt, and its output is extracted content, not a generated answer — so we
 * define a dedicated {@link OcrPlugin} category contract extending the base
 * {@link IPlugin} lifecycle. This keeps the AI category focused on generative
 * providers while giving document extraction its own stable seam
 * (Requirement 19.4).
 */
export interface OcrPlugin extends IPlugin {
  /** Extracts text (and optional structured fields) from a document. */
  extract(request: OcrRequest): Promise<OcrResult>;
}

/** A document submitted for OCR extraction. */
export interface OcrRequest {
  /** The document bytes (image or PDF). */
  readonly content: Uint8Array;
  /** The document's MIME type (e.g. `image/png`, `application/pdf`). */
  readonly mimeType: string;
  /**
   * Optional named fields to attempt to extract (e.g. `['total', 'cuit']`) so a
   * concrete adapter can return structured values alongside the raw text.
   */
  readonly fields?: readonly string[];
}

/** The result of an OCR extraction. */
export interface OcrResult {
  /** The full extracted text. */
  readonly text: string;
  /** Structured field values keyed by the requested field name, when found. */
  readonly fields?: Readonly<Record<string, string>>;
  /** Optional overall confidence in `[0, 1]`. */
  readonly confidence?: number;
}

/** Configuration for the OCR integration. */
export interface OcrConfig extends IntegrationConfig {
  /** API key for the OCR provider. Resolved from `OCR_API_KEY`. */
  readonly apiKey: string;
}

/**
 * OCR integration (Requirement 19.2). Implements the {@link OcrPlugin} contract
 * (see the rationale above for why OCR is its own category). Request/response
 * only — not webhook-driven.
 */
export interface OcrIntegration extends OcrPlugin {
  /** The default provider model/engine this integration is configured with, when applicable. */
  readonly engine?: string;
}
