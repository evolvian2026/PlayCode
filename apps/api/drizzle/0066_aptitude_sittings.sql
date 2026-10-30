CREATE TABLE "aptitude_sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adaptive_attempts" ADD COLUMN "sitting_id" uuid;--> statement-breakpoint
ALTER TABLE "aptitude_sittings" ADD CONSTRAINT "aptitude_sittings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aptitude_sittings_tenant_idx" ON "aptitude_sittings" USING btree ("tenant_id","closes_at");--> statement-breakpoint
ALTER TABLE "adaptive_attempts" ADD CONSTRAINT "adaptive_attempts_sitting_id_aptitude_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."aptitude_sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adaptive_attempts_sitting_uq" ON "adaptive_attempts" USING btree ("sitting_id","user_id");