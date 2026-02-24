"""GenAI Inference Gateway — FastAPI application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import email_analysis, email_summary, reply, attachments, contacts, chat

app = FastAPI(title="Aiden GenAI Gateway", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(email_analysis.router)
app.include_router(email_summary.router)
app.include_router(reply.router)
app.include_router(attachments.router)
app.include_router(contacts.router)
app.include_router(chat.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "genai-gateway"}
