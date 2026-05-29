import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { searchSerpApi } from '../../lib/brightdata';
import { ThreatPayloadSchema, ThreatPayload } from '../../types/pipeline';
import { propagateWebhook } from '../../lib/webhook-helper';
import { chatCompletion } from '../../lib/aimlapi';

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
  send: (body: string) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('[Agent 1] Unauthorized cron attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Agent 1] Initiating Threat Intelligence Scan...');

  try {
    const searchQuery = 'site:security-advisory.example.com vendor data breach';
    console.log(`[Agent 1] Executing broad web scan with query: "${searchQuery}"`);
    const searchResults = await searchSerpApi(searchQuery);

    if (searchResults.length === 0) {
      console.log('[Agent 1] Scan complete. No new threat indicators detected.');
      return res.status(200).json({ message: 'No threats detected' });
    }

    const primaryResult = searchResults[0];

    let threatPayload: ThreatPayload = {
      vendorName: 'AcmeCloud Corp',
      breachDate: new Date().toISOString().split('T')[0],
      impactDescription: primaryResult.snippet || 'A major data breach exposing client session data and configuration endpoints.',
      advisoryUrl: primaryResult.link || 'https://security-advisory.example.com/advisory-102',
      breachedDataTypes: ['API Keys', 'Customer Records', 'Session Tokens'],
    };

    if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Agent 1] Analyzing threat indicators with AI/ML API...');
        const messages = [
          {
            role: 'system' as const,
            content: 'You are an advanced Threat Intelligence AI assistant. Analyze the provided web search results and extract security breach details in strict JSON format.',
          },
          {
            role: 'user' as const,
            content: `Analyze this search result:
Title: ${primaryResult.title}
Link: ${primaryResult.link}
Snippet: ${primaryResult.snippet}

Please respond with a JSON object matching this schema:
{
  "vendorName": "name of vendor breached",
  "breachDate": "YYYY-MM-DD format (use today's date if not found)",
  "impactDescription": "detailed impact description (at least 15 characters long describing what happened)",
  "advisoryUrl": "link to the advisory",
  "breachedDataTypes": ["array", "of", "breached", "data", "types"]
}`
          }
        ];
        const aiResponse = await chatCompletion(messages, { response_format: { type: 'json_object' } });
        if (aiResponse) {
          const parsed = JSON.parse(aiResponse);
          if (parsed.vendorName && parsed.impactDescription && parsed.advisoryUrl && Array.isArray(parsed.breachedDataTypes)) {
            threatPayload = {
              vendorName: parsed.vendorName,
              breachDate: parsed.breachDate || new Date().toISOString().split('T')[0],
              impactDescription: parsed.impactDescription,
              advisoryUrl: parsed.advisoryUrl,
              breachedDataTypes: parsed.breachedDataTypes
            };
          }
        }
      } catch (e: any) {
        console.warn('[Agent 1] AI/ML API parsing failed, falling back to mock structure:', e.message);
      }
    }

    const validationResult = ThreatPayloadSchema.safeParse(threatPayload);
    if (!validationResult.success) {
      console.error('[Agent 1] Threat validation failed:', validationResult.error.format());
      return res.status(400).json({ error: 'Validation failed', details: validationResult.error.format() });
    }

    const [record] = await db
      .insert(securityThreatsPipeline)
      .values({
        status: 'RAW_DETECTED',
        threatSource: 'Bright Data SERP API',
        threatPayload: validationResult.data,
      })
      .returning({ id: securityThreatsPipeline.id, status: securityThreatsPipeline.status });

    if (!record) {
      throw new Error('Database insert returned no record.');
    }

    console.log(`[Agent 1] State logged. Record ID: ${record.id}, Status: ${record.status}`);

    const propagationSuccess = await propagateWebhook('/api/webhook/assess', {
      recordId: record.id,
      status: 'RAW_DETECTED',
    });

    if (!propagationSuccess) {
      await db
        .update(securityThreatsPipeline)
        .set({ status: 'FAILED', errorMessage: 'Failed to propagate threat to Risk Assessment Agent webhook.', updatedAt: new Date() })
        .where(eq(securityThreatsPipeline.id, record.id));

      return res.status(500).json({ error: 'Propagation failed' });
    }

    return res.status(202).json({ message: 'Threat intelligence gathered and pipeline initiated.', recordId: record.id });
  } catch (error: any) {
    console.error('[Agent 1] Critical error inside cron handler:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
