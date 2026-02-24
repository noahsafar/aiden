"""Attachment analysis / summarization endpoints."""

import base64

from fastapi import APIRouter, HTTPException

from app.models.requests import AnalyzeAttachmentRequest, SummarizeAttachmentRequest
from app.models.responses import AnalyzedAttachment
from app.services.claude_client import call_claude, call_claude_vision
from app.services.json_parser import extract_json
from app.services.prompt_templates import (
    ATTACHMENT_SYSTEM,
    analyze_attachment_image_prompt,
    analyze_attachment_text_prompt,
    summarize_attachment_prompt,
)

router = APIRouter(prefix="/api/v1", tags=["attachments"])


@router.post("/analyze-attachment", response_model=AnalyzedAttachment)
async def analyze_attachment(req: AnalyzeAttachmentRequest):
    try:
        # Build email context
        email_context = ""
        if req.email_summary:
            email_context = (
                f"\nEmail Context:\nSubject: {req.email_subject or 'N/A'}\n"
                f"From: {req.email_sender or 'N/A'}\nEmail Summary: {req.email_summary}"
            )
        elif req.email_subject or req.email_sender:
            email_context = (
                f"\nEmail Context:\nSubject: {req.email_subject or 'N/A'}\n"
                f"From: {req.email_sender or 'N/A'}"
            )

        is_image = req.mime_type.startswith("image/")

        if is_image:
            prompt = analyze_attachment_image_prompt(req.filename, req.mime_type, email_context)
            raw = await call_claude_vision(
                prompt, req.attachment_data, req.mime_type, system=ATTACHMENT_SYSTEM
            )
        else:
            # Decode and extract text
            decoded = base64.b64decode(req.attachment_data)
            text_content = decoded.decode("utf-8", errors="ignore")
            truncated = text_content[:12000]
            prompt = analyze_attachment_text_prompt(
                req.filename, req.mime_type, truncated, email_context
            )
            raw = await call_claude(prompt, system=ATTACHMENT_SYSTEM)

        parsed = extract_json(raw)
        return AnalyzedAttachment(
            summary=parsed.get("summary", ""),
            key_points=parsed.get("key_points", []),
            action_items=parsed.get("action_items", []),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/summarize-attachment")
async def summarize_attachment(req: SummarizeAttachmentRequest):
    try:
        decoded = base64.b64decode(req.data)
        text_content = decoded.decode("utf-8", errors="ignore")
        if len(text_content.strip()) < 10:
            raise HTTPException(status_code=400, detail="Could not extract meaningful text")

        text_for_summary = text_content[:8000]
        prompt = summarize_attachment_prompt(req.filename, text_for_summary)
        summary = await call_claude(prompt, max_tokens=300)
        return {
            "success": True,
            "summary": summary,
            "extracted_text_length": len(text_content),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
