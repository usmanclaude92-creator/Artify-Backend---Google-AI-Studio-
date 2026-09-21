/**
 * Structured logging (pino). Replaces uncontrolled console.log in the
 * backend request/error paths (Phase 0 finding S8 — raw PII logged to
 * stdout in artifysolscom/server.ts:177 must not recur here).
 *
 * Redaction: field paths below are scrubbed to "[REDACTED]" wherever they
 * appear in a logged object, at any nesting depth pino's wildcard reaches.
 * Never log: passwords, session tokens/cookies, API keys, webhook secrets,
 * Authorization headers, full payment details.
 */
import pino from "pino";
import { config } from "../config/env";

const REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.token",
  "*.sessionToken",
  "*.session_token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.webhookSecret",
  "*.gemini_api_key",
  "*.geminiApiKey",
  "*.cardNumber",
  "*.cvv",
];

export const logger = pino({
  level: config.logLevel,
  base: {
    service: "artify-platform-api",
    environment: config.nodeEnv,
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
