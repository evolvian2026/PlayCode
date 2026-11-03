CREATE TABLE "contest_results" (
	"contest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"participants" integer NOT NULL,
	"solved" integer NOT NULL,
	"penalty" integer NOT NULL,
	"rating_before" integer NOT NULL,
	"rating_after" integer NOT NULL,
	"certificate_code" text,
	CONSTRAINT "contest_results_contest_id_user_id_pk" PRIMARY KEY("contest_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "contest_rating" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "contests_rated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contest_results_user_idx" ON "contest_results" USING btree ("user_id");