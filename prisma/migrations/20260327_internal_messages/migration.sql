CREATE TABLE "internal_conversations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'DIRECT',
  "directKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "internal_conversation_participants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "lastReadAt" DATETIME,
  "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "internal_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "internal_conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "internal_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "attachmentPath" TEXT,
  "attachmentName" TEXT,
  "attachmentMime" TEXT,
  "attachmentSize" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "internal_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "internal_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "internal_conversations_directKey_key" ON "internal_conversations"("directKey");
CREATE UNIQUE INDEX "internal_conversation_participants_conversationId_userId_key" ON "internal_conversation_participants"("conversationId", "userId");
CREATE INDEX "internal_conversation_participants_userId_lastReadAt_idx" ON "internal_conversation_participants"("userId", "lastReadAt");
CREATE INDEX "internal_messages_conversationId_createdAt_idx" ON "internal_messages"("conversationId", "createdAt");
