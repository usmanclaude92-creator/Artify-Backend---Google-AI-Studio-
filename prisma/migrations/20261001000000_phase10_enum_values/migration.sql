-- New enum values must be committed before use elsewhere in the same
-- migration run (Postgres restriction on ALTER TYPE ... ADD VALUE) —
-- split into its own migration, applied and committed before
-- 20261001000001_phase10_commercial_billing, which is the first
-- migration to actually use these new values (e.g. subscriptions'
-- new DRAFT default).
ALTER TYPE "BillingCycle" ADD VALUE 'ONE_TIME';
ALTER TYPE "BillingCycle" ADD VALUE 'QUARTERLY';

ALTER TYPE "ContractStatus" ADD VALUE 'SUSPENDED';

ALTER TYPE "SubscriptionStatus" ADD VALUE 'DRAFT';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAUSED';
