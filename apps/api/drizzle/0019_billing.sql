CREATE TABLE "billing_profiles" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"address" text NOT NULL,
	"state_code" text,
	"email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period" text NOT NULL,
	"plan" text NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"cgst_paise" integer NOT NULL,
	"sgst_paise" integer NOT NULL,
	"igst_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"bill_to" jsonb NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_period_uq" ON "invoices" USING btree ("tenant_id","period");