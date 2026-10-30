CREATE TABLE "peer_feedback" (
	"session_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"partner_absent" boolean DEFAULT false NOT NULL,
	"ratings" jsonb,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "peer_feedback_session_id_from_id_pk" PRIMARY KEY("session_id","from_id")
);
--> statement-breakpoint
CREATE TABLE "peer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"track" text NOT NULL,
	"mode" text NOT NULL,
	"windows" jsonb NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"track" text NOT NULL,
	"mode" text NOT NULL,
	"place" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"seed" integer NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancelled_by" uuid,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_digests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_week" text
);
--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_session_id_peer_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."peer_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_feedback" ADD CONSTRAINT "peer_feedback_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_requests" ADD CONSTRAINT "peer_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_requests" ADD CONSTRAINT "peer_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_a_id_users_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_sessions" ADD CONSTRAINT "peer_sessions_b_id_users_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_digests" ADD CONSTRAINT "staff_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peer_feedback_to_idx" ON "peer_feedback" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "peer_requests_tenant_idx" ON "peer_requests" USING btree ("tenant_id","status","track");--> statement-breakpoint
CREATE INDEX "peer_sessions_a_idx" ON "peer_sessions" USING btree ("a_id");--> statement-breakpoint
CREATE INDEX "peer_sessions_b_idx" ON "peer_sessions" USING btree ("b_id");--> statement-breakpoint
CREATE INDEX "peer_sessions_tenant_idx" ON "peer_sessions" USING btree ("tenant_id","starts_at");