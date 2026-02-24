#!/usr/bin/env python3
"""
Email & Calendar Service — containerized wrapper for oauth_server.py.

When running in a container with GENAI_SERVICE_URL set, LLM-calling functions
are monkey-patched to proxy through the GenAI Gateway service instead of
calling OpenAI / Anthropic APIs directly.
"""

import os
import sys

# Ensure the app directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

from genai_proxy import proxy_summarize

# Import the original server module
import oauth_server

# Patch the summarize_email function to proxy through GenAI
_original_summarize = oauth_server.summarize_email


def patched_summarize_email(subject, sender, body_text, snippet=""):
    """Proxy to GenAI service if GENAI_SERVICE_URL is set, else fall back."""
    if os.getenv("GENAI_SERVICE_URL"):
        result = proxy_summarize(subject, sender, body_text, snippet)
        if result:
            return result
    return _original_summarize(subject, sender, body_text, snippet)


oauth_server.summarize_email = patched_summarize_email

# Patch call_anthropic_with_retry to proxy through GenAI when available.
# This covers handle_generate_reply, handle_edit_reply, handle_analyze_email,
# and handle_summarize_attachment which all call this function.
_original_anthropic = oauth_server.call_anthropic_with_retry


def patched_anthropic(messages, max_tokens=300, temperature=0.7, timeout=30):
    """Proxy through GenAI completion endpoint if available, else fall back."""
    if os.getenv("GENAI_SERVICE_URL"):
        import requests as _req

        genai_url = os.getenv("GENAI_SERVICE_URL")

        # Extract system message and user content, matching the original
        # call_anthropic_with_retry message processing
        system_msg = None
        prompt_parts = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg.get("content", "")
            elif msg.get("role") == "user":
                prompt_parts.append(msg.get("content", ""))

        prompt = "\n\n".join(prompt_parts)

        try:
            resp = _req.post(
                f"{genai_url}/api/v1/completion",
                json={
                    "prompt": prompt,
                    "system": system_msg,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
                timeout=timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("response", ""), None
        except Exception as e:
            print(f"GenAI proxy fallback: {e}")

    return _original_anthropic(messages, max_tokens, temperature, timeout)


oauth_server.call_anthropic_with_retry = patched_anthropic

# Start the server on port 8081 (fixed for container deployment)
if __name__ == "__main__":
    port = int(os.getenv("PORT", "8081"))

    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer(("0.0.0.0", port), oauth_server.OAuthHandler)
    print(f"Email & Calendar service started on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped")
    finally:
        server.server_close()
