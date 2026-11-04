export type LlmRole = 'developer' | 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export type LlmStreamEvent =
  | { type: 'started'; providerResponseId: string }
  | { type: 'text-delta'; delta: string }
  | {
      type: 'completed';
      providerResponseId: string;
      usage?: Record<string, number>;
    };
