-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "snippet" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Unhandled',
    "category" TEXT NOT NULL DEFAULT 'Normal',
    "summary" TEXT,
    "keyPoints" TEXT NOT NULL,
    "requiresReply" BOOLEAN NOT NULL DEFAULT false,
    "aiGeneratedReply" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_styles" (
    "userEmail" TEXT NOT NULL PRIMARY KEY,
    "tone" TEXT NOT NULL,
    "formalityScore" REAL NOT NULL,
    "commonPhrases" TEXT NOT NULL,
    "avgSentenceLength" REAL NOT NULL,
    "avgResponseTimeMinutes" REAL NOT NULL,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "notification_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailId" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" DATETIME,
    "actionTaken" TEXT
);

-- CreateTable
CREATE TABLE "queued_emails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailId" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "emails_gmailId_key" ON "emails"("gmailId");
