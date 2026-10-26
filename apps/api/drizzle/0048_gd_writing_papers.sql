CREATE TABLE "group_discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phase" text DEFAULT 'discussion' NOT NULL,
	"turns" jsonb NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"scorecard" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "question_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"duration_minutes" integer NOT NULL,
	"marks_per_question" integer DEFAULT 1 NOT NULL,
	"question_ids" jsonb NOT NULL,
	"sets" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"text" text NOT NULL,
	"words" integer NOT NULL,
	"time_ms" integer NOT NULL,
	"feedback" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_discussions" ADD CONSTRAINT "group_discussions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_discussions" ADD CONSTRAINT "group_discussions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_papers" ADD CONSTRAINT "question_papers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_attempts" ADD CONSTRAINT "writing_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_attempts" ADD CONSTRAINT "writing_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_discussions_user_idx" ON "group_discussions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "group_discussions_tenant_idx" ON "group_discussions" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "question_papers_tenant_idx" ON "question_papers" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "writing_attempts_user_idx" ON "writing_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "writing_attempts_tenant_idx" ON "writing_attempts" USING btree ("tenant_id","created_at");