import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateResponseDto } from './dto/create-response.dto';
import { ResponsesService } from './responses.service';

@Controller('responses')
export class ResponsesController {
  constructor(private readonly responsesService: ResponsesService) {}

  @Post()
  async create(
    @Body() request: CreateResponseDto,
    @Res() response: Response,
  ): Promise<void> {
    const context = this.responsesService.createContext(request);

    if (!request.stream) {
      response
        .status(200)
        .json(this.responsesService.createCompletedResponse(context));
      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    for await (const event of this.responsesService.stream(context)) {
      if (response.destroyed) {
        return;
      }
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    response.end();
  }
}
