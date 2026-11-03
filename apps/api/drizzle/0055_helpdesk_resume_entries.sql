CREATE TABLE "help_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"from_staff" boolean NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"correction" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"organisation" text DEFAULT '' NOT NULL,
	"start_month" text NOT NULL,
	"end_month" text,
	"description" text DEFAULT '' NOT NULL,
	"link" text,
	"verification" text DEFAULT 'none' NOT NULL,
	"verification_note" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "help_messages" ADD CONSTRAINT "help_messages_ticket_id_help_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."help_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_messages" ADD CONSTRAINT "help_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_tickets" ADD CONSTRAINT "help_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_tickets" ADD CONSTRAINT "help_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_entries" ADD CONSTRAINT "resume_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_entries" ADD CONSTRAINT "resume_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_messages_ticket_idx" ON "help_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "help_tickets_tenant_idx" ON "help_tickets" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "help_tickets_user_idx" ON "help_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resume_entries_user_idx" ON "resume_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resume_entries_tenant_idx" ON "resume_entries" USING btree ("tenant_id","verification");