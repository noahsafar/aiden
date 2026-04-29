"""
GenAI Approach Registry for Email Reply Generation
===================================================

Defines n>=3 distinct "approaches" (chains) for the same GenAI feature:
generating an email reply. Each approach varies along one or more axes:

  - underlying model
  - generation parameters (temperature, max_tokens)
  - prompting strategy (few-shot, zero-shot, chain-of-thought)

The dispatcher exposes a single ``generate(approach_id, context)`` entrypoint
that returns ``(text, error, approach_id_used)``. When the caller doesn't
specify an approach, the registered ``DEFAULT_APPROACH`` is used. When the
caller asks for a comparison (two responses), ``pick_random_pair`` selects
two distinct approaches.

This module is deliberately decoupled from oauth_server so the same registry
can be reused by any other endpoint (summarization, edit-reply, etc.) in
the future.
"""

import random


# ---------------------------------------------------------------------------
# Approach definitions
# ---------------------------------------------------------------------------

DEFAULT_APPROACH = "few_shot"


def _build_few_shot_prompt(context):
    """Approach A: recipient-specific few-shot examples + strict formatting.

    This is the original prompting strategy used by the app. Uses past emails
    sent by the user to the same recipient as in-context examples so the
    model can match the user's voice/style with that specific person.
    """
    user_name = context.get("user_name") or ""
    sender = context.get("sender", "")
    subject = context.get("subject", "")
    body_text = context.get("body_text", "") or ""
    recipient_first_name = context.get("recipient_first_name", "")
    recipient_emails = context.get("recipient_emails", []) or []
    user_answers_context = context.get("user_answers_context", "")
    additional_context_section = context.get("additional_context_section", "")
    sender_tone_section = context.get("sender_tone_section", "")
    style_instruction = context.get("style_instruction", "")
    user_answers = context.get("user_answers", [])
    additional_context = context.get("additional_context", "")

    examples = "\n\n---\n\n".join(recipient_emails[:4]) if recipient_emails else "(no past examples available)"

    return f"""You are {user_name} writing an email reply. STUDY the examples below which are YOUR past emails to THIS SAME PERSON.

CRITICAL: You are {user_name}. The email is FROM them, TO you. Sign with YOUR name ({user_name}), NOT theirs.

INCOMING EMAIL:
{sender} wrote: {subject}

{body_text[:1500]}
{user_answers_context}{additional_context_section}{sender_tone_section}
YOUR PAST EMAILS TO THIS PERSON (your writing style - study tone and format):
{examples}

CRITICAL RULES:
1. {"USE the user's choices above and state them clearly." if user_answers else "If the email asks you to make a choice, do not decide - ask for clarification."}
2. You are {user_name} - sign the email with YOUR NAME.
3. {style_instruction}
4. Match the writing style from your past emails.
5. {f'Address them as "{recipient_first_name}"' if recipient_first_name else 'Use the same salutation style.'}
6. NEVER use placeholders like [Your Name], [Your Position], etc.
7. Keep it under 100 words.
8. Output ONLY the email body - no subject line, no preamble.
9. {"Follow the ADDITIONAL CONTEXT/INSTRUCTIONS provided above." if additional_context else ""}

Now write the reply as {user_name}:"""


def _build_zero_shot_prompt(context):
    """Approach B: zero-shot, no examples, low temperature.

    Strips all few-shot context and personalization. Tests how well a
    smaller, more generic prompt performs - both as a quality baseline and
    as a faster path when no recipient history is available.
    """
    user_name = context.get("user_name") or ""
    sender = context.get("sender", "")
    subject = context.get("subject", "")
    body_text = context.get("body_text", "") or ""
    user_answers_context = context.get("user_answers_context", "")
    additional_context_section = context.get("additional_context_section", "")
    sender_tone_section = context.get("sender_tone_section", "")
    user_answers = context.get("user_answers", [])

    sign_off_line = f'Sign off with "{user_name}".' if user_name else ""

    return f"""Generate a short, professional reply to this email.

Email from {sender}:
Subject: {subject}

{body_text[:1000]}
{user_answers_context}{additional_context_section}{sender_tone_section}

{"Use the user's choices above when phrasing the reply." if user_answers else "Do not invent decisions on the user's behalf."}

Write a concise reply (under 100 words). Be professional and helpful.
Start with a salutation. {sign_off_line} Do not include a subject line - just the email body."""


def _build_chain_of_thought_prompt(context):
    """Approach C: chain-of-thought reasoning before the reply.

    Asks the model to think step-by-step inside a ``<thinking>`` block
    (purpose of email, key questions, tone, requested actions) and then
    output the reply inside a ``<reply>`` block. Output is parsed by
    ``_extract_reply_block``.
    """
    user_name = context.get("user_name") or ""
    sender = context.get("sender", "")
    subject = context.get("subject", "")
    body_text = context.get("body_text", "") or ""
    user_answers_context = context.get("user_answers_context", "")
    additional_context_section = context.get("additional_context_section", "")
    sender_tone_section = context.get("sender_tone_section", "")

    sign_line = f"Sign as {user_name}." if user_name else "Sign appropriately."

    return f"""You are an email assistant. Reason step-by-step about the email below, THEN write the reply.

EMAIL FROM {sender}:
Subject: {subject}

{body_text[:1500]}
{user_answers_context}{additional_context_section}{sender_tone_section}

First, in a <thinking> block, analyze:
1. The sender's main purpose / what they are asking
2. Key points, questions, or decisions raised
3. Appropriate tone and level of formality
4. What information the reply must include

Then, in a <reply> block, write the email reply.

CONSTRAINTS for the reply:
- Under 100 words.
- Start with a salutation, end with a sign-off.
- {sign_line}
- No subject line, no placeholders like [Your Name].
- Output ONLY the email body inside the <reply> block.

Now produce both blocks:"""


def _extract_reply_block(raw_text):
    """Pull the contents of <reply>...</reply> from a CoT response.

    Falls back to stripping the leading <thinking>...</thinking> block if
    the model omitted explicit <reply> tags.
    """
    if not raw_text:
        return raw_text
    import re
    m = re.search(r"<reply>\s*(.*?)\s*</reply>", raw_text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fallback: drop the <thinking>...</thinking> prefix if present
    stripped = re.sub(r"<thinking>.*?</thinking>", "", raw_text, flags=re.DOTALL | re.IGNORECASE).strip()
    return stripped or raw_text.strip()


# Each approach is a small spec the dispatcher uses to assemble the call.
APPROACHES = {
    "few_shot": {
        "label": "Claude Sonnet (few-shot, recipient examples)",
        "description": "Few-shot prompt with up to 4 of the user's past emails to the same recipient. Temp=0.7.",
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.7,
        "max_tokens": 300,
        "build_prompt": _build_few_shot_prompt,
        "post_process": None,
    },
    "zero_shot": {
        "label": "Claude Sonnet (zero-shot, concise)",
        "description": "No examples, lower temperature for more deterministic output. Temp=0.3.",
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.3,
        "max_tokens": 300,
        "build_prompt": _build_zero_shot_prompt,
        "post_process": None,
    },
    "chain_of_thought": {
        "label": "Claude Sonnet (chain-of-thought)",
        "description": "Model reasons in a <thinking> block then writes a <reply>. Temp=0.5.",
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.5,
        "max_tokens": 600,
        "build_prompt": _build_chain_of_thought_prompt,
        "post_process": _extract_reply_block,
    },
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_approaches():
    """Return a JSON-serializable list of registered approaches."""
    return [
        {"id": aid, "label": spec["label"], "description": spec["description"],
         "model": spec["model"], "temperature": spec["temperature"]}
        for aid, spec in APPROACHES.items()
    ]


def get_approach_ids():
    return list(APPROACHES.keys())


def pick_random_pair(seed=None):
    """Pick two distinct approach IDs at random for comparison mode."""
    rng = random.Random(seed)
    ids = list(APPROACHES.keys())
    if len(ids) < 2:
        raise RuntimeError("Need at least 2 approaches to compare")
    a, b = rng.sample(ids, 2)
    return a, b


def generate(approach_id, context, call_anthropic):
    """Run the named approach against the supplied context.

    Parameters
    ----------
    approach_id : str | None
        Which approach to use. If None or unknown, ``DEFAULT_APPROACH`` is
        selected (per milestone: "If an approach is not specified, the
        backend service should choose one of the approaches.").
    context : dict
        Context for prompt building (sender, subject, body_text, user_name,
        etc.). The same dict is used by every approach; each one extracts
        the keys it cares about.
    call_anthropic : callable(messages, max_tokens, temperature, timeout) -> (text, error)
        Injected so this module stays free of HTTP/oauth_server coupling.

    Returns
    -------
    (text, error, approach_id_used)
    """
    if not approach_id or approach_id not in APPROACHES:
        approach_id = DEFAULT_APPROACH

    spec = APPROACHES[approach_id]
    prompt = spec["build_prompt"](context)
    messages = [{"role": "user", "content": prompt}]

    text, error = call_anthropic(
        messages,
        max_tokens=spec["max_tokens"],
        temperature=spec["temperature"],
        timeout=30,
    )

    if text and spec.get("post_process"):
        text = spec["post_process"](text)

    return text, error, approach_id
