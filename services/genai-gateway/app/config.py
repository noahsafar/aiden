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
