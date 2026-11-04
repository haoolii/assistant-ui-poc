export type ChatRoomStatus = 'regular' | 'archived';
export type MessageRole =
  | 'system'
  | 'developer'
  | 'user'
  | 'assistant'
  | 'tool';
export type MessageStatus = 'in_progress' | 'completed' | 'failed';
export type RunStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export type MessageContentPart = TextContentPart;

export interface ChatRoom {
  id: string;
  title: string | null;
  status: ChatRoomStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatRoomId: string;
  role: MessageRole;
  content: MessageContentPart[];
  status: MessageStatus;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  chatRoomId: string;
  status: RunStatus;
  provider: string;
  model: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type UpdateChatRoom = Partial<Pick<ChatRoom, 'title' | 'status'>>;
export type UpdateRun = Partial<Omit<Run, 'id' | 'chatRoomId' | 'startedAt'>>;
