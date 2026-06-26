"""Shared Claude API client using httpx — ported from ai.rs call_claude_api_with_system."""

import logging

import httpx

from app.config import ANTHROPIC_API_KEY, ZAI_ENDPOINT, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, REQUEST_TIMEOUT
from app.services.prompt_guard import screen_input, sanitize_prompt_input
from app.services.json_parser import extract_json

logger = logging.getLogger(__name__)


async def call_claude(
    prompt: str,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: str = DEFAULT_MODEL,
    temperature: float | None = None,
) -> str:
    """Send a text-only message to the Claude API and return the response text."""
    # --- Prompt injection defense ---
    prompt = sanitize_prompt_input(prompt)
    screen = await screen_input(prompt)
    if screen.flagged:
        raise RuntimeError(f"Request blocked by prompt injection guard: {screen.reason}")

    messages = [{"role": "user", "content": prompt}]
    body: dict = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(
            ZAI_ENDPOINT,
            json=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Claude API error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    if not data.get("content"):
        raise RuntimeError("Empty response from Claude API")

    return data["content"][0]["text"]


async def call_claude_json(
    prompt: str,
    tool_name: str,
    tool_schema: dict,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: str = DEFAULT_MODEL,
) -> dict:
    """Force a structured-JSON result via Anthropic tool-use. Falls back to a plain
    deterministic text call + tolerant JSON extraction if the endpoint doesn't support
    tools, so callers degrade gracefully instead of hard-failing on a malformed char."""
    prompt = sanitize_prompt_input(prompt)
    screen = await screen_input(prompt)
    if screen.flagged:
        raise RuntimeError(f"Request blocked by prompt injection guard: {screen.reason}")

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
        "tools": [{
            "name": tool_name,
            "description": "Return the structured result for this request.",
            "input_schema": tool_schema,
        }],
        "tool_choice": {"type": "tool", "name": tool_name},
    }
    if system:
        body["system"] = system

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(ZAI_ENDPOINT, json=body, headers=headers)
        if resp.status_code == 200:
            for block in resp.json().get("content", []):
                if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
                    return block["input"]
            logger.warning("Tool-use response had no tool_use block — falling back to text parse")
        else:
            logger.warning("Tool-use call returned %d — falling back to text parse", resp.status_code)
    except Exception:
        logger.exception("Tool-use call failed — falling back to text parse")

    # Fallback: same prompt as a plain deterministic text call, then tolerant parse.
    body.pop("tools", None)
    body.pop("tool_choice", None)
    body["temperature"] = 0
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(ZAI_ENDPOINT, json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Claude API error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if not data.get("content"):
        raise RuntimeError("Empty response from Claude API")
    result = extract_json(data["content"][0].get("text", ""))
    if isinstance(result, dict):
        return result
    raise RuntimeError("Expected a JSON object from Claude")


async def call_claude_vision(
    prompt: str,
    base64_image: str,
    media_type: str,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: str = DEFAULT_MODEL,
) -> str:
    """Send a message with an image to the Claude API (vision)."""
    # --- Prompt injection defense ---
    prompt = sanitize_prompt_input(prompt)
    screen = await screen_input(prompt)
    if screen.flagged:
        raise RuntimeError(f"Request blocked by prompt injection guard: {screen.reason}")

    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64_image},
        },
    ]
    messages = [{"role": "user", "content": content}]
    body: dict = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system:
        body["system"] = system

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        resp = await client.post(
            ZAI_ENDPOINT,
            json=body,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Claude vision API error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    if not data.get("content"):
        raise RuntimeError("Empty response from Claude vision API")

    return data["content"][0]["text"]
