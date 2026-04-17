"""Prompt injection screening via Lakera Guard and input sanitization."""

import logging
import re
from dataclasses import dataclass

import httpx

from app.config import LAKERA_GUARD_API_KEY, LAKERA_GUARD_ENABLED

logger = logging.getLogger(__name__)

LAKERA_GUARD_URL = "https://api.lakera.ai/v2/guard"

MAX_INPUT_LENGTH = 50_000


@dataclass
class ScreenResult:
    flagged: bool
    reason: str = ""


async def screen_input(text: str) -> ScreenResult:
    """Screen text for prompt injection using Lakera Guard.

    Returns ScreenResult with flagged=True if injection detected.
    Gracefully degrades (allows through) if Lakera is unavailable or unconfigured.
    """
    if not LAKERA_GUARD_ENABLED or not LAKERA_GUARD_API_KEY:
        return ScreenResult(flagged=False)

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                LAKERA_GUARD_URL,
                json={"messages": [{"content": text, "role": "user"}]},
                headers={
                    "Authorization": f"Bearer {LAKERA_GUARD_API_KEY}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            logger.warning("Lakera Guard returned status %d — allowing request through", resp.status_code)
            return ScreenResult(flagged=False)

        data = resp.json()
        if data.get("flagged"):
            categories = data.get("categories", {})
            reasons = [k for k, v in categories.items() if v] if categories else ["prompt_injection"]
            reason = ", ".join(reasons)
            logger.warning("Lakera Guard flagged input: %s", reason)
            return ScreenResult(flagged=True, reason=reason)

        return ScreenResult(flagged=False)

    except httpx.TimeoutException:
        logger.warning("Lakera Guard timed out — allowing request through")
        return ScreenResult(flagged=False)
    except Exception:
        logger.exception("Lakera Guard error — allowing request through")
        return ScreenResult(flagged=False)


def sanitize_prompt_input(text: str) -> str:
    """Defense-in-depth: truncate excessively long inputs and strip
    common injection framing patterns from untrusted text.

    This does NOT replace Lakera Guard — it's an additional layer.
    """
    if len(text) > MAX_INPUT_LENGTH:
        text = text[:MAX_INPUT_LENGTH]

    # Strip sequences that attempt to break out of the user message context
    # by mimicking system/assistant role markers
    text = re.sub(r"(?i)<\|?(system|assistant|im_start|im_end)\|?>", "", text)

    return text
