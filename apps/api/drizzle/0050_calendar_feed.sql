ALTER TABLE "users" ADD COLUMN "calendar_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_token_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_calendar_token_hash_unique" UNIQUE("calendar_token_hash");