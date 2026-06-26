"""Analyze + classify email endpoints."""

from fastapi import APIRouter, HTTPException

from app.models.requests import AnalyzeEmailRequest, ClassifyEmailRequest
from app.models.responses import (
    AnalyzeEmailResponse,
    ClassifyEmailResponse,
    Question,
    MeetingRequest,
    AttachmentRequestItem,
    LifeDataItem,
)
from app.services.claude_client import call_claude, call_claude_json
from app.services.json_parser import extract_json
from app.services.prompt_templates import (
    ANALYZE_EMAIL_SYSTEM,
    analyze_email_prompt,
    classify_email_prompt,
)

router = APIRouter(prefix="/api/v1", tags=["email-analysis"])


@router.post("/analyze-email", response_model=AnalyzeEmailResponse)
async def analyze_email(req: AnalyzeEmailRequest):
    try:
        prompt = analyze_email_prompt(req.sender, req.subject, req.body_text, req.has_attachments)
        raw = await call_claude(prompt, system=ANALYZE_EMAIL_SYSTEM)
        parsed = extract_json(raw)

        questions = [Question(**q) for q in parsed.get("questions", [])]

        mr = parsed.get("meeting_request")
        meeting = None
        if mr and mr.get("is_meeting"):
            meeting = MeetingRequest(**mr)

        attachment_requests = [AttachmentRequestItem(**a) for a in parsed.get("attachment_requests", [])]
        life_data = [LifeDataItem(**ld) for ld in parsed.get("life_data", [])]

        return AnalyzeEmailResponse(
            questions=questions,
            suggested_formality_score=parsed.get("suggested_formality_score", 50),
            requires_reply=parsed.get("requires_reply", False),
            reply_reasoning=parsed.get("reply_reasoning", ""),
            meeting_request=meeting,
            missing_attachment_warning=parsed.get("missing_attachment_warning"),
            mentioned_document_types=parsed.get("mentioned_document_types", []),
            attachment_requests=attachment_requests,
            deadline=parsed.get("deadline"),
            sender_tone=parsed.get("sender_tone"),
            life_data=life_data,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


CLASSIFY_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": ["urgent", "important", "normal", "newsletter", "promotional", "transactional", "social"],
        },
        "confidence": {"type": "number"},
        "requires_reply": {"type": "boolean"},
        "can_auto_archive": {"type": "boolean"},
    },
    "required": ["category", "confidence", "requires_reply", "can_auto_archive"],
}


@router.post("/classify-email", response_model=ClassifyEmailResponse)
async def classify_email(req: ClassifyEmailRequest):
    try:
        prompt = classify_email_prompt(req.sender, req.subject, req.content)
        # Forced-JSON via tool-use (falls back to text+extract_json internally).
        parsed = await call_claude_json(
            prompt, tool_name="classify_email", tool_schema=CLASSIFY_TOOL_SCHEMA
        )
        # .get() with defaults — never KeyError on a missing field.
        return ClassifyEmailResponse(
            category=parsed.get("category", "normal"),
            confidence=float(parsed.get("confidence", 0.5)),
            requires_reply=bool(parsed.get("requires_reply", False)),
            can_auto_archive=bool(parsed.get("can_auto_archive", False)),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
