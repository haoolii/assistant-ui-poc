import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CHAT_STORE,
  InvalidCursorError,
  type ChatStore,
  type PageInput,
  type MessagePageInput,
} from './chat-store';
import type { ChatRoom, Message, UpdateChatRoom } from './chat.models';

@Injectable()
export class ChatService {
  constructor(@Inject(CHAT_STORE) private readonly store: ChatStore) {}

  createRoom(): ChatRoom {
    return this.store.createChatRoom();
  }

  listRooms(input: PageInput) {
    const page = this.getPage(() => this.store.listChatRooms(input));
    return { chatRooms: page.items, nextCursor: page.nextCursor };
  }

  getRoom(chatRoomId: string): ChatRoom {
    const room = this.store.getChatRoom(chatRoomId);
    if (!room) throw this.notFound(chatRoomId);
    return room;
  }

  updateRoom(chatRoomId: string, patch: UpdateChatRoom): ChatRoom {
    this.getRoom(chatRoomId);
    if (patch.title === undefined && patch.status === undefined) {
      throw new BadRequestException('Provide title and/or status to update.');
    }
    return this.store.updateChatRoom(chatRoomId, patch) as ChatRoom;
  }

  deleteRoom(chatRoomId: string): void {
    if (!this.store.deleteChatRoom(chatRoomId)) {
      throw this.notFound(chatRoomId);
    }
  }

  listMessages(
    chatRoomId: string,
    input: MessagePageInput,
  ): {
    messages: Message[];
    nextCursor: string | null;
  } {
    this.getRoom(chatRoomId);
    const page = this.getPage(() => this.store.listMessages(chatRoomId, input));
    return { messages: page.items, nextCursor: page.nextCursor };
  }

  private notFound(chatRoomId: string): NotFoundException {
    return new NotFoundException(`Chat room ${chatRoomId} does not exist.`);
  }

  private getPage<T>(load: () => T): T {
    try {
      return load();
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException('The pagination cursor is invalid.');
      }
      throw error;
    }
  }
}
