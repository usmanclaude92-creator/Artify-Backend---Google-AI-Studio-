-- Phase 12: AI Control Center migration

-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('GEMINI', 'OPENAI', 'ANTHROPIC', 'CUSTOM', 'MOCK');
CREATE TYPE "AiProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DEPRECATED');
CREATE TYPE "AiModelType" AS ENUM ('CHAT', 'COMPLETION', 'EMBEDDING', 'MULTIMODAL');
CREATE TYPE "AiModelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DEPRECATED');
CREATE TYPE "AiAgentStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
CREATE TYPE "AiPromptStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
CREATE TYPE "AiToolStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AiRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AiWorkflowTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'EVENT', 'WEBHOOK');
CREATE TYPE "AiWorkflowStatus" AS ENUM ('ACTIVE', 'DRAFT', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AiApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE "AiExecutionStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'REJECTED');

-- CreateTable ai_providers
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" "AiProviderType" NOT NULL DEFAULT 'GEMINI',
    "base_url" TEXT,
    "credential_ref" TEXT,
    "status" "AiProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "supported_capabilities" JSONB NOT NULL DEFAULT '[]',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_models
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "model_type" "AiModelType" NOT NULL DEFAULT 'CHAT',
    "context_limit" INTEGER NOT NULL DEFAULT 128000,
    "input_capabilities" JSONB NOT NULL DEFAULT '["TEXT"]',
    "output_capabilities" JSONB NOT NULL DEFAULT '["TEXT"]',
    "supports_tools" BOOLEAN NOT NULL DEFAULT true,
    "supports_vision" BOOLEAN NOT NULL DEFAULT false,
    "supports_embedding" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiModelStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "config_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_agents
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purpose" TEXT NOT NULL,
    "status" "AiAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "system_instructions" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{"temperature":0.3,"maxTokens":2048}',
    "allowed_tools" JSONB NOT NULL DEFAULT '[]',
    "allowed_capabilities" JSONB NOT NULL DEFAULT '[]',
    "knowledge_sources" JSONB NOT NULL DEFAULT '[]',
    "max_execution_time" INTEGER NOT NULL DEFAULT 30,
    "max_token_limit" INTEGER NOT NULL DEFAULT 4096,
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":2,"backoffMs":500}',
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_agent_versions
CREATE TABLE "ai_agent_versions" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "system_instructions" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "allowed_tools" JSONB NOT NULL,
    "allowed_capabilities" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_prompts
CREATE TABLE "ai_prompts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "system_prompt" TEXT,
    "template" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "output_format" TEXT NOT NULL DEFAULT 'TEXT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AiPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_active_version" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_prompt_versions
CREATE TABLE "ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system_prompt" TEXT,
    "template" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "output_format" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_tools
CREATE TABLE "ai_tools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "input_schema" JSONB NOT NULL,
    "output_schema" JSONB NOT NULL,
    "permission" TEXT NOT NULL,
    "status" "AiToolStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_level" "AiRiskLevel" NOT NULL DEFAULT 'LOW',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "requires_audit" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_workflows
CREATE TABLE "ai_workflows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" "AiWorkflowTrigger" NOT NULL DEFAULT 'MANUAL',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "agent_id" TEXT,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "input_schema" JSONB NOT NULL DEFAULT '{}',
    "output_schema" JSONB NOT NULL DEFAULT '{}',
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":1,"backoffMs":1000}',
    "timeout" INTEGER NOT NULL DEFAULT 60,
    "status" "AiWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_approvals
CREATE TABLE "ai_approvals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "workflow_id" TEXT,
    "execution_id" TEXT,
    "requester_id" TEXT,
    "approver_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decision_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ai_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable ai_executions
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "workflow_id" TEXT,
    "provider_id" TEXT,
    "model_id" TEXT,
    "capability" TEXT NOT NULL DEFAULT 'TEXT_GENERATION',
    "status" "AiExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "input_metadata" JSONB NOT NULL DEFAULT '{}',
    "output_metadata" JSONB NOT NULL DEFAULT '{}',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "approval_status" "AiApprovalStatus",
    "initiator_user_id" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_providers_organization_id_idx" ON "ai_providers"("organization_id");
CREATE UNIQUE INDEX "ai_models_provider_id_model_name_key" ON "ai_models"("provider_id", "model_name");
CREATE INDEX "ai_models_provider_id_idx" ON "ai_models"("provider_id");
CREATE INDEX "ai_agents_organization_id_idx" ON "ai_agents"("organization_id");
CREATE UNIQUE INDEX "ai_agent_versions_agent_id_version_key" ON "ai_agent_versions"("agent_id", "version");
CREATE INDEX "ai_agent_versions_agent_id_idx" ON "ai_agent_versions"("agent_id");
CREATE INDEX "ai_prompts_organization_id_idx" ON "ai_prompts"("organization_id");
CREATE UNIQUE INDEX "ai_prompt_versions_prompt_id_version_key" ON "ai_prompt_versions"("prompt_id", "version");
CREATE INDEX "ai_prompt_versions_prompt_id_idx" ON "ai_prompt_versions"("prompt_id");
CREATE UNIQUE INDEX "ai_tools_name_key" ON "ai_tools"("name");
CREATE INDEX "ai_workflows_organization_id_idx" ON "ai_workflows"("organization_id");
CREATE INDEX "ai_approvals_organization_id_idx" ON "ai_approvals"("organization_id");
CREATE INDEX "ai_approvals_status_idx" ON "ai_approvals"("status");
CREATE INDEX "ai_executions_organization_id_idx" ON "ai_executions"("organization_id");
CREATE INDEX "ai_executions_agent_id_idx" ON "ai_executions"("agent_id");
CREATE INDEX "ai_executions_workflow_id_idx" ON "ai_executions"("workflow_id");
CREATE INDEX "ai_executions_status_idx" ON "ai_executions"("status");
CREATE INDEX "ai_executions_started_at_idx" ON "ai_executions"("started_at");

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "ai_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_workflows" ADD CONSTRAINT "ai_workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_workflows" ADD CONSTRAINT "ai_workflows_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_workflows" ADD CONSTRAINT "ai_workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_workflows" ADD CONSTRAINT "ai_workflows_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_approvals" ADD CONSTRAINT "ai_approvals_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "ai_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
