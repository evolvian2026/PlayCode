CREATE TABLE "paper_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"set" text NOT NULL,
	"answers" text NOT NULL,
	"outcomes" jsonb NOT NULL,
	"score" integer NOT NULL,
	"entered_by" uuid NOT NULL,
	"entered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_attendance" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"marked_by" uuid,
	"marked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "training_attendance_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"trainer" text NOT NULL,
	"location" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"code_secret" text NOT NULL,
	"check_in_opened_at" timestamp with time zone,
	"check_in_closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_results" ADD CONSTRAINT "paper_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_results" ADD CONSTRAINT "paper_results_paper_id_question_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."question_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_results" ADD CONSTRAINT "paper_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_attendance" ADD CONSTRAINT "training_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_results_paper_user_idx" ON "paper_results" USING btree ("paper_id","user_id");--> statement-breakpoint
CREATE INDEX "paper_results_user_idx" ON "paper_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_attendance_user_idx" ON "training_attendance" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_sessions_tenant_idx" ON "training_sessions" USING btree ("tenant_id","starts_at");