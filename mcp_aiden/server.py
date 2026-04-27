"""
Aiden MCP Server
================

This exposes a subset of Aiden's backend functionality (Gmail integration) as an
MCP server that AI applications can consume. The server is basically a thin bridge in
front of Aiden's existing HTTP backend (``oauth_server.py``, by default
running on http://localhost:8081). All real work (Google OAuth, Gmail API
calls, etc.) is delegated to that backend. This file is only responsible
for translating between MCP and HTTP.

Capabilities advertised:
    Resource:   aiden://emails/recent
    Tools:      list_emails, send_email
    Prompt:     compose_reply

Run as a standalone stdio server:
    python -m mcp_aiden.server          # from Aiden project root
    python mcp_aiden/server.py          # equivalent

Configuration (env variables):
    AIDEN_BACKEND_URL   Base URL of the Aiden OAuth/HTTP backend
                        Defaults to ``http://localhost:8081``
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

BACKEND_URL = os.environ.get("AIDEN_BACKEND_URL", "http://localhost:8081").rstrip("/")
HTTP_TIMEOUT = float(os.environ.get("AIDEN_HTTP_TIMEOUT", "30"))

mcp = FastMCP("aiden-mcp")


def _backend_get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """GET ``path`` on the Aiden backend and return parsed JSON or an error envelope."""
    url = f"{BACKEND_URL}{path}"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.get(url, params=params or {})
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "error": f"Aiden backend GET {url} failed: {exc}",
            "hint": "Start the backend with `python3 oauth_server.py` and sign in via the desktop app.",
        }


def _backend_post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """POST JSON ``body`` to ``path`` on the Aiden backend."""
    url = f"{BACKEND_URL}{path}"
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            response = client.post(url, json=body)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "error": f"Aiden backend POST {url} failed: {exc}",
            "hint": "Start the backend with `python3 oauth_server.py` and sign in via the desktop app.",
        }


@mcp.resource("aiden://emails/recent", title="Recent inbox emails")
def recent_emails_resource() -> str:
    """The 10 most recent emails in the user's Gmail inbox, as a JSON string.

    Each entry contains the message id, subject, sender, snippet, and timestamp.
    Reading this resource calls the backend's ``GET /emails`` endpoint, so the
    user must already be authenticated via the Aiden desktop app's OAuth flow.
    """
    payload = _backend_get("/emails", params={"maxResults": 10})
    emails = payload.get("emails", []) if isinstance(payload, dict) else []
    summary = [
        {
            "id": e.get("id"),
            "subject": e.get("subject"),
            "from": e.get("from"),
            "snippet": e.get("snippet"),
            "date": e.get("date"),
            "isRead": e.get("isRead"),
        }
        for e in emails
    ]
    return json.dumps({"count": len(summary), "emails": summary, "raw": payload}, indent=2)


@mcp.tool(
    name="list_emails",
    title="List inbox emails",
    description=(
        "Search the user's Gmail inbox via the Aiden backend. "
        "Returns up to ``max_results`` messages matching the Gmail-style ``query``."
    ),
)
def list_emails(query: str = "in:inbox", max_results: int = 10) -> dict[str, Any]:
    """Search/list inbox emails.

    Args:
        query: A Gmail-style search query (e.g., ``"in:inbox is:unread"``,
            ``"from:alice@example.com"``). Defaults to ``in:inbox``.
        max_results: Maximum number of messages to return (1–50). Defaults to 10.
    """
    max_results = max(1, min(int(max_results), 50))
    payload = _backend_get("/emails", params={"q": query, "maxResults": max_results})
    if isinstance(payload, dict) and payload.get("ok") is False:
        return payload
    emails = payload.get("emails", []) if isinstance(payload, dict) else []
    return {
        "ok": True,
        "query": query,
        "count": len(emails),
        "emails": [
            {
                "id": e.get("id"),
                "threadId": e.get("threadId"),
                "subject": e.get("subject"),
                "from": e.get("from"),
                "to": e.get("to"),
                "snippet": e.get("snippet"),
                "date": e.get("date"),
                "isRead": e.get("isRead"),
            }
            for e in emails
        ],
    }


@mcp.tool(
    name="send_email",
    title="Send an email",
    description=(
        "Send an email through the user's authenticated Gmail account via the "
        "Aiden backend's ``/send-email`` endpoint."
    ),
)
def send_email(to: str, subject: str, body: str) -> dict[str, Any]:
    """Send a plain-text email.

    Args:
        to: Recipient email address (e.g. ``"alice@example.com"``).
        subject: Subject line of the message.
        body: Plain-text body of the message.
    """
    if not to or not subject or body is None:
        return {"ok": False, "error": "`to`, `subject`, and `body` are all required."}
    payload = _backend_post("/send-email", {"to": to, "subject": subject, "body": body})
    return payload


@mcp.prompt(
    name="compose_reply",
    title="Compose an email reply",
    description="Build a prompt that asks an LLM to draft a reply to a specific email in a specified tone.",
)
def compose_reply(subject: str, sender: str, body: str, tone: str = "professional") -> str:
    """Reusable prompt template for drafting email replies.

    Args:
        subject: Subject of the email being replied to.
        sender: Display name or email of the original sender.
        body: Full text of the email being replied to.
        tone: Desired tone of the reply (e.g. ``professional``, ``friendly``, ``brief``).
    """
    return (
        f"You are drafting an email reply on behalf of the user.\n\n"
        f"Original message\n"
        f"----------------\n"
        f"From:    {sender}\n"
        f"Subject: {subject}\n\n"
        f"{body}\n"
        f"----------------\n\n"
        f"Write a {tone} reply. Keep it concise, address the sender's points "
        f"directly, and end with a clear next step or sign-off. Output only the "
        f"reply body — no subject line, no preamble."
    )


def main() -> None:
    """Entry point for ``python -m mcp_aiden.server`` and direct execution."""
    mcp.run()


if __name__ == "__main__":
    main()
