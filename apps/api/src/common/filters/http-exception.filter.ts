import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiError } from '@qa/shared';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown[] = [];

    if (exception instanceof HttpException) {
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as Record<string, unknown>;
        code = (resp['code'] as string) ?? exception.constructor.name.replace('Exception', '').toUpperCase();
        message = (resp['message'] as string) ?? exception.message;
        if (Array.isArray(resp['message'])) {
          // ValidationPipe sends array of messages
          details = resp['message'] as unknown[];
          message = 'Validation failed';
          code = 'VALIDATION_ERROR';
        }
      } else {
        message = String(exResponse);
      }
    }

    const body: ApiError = {
      error: { code, message, details: details.length ? details : undefined },
      meta: {
        requestId: (request as unknown as Record<string, string>)['requestId'] ?? '',
        timestamp: new Date().toISOString(),
      },
    };

    response.status(status).json(body);
  }
}
