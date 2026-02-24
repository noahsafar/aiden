"""Contact classification endpoint."""

from fastapi import APIRouter, HTTPException

from app.models.requests import ClassifyContactsRequest
from app.models.responses import ContactClassifyResult
from app.services.claude_client import call_claude
from app.services.json_parser import extract_json
from app.services.prompt_templates import classify_contacts_prompt

router = APIRouter(prefix="/api/v1", tags=["contacts"])


@router.post("/classify-contacts", response_model=list[ContactClassifyResult])
async def classify_contacts(req: ClassifyContactsRequest):
    if not req.contacts:
        return []

    try:
        contacts_text = ""
        for i, c in enumerate(req.contacts):
            subjects = " | ".join(c.sample_subjects) if c.sample_subjects else "none"
            contacts_text += (
                f"{i + 1}. {c.name or 'Unknown'} ({c.email_address})\n"
                f"   Domain: {c.domain or 'unknown'}\n"
                f"   Emails received: {c.emails_received}, sent: {c.emails_sent}\n"
                f"   Sample subjects: {subjects}\n\n"
            )

        prompt = classify_contacts_prompt(contacts_text)
        raw = await call_claude(prompt)
        parsed = extract_json(raw)

        if isinstance(parsed, list):
            return [ContactClassifyResult(**item) for item in parsed]

        raise ValueError("Expected a JSON array from classification response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
