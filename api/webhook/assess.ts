import { supabase } from '../../lib/db/client';
import { RiskAnalysisSchema, RiskAnalysis } from '../../types/pipeline';
import { verifySignature, propagateWebhook } from '../../lib/webhook-helper';
import { chatCompletion } from '../../lib/aimlapi';
import { addMemory, searchMemory } from '../../lib/cognee';

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
    let complianceImpacts: string[] = ['SOC2'];
    let justification = `Threat involves compromise of ${breachedData.join(', ')} at ${payload.vendorName}, affecting operational compliance controls.`;

    if (breachedData.includes('API Keys') || breachedData.includes('Session Tokens')) {
      score = 95;
      severity = 'CRITICAL';
      complianceImpacts.push('GDPR', 'HIPAA');
    } else if (breachedData.includes('Customer Records')) {
      score = 80;
      severity = 'HIGH';
      complianceImpacts.push('GDPR');
    }

    // Retrieve historical Cognee memory context for this vendor
    let memoryContextText = 'No previous memory found for this vendor.';
    try {
      const memories = await searchMemory(payload.vendorName);
      if (memories && memories.length > 0) {
        memoryContextText = memories.map(m => `- ${m.content} (Relevance: ${m.relevance})`).join('\n');
        console.log(`[Agent 2] Retrieved Cognee memory for ${payload.vendorName}:`, memoryContextText);
      }
    } catch (memError: any) {
      console.warn('[Agent 2] Failed to fetch memory from Cognee:', memError.message);
    }

    if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Agent 2] Assessing risk dynamically using AI/ML API...');
        const messages = [
          {
            role: 'system' as const,
            content: 'You are an expert security compliance officer and risk analyst. Analyze the provided vendor breach payload and output risk metadata in strict JSON format.',
          },
          {
            role: 'user' as const,
            content: `Evaluate risk for the following security incident:
Vendor Name: ${payload.vendorName}
Breach Date: ${payload.breachDate}
Breach Impact: ${payload.impactDescription}
Exposed Data: ${breachedData.join(', ')}

Historical Memory Context (from Cognee):
${memoryContextText}

Please use the memory context above to inform your analysis. If previous assessments exist, maintain compliance assessment consistency unless the new breach indicators represent an escalation of risk.

Please respond with a JSON object matching this schema:
{
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "complianceImpacts": ["GDPR", "SOC2", "HIPAA", "PCI-DSS", "CCPA", etc.],
  "score": 0 to 100 (integer representing risk score),
  "justification": "Detailed explanation of the risk score and compliance impacts"
}`
          }
        ];
        const aiResponse = await chatCompletion(messages, {
          response_format: { type: 'json_object' }
        });
        if (aiResponse) {
          const parsed = JSON.parse(aiResponse);
          if (parsed.severity && typeof parsed.score === 'number' && parsed.justification) {
            severity = parsed.severity;
            score = parsed.score;
            complianceImpacts = parsed.complianceImpacts || ['SOC2'];
            justification = parsed.justification;
            console.log('[Agent 2] Dynamically assessed risk using AI/ML API:', { severity, score, complianceImpacts });
          }
        }
      } catch (e: any) {
        console.warn('[Agent 2] AI/ML API risk assessment failed, falling back to static rules:', e.message);
      }
    }

    const riskAnalysis: RiskAnalysis = {
      severity,
      complianceImpacts,
      score,
      justification,
    };

    // Validate structured object
    const validationResult = RiskAnalysisSchema.safeParse(riskAnalysis);
    if (!validationResult.success) {
      throw new Error(`Risk analysis validation failed: ${validationResult.error.message}`);
    }

    // Persist this assessment result to Cognee memory for persistent future context
    try {
      const memoryString = `Incident Memory: Vendor ${payload.vendorName} security incident on ${payload.breachDate} was assessed with a Risk Score of ${score} (${severity}). Justification: ${justification}. Compliance Impacts: ${complianceImpacts.join(', ')}.`;
      await addMemory(memoryString);
    } catch (memStoreError: any) {
      console.warn('[Agent 2] Failed to save assessment to Cognee memory:', memStoreError.message);
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
