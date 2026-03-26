import { api } from './api-client';
import type { PlanType } from '@qa/shared';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface SignupPayload {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminName: string;
  password: string;
  plan: PlanType;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user?: { id: string; name: string; email: string; role: string };
  tenant?: { id: string; slug: string; name: string; plan: string };
}

export const authApi = {
  signup: (payload: SignupPayload) =>
    api.post<{ data: AuthResponse }>('/auth/signup', payload).then((r) => r.data.data),

  login: (payload: LoginPayload, tenantSlug?: string) =>
    api
      .post<{ data: AuthResponse }>('/auth/login', payload, {
        headers: tenantSlug ? { 'x-tenant-slug': tenantSlug } : {},
      })
      .then((r) => r.data.data),

  logout: (refreshToken: string) => api.post('/auth/logout', { refreshToken }),

  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),

  acceptInvite: (token: string, password: string) =>
    api
      .post<{ data: AuthResponse }>('/auth/accept-invite', { token, password })
      .then((r) => r.data.data),

  me: () => api.get<{ data: CurrentUser }>('/auth/me').then((r) => r.data.data),
};

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  tenantId: string;
  lastLoginAt: string | null;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get<{ data: CurrentUser[] }>('/users').then((r) => r.data.data),

  invite: (payload: { email: string; name: string; role: string }) =>
    api.post('/users/invite', payload).then((r) => r.data),

  update: (id: string, payload: { name?: string; role?: string; status?: string }) =>
    api.patch(`/users/${id}`, payload).then((r) => r.data),

  deactivate: (id: string) => api.delete(`/users/${id}`),
};

// ─── LLM Config ───────────────────────────────────────────────────────────────

export const llmApi = {
  get: () => api.get('/llm-config').then((r) => r.data),
  set: (payload: Record<string, unknown>) => api.put('/llm-config', payload).then((r) => r.data),
  test: () => api.post('/llm-config/test').then((r) => r.data),
};

// ─── Conversations ────────────────────────────────────────────────────────────

export interface ConversationListItem {
  id: string;
  externalId: string | null;
  channel: string;
  agentName: string | null;
  customerRef: string | null;
  status: string;
  receivedAt: string;
  evaluation: {
    workflowState: string;
    finalScore: number | null;
    passFail: boolean | null;
  } | null;
}

export interface ConversationListResponse {
  items: ConversationListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const conversationsApi = {
  list: (params?: { status?: string; agentId?: string; page?: number; limit?: number }) =>
    api
      .get<{ data: ConversationListResponse }>('/conversations', { params })
      .then((r) => r.data.data),

  get: (id: string) =>
    api.get<{ data: ConversationListItem }>(`/conversations/${id}`).then((r) => r.data.data),

  upload: (payload: {
    channel: string;
    conversations: Array<{
      externalId?: string;
      agentId?: string;
      agentName?: string;
      customerRef?: string;
      content: unknown;
      metadata?: unknown;
      receivedAt?: string;
    }>;
  }) =>
    api
      .post<{ data: { uploaded: number } }>('/conversations/upload', payload)
      .then((r) => r.data.data),
};

// ─── Forms ────────────────────────────────────────────────────────────────────

export interface FormListItem {
  id: string;
  formKey: string;
  version: number;
  name: string;
  description: string | null;
  status: string;
  channels: string[];
  publishedAt: string | null;
  createdAt: string;
}

export interface FormSectionDef {
  id: string;
  title: string;
  weight: number;
  order: number;
}

export interface FormQuestionDef {
  id: string;
  sectionId: string;
  key: string;
  label: string;
  type: 'rating' | 'boolean' | 'text' | 'select' | 'multiselect';
  required: boolean;
  weight: number;
  order: number;
  rubric?: { goal: string; anchors?: Array<{ value: number; label: string }> };
  options?: Array<{ value: string; label: string }>;
  validation?: { min?: number; max?: number };
}

export interface FormDetail extends FormListItem {
  sections: FormSectionDef[];
  questions: FormQuestionDef[];
  scoringStrategy: { type: string; passMark: number; scale?: number };
  metadata?: Record<string, unknown>;
}

export const formsApi = {
  list: () => api.get<{ data: FormListItem[] }>('/forms').then((r) => r.data.data),

  get: (id: string) => api.get<{ data: FormDetail }>(`/forms/${id}`).then((r) => r.data.data),

  create: (payload: Record<string, unknown>) =>
    api.post<{ data: FormListItem }>('/forms', payload).then((r) => r.data.data),

  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<{ data: FormDetail }>(`/forms/${id}`, payload).then((r) => r.data.data),

  changeStatus: (id: string, action: 'publish' | 'deprecate' | 'archive') =>
    api.post<{ data: FormListItem }>(`/forms/${id}/status`, { action }).then((r) => r.data.data),
};
