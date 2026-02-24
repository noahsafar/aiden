"""Proxy LLM calls to the GenAI Gateway service instead of calling APIs directly.

This module provides proxy functions that forward requests to the GenAI service.
The main proxying is done by monkey-patching call_anthropic_with_retry in server.py,
which routes all LLM calls through /api/v1/completion. This module handles
summarize_email separately since it has a different return format.
"""

import os
import requests

GENAI_SERVICE_URL = os.getenv("GENAI_SERVICE_URL", "http://localhost:8090")


def proxy_summarize(subject, sender, body_text, snippet=""):
    """Proxy email summarization to GenAI service."""
    try:
        email_content = f"From: {sender}\nSubject: {subject}\n\n{body_text or snippet}"
        resp = requests.post(
            f"{GENAI_SERVICE_URL}/api/v1/summarize-email",
            json={"email_content": email_content},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            return {"summary": data.get("summary", ""), "key_points": data.get("key_points", []), "action_items": data.get("action_items", [])}
        return None
    except Exception as e:
        print(f"GenAI proxy error (summarize): {e}")
        return None
