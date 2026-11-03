CREATE TABLE "alumni" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"graduation_year" integer NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"company" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"open_to_referrals" boolean DEFAULT false NOT NULL,
	"open_to_advice" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_intros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alumnus_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"section" text NOT NULL,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"reviewer_id" uuid,
	"verdict" text,
	"summary" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alumni" ADD CONSTRAINT "alumni_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_intros" ADD CONSTRAINT "alumni_intros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_intros" ADD CONSTRAINT "alumni_intros_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_intros" ADD CONSTRAINT "alumni_intros_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_comments" ADD CONSTRAINT "resume_comments_review_id_resume_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."resume_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_reviews" ADD CONSTRAINT "resume_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_reviews" ADD CONSTRAINT "resume_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alumni_tenant_idx" ON "alumni" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "alumni_intros_tenant_idx" ON "alumni_intros" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "alumni_intros_user_idx" ON "alumni_intros" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resume_reviews_tenant_idx" ON "resume_reviews" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "resume_reviews_user_idx" ON "resume_reviews" USING btree ("user_id");