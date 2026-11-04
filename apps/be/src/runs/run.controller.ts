import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RunAgentInputDto } from './run.dto';
import { RunService } from './run.service';

@Controller('runs')
export class RunController {
  constructor(private readonly runService: RunService) {}

  @Post()
  async run(
    @Body() body: RunAgentInputDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    request.once('aborted', () => abortController.abort());
    response.on('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    if (request.aborted || response.destroyed) abortController.abort();
    if (abortController.signal.aborted) {
      if (!response.destroyed) response.end();
      return;
    }

    const prepared = this.runService.prepare(body);
    if (abortController.signal.aborted || response.destroyed) {
      this.runService.cancelPrepared(prepared);
      if (!response.destroyed) response.end();
      return;
    }

    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    await this.runService.stream(prepared, response, abortController.signal);
  }
}
