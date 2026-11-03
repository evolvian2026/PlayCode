CREATE TABLE "adaptive_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sections" jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"scores" jsonb,
	"score" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "adaptive_attempts" ADD CONSTRAINT "adaptive_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptive_attempts" ADD CONSTRAINT "adaptive_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adaptive_attempts_user_idx" ON "adaptive_attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "adaptive_attempts_tenant_idx" ON "adaptive_attempts" USING btree ("tenant_id","status");