-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing objects if they exist for clean execution
DROP TRIGGER IF EXISTS update_security_threats_pipeline_updated_at ON security_threats_pipeline;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP TABLE IF EXISTS security_threats_pipeline;
DROP TYPE IF EXISTS threat_pipeline_status;

-- Create Enum for pipeline status
CREATE TYPE threat_pipeline_status AS ENUM (
  'RAW_DETECTED', 
  'RISK_QUALIFIED', 
  'TARGETS_ENRICHED', 
  'OUTREACH_GENERATED', 
  'FAILED'
);

-- Create pipeline table
CREATE TABLE security_threats_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status threat_pipeline_status NOT NULL DEFAULT 'RAW_DETECTED',
  
  -- Agent 1 (Threat Intel) output
  threat_source VARCHAR(255) NOT NULL,
  threat_payload JSONB NOT NULL,
  
  -- Agent 2 (Risk Assessment) output
  risk_score INT CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_analysis JSONB,
  
  -- Agent 3 (GTM Enrichment) tracking and output
  brightdata_job_id VARCHAR(255),
  enriched_targets JSONB,
  
  -- Agent 4 (Autonomous Outreach) output
  outreach_drafts JSONB,
  
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexing for fast status queries and async job lookups
CREATE INDEX idx_threats_status ON security_threats_pipeline(status);
CREATE INDEX idx_threats_brightdata_job ON security_threats_pipeline(brightdata_job_id);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_security_threats_pipeline_updated_at
  BEFORE UPDATE ON security_threats_pipeline
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
