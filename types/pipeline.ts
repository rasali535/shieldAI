import { z } from 'zod';

// Pipeline Status definition
export const PipelineStatusSchema = z.enum([
  'RAW_DETECTED',
  'RISK_QUALIFIED',
  'TARGETS_ENRICHED',
  'OUTREACH_GENERATED',
  'FAILED',
]);

export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

// Agent 1: Threat Intelligence Zod Payload
export const ThreatPayloadSchema = z.object({
  vendorName: z.string().min(1, 'Vendor name is required'),
  breachDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'Invalid date format',
  }),
  impactDescription: z.string().min(10, 'Impact description must be detailed'),
  advisoryUrl: z.string().url('Invalid advisory URL'),
  breachedDataTypes: z.array(z.string()).min(1, 'At least one breached data type must be specified'),
});

export type ThreatPayload = z.infer<typeof ThreatPayloadSchema>;

// Agent 2: Risk Assessment Zod Payload
export const RiskAnalysisSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  complianceImpacts: z.array(z.string()),
  score: z.number().min(0).max(100),
  justification: z.string().min(1, 'Justification is required'),
});

export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>;

// Agent 3: GTM Enrichment Targets
export const TargetContactSchema = z.object({
  name: z.string(),
  role: z.string(),
  email: z.string().email(),
});

export const EnrichedTargetSchema = z.object({
  companyName: z.string(),
  domain: z.string().url(),
  techStackSignals: z.array(z.string()),
  contacts: z.array(TargetContactSchema),
});

export const EnrichedTargetsPayloadSchema = z.array(EnrichedTargetSchema);

export type EnrichedTargetsPayload = z.infer<typeof EnrichedTargetsPayloadSchema>;

// Agent 4: Outreach Drafts
export const OutreachDraftSchema = z.object({
  companyName: z.string(),
  contactEmail: z.string().email(),
  contactName: z.string(),
  emailSubject: z.string(),
  emailBody: z.string(),
});

export const OutreachDraftsPayloadSchema = z.array(OutreachDraftSchema);

export type OutreachDraftsPayload = z.infer<typeof OutreachDraftsPayloadSchema>;

// Complete row schema matching the DB structure
export const PipelineRecordSchema = z.object({
  id: z.string().uuid(),
  status: PipelineStatusSchema,
  threat_source: z.string(),
  threat_payload: ThreatPayloadSchema,
  risk_score: z.number().min(0).max(100).nullable().optional(),
  risk_analysis: RiskAnalysisSchema.nullable().optional(),
  brightdata_job_id: z.string().nullable().optional(),
  enriched_targets: EnrichedTargetsPayloadSchema.nullable().optional(),
  outreach_drafts: OutreachDraftsPayloadSchema.nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PipelineRecord = z.infer<typeof PipelineRecordSchema>;
