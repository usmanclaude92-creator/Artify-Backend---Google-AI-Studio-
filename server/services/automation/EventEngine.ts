/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Centralized Event Engine & Registry
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import {
  BusinessActorType,
  BusinessEventPayload,
  EventRegistration,
} from "./types";

export class EventEngine {
  private static instance: EventEngine;
  private eventRegistry = new Map<string, EventRegistration>();
  private listeners: Array<(event: BusinessEventPayload) => Promise<void>> = [];

  private constructor() {
    this.registerStandardEvents();
  }

  public static getInstance(): EventEngine {
    if (!EventEngine.instance) {
      EventEngine.instance = new EventEngine();
    }
    return EventEngine.instance;
  }

  /**
   * Registers default Artify business event types.
   */
  private registerStandardEvents(): void {
    const standardEvents: EventRegistration[] = [
      // CRM & Clients
      { eventType: "client.created", entityType: "client", sourceModule: "CRM", description: "Triggered when a new client record is created" },
      { eventType: "client.updated", entityType: "client", sourceModule: "CRM", description: "Triggered when client details are updated" },
      { eventType: "client.onboarded", entityType: "client", sourceModule: "ONBOARDING", description: "Triggered when client onboarding is completed" },

      // Projects
      { eventType: "project.created", entityType: "project", sourceModule: "PROJECTS", description: "Triggered when a new client project is initiated" },
      { eventType: "project.status_changed", entityType: "project", sourceModule: "PROJECTS", description: "Triggered when project workflow status changes" },

      // Products & Catalog
      { eventType: "product.created", entityType: "product", sourceModule: "CATALOG", description: "Triggered when a new service/product is added" },
      { eventType: "product.updated", entityType: "product", sourceModule: "CATALOG", description: "Triggered when a product/service is updated" },

      // Commercial & Billing
      { eventType: "invoice.created", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when a new invoice is created" },
      { eventType: "invoice.overdue", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when an invoice passes its due date without payment" },
      { eventType: "invoice.paid", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when an invoice is fully marked paid" },
      { eventType: "payment.created", entityType: "payment", sourceModule: "BILLING", description: "Triggered when a payment is recorded" },
      { eventType: "payment.failed", entityType: "payment", sourceModule: "BILLING", description: "Triggered when a payment attempt fails" },

      // CMS & Content
      { eventType: "cms.content_created", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS page or post is drafted" },
      { eventType: "cms.content_updated", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS content revision is updated" },
      { eventType: "cms.content_published", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS content is published" },

      // Identity & RBAC
      { eventType: "user.created", entityType: "user", sourceModule: "AUTH", description: "Triggered when a new team member is registered" },
      { eventType: "user.role_changed", entityType: "user", sourceModule: "RBAC", description: "Triggered when a user's role/permissions change" },

      // Automation Lifecycle
      { eventType: "workflow.created", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when a new workflow is configured" },
      { eventType: "workflow.failed", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when an execution fails" },
      { eventType: "workflow.completed", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when an execution completes" },
    ];

    for (const evt of standardEvents) {
      this.eventRegistry.set(evt.eventType, evt);
    }
  }

  /**
   * Register a custom event dynamically.
   */
  public registerEvent(registration: EventRegistration): void {
    this.eventRegistry.set(registration.eventType, registration);
  }

  /**
   * List all registered event descriptors.
   */
  public listRegisteredEvents(): EventRegistration[] {
    return Array.from(this.eventRegistry.values());
  }

  /**
   * Subscribe to business events.
   */
  public subscribe(listener: (event: BusinessEventPayload) => Promise<void>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Emits a business event into the system.
   * Sanitizes payload, persists to automation_events, and dispatches to subscribers.
   */
  public async emit<T extends Record<string, unknown>>(params: {
    eventType: string;
    entityType: string;
    entityId: string;
    organizationId: string;
    actorId?: string;
    actorType?: BusinessActorType;
    sourceModule?: string;
    payload: T;
    correlationId?: string;
  }): Promise<BusinessEventPayload<T>> {
    const eventId = crypto.randomUUID();
    const correlationId = params.correlationId || crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const registered = this.eventRegistry.get(params.eventType);
    const sourceModule = params.sourceModule || registered?.sourceModule || "SYSTEM";

    // Sanitize payload (prevent passwords/secrets from leaking into event logs)
    const sanitizedPayload = this.sanitizePayload(params.payload);

    const event: BusinessEventPayload<T> = {
      eventId,
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
      organizationId: params.organizationId,
      actorId: params.actorId,
      actorType: params.actorType || "USER",
      timestamp,
      payload: sanitizedPayload as T,
      correlationId,
      sourceModule,
    };

    // 1. Persist event to database
    try {
      await prisma.automationEvent.create({
        data: {
          id: eventId,
          organizationId: params.organizationId,
          eventType: params.eventType,
          entityType: params.entityType,
          entityId: params.entityId,
          actorId: params.actorId || null,
          actorType: event.actorType,
          sourceModule,
          correlationId,
          payload: sanitizedPayload as any,
          processed: false,
        },
      });
    } catch (err) {
      logger.error({ err, eventId }, "[EventEngine] Failed to persist automation event");
    }

    // 2. Dispatch to subscribers asynchronously
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        logger.error({ err, eventId, eventType: params.eventType }, "[EventEngine] Listener error");
      }
    }

    return event;
  }

  /**
   * Sanitizes payload by stripping sensitive keys.
   */
  private sanitizePayload(data: unknown): unknown {
    if (!data || typeof data !== "object") return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizePayload(item));
    }

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = new Set([
      "password",
      "passwordhash",
      "token",
      "accesstoken",
      "refreshtoken",
      "secret",
      "apikey",
      "sessionsecret",
    ]);

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizePayload(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

export const eventEngine = EventEngine.getInstance();
