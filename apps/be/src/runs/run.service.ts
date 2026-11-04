import type {
  AGUIEvent,
  Message as AgUiMessage,
  RunAgentInput,
} from '@ag-ui/core';
import { EventType, contentToText } from '@ag-ui/core';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CHAT_STORE, type ChatStore } from '../chat/chat-store';
import type { Message, Run } from '../chat/chat.models';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LlmProvider,
} from '../llm/llm-provider';
import type { LlmMessage } from '../llm/llm.types';
import type { RunAgentInputDto } from './run.dto';

interface PreparedRun {
  input: RunAgentInput;
  run: Run;
  assistant: Message;
  context: LlmMessage[];
}

const DEVELOPER_INSTRUCTION = 'You are the assistant for this application.';

@Injectable()
export class RunService {
  private readonly model: string;

  constructor(
    @Inject(CHAT_STORE) private readonly store: ChatStore,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProvider,
    config: ConfigService,
  ) {
    this.model = config.getOrThrow<string>('MOCK_LLM_MODEL');
  }

  prepare(dto: RunAgentInputDto): PreparedRun {
    if (!this.store.getChatRoom(dto.threadId)) {
      throw new NotFoundException(`Chat room ${dto.threadId} does not exist.`);
    }

    const incoming = dto.messages.map((message) => this.toAgUiMessage(message));
    const latestUserId = [...incoming]
      .reverse()
      .find((message) => message.role === 'user')?.id;
    if (!latestUserId) {
      throw new BadRequestException('messages must include a user message.');
    }

    const existingById = new Map(
      this.store
        .getMessages(dto.threadId)
        .map((message) => [message.id, message]),
    );
    const baseTime = Date.now();
    incoming.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') return;
      const text = contentToText(message.content);
      if (!text) return;
      const now = new Date(baseTime + index).toISOString();
      const existing = existingById.get(message.id);
      this.store.upsertMessage({
        id: message.id,
        chatRoomId: dto.threadId,
        role: existing?.role ?? message.role,
        content: [{ type: 'text', text }],
        status: existing?.status ?? 'completed',
        providerMessageId: existing?.providerMessageId ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: existing?.updatedAt ?? now,
      });
    });

    const canonical = this.store.getMessages(dto.threadId);
    const latestUser = canonical.find((message) => message.id === latestUserId);
    if (!latestUser || latestUser.role !== 'user') {
      throw new BadRequestException(
        'The latest user message has no text content.',
      );
    }

    const context: LlmMessage[] = [
      { role: 'developer', content: DEVELOPER_INSTRUCTION },
      ...canonical
        .filter(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            message.status === 'completed',
        )
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: this.text(message),
        }))
        .filter((message) => message.content.length > 0),
    ];

    const startedAt = new Date().toISOString();
    const run: Run = {
      id: dto.runId,
      chatRoomId: dto.threadId,
      status: 'in_progress',
      provider: 'openai-compatible',
      model: this.model,
      errorCode: null,
      errorMessage: null,
      startedAt,
      completedAt: null,
    };
    this.store.createRun(run);

    const assistantCreatedAt = new Date(
      Math.max(
        Date.now(),
        ...canonical.map((message) => Date.parse(message.createdAt) + 1),
      ),
    ).toISOString();
    const assistant: Message = {
      id: `msg_${randomUUID()}`,
      chatRoomId: dto.threadId,
      role: 'assistant',
      content: [],
      status: 'in_progress',
      providerMessageId: null,
      createdAt: assistantCreatedAt,
      updatedAt: assistantCreatedAt,
    };
    this.store.upsertMessage(assistant);

    const input: RunAgentInput = {
      threadId: dto.threadId,
      runId: dto.runId,
      protocolVersion: dto.protocolVersion,
      parentRunId: dto.parentRunId,
      state: dto.state ?? {},
      messages: incoming,
      tools: (dto.tools ?? []) as RunAgentInput['tools'],
      context: (dto.context ?? []) as RunAgentInput['context'],
      forwardedProps: dto.forwardedProps,
      resume: dto.resume as RunAgentInput['resume'],
    };
    return { input, run, assistant, context };
  }

  async stream(
    prepared: PreparedRun,
    response: Response,
    signal: AbortSignal,
  ): Promise<void> {
    const { input, run, assistant, context } = prepared;
    let providerMessageId: string | null = null;
    let output = '';

    this.send(response, {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
      protocolVersion: '1.0',
    });
    this.send(response, {
      type: EventType.TEXT_MESSAGE_START,
      messageId: assistant.id,
      role: 'assistant',
    });

    try {
      for await (const event of this.llmProvider.streamResponse(
        { messages: context, model: run.model },
        signal,
      )) {
        if (event.type === 'started') {
          providerMessageId = event.providerResponseId;
        } else if (event.type === 'text-delta') {
          output += event.delta;
          this.store.upsertMessage({
            ...assistant,
            content: [{ type: 'text', text: output }],
            providerMessageId,
            updatedAt: new Date().toISOString(),
          });
          this.send(response, {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: assistant.id,
            delta: event.delta,
          });
        } else {
          providerMessageId = event.providerResponseId;
        }
      }

      if (signal.aborted) {
        this.cancel(run, assistant, output, providerMessageId);
        return;
      }

      this.send(response, {
        type: EventType.TEXT_MESSAGE_END,
        messageId: assistant.id,
      });
      this.store.upsertMessage({
        ...assistant,
        content: [{ type: 'text', text: output }],
        status: 'completed',
        providerMessageId,
        updatedAt: new Date().toISOString(),
      });
      this.store.updateRun(run.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      this.send(response, {
        type: EventType.RUN_FINISHED,
        threadId: run.chatRoomId,
        runId: run.id,
      });
      response.end();
    } catch (error) {
      if (signal.aborted) {
        this.cancel(run, assistant, output, providerMessageId);
        return;
      }

      const code =
        error instanceof LlmProviderError ? error.code : 'generation_failed';
      this.store.upsertMessage({
        ...assistant,
        content: output ? [{ type: 'text', text: output }] : [],
        status: 'failed',
        providerMessageId,
        updatedAt: new Date().toISOString(),
      });
      this.store.updateRun(run.id, {
        status: 'failed',
        errorCode: code,
        errorMessage: 'Generation failed.',
        completedAt: new Date().toISOString(),
      });
      this.send(response, {
        type: EventType.RUN_ERROR,
        code,
        message: 'Generation failed.',
      });
      response.end();
    }
  }

  private cancel(
    run: Run,
    assistant: Message,
    output: string,
    providerMessageId: string | null,
  ): void {
    this.store.upsertMessage({
      ...assistant,
      content: output ? [{ type: 'text', text: output }] : [],
      status: 'failed',
      providerMessageId,
      updatedAt: new Date().toISOString(),
    });
    this.store.updateRun(run.id, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });
  }

  private send(response: Response, event: AGUIEvent): void {
    if (!response.destroyed && !response.writableEnded) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  private toAgUiMessage(message: Record<string, unknown>): AgUiMessage {
    const content = message.content;
    const hasValidContent =
      typeof content === 'string' ||
      (Array.isArray(content) &&
        content.every(
          (part) =>
            typeof part === 'object' &&
            part !== null &&
            (part as Record<string, unknown>).type === 'text' &&
            typeof (part as Record<string, unknown>).text === 'string',
        ));
    if (
      typeof message.id !== 'string' ||
      !message.id ||
      typeof message.role !== 'string' ||
      !['user', 'assistant'].includes(message.role)
    ) {
      throw new BadRequestException(
        'Each message must have an id and a supported role.',
      );
    }
    if (!hasValidContent) {
      throw new BadRequestException('Each message must contain text content.');
    }
    return message as unknown as AgUiMessage;
  }

  private text(message: Message): string {
    return message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }
}
