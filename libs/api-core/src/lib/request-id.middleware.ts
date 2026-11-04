import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incomingRequestId = request.header('x-request-id')?.trim();
  const requestId = incomingRequestId || randomUUID();

  (request as RequestWithId).requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
