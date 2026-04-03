#!/usr/bin/env node
/*
 * Auth smoke test for local development.
 * Validates: login -> me -> conversations list -> logout
 * using seeded dev credentials by default.
 */

const API_BASE_URL = process.env.SMOKE_API_URL || 'http://localhost:3000/api/v1';
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG || 'dev-tenant';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@dev.local';
const PASSWORD = process.env.SMOKE_PASSWORD || 'DevAdmin123!';

const argv = new Set(process.argv.slice(2));
const hasFlag = (name) => argv.has(name);
const CHECK_EVAL_QUEUE =
  hasFlag('--check-eval-queue') ||
  String(process.env.SMOKE_CHECK_EVAL_QUEUE || '').toLowerCase() === 'true';
const CHECK_EVAL_VERIFIER_QUEUE =
  hasFlag('--check-eval-verifier-queue') ||
  String(process.env.SMOKE_CHECK_EVAL_VERIFIER_QUEUE || '').toLowerCase() === 'true';

function fail(step, message, details) {
  const payload = { step, message, ...(details ? { details } : {}) };
  console.error(`\n[SMOKE][FAIL] ${JSON.stringify(payload, null, 2)}`);
  process.exit(1);
}

async function requestJson(path, { method = 'GET', token, body, extraHeaders } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-slug': TENANT_SLUG,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extraHeaders || {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { ok: response.ok, status: response.status, json };
}

async function run() {
  console.log(`[SMOKE] API: ${API_BASE_URL}`);
  console.log(`[SMOKE] Tenant: ${TENANT_SLUG}`);
  console.log(`[SMOKE] Email: ${EMAIL}`);
  console.log(`[SMOKE] Check eval queue: ${CHECK_EVAL_QUEUE}`);
  console.log(`[SMOKE] Check eval verifier queue: ${CHECK_EVAL_VERIFIER_QUEUE}`);

  const login = await requestJson('/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });

  if (!login.ok) {
    fail('login', `Expected HTTP 2xx, got ${login.status}`, login.json);
  }

  const accessToken = login.json?.data?.accessToken;
  const refreshToken = login.json?.data?.refreshToken;
  if (!accessToken || !refreshToken) {
    fail('login', 'Missing accessToken/refreshToken in login response', login.json);
  }
  console.log('[SMOKE][PASS] login');

  const me = await requestJson('/auth/me', { token: accessToken });
  if (!me.ok) {
    fail('me', `Expected HTTP 2xx, got ${me.status}`, me.json);
  }

  const meEmail = me.json?.data?.email;
  if (meEmail !== EMAIL) {
    fail('me', `Expected email ${EMAIL}, got ${String(meEmail)}`, me.json);
  }
  console.log('[SMOKE][PASS] me');

  const conversations = await requestJson('/conversations?page=1&limit=5', {
    token: accessToken,
  });
  if (!conversations.ok) {
    fail(
      'conversations:list',
      `Expected HTTP 2xx, got ${conversations.status}`,
      conversations.json,
    );
  }

  const items = conversations.json?.data?.items;
  const pagination = conversations.json?.data?.pagination;
  if (!Array.isArray(items) || !pagination || typeof pagination.total !== 'number') {
    fail('conversations:list', 'Unexpected response shape for conversations list', conversations.json);
  }
  console.log(`[SMOKE][PASS] conversations:list (items=${items.length})`);

  if (CHECK_EVAL_QUEUE) {
    const qaQueue = await requestJson('/evaluations/queue/qa?page=1&limit=5', {
      token: accessToken,
    });
    if (!qaQueue.ok) {
      fail(
        'evaluations:queue:qa',
        `Expected HTTP 2xx, got ${qaQueue.status}`,
        qaQueue.json,
      );
    }

    const qaItems = qaQueue.json?.items;
    const qaPagination = qaQueue.json?.pagination;
    if (!Array.isArray(qaItems) || !qaPagination || typeof qaPagination.total !== 'number') {
      fail(
        'evaluations:queue:qa',
        'Unexpected response shape for QA queue',
        qaQueue.json,
      );
    }
    console.log(`[SMOKE][PASS] evaluations:queue:qa (items=${qaItems.length})`);
  }

  if (CHECK_EVAL_VERIFIER_QUEUE) {
    const verifierQueue = await requestJson('/evaluations/queue/verifier?page=1&limit=5', {
      token: accessToken,
    });
    if (!verifierQueue.ok) {
      fail(
        'evaluations:queue:verifier',
        `Expected HTTP 2xx, got ${verifierQueue.status}`,
        verifierQueue.json,
      );
    }

    const verifierItems = verifierQueue.json?.items;
    const verifierPagination = verifierQueue.json?.pagination;
    if (
      !Array.isArray(verifierItems) ||
      !verifierPagination ||
      typeof verifierPagination.total !== 'number'
    ) {
      fail(
        'evaluations:queue:verifier',
        'Unexpected response shape for verifier queue',
        verifierQueue.json,
      );
    }
    console.log(
      `[SMOKE][PASS] evaluations:queue:verifier (items=${verifierItems.length})`,
    );
  }

  const logout = await requestJson('/auth/logout', {
    method: 'POST',
    token: accessToken,
    body: { refreshToken },
  });
  if (!logout.ok) {
    fail('logout', `Expected HTTP 2xx, got ${logout.status}`, logout.json);
  }
  console.log('[SMOKE][PASS] logout');

  console.log('\n[SMOKE][OK] auth + business flow is healthy');
}

run().catch((err) => {
  fail('runtime', err?.message || 'Unexpected error', {
    name: err?.name,
    stack: err?.stack,
  });
});
