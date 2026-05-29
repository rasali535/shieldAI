import { pgTable, uuid, text, varchar, integer, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const threatPipelineStatus = pgEnum("threat_pipeline_status", [
  "RAW_DETECTED",
  "RISK_QUALIFIED",
  "TARGETS_ENRICHED",
  "OUTREACH_GENERATED",
  "FAILED",
]);

export const securityThreatsPipeline = pgTable("security_threats_pipeline", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: threatPipelineStatus("status").notNull().default("RAW_DETECTED"),
  threatSource: varchar("threat_source", { length: 255 }).notNull(),
  threatPayload: jsonb("threat_payload").notNull(),
  riskScore: integer("risk_score"),
  riskAnalysis: jsonb("risk_analysis"),
  brightdataJobId: varchar("brightdata_job_id", { length: 255 }),
  enrichedTargets: jsonb("enriched_targets"),
  outreachDrafts: jsonb("outreach_drafts"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
