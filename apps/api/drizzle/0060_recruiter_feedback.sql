CREATE TABLE "recruiter_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"sent_to" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ratings" jsonb,
	"went_well" text DEFAULT '' NOT NULL,
	"gaps" text DEFAULT '' NOT NULL,
	"return_next_year" text,
	"planned_hires" integer,
	"respondent_name" text DEFAULT '' NOT NULL,
	"respondent_role" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "recruiter_feedback_drive_id_unique" UNIQUE("drive_id"),
	CONSTRAINT "recruiter_feedback_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "recruiter_feedback" ADD CONSTRAINT "recruiter_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruiter_feedback" ADD CONSTRAINT "recruiter_feedback_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;