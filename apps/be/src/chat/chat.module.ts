import { Module } from '@nestjs/common';
import { CHAT_STORE } from './chat-store';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { InMemoryChatStore } from './in-memory-chat.store';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    InMemoryChatStore,
    { provide: CHAT_STORE, useExisting: InMemoryChatStore },
  ],
  exports: [CHAT_STORE],
})
export class ChatModule {}
