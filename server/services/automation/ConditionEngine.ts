/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Safe Condition Evaluator — strictly avoids eval() or dynamic function compilation.
 */

import {
  ConditionGroup,
  ConditionOperator,
  SingleCondition,
  WorkflowCondition,
} from "./types";

export class ConditionEngine {
  /**
   * Safely resolves a nested property path from an object (e.g., 'invoice.amount' or 'payload.client.email').
   */
  public static resolvePath(obj: unknown, path: string): unknown {
    if (!obj || typeof obj !== "object" || !path) {
      return undefined;
    }

    const segments = path.split(".").map((s) => s.trim()).filter(Boolean);
    let current: unknown = obj;

    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    return current;
  }

  /**
   * Evaluates a single condition against the context.
   */
  public static evaluateSingle(condition: SingleCondition, context: Record<string, unknown>): boolean {
    const actual = this.resolvePath(context, condition.field);
    const expected = condition.value;

    return this.compare(actual, condition.operator, expected);
  }

  /**
   * Safely compares actual vs expected using defined operators.
   */
  public static compare(actual: unknown, operator: ConditionOperator, expected: unknown): boolean {
    switch (operator) {
      case "=":
      case "==":
      case "===": {
        // Numeric tolerance string vs number
        if (typeof actual === "number" && typeof expected === "string") {
          return actual === Number(expected);
        }
        if (typeof actual === "string" && typeof expected === "number") {
          return Number(actual) === expected;
        }
        return actual === expected;
      }

      case "!=":
      case "!==": {
        if (typeof actual === "number" && typeof expected === "string") {
          return actual !== Number(expected);
        }
        if (typeof actual === "string" && typeof expected === "number") {
          return Number(actual) !== expected;
        }
        return actual !== expected;
      }

      case ">": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual > numExpected;
      }

      case ">=": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual >= numExpected;
      }

      case "<": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual < numExpected;
      }

      case "<=": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual <= numExpected;
      }

      case "IN": {
        if (Array.isArray(expected)) {
          return expected.includes(actual);
        }
        if (typeof expected === "string") {
          return expected.split(",").map((s) => s.trim()).includes(String(actual));
        }
        return false;
      }

      case "NOT_IN": {
        if (Array.isArray(expected)) {
          return !expected.includes(actual);
        }
        if (typeof expected === "string") {
          return !expected.split(",").map((s) => s.trim()).includes(String(actual));
        }
        return true;
      }

      case "CONTAINS": {
        if (Array.isArray(actual)) {
          return actual.includes(expected);
        }
        if (typeof actual === "string") {
          return actual.toLowerCase().includes(String(expected).toLowerCase());
        }
        return false;
      }

      case "NOT_CONTAINS": {
        if (Array.isArray(actual)) {
          return !actual.includes(expected);
        }
        if (typeof actual === "string") {
          return !actual.toLowerCase().includes(String(expected).toLowerCase());
        }
        return true;
      }

      case "IS_EMPTY": {
        if (actual === null || actual === undefined) return true;
        if (typeof actual === "string") return actual.trim().length === 0;
        if (Array.isArray(actual)) return actual.length === 0;
        if (typeof actual === "object") return Object.keys(actual as object).length === 0;
        return false;
      }

      case "IS_NOT_EMPTY": {
        if (actual === null || actual === undefined) return false;
        if (typeof actual === "string") return actual.trim().length > 0;
        if (Array.isArray(actual)) return actual.length > 0;
        if (typeof actual === "object") return Object.keys(actual as object).length > 0;
        return true;
      }

      case "STARTS_WITH": {
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.startsWith(expected);
        }
        return false;
      }

      case "ENDS_WITH": {
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.endsWith(expected);
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Recursively evaluates a condition or nested condition group.
   */
  public static evaluate(
    condition: WorkflowCondition | WorkflowCondition[] | undefined | null,
    context: Record<string, unknown>
  ): boolean {
    if (!condition) return true;

    // Handle array of conditions (default to AND)
    if (Array.isArray(condition)) {
      if (condition.length === 0) return true;
      return condition.every((cond) => this.evaluate(cond, context));
    }

    // ConditionGroup (AND / OR)
    if ("logic" in condition && Array.isArray(condition.conditions)) {
      const group = condition as ConditionGroup;
      if (group.conditions.length === 0) return true;

      if (group.logic === "OR") {
        return group.conditions.some((child) => this.evaluate(child, context));
      }
      return group.conditions.every((child) => this.evaluate(child, context));
    }

    // SingleCondition
    if ("field" in condition && "operator" in condition) {
      return this.evaluateSingle(condition as SingleCondition, context);
    }

    return true;
  }
}
