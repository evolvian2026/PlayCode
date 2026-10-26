CREATE TABLE "interview_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid,
	"interviewer_name" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"booked_by" uuid,
	"booked_at" timestamp with time zone,
	"feedback" jsonb,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_slots" ADD CONSTRAINT "interview_slots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_slots" ADD CONSTRAINT "interview_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_slots" ADD CONSTRAINT "interview_slots_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_slots_tenant_idx" ON "interview_slots" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "interview_slots_booked_idx" ON "interview_slots" USING btree ("booked_by");