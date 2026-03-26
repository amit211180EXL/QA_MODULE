import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const { method, url } = request as { method: string; url: string };
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<{ statusCode: number }>();
        const durationMs = Date.now() - start;
        // Structured log — replace with pino logger in production
        console.log(
          JSON.stringify({
            type: 'request',
            requestId: request['requestId'],
            tenantId: (request['user'] as Record<string, string> | undefined)?.tenantId,
            method,
            url,
            statusCode: response.statusCode,
            durationMs,
          }),
        );
      }),
    );
  }
}
