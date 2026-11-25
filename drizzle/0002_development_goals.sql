CREATE TABLE "development_goals" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "development_goals_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "development_goals" ADD CONSTRAINT "development_goals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;