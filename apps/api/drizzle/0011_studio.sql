ALTER TABLE "questions" ADD COLUMN "origin" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "solutions" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "check_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "last_check" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "questions_tenant_status_idx" ON "questions" USING btree ("tenant_id","status");