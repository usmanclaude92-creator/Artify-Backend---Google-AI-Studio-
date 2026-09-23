-- Phase 15: AI Copilot & Conversational Workspace migration

-- CreateEnum
CREATE TYPE "CopilotResponseMode" AS ENUM ('ANSWER', 'EXPLAIN', 'SUMMARIZE', 'ANALYZE', 'RECOMMEND', 'DRAFT', 'EXECUTE');

-- CreateTable copilot_workspaces
CREATE TABLE "copilot_workspaces" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'Bot',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "allowed_agents" JSONB NOT NULL DEFAULT '[]',
    "allowed_tools" JSONB NOT NULL DEFAULT '[]',
    "knowledge_scope" JSONB NOT NULL DEFAULT '{}',
    "allowed_modules" JSONB NOT NULL DEFAULT '[]',
    "required_permissions" JSONB NOT NULL DEFAULT '[]',
    "system_instruction" TEXT,
    "default_mode" "CopilotResponseMode" NOT NULL DEFAULT 'ANSWER',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "require_citations" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable copilot_conversations
CREATE TABLE "copilot_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "context_metadata" JSONB NOT NULL DEFAULT '{}',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable copilot_messages
CREATE TABLE "copilot_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "provider_type" TEXT,
    "model_name" TEXT,
    "agent_id" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "execution_id" TEXT,
    "correlation_id" TEXT,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "action_preview" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable copilot_action_previews
CREATE TABLE "copilot_action_previews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_entity" TEXT,
    "changes_summary" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "execution_result" JSONB,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_id" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_action_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable copilot_usages
CREATE TABLE "copilot_usages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "provider_type" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "copilot_workspaces_organization_id_slug_key" ON "copilot_workspaces"("organization_id", "slug");
CREATE INDEX "copilot_workspaces_organization_id_idx" ON "copilot_workspaces"("organization_id");

-- CreateIndex
CREATE INDEX "copilot_conversations_organization_id_idx" ON "copilot_conversations"("organization_id");
CREATE INDEX "copilot_conversations_workspace_id_idx" ON "copilot_conversations"("workspace_id");
CREATE INDEX "copilot_conversations_user_id_idx" ON "copilot_conversations"("user_id");
CREATE INDEX "copilot_conversations_status_idx" ON "copilot_conversations"("status");

-- CreateIndex
CREATE INDEX "copilot_messages_conversation_id_idx" ON "copilot_messages"("conversation_id");
CREATE INDEX "copilot_messages_correlation_id_idx" ON "copilot_messages"("correlation_id");

-- CreateIndex
CREATE INDEX "copilot_action_previews_organization_id_idx" ON "copilot_action_previews"("organization_id");
CREATE INDEX "copilot_action_previews_conversation_id_idx" ON "copilot_action_previews"("conversation_id");
CREATE INDEX "copilot_action_previews_status_idx" ON "copilot_action_previews"("status");

-- CreateIndex
CREATE INDEX "copilot_usages_organization_id_idx" ON "copilot_usages"("organization_id");
CREATE INDEX "copilot_usages_user_id_idx" ON "copilot_usages"("user_id");
CREATE INDEX "copilot_usages_workspace_id_idx" ON "copilot_usages"("workspace_id");

-- AddForeignKey
ALTER TABLE "copilot_workspaces" ADD CONSTRAINT "copilot_workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "copilot_workspaces" ADD CONSTRAINT "copilot_workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "copilot_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "copilot_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_usages" ADD CONSTRAINT "copilot_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "copilot_usages" ADD CONSTRAINT "copilot_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
