import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { nanoid } from 'nanoid';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const response = context.switchToHttp().getResponse<Record<string, unknown>>();
    const requestId = (request['headers'] as Record<string, string>)['x-request-id'] ?? nanoid();
    request['requestId'] = requestId;
    (response['header'] as (key: string, val: string) => void)('x-request-id', requestId);
    return next.handle();
  }
}
