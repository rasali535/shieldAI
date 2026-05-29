import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { RiskAnalysisSchema, RiskAnalysis } from '../../types/pipeline';
import { verifySignature, propagateWebhook } from '../../lib/webhook-helper';
import { chatCompletion } from '../../lib/aimlapi';

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

  const signature = req.headers['x-shieldradius-signature'] as string;
  if (!signature || !verifySignature(req.body, signature)) {
    console.error('[Agent 2] Invalid signature header.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Hydrate local mock store if database record state is passed in body (for stateless environments)
  if (req.body && req.body.__dbRecord) {
    const { hydrateMockStore } = require('../../db/index');
    hydrateMockStore(req.body.__dbRecord);
  }

  const { recordId } = req.body;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in payload' });
  }

  console.log(`[Agent 2] Running Risk Assessment for record: ${recordId}`);

  try {
    const [record] = await db
      .select()
      .from(securityThreatsPipeline)
      .where(eq(securityThreatsPipeline.id, recordId));

    if (!record) {
      throw new Error(`Record not found for id: ${recordId}`);
    }

    const payload = record.threatPayload as any;
    const breachedData: string[] = payload.breachedDataTypes || [];

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

    let memoryContextText = 'No previous memory found for this vendor.';

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

Historical Memory Context:
${memoryContextText}

Please respond with a JSON object matching this schema:
{
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "complianceImpacts": ["GDPR", "SOC2", "HIPAA", "PCI-DSS", "CCPA"],
  "score": 0 to 100 integer,
  "justification": "Detailed explanation"
}`
          }
        ];
        const aiResponse = await chatCompletion(messages, { response_format: { type: 'json_object' } });
        if (aiResponse) {
          const parsed = JSON.parse(aiResponse);
          if (parsed.severity && typeof parsed.score === 'number' && parsed.justification) {
            severity = parsed.severity;
            score = parsed.score;
            complianceImpacts = parsed.complianceImpacts || ['SOC2'];
            justification = parsed.justification;
          }
        }
      } catch (e: any) {
        console.warn('[Agent 2] AI/ML API risk assessment failed, falling back to static rules:', e.message);
      }
    }

    const riskAnalysis: RiskAnalysis = { severity, complianceImpacts, score, justification };

    const validationResult = RiskAnalysisSchema.safeParse(riskAnalysis);
    if (!validationResult.success) {
      throw new Error(`Risk analysis validation failed: ${validationResult.error.message}`);
    }


    await db
      .update(securityThreatsPipeline)
      .set({ status: 'RISK_QUALIFIED', riskScore: score, riskAnalysis: validationResult.data, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    console.log(`[Agent 2] Risk assessment completed. Score: ${score}, Severity: ${severity}`);

    const propagationSuccess = await propagateWebhook('/api/webhook/enrich', {
      recordId,
      status: 'RISK_QUALIFIED',
    });

    if (!propagationSuccess) {
      await db
        .update(securityThreatsPipeline)
        .set({ status: 'FAILED', errorMessage: 'Failed to propagate threat to GTM Enrichment Agent webhook.', updatedAt: new Date() })
        .where(eq(securityThreatsPipeline.id, recordId));

      return res.status(500).json({ error: 'Propagation failed' });
    }

    return res.status(200).json({ message: 'Risk assessment complete', recordId });
  } catch (error: any) {
    console.error('[Agent 2] Risk evaluation failed:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 2 error: ${error.message || error}`, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
