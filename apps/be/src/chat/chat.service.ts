import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_STORE, type ChatStore, type PageInput } from './chat-store';
import type { ChatRoom, Message, UpdateChatRoom } from './chat.models';

@Injectable()
export class ChatService {
  constructor(@Inject(CHAT_STORE) private readonly store: ChatStore) {}

  createRoom(): ChatRoom {
    return this.store.createChatRoom();
  }

  listRooms(input: PageInput) {
    const page = this.store.listChatRooms(input);
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
    input: PageInput,
  ): {
    messages: Message[];
    nextCursor: string | null;
  } {
    this.getRoom(chatRoomId);
    const page = this.store.listMessages(chatRoomId, input);
    return { messages: page.items, nextCursor: page.nextCursor };
  }

  private notFound(chatRoomId: string): NotFoundException {
    return new NotFoundException(`Chat room ${chatRoomId} does not exist.`);
  }
}
