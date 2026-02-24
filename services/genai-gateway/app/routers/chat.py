"""Chat and raw completion endpoints."""

from fastapi import APIRouter, HTTPException

from app.models.requests import ChatRequest, CompletionRequest
from app.models.responses import ChatResponse
from app.services.claude_client import call_claude
from app.services.prompt_templates import CHAT_SYSTEM, chat_prompt

router = APIRouter(prefix="/api/v1", tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    try:
        prompt = chat_prompt(req.message, req.context or "")
        response = await call_claude(prompt, system=CHAT_SYSTEM, max_tokens=1000)
        return ChatResponse(response=response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/completion", response_model=ChatResponse)
async def completion(req: CompletionRequest):
    """Raw LLM passthrough — no injected system prompt, caller controls max_tokens.
    Used by the email-calendar service to proxy its existing LLM calls."""
    try:
        response = await call_claude(
            req.prompt, system=req.system, max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
        return ChatResponse(response=response)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
