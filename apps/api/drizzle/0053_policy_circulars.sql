CREATE TABLE "circular_acks" (
	"circular_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "circular_acks_circular_id_user_id_pk" PRIMARY KEY("circular_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "circulars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"require_ack" boolean DEFAULT false NOT NULL,
	"ack_by" text,
	"last_reminded_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "decide_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "placement_applications" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "circular_acks" ADD CONSTRAINT "circular_acks_circular_id_circulars_id_fk" FOREIGN KEY ("circular_id") REFERENCES "public"."circulars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circular_acks" ADD CONSTRAINT "circular_acks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circulars" ADD CONSTRAINT "circulars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "circular_acks_user_idx" ON "circular_acks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "circulars_tenant_idx" ON "circulars" USING btree ("tenant_id","created_at");