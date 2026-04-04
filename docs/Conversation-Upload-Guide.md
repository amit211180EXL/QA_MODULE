# Conversation Upload Guide (By Channel)

This guide explains how to push conversations into QA Platform for different channels.

## 1. Endpoint

- Method: `POST`
- URL: `/api/v1/conversations/upload`
- Auth: `Authorization: Bearer <access_token>`
- Content-Type: `application/json`
- Limit: max `500` conversations per request

Example base URL:

- Local: `http://localhost:3000/api/v1/conversations/upload`

## 2. Request Format

Top-level payload:

```json
{
  "channel": "CHAT",
  "conversations": [
    {
      "externalId": "string-optional",
      "agentId": "string-optional",
      "agentName": "string-optional",
      "customerRef": "string-optional",
      "content": {},
      "metadata": {},
      "receivedAt": "2026-04-04T11:30:00.000Z"
    }
  ]
}
```

### Field Notes

- `channel` is required and must be one of:
  - `CHAT`
  - `EMAIL`
  - `CALL`
  - `SOCIAL`
- `conversations` is required and must be a non-empty array.
- `externalId` is recommended for deduplication across retries.
- `content` is required and should contain your channel transcript/message structure.
- `metadata` is optional extra context.
- `receivedAt` is optional. If omitted, server time is used.

## 3. Channel-wise Sample Payloads

## CHAT

```json
{
  "channel": "CHAT",
  "conversations": [
    {
      "externalId": "CHAT-10001",
      "agentId": "agent-chat-1",
      "agentName": "Alice",
      "customerRef": "cust-77",
      "content": [
        { "role": "customer", "text": "I need help with order 1001", "ts": "2026-04-04T10:00:00.000Z" },
        { "role": "agent", "text": "Sure, let me check that for you.", "ts": "2026-04-04T10:00:30.000Z" }
      ],
      "metadata": { "topic": "order_update", "source": "web_chat" },
      "receivedAt": "2026-04-04T10:00:00.000Z"
    }
  ]
}
```

## EMAIL

```json
{
  "channel": "EMAIL",
  "conversations": [
    {
      "externalId": "EMAIL-9001",
      "agentId": "agent-email-2",
      "agentName": "John",
      "customerRef": "cust-92",
      "content": [
        { "role": "customer", "text": "Subject: Billing issue\nI was charged twice.", "ts": "2026-04-04T08:00:00.000Z" },
        { "role": "agent", "text": "We have issued a refund for the duplicate charge.", "ts": "2026-04-04T08:30:00.000Z" }
      ],
      "metadata": { "topic": "billing", "source": "email_inbox" },
      "receivedAt": "2026-04-04T08:00:00.000Z"
    }
  ]
}
```

## CALL

```json
{
  "channel": "CALL",
  "conversations": [
    {
      "externalId": "CALL-52001",
      "agentId": "agent-call-3",
      "agentName": "Rita",
      "customerRef": "cust-31",
      "content": [
        { "speaker": "agent", "text": "Thank you for calling support.", "ts": "2026-04-04T09:00:00.000Z" },
        { "speaker": "customer", "text": "My internet keeps disconnecting.", "ts": "2026-04-04T09:00:20.000Z" }
      ],
      "metadata": { "topic": "connectivity", "source": "contact_center" },
      "receivedAt": "2026-04-04T09:00:00.000Z"
    }
  ]
}
```

## SOCIAL

```json
{
  "channel": "SOCIAL",
  "conversations": [
    {
      "externalId": "SOCIAL-42001",
      "agentId": "agent-social-4",
      "agentName": "Mike",
      "customerRef": "@customer_handle",
      "content": [
        { "author": "customer", "text": "My package is delayed.", "ts": "2026-04-04T07:30:00.000Z" },
        { "author": "agent", "text": "Please DM your order ID and we will assist.", "ts": "2026-04-04T07:35:00.000Z" }
      ],
      "metadata": { "topic": "delivery_status", "source": "social_media" },
      "receivedAt": "2026-04-04T07:30:00.000Z"
    }
  ]
}
```

## 4. cURL Example

```bash
curl -X POST "http://localhost:3000/api/v1/conversations/upload" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "CHAT",
    "conversations": [
      {
        "externalId": "CHAT-10001",
        "agentId": "agent-chat-1",
        "agentName": "Alice",
        "customerRef": "cust-77",
        "content": [
          { "role": "customer", "text": "I need help", "ts": "2026-04-04T10:00:00.000Z" },
          { "role": "agent", "text": "Sure", "ts": "2026-04-04T10:00:30.000Z" }
        ],
        "metadata": { "topic": "support", "source": "web_chat" },
        "receivedAt": "2026-04-04T10:00:00.000Z"
      }
    ]
  }'
```

## 5. Success and Error Behavior

On success, API returns `201` with standard envelope.

Typical errors:

- `EMPTY_PAYLOAD`: no conversations in request
- `BATCH_TOO_LARGE`: more than 500 records
- `PLAN_LIMIT_EXCEEDED` / `PLAN_LIMIT_WOULD_EXCEED`: monthly plan limit reached
- Validation errors for malformed payload

## 6. Important Operational Notes

- A published form must exist for the target channel, otherwise conversations are stored but evaluation creation may not proceed.
- If LLM is enabled, workflow starts with AI processing.
- If LLM is disabled, items go directly to QA queue.
- Use stable `externalId` values to avoid accidental duplicate pushes.

## 7. Bulk Test Data Option

For local testing, you can seed sample data for all channels:

```bash
node scripts/seed-channel-conversations.cjs --tenant=<tenant-slug> --count=2
```

This script inserts sample conversations for `CHAT`, `EMAIL`, `CALL`, and `SOCIAL`.
