ALTER TABLE "attempt_snapshots" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "attempt_snapshots" ADD COLUMN "reviewed_at" timestamp with time zone;