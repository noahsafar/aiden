#!/usr/bin/env python3
"""
One-off test send to check how a sent email renders.

Reuses the SAME stored Google credentials the app uses (~/.aiden/token.pickle).
Sends a multipart/alternative message: a plain-text part AND a clean HTML part
(real paragraphs, system font), which is what makes it look good in Gmail —
plain text alone renders flat and can wrap awkwardly.

Run from the project root:

    python3 send_test_email.py

Sends to noahsafar12345@gmail.com.
"""
import base64
import email.message
import pickle
from html import escape
from pathlib import Path

from google.auth.transport.requests import Request
from googleapiclient.discovery import build

TOKEN_FILE = Path.home() / ".aiden" / "token.pickle"
TO = "noahsafar12345@gmail.com"
SUBJECT = "Aiden test — HTML formatting"

# Plain-text body. Paragraphs separated by blank lines; single newlines are
# soft line breaks within a paragraph.
BODY = (
    "Hi Noah,\n\n"
    "This is a test from Aiden. This sentence is intentionally long — well over "
    "seventy-six characters without any manual breaks — so you can see it wraps "
    "cleanly rather than getting chopped mid-word.\n\n"
    "You should see three tidy paragraphs in a normal font, with line breaks "
    "only where intended.\n\n"
    "If this reads nicely, the HTML send path looks right.\n\n"
    "— Aiden"
)


def to_html(text: str) -> str:
    """Turn the plain body into simple, well-spaced HTML: blank lines become
    paragraphs; single newlines become <br>. Escaped so it's injection-safe."""
    paragraphs = [p for p in text.split("\n\n")]
    blocks = "".join(
        f'<p style="margin:0 0 16px">{escape(p).replace(chr(10), "<br>")}</p>'
        for p in paragraphs
    )
    return (
        '<!doctype html><html><body style="margin:0;padding:0">'
        '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
        "Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;"
        'color:#1f2937;max-width:600px">'
        f"{blocks}"
        "</div></body></html>"
    )


def get_credentials():
    if not TOKEN_FILE.exists():
        raise SystemExit(
            f"No token found at {TOKEN_FILE}. Sign in through the app once, then re-run."
        )
    with open(TOKEN_FILE, "rb") as f:
        creds = pickle.load(f)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open(TOKEN_FILE, "wb") as f:
                pickle.dump(creds, f)
        else:
            raise SystemExit("Stored credentials are invalid; re-authenticate in the app.")
    return creds


def main():
    creds = get_credentials()
    service = build("gmail", "v1", credentials=creds)

    message = email.message.EmailMessage()
    message["To"] = TO
    message["Subject"] = SUBJECT
    message.set_content(BODY, cte="8bit")  # plain-text fallback
    message.add_alternative(to_html(BODY), subtype="html", cte="8bit")  # the nice version

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    print(f"Sent to {TO}. Message id: {sent['id']}")


if __name__ == "__main__":
    main()
