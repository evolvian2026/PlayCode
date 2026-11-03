ALTER TABLE "skill_ratings" ADD COLUMN "review_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "review_due_on" text;--> statement-breakpoint
-- Existing skills come up for review on the first step's interval after their last practice.
UPDATE "skill_ratings" SET "review_due_on" = to_char("last_practised_at"::date + 2, 'YYYY-MM-DD') WHERE "last_practised_at" IS NOT NULL;
