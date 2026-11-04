import type {
  AGUIEvent,
  Message as AgUiMessage,
  RunAgentInput,
} from '@ag-ui/core';
import { EventType, contentToText } from '@ag-ui/core';
import {
  BadRequestException,
  ConflictException,
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

type ClientConversationMessage = Extract<
  AgUiMessage,
  { role: 'user' | 'assistant' }
>;

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
    if (this.store.getRun(dto.runId)) {
      throw new ConflictException(`Run ${dto.runId} already exists.`);
    }

    const incoming = dto.messages.map((message) => this.toAgUiMessage(message));
    if (
      new Set(incoming.map((message) => message.id)).size !== incoming.length
    ) {
      throw new BadRequestException('Message IDs must be unique within a run.');
    }
    const latestUserId = [...incoming]
      .reverse()
      .find((message) => message.role === 'user')?.id;
    if (!latestUserId) {
      throw new BadRequestException('messages must include a user message.');
    }

    const canonical = this.store.getMessages(dto.threadId);
    const existingById = new Map(
      canonical.map((message) => [message.id, message]),
    );
    const baseTime = Date.now();
    const userMessages: Message[] = [];
    incoming.forEach((message, index) => {
      const text = contentToText(message.content);
      const globalExisting = this.store.getMessage(message.id);
      if (globalExisting && globalExisting.chatRoomId !== dto.threadId) {
        throw new ConflictException(
          `Message ${message.id} belongs to another chat room.`,
        );
      }
      const existing = existingById.get(message.id);
      if (message.role === 'assistant') {
        if (!existing || existing.role !== 'assistant') {
          throw new BadRequestException(
            `Assistant message ${message.id} is not canonical server history.`,
          );
        }
        if (this.text(existing) !== text) {
          throw new BadRequestException(
            `Assistant message ${message.id} cannot be modified by the client.`,
          );
        }
        return;
      }
      if (!text.trim()) {
        throw new BadRequestException(
          `Message ${message.id} must contain non-empty text.`,
        );
      }
      if (existing && existing.role !== 'user') {
        throw new BadRequestException(
          `Message ${message.id} has a conflicting canonical role.`,
        );
      }
      const now = new Date(baseTime + index).toISOString();
      userMessages.push({
        id: message.id,
        chatRoomId: dto.threadId,
        role: 'user',
        content: [{ type: 'text', text }],
        status: 'completed',
        providerMessageId: existing?.providerMessageId ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    });

    const prospectiveById = new Map(
      canonical.map((message) => [message.id, message]),
    );
    for (const message of userMessages)
      prospectiveById.set(message.id, message);
    const prospective = [...prospectiveById.values()].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
    const latestUser = prospectiveById.get(latestUserId);
    if (!latestUser || latestUser.role !== 'user') {
      throw new BadRequestException(
        'The latest user message has no text content.',
      );
    }

    const context: LlmMessage[] = [
      { role: 'developer', content: DEVELOPER_INSTRUCTION },
      ...prospective
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
    const assistantCreatedAt = new Date(
      Math.max(
        Date.now(),
        ...prospective.map((message) => Date.parse(message.createdAt) + 1),
      ),
    ).toISOString();
    let assistantId: string;
    do {
      assistantId = `msg_${randomUUID()}`;
    } while (this.store.getMessage(assistantId));
    const assistant: Message = {
      id: assistantId,
      chatRoomId: dto.threadId,
      role: 'assistant',
      content: [],
      status: 'in_progress',
      providerMessageId: null,
      createdAt: assistantCreatedAt,
      updatedAt: assistantCreatedAt,
    };
    if (!this.store.startRun(run, [...userMessages, assistant])) {
      if (!this.store.getChatRoom(dto.threadId)) {
        throw new NotFoundException(
          `Chat room ${dto.threadId} does not exist.`,
        );
      }
      throw new ConflictException(`Run ${dto.runId} already exists.`);
    }

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

    if (signal.aborted || response.destroyed) {
      this.cancelPrepared(prepared);
      if (!response.destroyed) response.end();
      return;
    }

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
      const providerAbort = new AbortController();
      const providerSignal = AbortSignal.any([signal, providerAbort.signal]);
      for await (const event of this.llmProvider.streamResponse(
        { messages: context, model: run.model },
        providerSignal,
      )) {
        if (!this.store.getChatRoom(run.chatRoomId)) {
          providerAbort.abort();
          this.send(response, {
            type: EventType.RUN_ERROR,
            code: 'chat_room_deleted',
            message: 'The chat room was deleted.',
          });
          response.end();
          return;
        }
        if (event.type === 'started') {
          providerMessageId = event.providerResponseId;
        } else if (event.type === 'text-delta') {
          output += event.delta;
          const stored = this.store.upsertMessage({
            ...assistant,
            content: [{ type: 'text', text: output }],
            providerMessageId,
            updatedAt: new Date().toISOString(),
          });
          if (!stored) {
            providerAbort.abort();
            this.send(response, {
              type: EventType.RUN_ERROR,
              code: 'chat_room_deleted',
              message: 'The chat room was deleted.',
            });
            response.end();
            return;
          }
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
      if (!this.store.getChatRoom(run.chatRoomId)) {
        this.send(response, {
          type: EventType.RUN_ERROR,
          code: 'chat_room_deleted',
          message: 'The chat room was deleted.',
        });
        response.end();
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

  cancelPrepared(prepared: PreparedRun): void {
    this.cancel(prepared.run, prepared.assistant, '', null);
  }

  private send(response: Response, event: AGUIEvent): void {
    if (!response.destroyed && !response.writableEnded) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  private toAgUiMessage(
    message: Record<string, unknown>,
  ): ClientConversationMessage {
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
    return message as unknown as ClientConversationMessage;
  }

  private text(message: Message): string {
    return message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }
}
