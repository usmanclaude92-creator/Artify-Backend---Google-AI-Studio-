/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Strict Workflow Validator Engine
 */

import { prisma } from "../../db/prisma";
import { actionRegistry } from "./ActionRegistry";
import { aiToolExecutor } from "../../ai/tools";
import {
  WorkflowStepConfig,
  WorkflowLimits,
  WorkflowRetryPolicy,
  WorkflowTriggerConfig,
  WorkflowTriggerType,
} from "./types";

export interface ValidationIssue {
  field: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details: ValidationIssue[];
}

export class WorkflowValidator {
  /**
   * Validates a workflow definition before publishing.
   */
  public static async validate(params: {
    organizationId: string;
    name: string;
    triggerType: WorkflowTriggerType;
    triggerConfig: WorkflowTriggerConfig;
    conditions?: unknown;
    steps: WorkflowStepConfig[];
    limits?: WorkflowLimits;
    retryPolicy?: WorkflowRetryPolicy;
  }): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // 1. Basic Name Check
    if (!params.name || params.name.trim().length < 3) {
      issues.push({
        field: "name",
        message: "Workflow name must be at least 3 characters long.",
        severity: "ERROR",
      });
    }

    // 2. Trigger Validation
    if (!params.triggerType) {
      issues.push({
        field: "triggerType",
        message: "Workflow trigger type is required.",
        severity: "ERROR",
      });
    }

    if (params.triggerType === "EVENT") {
      const eventCfg = params.triggerConfig as { eventType?: string };
      if (!eventCfg?.eventType) {
        issues.push({
          field: "triggerConfig.eventType",
          message: "Event trigger requires a valid 'eventType'.",
          severity: "ERROR",
        });
      }
    }

    if (params.triggerType === "SCHEDULE") {
      const schedCfg = params.triggerConfig as { scheduleType?: string; cronExpression?: string; intervalSeconds?: number };
      if (!schedCfg?.scheduleType) {
        issues.push({
          field: "triggerConfig.scheduleType",
          message: "Schedule trigger requires 'scheduleType'.",
          severity: "ERROR",
        });
      }
    }

    // 3. Steps Validation
    if (!Array.isArray(params.steps) || params.steps.length === 0) {
      issues.push({
        field: "steps",
        message: "Workflow must contain at least one step.",
        severity: "ERROR",
      });
    } else {
      const stepIds = new Set<string>();

      for (let i = 0; i < params.steps.length; i++) {
        const step = params.steps[i];
        const stepPrefix = `steps[${i}]`;

        if (!step.id) {
          issues.push({
            field: `${stepPrefix}.id`,
            message: `Step at index ${i} is missing a unique ID.`,
            severity: "ERROR",
          });
        } else {
          if (stepIds.has(step.id)) {
            issues.push({
              field: `${stepPrefix}.id`,
              message: `Duplicate step ID: "${step.id}".`,
              severity: "ERROR",
            });
          }
          stepIds.add(step.id);
        }

        if (!step.name) {
          issues.push({
            field: `${stepPrefix}.name`,
            message: `Step at index ${i} is missing a name.`,
            severity: "ERROR",
          });
        }

        // Validate step by type
        switch (step.type) {
          case "CONDITION": {
            if (!step.condition) {
              issues.push({
                field: `${stepPrefix}.condition`,
                message: `Condition step "${step.name}" is missing condition logic.`,
                severity: "ERROR",
              });
            }
            break;
          }

          case "TOOL_CALL": {
            if (!step.toolName) {
              issues.push({
                field: `${stepPrefix}.toolName`,
                message: `Tool call step "${step.name}" is missing toolName.`,
                severity: "ERROR",
              });
            } else {
              const tool = aiToolExecutor.getTool(step.toolName);
              if (!tool) {
                issues.push({
                  field: `${stepPrefix}.toolName`,
                  message: `Referenced tool "${step.toolName}" is not registered in the system.`,
                  severity: "ERROR",
                });
              }
            }
            break;
          }

          case "BUSINESS_ACTION": {
            if (!step.actionId) {
              issues.push({
                field: `${stepPrefix}.actionId`,
                message: `Business action step "${step.name}" is missing actionId.`,
                severity: "ERROR",
              });
            } else {
              const action = actionRegistry.getAction(step.actionId);
              if (!action) {
                issues.push({
                  field: `${stepPrefix}.actionId`,
                  message: `Referenced business action "${step.actionId}" does not exist in registry.`,
                  severity: "ERROR",
                });
              }
            }
            break;
          }

          case "AI_DECISION":
          case "AI_GENERATION": {
            if (!step.prompt) {
              issues.push({
                field: `${stepPrefix}.prompt`,
                message: `AI step "${step.name}" is missing prompt instruction.`,
                severity: "ERROR",
              });
            }
            // Check agent if specified
            if (step.agentId) {
              const agent = await prisma.aiAgent.findFirst({
                where: { id: step.agentId, organizationId: params.organizationId },
              });
              if (!agent) {
                issues.push({
                  field: `${stepPrefix}.agentId`,
                  message: `Referenced AI Agent "${step.agentId}" was not found.`,
                  severity: "ERROR",
                });
              }
            }
            break;
          }

          case "APPROVAL": {
            if (!step.actionDescription) {
              issues.push({
                field: `${stepPrefix}.actionDescription`,
                message: `Approval step "${step.name}" requires an actionDescription.`,
                severity: "ERROR",
              });
            }
            break;
          }

          case "NOTIFICATION": {
            if (!step.titleTemplate || !step.messageTemplate) {
              issues.push({
                field: `${stepPrefix}.templates`,
                message: `Notification step "${step.name}" requires titleTemplate and messageTemplate.`,
                severity: "ERROR",
              });
            }
            break;
          }

          case "LOOP": {
            if (!step.itemsPath) {
              issues.push({
                field: `${stepPrefix}.itemsPath`,
                message: `Loop step "${step.name}" requires itemsPath.`,
                severity: "ERROR",
              });
            }
            if (step.maxIterations && step.maxIterations > 50) {
              issues.push({
                field: `${stepPrefix}.maxIterations`,
                message: `Loop step maximum iterations cannot exceed 50 for safety.`,
                severity: "ERROR",
              });
            }
            break;
          }

          case "KNOWLEDGE_RETRIEVAL": {
            if (!step.queryTemplate || step.queryTemplate.trim().length === 0) {
              issues.push({
                field: `${stepPrefix}.queryTemplate`,
                message: `Knowledge retrieval step "${step.name}" requires a queryTemplate.`,
                severity: "ERROR",
              });
            }
            break;
          }

          default:
            break;
        }
      }

      // Check for circular execution references
      for (const step of params.steps) {
        if (step.type === "CONDITION") {
          if (step.thenStepId && !stepIds.has(step.thenStepId)) {
            issues.push({
              field: `steps.${step.id}.thenStepId`,
              message: `Condition target thenStepId "${step.thenStepId}" does not exist.`,
              severity: "ERROR",
            });
          }
          if (step.elseStepId && !stepIds.has(step.elseStepId)) {
            issues.push({
              field: `steps.${step.id}.elseStepId`,
              message: `Condition target elseStepId "${step.elseStepId}" does not exist.`,
              severity: "ERROR",
            });
          }
        }
      }
    }

    // 4. Limits & Resource Protection Check
    if (params.limits) {
      if (params.limits.maxSteps < 1 || params.limits.maxSteps > 100) {
        issues.push({
          field: "limits.maxSteps",
          message: "maxSteps must be between 1 and 100.",
          severity: "ERROR",
        });
      }
      if (params.limits.maxDurationMs < 5000 || params.limits.maxDurationMs > 600000) {
        issues.push({
          field: "limits.maxDurationMs",
          message: "maxDurationMs must be between 5000ms and 600000ms (10 minutes).",
          severity: "ERROR",
        });
      }
    }

    // 5. Retry Settings Check
    if (params.retryPolicy) {
      if (params.retryPolicy.maxRetries < 0 || params.retryPolicy.maxRetries > 5) {
        issues.push({
          field: "retryPolicy.maxRetries",
          message: "maxRetries cannot exceed 5.",
          severity: "ERROR",
        });
      }
    }

    const errors = issues.filter((i) => i.severity === "ERROR").map((i) => i.message);
    const warnings = issues.filter((i) => i.severity === "WARNING").map((i) => i.message);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      details: issues,
    };
  }
}
