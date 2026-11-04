import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';
import type { RequestWithId } from './request-id.middleware';

interface NestErrorResponse {
  message?: string | string[];
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail: this.getDetail(exception, status),
        instance: request.originalUrl,
        requestId: request.requestId,
      });
  }

  private getDetail(exception: unknown, status: number): string {
    if (!(exception instanceof HttpException)) {
      return 'An unexpected error occurred.';
    }

    const exceptionResponse = exception.getResponse();
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    const message = (exceptionResponse as NestErrorResponse).message;
    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? STATUS_CODES[status] ?? 'Request failed.';
  }
}
