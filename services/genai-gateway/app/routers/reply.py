"""Generate + edit reply endpoints."""

import re

from fastapi import APIRouter, HTTPException

from app.models.requests import GenerateReplyRequest, EditReplyRequest
from app.models.responses import GenerateReplyResponse
from app.services.claude_client import call_claude
from app.services.json_parser import extract_json
from app.services.prompt_templates import (
    generate_reply_system,
    generate_reply_prompt,
    edit_reply_prompt,
)

router = APIRouter(prefix="/api/v1", tags=["reply"])


def _normalize_reply_subject(subject: str | None, original: str) -> str:
    """Collapse stacked Re:/Fwd:/Aw: prefixes into a single 'Re: ' prefix."""
    s = (subject or "").strip() or (original or "").strip()
    s = re.sub(r"^\s*(?:(?:re|fwd|fw|aw|wg):\s*)+", "", s, flags=re.IGNORECASE).strip()
    return f"Re: {s}" if s else "Re:"


@router.post("/generate-reply", response_model=GenerateReplyResponse)
async def generate_reply(req: GenerateReplyRequest):
    try:
        system = generate_reply_system(
            req.sender,
            req.learned_writing_style.model_dump() if req.learned_writing_style else None,
        )

        answers = [a.model_dump() for a in req.user_answers]
        ctx = req.conversation_context.model_dump() if req.conversation_context else None

        prompt = generate_reply_prompt(
            sender=req.sender,
            subject=req.subject,
            body_text=req.body_text,
            user_answers=answers,
            formality_level=req.formality_level,
            additional_context=req.additional_context or "",
            selected_meeting_time=req.selected_meeting_time or "",
            sender_tone=req.sender_tone or "",
            conversation_context=ctx,
            user_name=req.user_name or "",
        )

        raw = await call_claude(prompt, system=system)
        parsed = extract_json(raw)

        return GenerateReplyResponse(
            reply=parsed.get("reply", raw),
            subject=_normalize_reply_subject(parsed.get("subject"), req.subject),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edit-reply")
async def edit_reply(req: EditReplyRequest):
    try:
        prompt = edit_reply_prompt(req.current_reply, req.edit_prompt)
        edited = await call_claude(prompt)
        return {"edited_reply": edited}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
