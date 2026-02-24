"""Shared Claude API client using httpx — ported from ai.rs call_claude_api_with_system."""

import httpx
from app.config import ANTHROPIC_API_KEY, ZAI_ENDPOINT, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, REQUEST_TIMEOUT


async def call_claude(
    prompt: str,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: str = DEFAULT_MODEL,
    temperature: float | None = None,
) -> str:
    """Send a text-only message to the Claude API and return the response text."""
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


async def call_claude_vision(
    prompt: str,
    base64_image: str,
    media_type: str,
    system: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    model: str = DEFAULT_MODEL,
) -> str:
    """Send a message with an image to the Claude API (vision)."""
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
