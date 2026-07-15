"""All prompt templates ported from ai.rs and oauth_server.py."""

# ── Analyze email ──────────────────────────────────────────────

ANALYZE_EMAIL_SYSTEM = (
    "You are Aiden, an intelligent email assistant. Your job is to analyze emails and extract:\n"
    "1. Questions the sender needs answers to\n"
    "2. Whether a reply is needed and why\n"
    "3. The appropriate tone (formality 0-100)\n"
    "4. Whether this is a meeting request\n"
    "5. Any missing attachments mentioned\n"
    "6. What attachments the sender is requesting (keywords and file types)\n\n"
    "Always respond with valid JSON only."
)


def analyze_email_prompt(sender: str, subject: str, body_text: str, has_attachments: bool) -> str:
    from datetime import date
    today = date.today().isoformat()
    return f"""Analyze this email and respond with ONLY valid JSON (no markdown, no explanation):

Today's date: {today}
Sender: {sender}
Subject: {subject}
Body: {body_text}
Has Attachments: {has_attachments}

Respond in this exact JSON format:
{{
  "questions": [
    {{"type": "choice", "question": "What's your preference?", "options": ["Option A", "Option B", "Option C"]}},
    {{"type": "text", "question": "What specific information do you need?"}}
  ],
  "suggested_formality_score": 50,
  "requires_reply": true,
  "reply_reasoning": "Brief explanation of why reply is needed",
  "meeting_request": {{
    "is_meeting": false,
    "event_type": "meeting",
    "proposed_times": [],
    "duration_minutes": 60,
    "subject": "Meeting/event subject extracted from email",
    "location": null
  }},
  "missing_attachment_warning": null,
  "mentioned_document_types": [],
  "attachment_requests": [
    {{"keyword": "resume", "file_type": "pdf", "description": "They want your resume"}},
    {{"keyword": "transcript", "file_type": null, "description": "They're asking for your transcript"}}
  ],
  "deadline": null,
  "sender_tone": "neutral",
  "life_data": [
    {{"data_type": "subscription", "title": "Annual Membership", "amount": 50, "currency": "USD", "frequency": "yearly", "details": "Renews Friday at midnight"}},
    {{"data_type": "travel", "title": "Mom visiting", "date": "2026-08-12", "end_date": "2026-08-19", "details": "Delta flight DL 482"}}
  ]
}}

Guidelines:
- Questions: Extract actual questions or decisions needed from the email
- Type: "choice" for questions with clear options (like "yes/no"), "text" for open-ended
- If requires_reply is true, include at least one question (e.g. a yes/no confirmation or "preferred time?"). An empty questions array on a reply-needed email is almost always wrong.
- Formality: 0=very casual, 50=neutral, 100=very formal
- Meeting/Event: Set is_meeting=true if there's a meeting OR an event the user could attend.
  * event_type: "meeting" if someone wants to schedule a 1-on-1 or group meeting. "event" if it's a talk, seminar, workshop, webinar, lecture, presentation, panel, networking event, office hours, or any scheduled event the user is invited to attend.
  * proposed_times: For meetings, extract proposed times like "Tuesday at 2pm". For events, extract the event datetime in ISO format (e.g. "2026-02-27T11:30:00"). ALWAYS include the year based on context (use the current year if not specified).
  * duration_minutes: Best guess (60 default for meetings, 90 for talks/seminars, adjust based on context).
  * subject: The event/meeting name.
  * location: Extract venue/room/link if mentioned, null otherwise.
  IMPORTANT: Events are NOT deadlines.
  Set is_meeting=false for CANCELLED events (even if a new time is proposed — that's a negotiation, not a meeting), travel/flight check-ins, holidays, and meetings only referenced in passing ("as we discussed at the meeting"). Only set is_meeting=true if there is a CONFIRMED upcoming time the user should attend.
- Missing attachment: Warn if they mention "attached file" but no attachments exist
- Document types: List mentioned file types (resume, PDF, etc.)
- Attachment requests: Extract files/documents they're asking for.
- Sender tone: Detect the emotional tone. Use one word like "friendly", "neutral", "frustrated", "angry", etc.
- Deadline: Extract a deadline ONLY if the USER personally must complete an action BY that date or suffer a real-world consequence (missed filing, late penalty, lost deliverable). Use ISO format (YYYY-MM-DD). null if none.
  NOT a deadline (return null): a marketing/sale end-date, early-bird or discount expiry, conference registration cutoff, a cancellation window on an already-confirmed booking, an autopay/scheduled-payment date, or a phishing/scam ultimatum ("verify in 24h", "account suspended", "final notice").
  Do NOT extract deadlines that have already passed, unless the email explicitly provides a new/extended deadline.
  Ignore "respond within X business days" or similar boilerplate in email signatures/footers.
- Life data: Extract structured life-intelligence items. Each item MUST include a "data_type" field (one of: subscription, bill, travel, package, order, appointment, deadline, financial, insurance, family, move, career) and a short "title"; add relevant optional fields (amount, currency, date, end_date, frequency, details, tracking_number, carrier) only if present in the email. Only extract items the USER is personally committed to or receiving — a real bill/subscription/policy/trip/package/appointment IN THEIR NAME. Do NOT extract: events you're merely invited to (use meeting_request instead), marketing mentions of a product, casual references to a concept, third-party birthdays, or "deadline" as a synonym for a deploy/ship time. For major personal events (engagement, wedding, birth, divorce) use data_type "family"; a major move involving family -> emit both "move" and "family". When unsure, return [].

IMPORTANT - Set requires_reply to FALSE for:
- Newsletters, marketing emails, notifications, or automated emails
- Emails that are purely informational with no questions asked
- Receipts, confirmations, order updates, or shipping notifications
- CC'd emails, GitHub/Jira/Slack notifications, promotional emails
- When in doubt, default to FALSE

Set requires_reply to TRUE ONLY for:
- A real person directly asking the user a question
- Meeting requests that need a yes/no
- Explicit requests for input, approval, deliverables, or action"""


# ── Classify email ─────────────────────────────────────────────

def classify_email_prompt(sender: str, subject: str, content: str) -> str:
    from datetime import date
    today = date.today().isoformat()
    return f"""Classify this email. Be CONSERVATIVE about urgency — most real person-to-person mail is "normal"; most bulk mail falls into a specific non-priority class below.

Today's date: {today}
From: {sender}
Subject: {subject}
Content: {content}

Pick EXACTLY ONE category:
- "urgent" — needs the user's personal action within ~24-48h (real deadline, blocker, time-sensitive ask from a real person). A hard external deadline with real consequences (legal default, missed filing / loss of work authorization, late penalty) is "urgent" even if the date is weeks away.
- "important" — needs the user's personal action or decision, but not immediately. A social RSVP is "important" at most, never "urgent".
- "normal" — regular person-to-person mail that may or may not need a reply. Default for real humans when unsure.
- "newsletter" — bulk editorial/marketing list mail (digests, announcements; usually has "view in browser"/"unsubscribe" footers).
- "promotional" — sales/marketing pushing an offer, discount, or product.
- "transactional" — automated receipts, order/shipping updates, confirmations, security codes, calendar notifications.
- "social" — social-network/community notifications, event RSVPs, likes/mentions.

Respond in JSON:
{{"category": "...", "confidence": 0.0-1.0, "requires_reply": true|false, "can_auto_archive": true|false}}

Rules:
- requires_reply = TRUE only if a REAL person is directly asking the user to respond. ALWAYS false for newsletter/promotional/transactional/social.
- can_auto_archive = TRUE for newsletter/promotional/transactional/social that need no action.
- Prefer "normal" for real humans, or the right bulk class for machines, unless you're clearly confident it's urgent/important. If confidence in a priority class is < 0.5, fall back to "normal".

Examples:
From: Yale Clean Energy Forum <news@e.yale.edu> | Subject: April digest + apply to our accelerator
=> {{"category": "newsletter", "confidence": 0.95, "requires_reply": false, "can_auto_archive": true}}
From: Sarah Chen <sarah@acme.com> | Subject: can you review the deck before our 9am?
=> {{"category": "urgent", "confidence": 0.85, "requires_reply": true, "can_auto_archive": false}}
From: Amazon <ship-confirm@amazon.com> | Subject: Your package was delivered
=> {{"category": "transactional", "confidence": 0.97, "requires_reply": false, "can_auto_archive": true}}
From: Mike <mike@partner.com> | Subject: thoughts on the proposal whenever you get a sec
=> {{"category": "normal", "confidence": 0.7, "requires_reply": true, "can_auto_archive": false}}"""


# ── Summarize email ────────────────────────────────────────────

def summarize_email_prompt(email_content: str, style_context: str = "") -> str:
    return f"""Please analyze this email and provide a concise summary and key points.

Email Content:
{email_content}

Additional Context about recipient's preferences:
{style_context}

Please respond in the following JSON format:
{{
  "summary": "A brief 2-3 sentence summary of the email",
  "key_points": ["Key point 1", "Key point 2", "Key point 3"],
  "action_items": ["Action item 1 if any"]
}}

Focus on the most important information and action items."""


# ── Generate reply ─────────────────────────────────────────────

def generate_reply_system(sender: str, learned_style: dict | None = None) -> str:
    base = (
        "You are Aiden, an intelligent email assistant. You write professional, "
        "contextually appropriate email replies.\n"
        "Keep replies concise and natural. Match the requested formality level."
    )
    if learned_style:
        base += f"""

LEARNED WRITING STYLE FOR THIS RECIPIENT:
- Recipient: {learned_style.get('recipient_email', '')}
- Tone: {learned_style.get('tone_description', '')} (formality: {learned_style.get('formality_score', 50)}/100)
- Common phrases: {', '.join(learned_style.get('common_phrases', []))}
- Greeting style: {learned_style.get('greeting_style', '')}
- Sign-off style: {learned_style.get('sign_off_style', '')}
- Based on {learned_style.get('sample_count', 0)} previous emails

Incorporate this learned style naturally into your reply."""
    return base


def generate_reply_prompt(
    sender: str,
    subject: str,
    body_text: str,
    user_answers: list[dict],
    formality_level: str,
    additional_context: str = "",
    selected_meeting_time: str = "",
    sender_tone: str = "",
    conversation_context: dict | None = None,
    user_name: str = "",
) -> str:
    answers_section = "No specific questions to address."
    if user_answers:
        answers_section = "\n".join(
            f"Q: {a.get('question', '')}\nA: {a.get('answer', '')}" for a in user_answers
        )

    context_section = f"\nAdditional Context: {additional_context}" if additional_context else ""
    meeting_section = f"\nMeeting Time: {selected_meeting_time}" if selected_meeting_time else ""
    name_section = f"\nUSER'S NAME: {user_name} — Use this name instead of placeholders like [Your Name]." if user_name else ""
    tone_section = (
        f"\nSENDER'S TONE: {sender_tone} — Adapt your reply tone accordingly."
        if sender_tone
        else ""
    )

    conversation_history = ""
    if conversation_context and conversation_context.get("previous_emails"):
        emails = conversation_context["previous_emails"][:5]
        history = "\n\n".join(
            f"{'You' if e.get('is_from_user') else 'Them'} ({e.get('date', '')})\n"
            f"Subject: {e.get('subject', '')}\n"
            f"{e.get('body', '')[:200]}"
            for e in emails
        )
        conversation_history = (
            f"\nCONVERSATION HISTORY ({conversation_context.get('total_conversation_count', 0)} "
            f"emails total, showing most recent):\n{history}\n"
        )

    return f"""Write a reply to this email.

ORIGINAL EMAIL:
From: {sender}
Subject: {subject}
Body: {body_text}
{conversation_history}

MY ANSWERS TO QUESTIONS:
{answers_section}

{context_section}

{meeting_section}
{tone_section}
{name_section}

REQUIREMENTS:
- Formality: {formality_level}
- Keep it concise (2-4 sentences typically)
- Be professional but natural
- STRUCTURE with real line breaks: a greeting line, a blank line, the body (2-4 sentences), a blank line, then a sign-off — use "{user_name}" as your name in the sign-off when provided. Skip greeting/sign-off ONLY if LEARNED WRITING STYLE specifies otherwise (e.g. a very casual thread).
- For a frustrated/angry sender, lead with a calm personal greeting, then acknowledge and apologize before the substance.
- Subject: a single "Re: " prefix — do NOT add "Re:" if the subject already starts with "Re:" (never produce "Re: Re:").
- Reference the conversation history naturally if relevant
- Return ONLY a JSON object with "reply" and "subject" fields

Response format:
{{
  "reply": "Your email reply here...",
  "subject": "<reply subject with a single Re: prefix>"
}}"""


# ── Edit reply ─────────────────────────────────────────────────

def edit_reply_prompt(current_reply: str, edit_prompt: str) -> str:
    return f"""Edit this email reply based on the user's request.

Current reply:
{current_reply}

User's edit request: {edit_prompt}

Return ONLY the edited reply, no explanation or extra text."""


# ── Attachment analysis ────────────────────────────────────────

ATTACHMENT_SYSTEM = (
    "You are Aiden, an intelligent email assistant. Analyze email attachments and provide:\n"
    "1. A concise 2-3 sentence summary of what the attachment contains\n"
    "2. Key points extracted from the attachment content\n"
    "3. Any action items, dates, deadlines, or important information\n\n"
    "Focus primarily on the attachment's actual content."
)


def analyze_attachment_image_prompt(
    filename: str, mime_type: str, email_context: str = ""
) -> str:
    return f"""Analyze this email attachment image.

Attachment filename: {filename}
{email_context}

Focus primarily on describing what the image contains — any text visible, data, charts, diagrams, or other visual information.

Respond in this JSON format:
{{
  "summary": "Concise 2-3 sentence description of what the image shows",
  "key_points": ["Main point 1", "Main point 2", "Main point 3"],
  "action_items": ["Action item 1 if any"]
}}"""


def analyze_attachment_text_prompt(
    filename: str, mime_type: str, text_content: str, email_context: str = ""
) -> str:
    return f"""You are analyzing an email attachment. Focus primarily on the attachment's content.

Attachment: {filename} ({mime_type}){email_context}

Analyze the attachment content and provide:

Respond in this JSON format:
{{
  "summary": "Concise 2-3 sentence summary of the attachment's actual content",
  "key_points": ["Main point 1", "Main point 2", "Main point 3"],
  "action_items": ["Action item 1 if any"]
}}

Attachment content to analyze:
{text_content}"""


def summarize_attachment_prompt(filename: str, text_content: str) -> str:
    return f"""Summarize the content of this document (filename: {filename}) in 2-3 sentences.
Focus on the key points, main topics, and any action items or important information.

Document content:
{text_content}

Provide only the summary, no preamble."""


# ── Contact classification ─────────────────────────────────────

def classify_contacts_prompt(contacts_text: str) -> str:
    return f"""Classify each contact into exactly ONE category based on their email address, domain, name, communication pattern, and email subjects.

Categories:
- Colleague (coworker, classmate, team member, professor, university staff)
- Client (customer, someone you provide services to)
- Vendor (service provider, company you buy from, subscriptions)
- Friend (personal contact, non-work relationship)
- Family (family member)
- Other (newsletters, automated emails, unknown)

Contacts to classify:
{contacts_text}

Respond with valid JSON only - an array of objects with "email_address" and "category":
[
  {{"email_address": "example@domain.com", "category": "Colleague"}},
  ...
]

Rules:
- .edu domains are likely Colleague unless clearly a newsletter
- Automated/newsletter senders are Other
- If unsure, use Other
- Only use the exact category names listed above"""


# ── Chat ───────────────────────────────────────────────────────

CHAT_SYSTEM = (
    "You are Aiden, an intelligent email assistant chatbot. You help users with "
    "email-related questions, writing advice, and general productivity. "
    "Be concise and helpful."
)


def chat_prompt(user_message: str, context: str = "") -> str:
    if context:
        return f"Context:\n{context}\n\nUser: {user_message}"
    return user_message
