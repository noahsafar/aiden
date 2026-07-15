"""Pydantic response models — mirroring the Rust structs in ai.rs."""

from pydantic import BaseModel, Field, AliasChoices


class Question(BaseModel):
    type: str
    question: str
    options: list[str] | None = None


class AttachmentRequestItem(BaseModel):
    keyword: str
    file_type: str | None = None
    description: str


class LifeDataItem(BaseModel):
    # The model often emits "type" instead of the canonical "data_type"; accept
    # both, default the required fields, and ignore extras so a single malformed
    # life-intel item can never crash the whole email analysis.
    data_type: str = Field(default="other", validation_alias=AliasChoices("data_type", "type"))
    title: str = ""
    amount: float | None = None
    currency: str | None = None
    date: str | None = None
    end_date: str | None = None
    frequency: str | None = None
    details: str | None = None
    tracking_number: str | None = None
    carrier: str | None = None

    model_config = {"populate_by_name": True, "extra": "ignore"}


class MeetingRequest(BaseModel):
    is_meeting: bool
    proposed_times: list[str] = []
    duration_minutes: int = 60
    subject: str = ""
    event_type: str = "meeting"
    location: str | None = None


class AnalyzeEmailResponse(BaseModel):
    questions: list[Question] = []
    suggested_formality_score: int = 50
    requires_reply: bool = False
    reply_reasoning: str = ""
    meeting_request: MeetingRequest | None = None
    missing_attachment_warning: str | None = None
    mentioned_document_types: list[str] = []
    attachment_requests: list[AttachmentRequestItem] = []
    deadline: str | None = None
    sender_tone: str | None = None
    life_data: list[LifeDataItem] = []


class ClassifyEmailResponse(BaseModel):
    category: str
    confidence: float
    requires_reply: bool
    can_auto_archive: bool


class SummarizeEmailResponse(BaseModel):
    summary: str
    key_points: list[str] = []
    action_items: list[str] = []


class GenerateReplyResponse(BaseModel):
    reply: str
    subject: str


class AnalyzedAttachment(BaseModel):
    summary: str
    key_points: list[str] = []
    action_items: list[str] = []


class ContactClassifyResult(BaseModel):
    email_address: str
    category: str


class ChatResponse(BaseModel):
    response: str
