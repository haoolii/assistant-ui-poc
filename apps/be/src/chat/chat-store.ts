import type {
  ChatRoom,
  Message,
  Page,
  Run,
  UpdateChatRoom,
  UpdateRun,
} from './chat.models';

export const CHAT_STORE = Symbol('CHAT_STORE');

export interface PageInput {
  cursor?: string;
  limit: number;
}

export interface ChatStore {
  createChatRoom(): ChatRoom;
  listChatRooms(input: PageInput): Page<ChatRoom>;
  getChatRoom(chatRoomId: string): ChatRoom | undefined;
  updateChatRoom(
    chatRoomId: string,
    patch: UpdateChatRoom,
  ): ChatRoom | undefined;
  deleteChatRoom(chatRoomId: string): boolean;
  listMessages(chatRoomId: string, input: PageInput): Page<Message>;
  getMessages(chatRoomId: string): Message[];
  upsertMessage(message: Message): Message;
  createRun(run: Run): Run;
  updateRun(runId: string, patch: UpdateRun): Run | undefined;
}
