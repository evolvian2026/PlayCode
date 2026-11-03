CREATE TABLE "drive_round_tests" (
	"drive_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"assessment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cutoff_pct" integer NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_round_tests_drive_id_round_pk" PRIMARY KEY("drive_id","round")
);
--> statement-breakpoint
ALTER TABLE "drive_slots" ADD COLUMN "feedback" jsonb;--> statement-breakpoint
ALTER TABLE "drive_round_tests" ADD CONSTRAINT "drive_round_tests_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_round_tests" ADD CONSTRAINT "drive_round_tests_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_round_tests" ADD CONSTRAINT "drive_round_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;