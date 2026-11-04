import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateResponseDto } from './dto/create-response.dto';

const MOCK_REPLIES = [
  'This is a response from the mock language model.',
  'The MockLLM connection is working and the response is streaming.',
  'I am a stateless mock model. Send the conversation context on every request.',
];

interface ResponseContext {
  responseId: string;
  messageId: string;
  createdAt: number;
  model: string;
  text: string;
  inputTokens: number;
  maxOutputTokens?: number;
  shouldFail: boolean;
  shouldStreamSlowly: boolean;
}

const MOCK_ERROR = {
  code: 'mock_generation_error',
  message: 'MockLLM failure requested by the latest user message.',
  type: 'server_error',
};

@Injectable()
export class ResponsesService {
  createContext(request: CreateResponseDto): ResponseContext {
    const latestUserText = [...request.input]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const reply = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];

    return {
      responseId: `resp_${randomUUID()}`,
      messageId: `msg_${randomUUID()}`,
      createdAt: Math.floor(Date.now() / 1000),
      model: request.model,
      text: this.limitWords(reply, request.max_output_tokens),
      inputTokens: request.input.reduce(
        (total, message) => total + this.countWords(message.content),
        0,
      ),
      maxOutputTokens: request.max_output_tokens,
      shouldFail: latestUserText?.includes('mock:error') ?? false,
      shouldStreamSlowly: latestUserText?.includes('mock:slow') ?? false,
    };
  }

  createCompletedResponse(context: ResponseContext) {
    return {
      id: context.responseId,
      object: 'response',
      created_at: context.createdAt,
      status: 'completed',
      error: null,
      incomplete_details: null,
      max_output_tokens: context.maxOutputTokens ?? null,
      model: context.model,
      output: [this.createMessage(context, 'completed')],
      usage: this.createUsage(context),
    };
  }

  createFailedResponse(context: ResponseContext) {
    return {
      id: context.responseId,
      object: 'response',
      created_at: context.createdAt,
      status: 'failed',
      error: MOCK_ERROR,
      incomplete_details: null,
      max_output_tokens: context.maxOutputTokens ?? null,
      model: context.model,
      output: [],
      usage: null,
    };
  }

  async *stream(
    context: ResponseContext,
    signal: AbortSignal,
  ): AsyncGenerator<object> {
    let sequenceNumber = 0;

    if (context.shouldFail) {
      yield {
        type: 'error',
        sequence_number: sequenceNumber++,
        code: MOCK_ERROR.code,
        message: MOCK_ERROR.message,
        param: null,
      };
      yield {
        type: 'response.failed',
        sequence_number: sequenceNumber,
        response: this.createFailedResponse(context),
      };
      return;
    }

    yield {
      type: 'response.created',
      sequence_number: sequenceNumber++,
      response: {
        id: context.responseId,
        object: 'response',
        created_at: context.createdAt,
        status: 'in_progress',
        error: null,
        incomplete_details: null,
        max_output_tokens: context.maxOutputTokens ?? null,
        model: context.model,
        output: [],
        usage: null,
      },
    };
    yield {
      type: 'response.output_item.added',
      sequence_number: sequenceNumber++,
      output_index: 0,
      item: this.createMessage(context, 'in_progress', []),
    };
    yield {
      type: 'response.content_part.added',
      sequence_number: sequenceNumber++,
      item_id: context.messageId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    };

    for (const delta of this.chunkText(context.text)) {
      const delay = context.shouldStreamSlowly
        ? 200 + Math.floor(Math.random() * 101)
        : 35 + Math.floor(Math.random() * 45);
      if (!(await this.delay(delay, signal))) {
        return;
      }
      yield {
        type: 'response.output_text.delta',
        sequence_number: sequenceNumber++,
        item_id: context.messageId,
        output_index: 0,
        content_index: 0,
        delta,
      };
    }

    yield {
      type: 'response.output_text.done',
      sequence_number: sequenceNumber++,
      item_id: context.messageId,
      output_index: 0,
      content_index: 0,
      text: context.text,
    };
    yield {
      type: 'response.output_item.done',
      sequence_number: sequenceNumber++,
      output_index: 0,
      item: this.createMessage(context, 'completed'),
    };
    yield {
      type: 'response.completed',
      sequence_number: sequenceNumber,
      response: this.createCompletedResponse(context),
    };
  }

  private createMessage(
    context: ResponseContext,
    status: 'in_progress' | 'completed',
    content = [
      { type: 'output_text', text: context.text, annotations: [] as object[] },
    ],
  ) {
    return {
      id: context.messageId,
      type: 'message',
      status,
      role: 'assistant',
      content,
    };
  }

  private createUsage(context: ResponseContext) {
    const outputTokens = this.countWords(context.text);

    return {
      input_tokens: context.inputTokens,
      output_tokens: outputTokens,
      total_tokens: context.inputTokens + outputTokens,
    };
  }

  private countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  private limitWords(text: string, maximum?: number): string {
    return maximum === undefined
      ? text
      : text.trim().split(/\s+/).slice(0, maximum).join(' ');
  }

  private chunkText(text: string): string[] {
    return text.match(/.{1,12}(?:\s|$)/g) ?? [text];
  }

  private async delay(
    milliseconds: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) {
      return false;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, milliseconds);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
