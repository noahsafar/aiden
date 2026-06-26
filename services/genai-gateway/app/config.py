import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ZAI_ENDPOINT = os.getenv("ZAI_ENDPOINT", "https://api.z.ai/api/anthropic/v1/messages")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514")
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "4000"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "60"))

# Lakera Guard — prompt injection screening
LAKERA_GUARD_API_KEY = os.getenv("LAKERA_GUARD_API_KEY", "")
LAKERA_GUARD_ENABLED = os.getenv("LAKERA_GUARD_ENABLED", "true").lower() in ("true", "1", "yes")
# If true, block requests when Lakera is unreachable/erroring (fail-closed) rather
# than allowing them through.
LAKERA_FAIL_CLOSED = os.getenv("LAKERA_FAIL_CLOSED", "false").lower() in ("true", "1", "yes")

# Gateway access control. When set, every /api/v1 route requires a matching
# X-API-Key header; empty in local dev (the app logs that it is unauthenticated).
GATEWAY_API_KEY = os.getenv("GATEWAY_API_KEY", "")
# Browser CORS allowlist (comma-separated). Defaults to the local app origins —
# the wildcard "*" is intentionally NOT the default.
CORS_ALLOW_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,https://tauri.localhost",
    ).split(",")
    if o.strip()
]
# Hard ceiling on caller-supplied max_tokens (guards the raw /completion passthrough).
MAX_COMPLETION_TOKENS = int(os.getenv("MAX_COMPLETION_TOKENS", "4000"))
