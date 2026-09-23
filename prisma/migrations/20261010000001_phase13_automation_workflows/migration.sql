-- Phase 13: Autonomous AI Workflows & Business Automation migration

-- CreateEnum
CREATE TYPE "AutomationWorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AutomationTriggerType" AS ENUM ('EVENT', 'SCHEDULE', 'MANUAL', 'API', 'CONDITIONAL');
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_DELAY', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT');
CREATE TYPE "AutomationStepType" AS ENUM ('CONDITION', 'AI_DECISION', 'AI_GENERATION', 'TOOL_CALL', 'BUSINESS_ACTION', 'APPROVAL', 'NOTIFICATION', 'DELAY', 'LOOP', 'TRANSFORM');
CREATE TYPE "AutomationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'WAITING_APPROVAL', 'WAITING_DELAY');
CREATE TYPE "AutomationScheduleType" AS ENUM ('ONE_TIME', 'RECURRING', 'CRON');
CREATE TYPE "AutomationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "AutomationTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "AutomationTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable automation_workflows
CREATE TABLE "automation_workflows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" "AutomationWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "published_version" INTEGER,
    "trigger_type" "AutomationTriggerType" NOT NULL DEFAULT 'EVENT',
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":2,"backoffMs":1000,"exponential":true}',
    "limits" JSONB NOT NULL DEFAULT '{"maxSteps":50,"maxDurationMs":300000,"maxAiCalls":10,"maxToolCalls":15,"maxLoopIterations":10}',
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_workflow_versions
CREATE TABLE "automation_workflow_versions" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":2,"backoffMs":1000,"exponential":true}',
    "limits" JSONB NOT NULL DEFAULT '{"maxSteps":50,"maxDurationMs":300000,"maxAiCalls":10,"maxToolCalls":15,"maxLoopIterations":10}',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT,
    "change_summary" TEXT,

    CONSTRAINT "automation_workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_executions
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "trigger_event_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB NOT NULL DEFAULT '{}',
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "initiated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_step_executions
CREATE TABLE "automation_step_executions" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_id" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "step_type" "AutomationStepType" NOT NULL,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "automation_step_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_schedules
CREATE TABLE "automation_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schedule_type" "AutomationScheduleType" NOT NULL DEFAULT 'RECURRING',
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "interval_seconds" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_events
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "source_module" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_approvals
CREATE TABLE "automation_approvals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_execution_id" TEXT,
    "workflow_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "required_role" TEXT,
    "status" "AutomationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" TEXT,
    "approver_id" TEXT,
    "decision_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "automation_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_tasks
CREATE TABLE "automation_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigned_user_id" TEXT,
    "assigned_role" TEXT,
    "priority" "AutomationTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AutomationTaskStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "source_workflow_id" TEXT,
    "source_execution_id" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_action_executions
CREATE TABLE "automation_action_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "automation_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable automation_notifications
CREATE TABLE "automation_notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "recipient_role" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "source_workflow_id" TEXT,
    "source_execution_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_workflows_organization_id_idx" ON "automation_workflows"("organization_id");
CREATE INDEX "automation_workflows_status_idx" ON "automation_workflows"("status");
CREATE INDEX "automation_workflows_trigger_type_idx" ON "automation_workflows"("trigger_type");

CREATE UNIQUE INDEX "automation_workflow_versions_workflow_id_version_key" ON "automation_workflow_versions"("workflow_id", "version");
CREATE INDEX "automation_workflow_versions_workflow_id_idx" ON "automation_workflow_versions"("workflow_id");

CREATE INDEX "automation_executions_organization_id_idx" ON "automation_executions"("organization_id");
CREATE INDEX "automation_executions_workflow_id_idx" ON "automation_executions"("workflow_id");
CREATE INDEX "automation_executions_status_idx" ON "automation_executions"("status");
CREATE INDEX "automation_executions_correlation_id_idx" ON "automation_executions"("correlation_id");
CREATE INDEX "automation_executions_idempotency_key_idx" ON "automation_executions"("idempotency_key");

CREATE INDEX "automation_step_executions_execution_id_idx" ON "automation_step_executions"("execution_id");
CREATE INDEX "automation_step_executions_step_id_idx" ON "automation_step_executions"("step_id");

CREATE INDEX "automation_schedules_organization_id_idx" ON "automation_schedules"("organization_id");
CREATE INDEX "automation_schedules_workflow_id_idx" ON "automation_schedules"("workflow_id");
CREATE INDEX "automation_schedules_is_active_idx" ON "automation_schedules"("is_active");

CREATE INDEX "automation_events_organization_id_idx" ON "automation_events"("organization_id");
CREATE INDEX "automation_events_event_type_idx" ON "automation_events"("event_type");
CREATE INDEX "automation_events_correlation_id_idx" ON "automation_events"("correlation_id");
CREATE INDEX "automation_events_processed_idx" ON "automation_events"("processed");

CREATE INDEX "automation_approvals_organization_id_idx" ON "automation_approvals"("organization_id");
CREATE INDEX "automation_approvals_execution_id_idx" ON "automation_approvals"("execution_id");
CREATE INDEX "automation_approvals_status_idx" ON "automation_approvals"("status");

CREATE INDEX "automation_tasks_organization_id_idx" ON "automation_tasks"("organization_id");
CREATE INDEX "automation_tasks_status_idx" ON "automation_tasks"("status");
CREATE INDEX "automation_tasks_assigned_user_id_idx" ON "automation_tasks"("assigned_user_id");
CREATE INDEX "automation_tasks_source_workflow_id_idx" ON "automation_tasks"("source_workflow_id");

CREATE INDEX "automation_action_executions_organization_id_idx" ON "automation_action_executions"("organization_id");
CREATE INDEX "automation_action_executions_execution_id_idx" ON "automation_action_executions"("execution_id");
CREATE INDEX "automation_action_executions_idempotency_key_idx" ON "automation_action_executions"("idempotency_key");

CREATE INDEX "automation_notifications_organization_id_idx" ON "automation_notifications"("organization_id");
CREATE INDEX "automation_notifications_user_id_idx" ON "automation_notifications"("user_id");
CREATE INDEX "automation_notifications_status_idx" ON "automation_notifications"("status");

-- AddForeignKey
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_workflow_versions" ADD CONSTRAINT "automation_workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_workflow_versions" ADD CONSTRAINT "automation_workflow_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_step_executions" ADD CONSTRAINT "automation_step_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_schedules" ADD CONSTRAINT "automation_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_schedules" ADD CONSTRAINT "automation_schedules_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_source_workflow_id_fkey" FOREIGN KEY ("source_workflow_id") REFERENCES "automation_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_source_execution_id_fkey" FOREIGN KEY ("source_execution_id") REFERENCES "automation_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_source_execution_id_fkey" FOREIGN KEY ("source_execution_id") REFERENCES "automation_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
