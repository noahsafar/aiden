"""GenAI Inference Gateway — FastAPI application."""

import logging

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ALLOW_ORIGINS, GATEWAY_API_KEY
from app.routers import email_analysis, email_summary, reply, attachments, contacts, chat

logger = logging.getLogger(__name__)


async def require_api_key(x_api_key: str | None = Header(default=None)):
    """Require X-API-Key on protected routes — enforced only when GATEWAY_API_KEY is
    set. Unset = open (local dev); a loud warning is logged at startup in that case."""
    if not GATEWAY_API_KEY:
        return
    if x_api_key != GATEWAY_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


app = FastAPI(title="Aiden GenAI Gateway", version="1.0.0")

if not GATEWAY_API_KEY:
    logger.warning(
        "GATEWAY_API_KEY is not set — the GenAI gateway is UNAUTHENTICATED. Anyone who "
        "can reach it can run prompts billed to your Anthropic key. Set GATEWAY_API_KEY "
        "(and the frontend's VITE_GENAI_API_KEY) in any non-local deployment."
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers — all /api/v1 routes require the API key (when one is configured)
_auth = [Depends(require_api_key)]
app.include_router(email_analysis.router, dependencies=_auth)
app.include_router(email_summary.router, dependencies=_auth)
app.include_router(reply.router, dependencies=_auth)
app.include_router(attachments.router, dependencies=_auth)
app.include_router(contacts.router, dependencies=_auth)
app.include_router(chat.router, dependencies=_auth)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "genai-gateway"}
