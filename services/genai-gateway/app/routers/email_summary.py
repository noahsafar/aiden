"""Summarize email endpoint."""

from fastapi import APIRouter, HTTPException

from app.models.requests import SummarizeEmailRequest
from app.models.responses import SummarizeEmailResponse
from app.services.claude_client import call_claude
from app.services.json_parser import extract_json
from app.services.prompt_templates import summarize_email_prompt

router = APIRouter(prefix="/api/v1", tags=["email-summary"])


@router.post("/summarize-email", response_model=SummarizeEmailResponse)
async def summarize_email(req: SummarizeEmailRequest):
    try:
        prompt = summarize_email_prompt(req.email_content, req.style_context or "")
        raw = await call_claude(prompt)
        parsed = extract_json(raw)
        return SummarizeEmailResponse(
            summary=parsed.get("summary", ""),
            key_points=parsed.get("key_points", []),
            action_items=parsed.get("action_items", []),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
