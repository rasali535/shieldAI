import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { RiskAnalysisSchema, RiskAnalysis } from '../../types/pipeline';
import { verifySignature, propagateWebhook } from '../../lib/webhook-helper';
import { deepSeekR1Completion } from '../../lib/aimlapi';

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

    // ── Static rule baseline (always computed, AI may override) ────────────
    let score = 50;
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';
    let complianceImpacts: string[] = ['SOC2'];
    let justification = `Threat involves compromise of ${breachedData.join(', ')} at ${payload.vendorName}, affecting operational compliance controls.`;

    if (breachedData.includes('API Keys') || breachedData.includes('Session Tokens')) {
      score = 95; severity = 'CRITICAL';
      complianceImpacts.push('GDPR', 'HIPAA');
    } else if (breachedData.includes('Customer Records')) {
      score = 80; severity = 'HIGH';
      complianceImpacts.push('GDPR');
    }

    // ── DeepSeek-R1 risk analysis (chain-of-thought reasoning) ─────────────
    if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Agent 2] Running deep risk analysis with DeepSeek-R1 (chain-of-thought)...');
        const messages = [
          {
            role: 'system' as const,
            content: 'You are an expert security compliance officer and risk analyst. Analyse the vendor breach and respond ONLY with a single valid JSON object — no markdown, no explanation, no code fences.',
          },
          {
            role: 'user' as const,
            content: `Evaluate risk for this security incident:
Vendor: ${payload.vendorName}
Breach Date: ${payload.breachDate}
Impact: ${payload.impactDescription}
Exposed Data: ${breachedData.join(', ')}

Return this exact JSON schema:
{
  "severity": "LOW" or "MEDIUM" or "HIGH" or "CRITICAL",
  "complianceImpacts": ["GDPR", "SOC2", "HIPAA", "PCI-DSS", "CCPA"],
  "score": integer 0-100,
  "justification": "detailed explanation"
}`
          }
        ];

        const aiResponse = await deepSeekR1Completion(messages, { max_tokens: 1024, temperature: 0.1 });

        if (aiResponse) {
          const clean = aiResponse.replace(/```json\n?|```\n?/g, '').trim();
          const parsed = JSON.parse(clean);
          if (parsed.severity && typeof parsed.score === 'number' && parsed.justification) {
            severity          = parsed.severity;
            score             = parsed.score;
            complianceImpacts = parsed.complianceImpacts || ['SOC2'];
            justification     = parsed.justification;
            console.log(`[Agent 2] DeepSeek-R1 scored: ${score}/100, severity=${severity}`);
          }
        }
      } catch (e: any) {
        console.warn('[Agent 2] DeepSeek-R1 assessment failed, using static rules:', e.message);
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

    const result = await propagateWebhook('/api/webhook/enrich', {
      recordId,
      status: 'RISK_QUALIFIED',
    });

    if (!result) {
      await db
        .update(securityThreatsPipeline)
        .set({ status: 'FAILED', errorMessage: 'Failed to propagate threat to GTM Enrichment Agent webhook.', updatedAt: new Date() })
        .where(eq(securityThreatsPipeline.id, recordId));
      return res.status(500).json({ error: 'Propagation failed' });
    }

    let finalRecord = typeof result === 'object' ? result : null;
    if (!finalRecord) {
      const [rec] = await db
        .select()
        .from(securityThreatsPipeline)
        .where(eq(securityThreatsPipeline.id, recordId));
      finalRecord = rec;
    }

    return res.status(200).json({ message: 'Risk assessment complete', recordId, score, severity, record: finalRecord });
  } catch (error: any) {
    console.error('[Agent 2] Risk evaluation failed:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 2 error: ${error.message || error}`, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
