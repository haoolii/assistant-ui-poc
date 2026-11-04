import { BE_BASE_URL } from './be-client';

export interface Room {
  id: string;
  title: string | null;
  status: 'regular' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatRoomId: string;
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: { type: 'text'; text: string }[];
  status: 'in_progress' | 'completed' | 'failed';
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BE_BASE_URL}${path}`, init);
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.detail || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

async function allPages<T>(
  load: (query: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const query = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await load(query);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export function listRooms(): Promise<Room[]> {
  return allPages(async (query) => {
    const page = await request<{
      chatRooms: Room[];
      nextCursor: string | null;
    }>(`/chat-rooms${query}`);
    return { items: page.chatRooms, nextCursor: page.nextCursor };
  });
}

export function createRoom(signal?: AbortSignal): Promise<Room> {
  return request<Room>('/chat-rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
}

export function cancelRun(
  id: string,
  threadId: string,
): Promise<{
  id: string;
  chatRoomId: string;
  status: 'completed' | 'failed' | 'cancelled';
  started: boolean;
}> {
  return request(`/runs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId }),
    signal: AbortSignal.timeout(12000),
  });
}

export function getHistory(
  roomId: string,
  cursor?: string,
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const query = `?limit=50&order=desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return request(`/chat-rooms/${encodeURIComponent(roomId)}/messages${query}`, {
    signal: AbortSignal.timeout(10000),
  });
}

export function renameRoom(roomId: string, title: string): Promise<Room> {
  return request<Room>(`/chat-rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export function deleteRoom(roomId: string): Promise<void> {
  return request<void>(`/chat-rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
  });
}
