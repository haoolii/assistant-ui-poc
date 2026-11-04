import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ChatRoomPageQuery,
  CreateChatRoomDto,
  MessagePageQuery,
  UpdateChatRoomDto,
} from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat-rooms')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  create(
    @Body() _body: CreateChatRoomDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const room = this.chatService.createRoom();
    response.location(`/api/v1/chat-rooms/${room.id}`);
    return room;
  }

  @Get()
  list(@Query() query: ChatRoomPageQuery) {
    return this.chatService.listRooms(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.chatService.getRoom(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateChatRoomDto) {
    return this.chatService.updateRoom(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string): void {
    this.chatService.deleteRoom(id);
  }

  @Get(':id/messages')
  messages(@Param('id') id: string, @Query() query: MessagePageQuery) {
    return this.chatService.listMessages(id, query);
  }
}
