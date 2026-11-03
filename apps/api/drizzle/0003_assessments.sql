CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"device_id" text,
	"results" jsonb,
	"score_x100" integer,
	"max_score_x100" integer,
	"section_scores" jsonb,
	"integrity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_similarity_pct" integer DEFAULT 0 NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"extra_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"proctor_level" integer DEFAULT 1 NOT NULL,
	"duration_minutes" integer NOT NULL,
	"open_at" timestamp with time zone NOT NULL,
	"close_at" timestamp with time zone NOT NULL,
	"sections" jsonb NOT NULL,
	"org_unit_ids" jsonb NOT NULL,
	"release_policy" text DEFAULT 'manual' NOT NULL,
	"results_released_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plagiarism_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"attempt_a" uuid NOT NULL,
	"attempt_b" uuid NOT NULL,
	"similarity_pct" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_snapshots" ADD CONSTRAINT "attempt_snapshots_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plagiarism_pairs" ADD CONSTRAINT "plagiarism_pairs_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plagiarism_pairs" ADD CONSTRAINT "plagiarism_pairs_attempt_a_assessment_attempts_id_fk" FOREIGN KEY ("attempt_a") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plagiarism_pairs" ADD CONSTRAINT "plagiarism_pairs_attempt_b_assessment_attempts_id_fk" FOREIGN KEY ("attempt_b") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_assessment_user_uq" ON "assessment_attempts" USING btree ("assessment_id","user_id");--> statement-breakpoint
CREATE INDEX "attempts_user_idx" ON "assessment_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assessments_tenant_idx" ON "assessments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "attempt_snapshots_attempt_idx" ON "attempt_snapshots" USING btree ("attempt_id","at");--> statement-breakpoint
CREATE INDEX "integrity_events_attempt_idx" ON "integrity_events" USING btree ("attempt_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "plagiarism_pair_uq" ON "plagiarism_pairs" USING btree ("assessment_id","question_id","attempt_a","attempt_b");