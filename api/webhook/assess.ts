import { supabase } from '../../lib/db/client';
import { RiskAnalysisSchema, RiskAnalysis } from '../../types/pipeline';
import { verifySignature, propagateWebhook } from '../../lib/webhook-helper';

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
  send: (body: string) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Verify incoming webhook signature
  const signature = req.headers['x-shieldradius-signature'] as string;
  if (!signature || !verifySignature(req.body, signature)) {
    console.error('[Agent 2] Invalid signature header.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { recordId } = req.body;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in payload' });
  }

  console.log(`[Agent 2] Running Risk Assessment for record: ${recordId}`);

  try {
    // 2. Fetch record from Supabase
    const { data: record, error: fetchError } = await supabase
      .from('security_threats_pipeline')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      throw new Error(`Record not found: ${fetchError?.message || 'No record returned'}`);
    }

    // 3. Compute Risk Analysis
    const payload = record.threat_payload;
    const breachedData = payload.breachedDataTypes || [];
    
    let score = 50;
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
    const complianceImpacts: string[] = ['SOC2'];

    if (breachedData.includes('API Keys') || breachedData.includes('Session Tokens')) {
      score = 95;
      severity = 'CRITICAL';
      complianceImpacts.push('GDPR', 'HIPAA');
    } else if (breachedData.includes('Customer Records')) {
      score = 80;
      severity = 'HIGH';
      complianceImpacts.push('GDPR');
    }

    const riskAnalysis: RiskAnalysis = {
      severity,
      complianceImpacts,
      score,
      justification: `Threat involves compromise of ${breachedData.join(', ')} at ${payload.vendorName}, affecting operational compliance controls.`,
    };

    // Validate structured object
    const validationResult = RiskAnalysisSchema.safeParse(riskAnalysis);
    if (!validationResult.success) {
      throw new Error(`Risk analysis validation failed: ${validationResult.error.message}`);
    }

    // 4. Update state in database
    const { error: updateError } = await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'RISK_QUALIFIED',
        risk_score: score,
        risk_analysis: validationResult.data,
      })
      .eq('id', recordId);

    if (updateError) {
      throw new Error(`Failed to update risk evaluation: ${updateError.message}`);
    }

    console.log(`[Agent 2] Risk assessment completed. Score: ${score}, Severity: ${severity}`);

    // 5. Propagate state to Agent 3 (GTM Enrichment Agent)
    const propagationSuccess = await propagateWebhook('/api/webhook/enrich', {
      recordId,
      status: 'RISK_QUALIFIED',
    });

    if (!propagationSuccess) {
      await supabase
        .from('security_threats_pipeline')
        .update({
          status: 'FAILED',
          error_message: 'Failed to propagate threat to GTM Enrichment Agent webhook.',
        })
        .eq('id', recordId);
      
      return res.status(500).json({ error: 'Propagation failed' });
    }

    return res.status(200).json({ message: 'Risk assessment complete', recordId });
  } catch (error: any) {
    console.error('[Agent 2] Risk evaluation failed:', error.message || error);
    await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'FAILED',
        error_message: `Agent 2 error: ${error.message || error}`,
      })
      .eq('id', recordId);
    
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
