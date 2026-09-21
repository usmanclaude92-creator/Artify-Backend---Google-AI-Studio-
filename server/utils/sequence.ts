/**
 * Race-safe document numbering (Phase 10 §16/§37 — real Postgres
 * `SEQUENCE`s, created in prisma/migrations/20261001000001_phase10_commercial_billing).
 * `nextval()` is atomic at the database level — concurrent callers can
 * never receive the same value, which a JS-level "count existing rows + 1"
 * or a timestamp cannot guarantee. The sequence name is always one of this
 * module's own literal constants, never caller-supplied, so the
 * unparameterized identifier in the raw query is not an injection risk.
 */
import { prisma } from "../db/prisma";

const SEQUENCES = {
  contract: "contract_number_seq",
  subscription: "subscription_number_seq",
  invoice: "invoice_number_seq",
} as const;

type SequenceKind = keyof typeof SEQUENCES;

async function nextSequenceValue(kind: SequenceKind): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(`SELECT nextval('${SEQUENCES[kind]}') AS nextval`);
  return Number(rows[0]!.nextval);
}

function pad(value: number): string {
  return String(value).padStart(6, "0");
}

export async function nextContractNumber(): Promise<string> {
  return `CTR-${pad(await nextSequenceValue("contract"))}`;
}

export async function nextSubscriptionNumber(): Promise<string> {
  return `SUB-${pad(await nextSequenceValue("subscription"))}`;
}

export async function nextInvoiceNumber(): Promise<string> {
  return `INV-${pad(await nextSequenceValue("invoice"))}`;
}
