import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../../health/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();

    const method = String(request['method'] ?? 'UNKNOWN');
    const route = String(
      (request['route'] as Record<string, unknown> | undefined)?.['path'] ?? request['url'] ?? 'unknown',
    );
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - start;
        this.metrics.recordHttpRequest(method, route, response.statusCode, durationMs);
      }),
    );
  }
}
