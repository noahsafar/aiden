# Instructions-HW3 — Aiden MCP Server & Client

This document covers the MCP Server and Client implementation for the
Homework 3 assignment, integrated into the Aiden project.

The MCP server is a thin bridge in front of the existing Aiden backend
(`oauth_server.py`).

---

## 1. What the MCP Server exposes

| Kind     | Name                       | Bridges to backend                 |
|----------|----------------------------|------------------------------------|
| Resource | `aiden://emails/recent`    | `GET  /emails?maxResults=10`       |
| Tool     | `list_emails`              | `GET  /emails?q=…&maxResults=…`    |
| Tool     | `send_email`               | `POST /send-email`                 |
| Prompt   | `compose_reply`            | (no backend call — pure template)  |

- **Resource** `aiden://emails/recent` — returns the 10 most recent inbox
  emails as a JSON string (id, subject, sender, snippet, date, read state).
- **Tool** `list_emails(query, max_results)` — Gmail-style search over the
  user's inbox. Defaults to `query="in:inbox"`, `max_results=10`.
- **Tool** `send_email(to, subject, body)` — sends a plain-text email through
  the user's authenticated Gmail account.
- **Prompt** `compose_reply(subject, sender, body, tone="professional")` —
  reusable parameterized prompt template that asks an LLM to draft a reply
  in the requested tone.

The server is built with the official Python MCP SDK
(`mcp.server.fastmcp.FastMCP`) and uses stdio transport so any MCP
client can spawn it as a subprocess.

---

## 2. Layout

```
aiden/
├── Instructions-HW3.md          ← this file
├── oauth_server.py              ← existing Aiden HTTP backend
└── mcp_aiden/
    ├── __init__.py
    ├── server.py                ← FastMCP server (1 resource, 2 tools, 1 prompt)
    ├── client.py                ← discovery + end-to-end tool-call demo client
    ├── requirements.txt
    └── Instructions-HW3.md      ← copy of this file
```

The package directory is named `mcp_aiden` (not `mcp`) in order to avoid clashing with
the installed `mcp` PyPI package.

---

## 3. Setup

Requires Python ≥ 3.10.

```bash
# from the Aiden project root
python3 -m pip install -r mcp_aiden/requirements.txt
```

`requirements.txt`:

```
mcp>=1.2.0
httpx>=0.27.0
```

---

## 4. Running the MCP Client (which auto-spawns the Server)

The client is the easiest way to demo the assignment. It launches the server
over stdio, performs full capability discovery, prints every resource / tool /
prompt with its name, description, and parameters, and then invokes one tool
end-to-end, printing both the request arguments and the server response.

```bash
# from the Aiden project root
python3 -m mcp_aiden.client
```

By default the client invokes `list_emails` with `{"query": "in:inbox",
"max_results": 5}`. Override either of those:

```bash
# pick a different tool
python3 -m mcp_aiden.client --tool send_email \
    --args '{"to":"alice@example.com","subject":"hi","body":"hello"}'

# different list_emails arguments
python3 -m mcp_aiden.client --tool list_emails \
    --args '{"query":"is:unread","max_results":3}'
```

### Expected output (abridged)

```
Aiden MCP Client - Capability Discovery
=======================================
Connected to MCP server: aiden-mcp (version …)
Protocol version: 2025-11-25

Resources
---------
  - aiden://emails/recent
      name:        recent_emails_resource
      title:       Recent inbox emails
      description: The 10 most recent emails …
      mimeType:    text/plain

Tools
-----
  - list_emails
      title:       List inbox emails
      description: Search the user's Gmail inbox via the Aiden backend …
      parameters:
        - query (string, optional, default='in:inbox')
        - max_results (integer, optional, default=10)
  - send_email
      title:       Send an email
      description: Send an email through the user's authenticated Gmail account …
      parameters:
        - to (string, required)
        - subject (string, required)
        - body (string, required)

Prompts
-------
  - compose_reply
      title:       Compose an email reply
      description: Build a prompt that asks an LLM to draft a reply …
      arguments:
        - subject (required)
        - sender (required)
        - body (required)
        - tone (optional)

Invoking tool: list_emails
==========================
Arguments sent to server: {"query": "in:inbox", "max_results": 5}

Server response
---------------
{ "ok": true, "query": "in:inbox", "count": 5, "emails": [ … ] }
```

---

## 5. Running the MCP Server standalone

You usually don't need to because the client spawns it for you. But it can also be
hosted directly so any other MCP client (Claude Desktop, mcp-inspector, etc.)
can connect:

```bash
python3 -m mcp_aiden.server
# or, equivalently:
python3 mcp_aiden/server.py
```

It speaks MCP over stdio.

### Wiring it into another MCP client

Example `mcpServers` config entry (e.g. for Claude Desktop):

```json
{
  "mcpServers": {
    "aiden": {
      "command": "python3",
      "args": ["-m", "mcp_aiden.server"],
      "cwd": "/absolute/path/to/aiden"
    }
  }
}
```

---

## 6. Backend dependency (the bridged API)

The two tools (`list_emails`, `send_email`) and the resource ultimately call
Aiden's existing HTTP backend at `http://localhost:8081`. To exercise them
end-to-end with real Gmail data:

1. Configure `.env` per the project README (`GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, etc.).
2. Start the backend:
   ```bash
   python3 oauth_server.py
   ```
3. Sign in once via the Aiden desktop app to populate the OAuth token cache.

Override the backend location with the `AIDEN_BACKEND_URL` environment
variable (defaults to `http://localhost:8081`).

If the backend is not running, the tools return a structured error
envelope like:

```json
{
  "ok": false,
  "error": "Aiden backend GET http://localhost:8081/emails failed: …",
  "hint": "Start the backend with `python3 oauth_server.py` …"
}
```

The MCP layer itself still works. Capability discovery and tool invocation
both succeed, the client prints the response correctly. The error envelope
is the response.

---

## 7. Configuration reference

| Env var               | Default                  | Purpose                              |
|-----------------------|--------------------------|--------------------------------------|
| `AIDEN_BACKEND_URL`   | `http://localhost:8081`  | Base URL of the Aiden HTTP backend.  |
| `AIDEN_HTTP_TIMEOUT`  | `30`                     | HTTP timeout (seconds) for backend calls. |

---

## 8. How this maps to the aspects in rubric

| Requirement                                                                   | Where it lives                                            |
|--------------------------------------------------------------------------------|-----------------------------------------------------------|
| MCP server exposing functionality of the team's backend API                   | `mcp_aiden/server.py` (calls `oauth_server.py` over HTTP) |
| At least one resource                                                          | `aiden://emails/recent`                                   |
| At least two tools                                                             | `list_emails`, `send_email`                               |
| One prompt (optional)                                                          | `compose_reply`                                           |
| MCP client connects to the server                                              | `mcp_aiden/client.py` via `stdio_client`                  |
| Client automatically discovers all capabilities                                | `list_resources` / `list_tools` / `list_prompts`          |
| Client prints each capability with name, description, parameters               | `_format_schema` + structured printing                    |
| Client demonstrates invoking ≥ 1 tool end-to-end with arguments and response   | `session.call_tool(...)` + `_truncate` printing           |
| Code is integrated with the rest of the project repo                           | Lives under `mcp_aiden/`; references existing backend     |
| Submission `Instructions-HW3.md` documents how to use server and client        | This file                                                 |