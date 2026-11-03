CREATE TABLE "duel_players" (
	"duel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"time_ms" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"rating_before" integer NOT NULL,
	"rating_after" integer,
	"xp" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "duel_players_duel_id_user_id_pk" PRIMARY KEY("duel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"challenger_id" uuid NOT NULL,
	"opponent_id" uuid,
	"question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"winner_id" uuid
);
--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "duel_rating" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "duel_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "duel_losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "duel_draws" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "duel_players" ADD CONSTRAINT "duel_players_duel_id_duels_id_fk" FOREIGN KEY ("duel_id") REFERENCES "public"."duels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_players" ADD CONSTRAINT "duel_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duel_players_user_idx" ON "duel_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "duels_tenant_status_idx" ON "duels" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "duels_opponent_idx" ON "duels" USING btree ("opponent_id");