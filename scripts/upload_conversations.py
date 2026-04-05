#!/usr/bin/env python3
"""
upload_conversations.py
-----------------------
Push conversations to QA Platform following the Conversation-Upload-Guide.

Usage
-----
  # Use built-in sample payloads (one per channel)
  python scripts/upload_conversations.py \
    --base-url http://localhost:3000/api/v1 \
    --tenant-slug dev-tenant \
    --email admin@dev.local \
    --password DevAdmin123! \
    --channel CHAT

  # Supply a JSON file of conversations (array)
  python scripts/upload_conversations.py \
    --base-url http://localhost:3000/api/v1 \
    --tenant-slug dev-tenant \
    --email admin@dev.local \
    --password DevAdmin123! \
    --channel CALL \
    --file my_conversations.json

  # Read credentials from environment variables
  export QA_BASE_URL=http://localhost:3000/api/v1
  export QA_TENANT_SLUG=dev-tenant
  export QA_EMAIL=admin@dev.local
  export QA_PASSWORD=DevAdmin123!
  python scripts/upload_conversations.py --channel EMAIL

    # Use secure password prompt (avoids shell escaping issues)
    python scripts/upload_conversations.py \
        --tenant-slug dev-tenant \
        --email qa.user@dev.local \
        --prompt-password \
        --channel CHAT

    # Skip login by passing an existing token
    python scripts/upload_conversations.py \
        --access-token <jwt_access_token> \
        --channel CALL

Supported channels: CHAT | EMAIL | CALL | SOCIAL
Max 500 conversations per request (API limit).

Dependencies: requests  (pip install requests)
"""

import argparse
import getpass
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: run  pip install requests")


# ── default sample payloads (one conversation per channel) ────────────────────

def _ts(offset_seconds: int = 0) -> str:
    """Return an ISO-8601 UTC timestamp offset by `offset_seconds`."""
    t = datetime.now(timezone.utc)
    return t.replace(microsecond=0).isoformat().replace("+00:00", ".000Z")


def _ext(prefix: str) -> str:
    return f"{prefix}-{int(time.time())}"


SAMPLE_PAYLOADS: dict[str, list[dict]] = {
    "CHAT": [
        {
            "externalId": _ext("SAMPLE-CHAT"),
            "agentId": "agent-chat-1",
            "agentName": "Alice",
            "customerRef": "cust-77",
            "content": [
                {"role": "customer", "text": "I need help with order 1001", "ts": _ts()},
                {"role": "agent",    "text": "Sure, let me check that for you.", "ts": _ts(30)},
            ],
            "metadata": {"topic": "order_update", "source": "web_chat"},
            "receivedAt": _ts(),
        }
    ],
    "EMAIL": [
        {
            "externalId": _ext("SAMPLE-EMAIL"),
            "agentId": "agent-email-2",
            "agentName": "John",
            "customerRef": "cust-92",
            "content": [
                {"role": "customer", "text": "Subject: Billing issue\nI was charged twice.", "ts": _ts()},
                {"role": "agent",    "text": "We have issued a refund for the duplicate charge.", "ts": _ts(1800)},
            ],
            "metadata": {"topic": "billing", "source": "email_inbox"},
            "receivedAt": _ts(),
        }
    ],
    "CALL": [
        {
            "externalId": _ext("SAMPLE-CALL"),
            "agentId": "agent-call-3",
            "agentName": "Rita",
            "customerRef": "cust-31",
            "content": {
                "messages": [
                    {"speaker": "agent",    "text": "Thank you for calling support.", "ts": _ts()},
                    {"speaker": "customer", "text": "My internet keeps disconnecting.", "ts": _ts(20)},
                ],
                # recordingUrl is optional — remove or replace with a real URL
                "recordingUrl": "https://example.com/sample-call.mp3",
            },
            "metadata": {"topic": "connectivity", "source": "contact_center"},
            "receivedAt": _ts(),
        }
    ],
    "SOCIAL": [
        {
            "externalId": _ext("SAMPLE-SOCIAL"),
            "agentId": "agent-social-4",
            "agentName": "Mike",
            "customerRef": "@customer_handle",
            "content": [
                {"author": "customer", "text": "My package is delayed.", "ts": _ts()},
                {"author": "agent",    "text": "Please DM your order ID and we will assist.", "ts": _ts(300)},
            ],
            "metadata": {"topic": "delivery_status", "source": "social_media"},
            "receivedAt": _ts(),
        }
    ],
}


# ── helpers ───────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}")


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# ── auth ──────────────────────────────────────────────────────────────────────

def login(base_url: str, tenant_slug: str, email: str, password: str) -> str:
    """
    POST /api/v1/auth/login with x-tenant-slug header.
    Returns the access token on success.
    """
    url = f"{base_url.rstrip('/')}/auth/login"
    log(f"Logging in as {email} (tenant: {tenant_slug}) ...")
    resp = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "x-tenant-slug": tenant_slug,
        },
        json={"email": email, "password": password},
        timeout=15,
    )
    if not resp.ok:
        hint = ""
        if resp.status_code in (401, 403):
            hint = (
                " Hint: verify tenant slug, credentials, and account status. "
                "If your password has shell-special characters, avoid passing it directly "
                "on CLI and use an interactive prompt or environment variable."
            )
        die(f"Login failed [{resp.status_code}]: {resp.text}{hint}")
    body = resp.json()
    token = (body.get("data") or {}).get("accessToken")
    if not token:
        die(f"No accessToken in login response: {resp.text}")
    log("Login successful.")
    return token


# ── upload ────────────────────────────────────────────────────────────────────

def upload(
    base_url: str,
    token: str,
    channel: str,
    conversations: list[dict],
) -> dict:
    """
    POST /api/v1/conversations/upload
    Sends at most 500 conversations per request (API hard limit).
    Returns the parsed response body.
    """
    if len(conversations) > 500:
        die("Batch too large: API limit is 500 conversations per request.")
    if not conversations:
        die("Conversation list is empty — nothing to upload.")

    url = f"{base_url.rstrip('/')}/conversations/upload"
    payload = {"channel": channel, "conversations": conversations}
    log(f"Uploading {len(conversations)} {channel} conversation(s) ...")

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not resp.ok:
        hint = ""
        if resp.status_code == 403:
            hint = " Hint: this user may not have permission in the target tenant."
        die(f"Upload failed [{resp.status_code}]: {resp.text}{hint}")
    return resp.json()


def verify_token(base_url: str, token: str) -> None:
    """Call /auth/me to confirm token validity and show acting user context."""
    url = f"{base_url.rstrip('/')}/auth/me"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if not resp.ok:
        die(f"Token validation failed [{resp.status_code}]: {resp.text}")
    body = resp.json()
    user = (body.get("data") or {})
    log(
        "Using token for "
        f"{user.get('email', 'unknown')} "
        f"(role: {user.get('role', 'unknown')}, tenantId: {user.get('tenantId', 'unknown')})"
    )


# ── main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Upload conversations to QA Platform.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--base-url",     default=os.getenv("QA_BASE_URL", "http://localhost:3000/api/v1"))
    p.add_argument("--tenant-slug",  default=os.getenv("QA_TENANT_SLUG", ""))
    p.add_argument("--email",        default=os.getenv("QA_EMAIL", ""))
    p.add_argument("--password",     default=os.getenv("QA_PASSWORD", ""))
    p.add_argument(
        "--access-token",
        default=os.getenv("QA_ACCESS_TOKEN", ""),
        help="Use an existing Bearer token (skips login step).",
    )
    p.add_argument(
        "--prompt-password",
        action="store_true",
        help="Prompt for password securely (recommended when password contains special chars).",
    )
    p.add_argument(
        "--channel",
        choices=["CHAT", "EMAIL", "CALL", "SOCIAL"],
        required=True,
        help="Target channel.",
    )
    p.add_argument(
        "--file",
        default=None,
        help=(
            "Path to a JSON file containing an array of conversation objects. "
            "If omitted, a built-in sample payload for the chosen channel is used."
        ),
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # ── credentials: either token mode OR login mode ────────────────────────
    token = args.access_token.strip()
    if not token:
        if args.prompt_password and not args.password:
            args.password = getpass.getpass("Password: ")

        missing = [f for f, v in [
            ("--tenant-slug / QA_TENANT_SLUG", args.tenant_slug),
            ("--email / QA_EMAIL",             args.email),
            ("--password / QA_PASSWORD",       args.password),
        ] if not v]
        if missing:
            die(
                "Missing required arguments for login mode:\n  "
                + "\n  ".join(missing)
                + "\nOr pass --access-token / QA_ACCESS_TOKEN to skip login."
            )

    # ── load conversations ────────────────────────────────────────────────────
    if args.file:
        path = os.path.abspath(args.file)
        if not os.path.isfile(path):
            die(f"File not found: {path}")
        with open(path, encoding="utf-8") as fh:
            conversations = json.load(fh)
        if not isinstance(conversations, list):
            die("JSON file must contain a top-level array of conversation objects.")
        log(f"Loaded {len(conversations)} conversation(s) from {args.file}.")
    else:
        conversations = SAMPLE_PAYLOADS[args.channel]
        log(f"Using built-in sample payload for channel {args.channel}.")

    # ── auth + upload ─────────────────────────────────────────────────────────
    if token:
        verify_token(args.base_url, token)
    else:
        token = login(args.base_url, args.tenant_slug, args.email, args.password)
    result = upload(args.base_url, token, args.channel, conversations)

    # ── report ────────────────────────────────────────────────────────────────
    data = result.get("data", {})
    meta = result.get("meta", {})
    log("Upload complete.")
    print()
    print(f"  Uploaded  : {data.get('uploaded', '?')}")
    print(f"  Evaluated : {data.get('evaluated', '?')}")
    print(f"  Request ID: {meta.get('requestId', '?')}")
    print(f"  Timestamp : {meta.get('timestamp', '?')}")
    print()
    log("Done. Conversations are now visible in the QA queue.")


if __name__ == "__main__":
    main()
