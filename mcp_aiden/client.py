"""
Aiden MCP Client
================

A minimal MCP client that:

  1. Spawns the Aiden MCP server (``mcp_aiden/server.py``) over stdio.
  2. Discovers all advertised resources, tools, and prompts.
  3. Prints each capability with its name, description, and parameters.
  4. Demonstrates an end-to-end tool invocation, printing both the request
     arguments and the server response.

Run from the project root:

    python -m mcp_aiden.client                           # default: list_emails
    python -m mcp_aiden.client --tool send_email \
        --args '{"to":"a@b.com","subject":"hi","body":"hello"}'

Notes:
  * Tools that require an authenticated Aiden backend (e.g. ``list_emails``)
    will return an error envelope if ``oauth_server.py`` isn't running or the
    user hasn't signed in. The client still prints whatever the server returns,
    which fulfills the "demonstrate end-to-end" requirement.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


HERE = Path(__file__).resolve().parent
SERVER_SCRIPT = HERE / "server.py"


def _format_schema(schema: dict[str, Any] | None) -> str:
    """Render a JSON-schema-like dict as a compact, readable parameter list."""
    if not schema or not isinstance(schema, dict):
        return "    (no parameters)"
    properties = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    if not properties:
        return "        (no parameters)"
    lines = []
    for param_name, param_schema in properties.items():
        type_label = param_schema.get("type", "any")
        default = param_schema.get("default", None)
        description = param_schema.get("description", "").strip()
        marker = "required" if param_name in required else "optional"
        default_part = f", default={default!r}" if default is not None else ""
        head = f"        - {param_name} ({type_label}, {marker}{default_part})"
        if description:
            head += f": {description}"
        lines.append(head)
    return "\n".join(lines)


def _print_header(title: str) -> None:
    print()
    print(title)
    print("=" * len(title))


def _print_block(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def _truncate(text: str, limit: int = 1200) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [truncated, {len(text) - limit} more chars]"


async def run_demo(invoke_tool: str, invoke_args: dict[str, Any]) -> int:
    """Connect, discover, print capabilities, and invoke one tool end-to-end."""
    server_params = StdioServerParameters(
        command=sys.executable,
        args=[str(SERVER_SCRIPT)],
        env=None,
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init_result = await session.initialize()

            _print_header("Aiden MCP Client - Capability Discovery")
            server_info = getattr(init_result, "serverInfo", None)
            if server_info is not None:
                name = getattr(server_info, "name", "?")
                version = getattr(server_info, "version", "?")
                print(f"Connected to MCP server: {name} (version {version})")
            print(f"Protocol version: {getattr(init_result, 'protocolVersion', '?')}")

            # Resources
            _print_block("Resources")
            try:
                resources = (await session.list_resources()).resources
            except Exception as exc:
                resources = []
                print(f"  (server does not advertise resources: {exc})")
            if not resources:
                print("  (none)")
            for r in resources:
                print(f"  - {r.uri}")
                if r.name:
                    print(f"      name:        {r.name}")
                if r.title:
                    print(f"      title:       {r.title}")
                if r.description:
                    print(f"      description: {r.description.strip()}")
                if r.mimeType:
                    print(f"      mimeType:    {r.mimeType}")

            # Tools
            _print_block("Tools")
            tools = (await session.list_tools()).tools
            if not tools:
                print("  (none)")
            for t in tools:
                print(f"  - {t.name}")
                if t.title:
                    print(f"      title:       {t.title}")
                if t.description:
                    indented = "\n        ".join(t.description.strip().splitlines())
                    print(f"      description: {indented}")
                print("      parameters:")
                print(_format_schema(t.inputSchema))

            # Prompts
            _print_block("Prompts")
            try:
                prompts = (await session.list_prompts()).prompts
            except Exception as exc:
                prompts = []
                print(f"  (server does not advertise prompts: {exc})")
            if not prompts:
                print("  (none)")
            for p in prompts:
                print(f"  - {p.name}")
                if p.title:
                    print(f"      title:       {p.title}")
                if p.description:
                    print(f"      description: {p.description.strip()}")
                args = getattr(p, "arguments", None) or []
                if args:
                    print("      arguments:")
                    for arg in args:
                        marker = "required" if getattr(arg, "required", False) else "optional"
                        desc = (getattr(arg, "description", "") or "").strip()
                        line = f"        - {arg.name} ({marker})"
                        if desc:
                            line += f": {desc}"
                        print(line)

            # Demonstrate one tool invocation
            _print_header(f"Invoking tool: {invoke_tool}")
            print(f"Arguments sent to server:")
            print(json.dumps(invoke_args, indent=2))

            tool_names = {t.name for t in tools}
            if invoke_tool not in tool_names:
                print()
                print(
                    f"Tool {invoke_tool!r} is not exposed by the server. "
                    f"Available: {sorted(tool_names)}"
                )
                return 2

            result = await session.call_tool(invoke_tool, invoke_args)

            _print_block("Server response")
            if result.isError:
                print("(server returned an error envelope)")

            content_pieces = []
            for c in result.content:
                text = getattr(c, "text", None)
                if text is not None:
                    content_pieces.append(text)
                else:
                    content_pieces.append(repr(c))
            joined = "\n".join(content_pieces) if content_pieces else "(empty)"
            print(_truncate(joined))

            structured = getattr(result, "structuredContent", None)
            if structured:
                _print_block("Structured content")
                print(_truncate(json.dumps(structured, indent=2)))

    return 0


def _parse_cli(argv: list[str]) -> tuple[str, dict[str, Any]]:
    parser = argparse.ArgumentParser(description="Aiden MCP demo client")
    parser.add_argument(
        "--tool",
        default="list_emails",
        help="Tool name to invoke for the end-to-end demo (default: list_emails).",
    )
    parser.add_argument(
        "--args",
        default=None,
        help=(
            "JSON object of arguments to pass to the chosen tool. "
            'Example: \'{"query":"is:unread","max_results":5}\''
        ),
    )
    parsed = parser.parse_args(argv)

    if parsed.args is None:
        # Sensible defaults per known tool so a bare `python -m mcp_aiden.client` produces something interesting end-to-end
        defaults: dict[str, dict[str, Any]] = {
            "list_emails": {"query": "in:inbox", "max_results": 5},
            "send_email": {
                "to": "you@example.com",
                "subject": "Aiden MCP demo",
                "body": "This is a demo send_email call from the MCP client.",
            },
        }
        args = defaults.get(parsed.tool, {})
    else:
        try:
            args = json.loads(parsed.args)
        except json.JSONDecodeError as exc:
            parser.error(f"--args must be valid JSON: {exc}")
        if not isinstance(args, dict):
            parser.error("--args must decode to a JSON object")

    return parsed.tool, args


def main() -> None:
    tool, args = _parse_cli(sys.argv[1:])
    sys.exit(asyncio.run(run_demo(tool, args)))


if __name__ == "__main__":
    main()
