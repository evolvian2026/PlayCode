CREATE TABLE "batch_graduations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"user_ids" jsonb NOT NULL,
	"by_id" uuid NOT NULL,
	"graduated_at" timestamp with time zone NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "graduate_responses" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid,
	"alumni_choice" text,
	"ratings" jsonb,
	"recommend" boolean,
	"comment" text DEFAULT '' NOT NULL,
	"survey_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alumni" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "graduated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batch_graduations" ADD CONSTRAINT "batch_graduations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_graduations" ADD CONSTRAINT "batch_graduations_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduate_responses" ADD CONSTRAINT "graduate_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduate_responses" ADD CONSTRAINT "graduate_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduate_responses" ADD CONSTRAINT "graduate_responses_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_graduations_unit_idx" ON "batch_graduations" USING btree ("tenant_id","unit_id");--> statement-breakpoint
ALTER TABLE "alumni" ADD CONSTRAINT "alumni_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alumni_user_uq" ON "alumni" USING btree ("tenant_id","user_id");