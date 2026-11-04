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
      if (context.shouldFail) {
        response
          .status(500)
          .json(this.responsesService.createFailedResponse(context));
        return;
      }

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

    const abortController = new AbortController();
    response.once('close', () => abortController.abort());

    for await (const event of this.responsesService.stream(
      context,
      abortController.signal,
    )) {
      if (response.destroyed || response.writableEnded) {
        return;
      }
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  }
}
