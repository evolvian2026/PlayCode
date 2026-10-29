CREATE TABLE "placement_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"graduation_year" integer NOT NULL,
	"unit_id" uuid,
	"target_pct" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiter_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recruiter_id" uuid NOT NULL,
	"name" text NOT NULL,
	"designation" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiter_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recruiter_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"on" text NOT NULL,
	"note" text NOT NULL,
	"follow_up_on" text,
	"follow_up_done" boolean DEFAULT false NOT NULL,
	"by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruiters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sector" text DEFAULT '' NOT NULL,
	"website" text,
	"stage" text DEFAULT 'prospect' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placement_targets" ADD CONSTRAINT "placement_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_targets" ADD CONSTRAINT "placement_targets_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_contacts" ADD CONSTRAINT "recruiter_contacts_recruiter_id_recruiters_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."recruiters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_interactions" ADD CONSTRAINT "recruiter_interactions_recruiter_id_recruiters_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."recruiters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_interactions" ADD CONSTRAINT "recruiter_interactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_interactions" ADD CONSTRAINT "recruiter_interactions_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "placement_targets_idx" ON "placement_targets" USING btree ("tenant_id","graduation_year",coalesce("unit_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "recruiter_contacts_idx" ON "recruiter_contacts" USING btree ("recruiter_id");--> statement-breakpoint
CREATE INDEX "recruiter_interactions_idx" ON "recruiter_interactions" USING btree ("recruiter_id","on");--> statement-breakpoint
CREATE INDEX "recruiter_followups_idx" ON "recruiter_interactions" USING btree ("tenant_id","follow_up_done","follow_up_on");--> statement-breakpoint
CREATE UNIQUE INDEX "recruiters_tenant_name_idx" ON "recruiters" USING btree ("tenant_id",lower("name"));