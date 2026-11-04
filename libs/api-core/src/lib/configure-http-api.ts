import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ProblemDetailsFilter } from './problem-details.filter';
import { requestIdMiddleware } from './request-id.middleware';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

export function configureHttpApi(app: INestApplication): void {
  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());
}
