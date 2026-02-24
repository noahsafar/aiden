"""Pydantic request models — mirroring the Rust structs in ai.rs."""

from pydantic import BaseModel


class AnalyzeEmailRequest(BaseModel):
    sender: str
    subject: str
    body_text: str
    has_attachments: bool = False


class ClassifyEmailRequest(BaseModel):
    sender: str
    subject: str
    content: str


class SummarizeEmailRequest(BaseModel):
    email_content: str
    style_context: str | None = None


class UserAnswer(BaseModel):
    question: str
    answer: str


class ConversationEmail(BaseModel):
    subject: str
    sender: str
    body: str
    date: str
    is_from_user: bool


class ConversationContext(BaseModel):
    recipient_email: str
    previous_emails: list[ConversationEmail] = []
    total_conversation_count: int = 0


class RecipientWritingStyle(BaseModel):
    recipient_email: str
    tone_description: str
    formality_score: int = 50
    common_phrases: list[str] = []
    greeting_style: str = ""
    sign_off_style: str = ""
    sample_count: int = 0
    last_updated: str = ""


class GenerateReplyRequest(BaseModel):
    sender: str
    subject: str
    body_text: str
    user_answers: list[UserAnswer] = []
    formality_level: str = "neutral"
    additional_context: str | None = None
    selected_meeting_time: str | None = None
    conversation_context: ConversationContext | None = None
    learned_writing_style: RecipientWritingStyle | None = None
    sender_tone: str | None = None
    user_name: str | None = None


class EditReplyRequest(BaseModel):
    current_reply: str
    edit_prompt: str


class AnalyzeAttachmentRequest(BaseModel):
    filename: str
    attachment_data: str  # base64 encoded
    mime_type: str
    email_subject: str | None = None
    email_sender: str | None = None
    email_body: str | None = None
    email_summary: str | None = None


class SummarizeAttachmentRequest(BaseModel):
    filename: str
    data: str  # base64 encoded
    mime_type: str


class ContactClassifyInput(BaseModel):
    email_address: str
    name: str | None = None
    domain: str | None = None
    emails_received: int = 0
    emails_sent: int = 0
    sample_subjects: list[str] = []


class ClassifyContactsRequest(BaseModel):
    contacts: list[ContactClassifyInput]


class ChatRequest(BaseModel):
    message: str
    context: str | None = None


class CompletionRequest(BaseModel):
    """Raw LLM completion — used by the email-calendar service proxy."""
    prompt: str
    system: str | None = None
    max_tokens: int = 4000
    temperature: float | None = None
