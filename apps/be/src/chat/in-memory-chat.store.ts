import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ChatStore, PageInput } from './chat-store';
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
  private readonly messages = new Map<string, Message>();
  private readonly runs = new Map<string, Run>();

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
    return room;
  }

  listChatRooms(input: PageInput): Page<ChatRoom> {
    const rooms = [...this.chatRooms.values()].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    );
    return this.page(rooms, input);
  }

  getChatRoom(chatRoomId: string): ChatRoom | undefined {
    return this.chatRooms.get(chatRoomId);
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

    for (const [id, message] of this.messages) {
      if (message.chatRoomId === chatRoomId) this.messages.delete(id);
    }
    for (const [id, run] of this.runs) {
      if (run.chatRoomId === chatRoomId) this.runs.delete(id);
    }
    return true;
  }

  listMessages(chatRoomId: string, input: PageInput): Page<Message> {
    return this.page(this.getMessages(chatRoomId), input);
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

  upsertMessage(message: Message): Message {
    const current = this.messages.get(message.id);
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

  createRun(run: Run): Run {
    this.runs.set(run.id, run);
    return run;
  }

  updateRun(runId: string, patch: UpdateRun): Run | undefined {
    const current = this.runs.get(runId);
    if (!current) return undefined;
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

  private page<T extends { id: string }>(
    items: T[],
    input: PageInput,
  ): Page<T> {
    const cursorIndex = input.cursor
      ? items.findIndex((item) => item.id === input.cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = items.slice(start, start + input.limit);
    const hasMore = start + page.length < items.length;
    return {
      items: page,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
