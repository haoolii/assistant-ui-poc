import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProviderError, type LlmProvider } from './llm-provider';
import type { LlmRequest, LlmStreamEvent } from './llm.types';

interface OpenAiStreamEvent {
  type: string;
  delta?: string;
  response?: {
    id?: string;
    usage?: Record<string, number>;
  };
}

@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .getOrThrow<string>('MOCK_LLM_BASE_URL')
      .replace(/\/$/, '');
    this.defaultModel = config.getOrThrow<string>('MOCK_LLM_MODEL');
    this.timeoutMs = config.getOrThrow<number>('LLM_TIMEOUT_MS');
  }

  async checkHealth(signal?: AbortSignal): Promise<void> {
    const response = await this.fetch('/health', { method: 'GET' }, signal);
    if (!response.ok) {
      throw new LlmProviderError(
        'MockLLM health check failed.',
        'upstream_health_failed',
        response.status,
      );
    }
  }

  async *streamResponse(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent> {
    const response = await this.fetch(
      '/responses',
      {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          input: request.messages,
          stream: true,
          temperature: request.temperature,
          max_output_tokens: request.maxOutputTokens,
        }),
      },
      signal,
    );

    if (!response.ok) {
      throw new LlmProviderError(
        `MockLLM returned HTTP ${response.status}.`,
        'upstream_http_error',
        response.status,
      );
    }
    if (!response.body) {
      throw new LlmProviderError(
        'MockLLM returned an empty stream.',
        'upstream_empty_stream',
      );
    }

    let completed = false;
    for await (const event of this.parseSse(response.body)) {
      if (event.type === 'completed') {
        completed = true;
      }
      yield event;
    }

    if (!completed) {
      throw new LlmProviderError(
        'MockLLM stream ended before response.completed.',
        'upstream_truncated_stream',
      );
    }
  }

  private async *parseSse(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<LlmStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = this.parseEventBlock(block);
        if (event) {
          yield event;
        }
        boundary = buffer.indexOf('\n\n');
      }

      if (done) {
        break;
      }
    }
  }

  private parseEventBlock(block: string): LlmStreamEvent | undefined {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (!data || data === '[DONE]') {
      return undefined;
    }

    let event: OpenAiStreamEvent;
    try {
      event = JSON.parse(data) as OpenAiStreamEvent;
    } catch {
      throw new LlmProviderError(
        'MockLLM returned invalid SSE JSON.',
        'upstream_invalid_event',
      );
    }

    if (event.type === 'response.created' && event.response?.id) {
      return { type: 'started', providerResponseId: event.response.id };
    }
    if (event.type === 'response.output_text.delta' && event.delta) {
      return { type: 'text-delta', delta: event.delta };
    }
    if (event.type === 'response.completed' && event.response?.id) {
      return {
        type: 'completed',
        providerResponseId: event.response.id,
        usage: event.response.usage,
      };
    }
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new LlmProviderError(
        'MockLLM reported a generation failure.',
        'upstream_generation_failed',
      );
    }

    return undefined;
  }

  private async fetch(
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: combinedSignal,
      });
    } catch {
      const aborted = combinedSignal.aborted;
      throw new LlmProviderError(
        aborted ? 'MockLLM request was aborted.' : 'MockLLM is unavailable.',
        aborted ? 'upstream_aborted' : 'upstream_unavailable',
      );
    }
  }
}
