CREATE TYPE "threat_pipeline_status" AS ENUM('RAW_DETECTED', 'RISK_QUALIFIED', 'TARGETS_ENRICHED', 'OUTREACH_GENERATED', 'FAILED');--> statement-breakpoint
CREATE TABLE "security_threats_pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" "threat_pipeline_status" DEFAULT 'RAW_DETECTED'::"threat_pipeline_status" NOT NULL,
	"threat_source" varchar(255) NOT NULL,
	"threat_payload" jsonb NOT NULL,
	"risk_score" integer,
	"risk_analysis" jsonb,
	"brightdata_job_id" varchar(255),
	"enriched_targets" jsonb,
	"outreach_drafts" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
