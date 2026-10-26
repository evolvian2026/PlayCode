CREATE TABLE "live_quiz_answers" (
	"quiz_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_index" integer NOT NULL,
	"response" jsonb NOT NULL,
	"correct" boolean NOT NULL,
	"points" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_quiz_answers_quiz_id_user_id_question_index_pk" PRIMARY KEY("quiz_id","user_id","question_index")
);
--> statement-breakpoint
CREATE TABLE "live_quiz_players" (
	"quiz_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"last_scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_quiz_players_quiz_id_user_id_pk" PRIMARY KEY("quiz_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "live_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"question_ids" jsonb NOT NULL,
	"seconds_per_question" integer NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"current_index" integer DEFAULT -1 NOT NULL,
	"question_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "live_quiz_answers" ADD CONSTRAINT "live_quiz_answers_quiz_id_live_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."live_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quiz_answers" ADD CONSTRAINT "live_quiz_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quiz_players" ADD CONSTRAINT "live_quiz_players_quiz_id_live_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."live_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quiz_players" ADD CONSTRAINT "live_quiz_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quizzes" ADD CONSTRAINT "live_quizzes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_quizzes" ADD CONSTRAINT "live_quizzes_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_quizzes_code_idx" ON "live_quizzes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "live_quizzes_tenant_idx" ON "live_quizzes" USING btree ("tenant_id","created_at");