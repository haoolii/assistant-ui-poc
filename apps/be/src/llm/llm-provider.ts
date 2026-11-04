import type { LlmRequest, LlmStreamEvent } from './llm.types';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmProvider {
  checkHealth(signal?: AbortSignal): Promise<void>;
  streamResponse(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamEvent>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}
