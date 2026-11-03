CREATE TABLE "interview_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"drive_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"result" text NOT NULL,
	"difficulty" integer NOT NULL,
	"rounds" jsonb NOT NULL,
	"tips" text DEFAULT '' NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mentor_assignments" (
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"mentor_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mentor_assignments_tenant_id_student_id_pk" PRIMARY KEY("tenant_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "mentoring_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mentor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"meeting_date" text NOT NULL,
	"mode" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"action_points" text DEFAULT '' NOT NULL,
	"follow_up_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_experiences" ADD CONSTRAINT "interview_experiences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_experiences" ADD CONSTRAINT "interview_experiences_drive_id_placement_drives_id_fk" FOREIGN KEY ("drive_id") REFERENCES "public"."placement_drives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_experiences" ADD CONSTRAINT "interview_experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentoring_meetings" ADD CONSTRAINT "mentoring_meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentoring_meetings" ADD CONSTRAINT "mentoring_meetings_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentoring_meetings" ADD CONSTRAINT "mentoring_meetings_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_experiences_drive_user_idx" ON "interview_experiences" USING btree ("drive_id","user_id");--> statement-breakpoint
CREATE INDEX "interview_experiences_tenant_idx" ON "interview_experiences" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "mentor_assignments_mentor_idx" ON "mentor_assignments" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "mentoring_meetings_student_idx" ON "mentoring_meetings" USING btree ("student_id","meeting_date");--> statement-breakpoint
CREATE INDEX "mentoring_meetings_tenant_idx" ON "mentoring_meetings" USING btree ("tenant_id","meeting_date");