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
  model: string;
  text: string;
}

@Injectable()
export class ResponsesService {
  createContext(request: CreateResponseDto): ResponseContext {
    return {
      responseId: `resp_${randomUUID()}`,
      messageId: `msg_${randomUUID()}`,
      model: request.model,
      text: MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)],
    };
  }

  createCompletedResponse(context: ResponseContext) {
    return {
      id: context.responseId,
      object: 'response',
      status: 'completed',
      model: context.model,
      output: [this.createMessage(context, 'completed')],
      usage: this.createUsage(context.text),
    };
  }

  async *stream(context: ResponseContext): AsyncGenerator<object> {
    yield {
      type: 'response.created',
      response: {
        id: context.responseId,
        object: 'response',
        status: 'in_progress',
        model: context.model,
        output: [],
      },
    };
    yield {
      type: 'response.output_item.added',
      output_index: 0,
      item: this.createMessage(context, 'in_progress', []),
    };
    yield {
      type: 'response.content_part.added',
      item_id: context.messageId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    };

    for (const delta of this.chunkText(context.text)) {
      await this.delay(35 + Math.floor(Math.random() * 45));
      yield {
        type: 'response.output_text.delta',
        item_id: context.messageId,
        output_index: 0,
        content_index: 0,
        delta,
      };
    }

    yield {
      type: 'response.output_text.done',
      item_id: context.messageId,
      output_index: 0,
      content_index: 0,
      text: context.text,
    };
    yield {
      type: 'response.output_item.done',
      output_index: 0,
      item: this.createMessage(context, 'completed'),
    };
    yield {
      type: 'response.completed',
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

  private createUsage(text: string) {
    return {
      input_tokens: 0,
      output_tokens: text.split(/\s+/).length,
      total_tokens: text.split(/\s+/).length,
    };
  }

  private chunkText(text: string): string[] {
    return text.match(/.{1,12}(?:\s|$)/g) ?? [text];
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
