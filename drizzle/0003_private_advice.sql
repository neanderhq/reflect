CREATE TABLE "advice_requests" (
	"company_id" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "advice_requests_company_id_id_pk" PRIMARY KEY("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "advice_requests" ADD CONSTRAINT "advice_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;