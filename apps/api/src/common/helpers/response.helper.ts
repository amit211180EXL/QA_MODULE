import { ApiMeta, ApiResponse } from '@qa/shared';

export function buildResponse<T>(data: T, requestId: string): ApiResponse<T> {
  const meta: ApiMeta = { requestId, timestamp: new Date().toISOString() };
  return { data, meta };
}
