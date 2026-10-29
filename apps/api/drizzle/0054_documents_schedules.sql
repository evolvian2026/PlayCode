CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"due_on" text NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_submissions" (
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_submissions_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "drive_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"slot_minutes" integer NOT NULL,
	"panels" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_slots" (
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"panel" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "drive_slots_schedule_id_user_id_pk" PRIMARY KEY("schedule_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_request_id_document_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."document_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_submissions" ADD CONSTRAINT "document_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_schedules" ADD CONSTRAINT "drive_schedules_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_schedules" ADD CONSTRAINT "drive_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_slots" ADD CONSTRAINT "drive_slots_schedule_id_drive_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."drive_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_slots" ADD CONSTRAINT "drive_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_requests_tenant_idx" ON "document_requests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "document_submissions_user_idx" ON "document_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_schedules_round_idx" ON "drive_schedules" USING btree ("drive_id","round");--> statement-breakpoint
CREATE INDEX "drive_slots_user_idx" ON "drive_slots" USING btree ("user_id");