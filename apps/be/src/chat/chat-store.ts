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

export interface MessagePageInput extends PageInput {
  order?: 'asc' | 'desc';
}

export class InvalidCursorError extends Error {}

export interface ChatStore {
  createChatRoom(): ChatRoom;
  listChatRooms(input: PageInput): Page<ChatRoom>;
  getChatRoom(chatRoomId: string): ChatRoom | undefined;
  getRoomSignal(chatRoomId: string): AbortSignal | undefined;
  updateChatRoom(
    chatRoomId: string,
    patch: UpdateChatRoom,
  ): ChatRoom | undefined;
  deleteChatRoom(chatRoomId: string): boolean;
  listMessages(chatRoomId: string, input: MessagePageInput): Page<Message>;
  getMessages(chatRoomId: string): Message[];
  getMessage(messageId: string): Message | undefined;
  getRun(runId: string): Run | undefined;
  startRun(run: Run, messages: Message[]): boolean;
  upsertMessage(message: Message): Message | undefined;
  updateRun(runId: string, patch: UpdateRun): Run | undefined;
}
