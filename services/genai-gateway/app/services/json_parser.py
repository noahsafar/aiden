"""JSON extraction from LLM responses — ported from ai.rs extract_json_from_response."""

import json


def extract_json(response: str) -> dict | list:
    """Extract and parse JSON from an LLM response that may contain markdown fences or extra text."""
    # Try parsing as-is
    try:
        return json.loads(response)
    except json.JSONDecodeError:
        pass

    # Look for ```json ... ```
    marker = "```json"
    start = response.find(marker)
    if start != -1:
        json_start = start + len(marker)
        end = response.find("```", json_start)
        if end != -1:
            candidate = response[json_start:end].strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

    # Look for ``` ... ```
    marker2 = "```"
    start = response.find(marker2)
    if start != -1:
        json_start = start + len(marker2)
        end = response.find("```", json_start)
        if end != -1:
            candidate = response[json_start:end].strip()
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

    # Try to find { ... } or [ ... ] boundaries
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        start = response.find(open_ch)
        end = response.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            candidate = response[start : end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

    raise ValueError(f"Could not extract valid JSON from response: {response[:200]}")
