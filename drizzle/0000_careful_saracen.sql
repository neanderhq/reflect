CREATE TABLE "acknowledgments" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "acknowledgments_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "development_actions" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "development_actions_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "assignments_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "audit_events_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "cycles_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "nominations" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "nominations_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "notification_outbox_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "packets" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "packets_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "people_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"hash" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"person_id" text NOT NULL,
	"version" integer NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "summaries_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "templates_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth_throttles" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"person_id" text NOT NULL,
	"kind" text NOT NULL,
	"sealed" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packets" ADD CONSTRAINT "packets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_expiry" ON "sessions" USING btree ("expires");