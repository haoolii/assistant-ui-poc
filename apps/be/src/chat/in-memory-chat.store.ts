import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  InvalidCursorError,
  type ChatStore,
  type PageInput,
} from './chat-store';
import type {
  ChatRoom,
  Message,
  Page,
  Run,
  UpdateChatRoom,
  UpdateRun,
} from './chat.models';

@Injectable()
export class InMemoryChatStore implements ChatStore {
  private readonly chatRooms = new Map<string, ChatRoom>();
  private readonly roomControllers = new Map<string, AbortController>();
  private readonly messages = new Map<string, Message>();
  private readonly runs = new Map<string, Run>();
  private readonly issuedCursors = new Set<string>();

  createChatRoom(): ChatRoom {
    const now = new Date().toISOString();
    const room: ChatRoom = {
      id: `room_${randomUUID()}`,
      title: null,
      status: 'regular',
      createdAt: now,
      updatedAt: now,
    };
    this.chatRooms.set(room.id, room);
    this.roomControllers.set(room.id, new AbortController());
    return room;
  }

  listChatRooms(input: PageInput): Page<ChatRoom> {
    const rooms = [...this.chatRooms.values()].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    );
    return this.page(rooms, input, 'chat-rooms', 'updatedAt', 'descending');
  }

  getChatRoom(chatRoomId: string): ChatRoom | undefined {
    return this.chatRooms.get(chatRoomId);
  }

  getRoomSignal(chatRoomId: string): AbortSignal | undefined {
    return this.roomControllers.get(chatRoomId)?.signal;
  }

  updateChatRoom(
    chatRoomId: string,
    patch: UpdateChatRoom,
  ): ChatRoom | undefined {
    const current = this.chatRooms.get(chatRoomId);
    if (!current) return undefined;

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.chatRooms.set(chatRoomId, updated);
    return updated;
  }

  deleteChatRoom(chatRoomId: string): boolean {
    if (!this.chatRooms.delete(chatRoomId)) return false;
    this.roomControllers.get(chatRoomId)?.abort();
    this.roomControllers.delete(chatRoomId);

    for (const [id, message] of this.messages) {
      if (message.chatRoomId === chatRoomId) this.messages.delete(id);
    }
    for (const [id, run] of this.runs) {
      if (run.chatRoomId === chatRoomId) this.runs.delete(id);
    }
    return true;
  }

  listMessages(chatRoomId: string, input: PageInput): Page<Message> {
    return this.page(
      this.getMessages(chatRoomId),
      input,
      `messages:${chatRoomId}`,
      'createdAt',
      'ascending',
    );
  }

  getMessages(chatRoomId: string): Message[] {
    return [...this.messages.values()]
      .filter((message) => message.chatRoomId === chatRoomId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  getMessage(messageId: string): Message | undefined {
    return this.messages.get(messageId);
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  startRun(run: Run, messages: Message[]): boolean {
    if (this.runs.has(run.id) || !this.chatRooms.has(run.chatRoomId)) {
      return false;
    }
    if (
      messages.some((message) => {
        const current = this.messages.get(message.id);
        return (
          message.chatRoomId !== run.chatRoomId ||
          (current !== undefined &&
            (current.chatRoomId !== run.chatRoomId ||
              current.role !== 'user' ||
              message.role !== 'user'))
        );
      })
    ) {
      return false;
    }

    this.runs.set(run.id, run);
    for (const message of messages) {
      const current = this.messages.get(message.id);
      this.messages.set(message.id, {
        ...message,
        createdAt: current?.createdAt ?? message.createdAt,
      });
    }
    this.touchRoom(run.chatRoomId);
    return true;
  }

  upsertMessage(message: Message): Message | undefined {
    if (!this.chatRooms.has(message.chatRoomId)) return undefined;
    const current = this.messages.get(message.id);
    if (current && current.chatRoomId !== message.chatRoomId) return undefined;
    const stored = current
      ? {
          ...message,
          createdAt: current.createdAt,
        }
      : message;
    this.messages.set(stored.id, stored);
    this.touchRoom(stored.chatRoomId);
    return stored;
  }

  updateRun(runId: string, patch: UpdateRun): Run | undefined {
    const current = this.runs.get(runId);
    if (!current || !this.chatRooms.has(current.chatRoomId)) return undefined;
    const updated = { ...current, ...patch };
    this.runs.set(runId, updated);
    return updated;
  }

  private touchRoom(chatRoomId: string): void {
    const room = this.chatRooms.get(chatRoomId);
    if (room) {
      this.chatRooms.set(chatRoomId, {
        ...room,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private page<T extends { id: string } & Record<K, string>, K extends string>(
    items: T[],
    input: PageInput,
    kind: string,
    timestampKey: K,
    direction: 'ascending' | 'descending',
  ): Page<T> {
    const cursor =
      input.cursor !== undefined
        ? this.decodeCursor(input.cursor, kind)
        : undefined;
    const remaining = cursor
      ? items.filter((item) => {
          const comparison = item[timestampKey].localeCompare(cursor.timestamp);
          const idComparison = item.id.localeCompare(cursor.id);
          return direction === 'ascending'
            ? comparison > 0 || (comparison === 0 && idComparison > 0)
            : comparison < 0 || (comparison === 0 && idComparison < 0);
        })
      : items;
    const page = remaining.slice(0, input.limit);
    const hasMore = page.length < remaining.length;
    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? this.encodeCursor(kind, last[timestampKey], last.id)
        : null;
    return {
      items: page,
      nextCursor,
    };
  }

  private encodeCursor(kind: string, timestamp: string, id: string): string {
    const cursor = Buffer.from(
      JSON.stringify({ version: 1, kind, timestamp, id }),
    ).toString('base64url');
    this.issuedCursors.add(cursor);
    return cursor;
  }

  private decodeCursor(
    cursor: string,
    kind: string,
  ): { timestamp: string; id: string } {
    if (!this.issuedCursors.has(cursor)) throw new InvalidCursorError();
    try {
      const value = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        value.version !== 1 ||
        value.kind !== kind ||
        typeof value.timestamp !== 'string' ||
        Number.isNaN(Date.parse(value.timestamp)) ||
        typeof value.id !== 'string'
      ) {
        throw new InvalidCursorError();
      }
      return { timestamp: value.timestamp, id: value.id };
    } catch (error) {
      if (error instanceof InvalidCursorError) throw error;
      throw new InvalidCursorError();
    }
  }
}
