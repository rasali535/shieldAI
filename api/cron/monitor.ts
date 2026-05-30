import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { parallelSerpSearch } from '../../lib/brightdata';
import { ThreatPayloadSchema, ThreatPayload } from '../../types/pipeline';
import { propagateWebhook } from '../../lib/webhook-helper';
import { deepSeekCompletion } from '../../lib/aimlapi';

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

  if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
    console.error('[Agent 1] Unauthorized cron attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Agent 1] Initiating Threat Intelligence Scan...');

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const queryParams = req.query || {};

    const customVendor = body.customVendor || body.simulateVendor || queryParams.vendor;
    const customQuery  = body.customQuery  || queryParams.query;
    const scrapeUrl    = body.scrapeUrl    || queryParams.scrapeUrl;

    // ── Build a set of parallel search angles for broader coverage ──────────
    const baseQuery = (customQuery && typeof customQuery === 'string')
      ? customQuery
      : 'vendor data breach security advisory';

    const parallelQueries = [
      baseQuery,
      `${baseQuery} CVE vulnerability 2024 2025`,
      `${baseQuery} site:nvd.nist.gov OR site:cve.mitre.org`,
      `${baseQuery} incident report exposed credentials`,
    ];

    console.log(`[Agent 1] Firing ${parallelQueries.length} parallel SERP queries for wider coverage...`);
    const searchResults = await parallelSerpSearch(parallelQueries);

    if (searchResults.length === 0) {
      console.log('[Agent 1] Scan complete. No new threat indicators detected.');
      return res.status(200).json({ message: 'No threats detected' });
    }

    // Use the top result as primary, pass context from all results to DeepSeek
    const primaryResult = searchResults[0];
    const contextSnippets = searchResults
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.link}`)
      .join('\n\n');

    let threatPayload: ThreatPayload = {
      vendorName: (customVendor && customVendor !== 'CUSTOM') ? customVendor : 'AcmeCloud Corp',
      breachDate: new Date().toISOString().split('T')[0],
      impactDescription: primaryResult.snippet || 'A major data breach exposing client session data and configuration endpoints.',
      advisoryUrl: primaryResult.link || 'https://security-advisory.example.com/advisory-102',
      breachedDataTypes: ['API Keys', 'Customer Records', 'Session Tokens'],
      scrapeUrl: scrapeUrl || undefined,
    };

    if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Agent 1] Analysing threat indicators with DeepSeek-V3 (wide context)...');
        const messages = [
          {
            role: 'system' as const,
            content: 'You are an advanced Threat Intelligence AI. Analyse the provided web search results and extract security breach details. Respond ONLY with a single valid JSON object — no markdown, no explanation.',
          },
          {
            role: 'user' as const,
            content: `Analyse the following ${searchResults.length} search results about a security incident:\n\n${contextSnippets}\n\nReturn a JSON object with this exact schema:\n{\n  "vendorName": "name of vendor breached",\n  "breachDate": "YYYY-MM-DD",\n  "impactDescription": "detailed impact description (minimum 15 characters)",\n  "advisoryUrl": "primary advisory URL",\n  "breachedDataTypes": ["array", "of", "data", "types"]\n}`
          }
        ];

        const aiResponse = await deepSeekCompletion(messages, {
          max_tokens: 1024,
          temperature: 0.1,
        });

        if (aiResponse) {
          // Strip any accidental markdown code fences
          const clean = aiResponse.replace(/```json\n?|```\n?/g, '').trim();
          const parsed = JSON.parse(clean);
          if (parsed.vendorName && parsed.impactDescription && parsed.advisoryUrl && Array.isArray(parsed.breachedDataTypes)) {
            // Validate date: DeepSeek may return empty string, 'unknown', or wrong format
            const today = new Date().toISOString().split('T')[0];
            const dateStr = parsed.breachDate || '';
            const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
            threatPayload = {
              vendorName: parsed.vendorName,
              breachDate: isValidDate ? dateStr : today,
              impactDescription: parsed.impactDescription,
              advisoryUrl: parsed.advisoryUrl,
              breachedDataTypes: parsed.breachedDataTypes,
              scrapeUrl: scrapeUrl || undefined,
            };
            console.log(`[Agent 1] DeepSeek extracted: vendor="${threatPayload.vendorName}", date=${threatPayload.breachDate}`);
          }
        }
      } catch (e: any) {
        console.warn('[Agent 1] DeepSeek parsing failed, falling back to primary SERP result:', e.message);
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
        threatSource: `Bright Data SERP API (${searchResults.length} results, ${parallelQueries.length} parallel queries)`,
        threatPayload: validationResult.data,
      })
      .returning({ id: securityThreatsPipeline.id, status: securityThreatsPipeline.status });

    if (!record) {
      throw new Error('Database insert returned no record.');
    }

    console.log(`[Agent 1] State logged. Record ID: ${record.id}, Status: ${record.status}`);

    const result = await propagateWebhook('/api/webhook/assess', {
      recordId: record.id,
      status: 'RAW_DETECTED',
    });

    if (!result) {
      await db
        .update(securityThreatsPipeline)
        .set({ status: 'FAILED', errorMessage: 'Failed to propagate threat to Risk Assessment Agent webhook.', updatedAt: new Date() })
        .where(eq(securityThreatsPipeline.id, record.id));

      return res.status(500).json({ error: 'Propagation failed' });
    }

    let finalRecord = typeof result === 'object' ? result : null;
    if (!finalRecord) {
      const [rec] = await db
        .select()
        .from(securityThreatsPipeline)
        .where(eq(securityThreatsPipeline.id, record.id));
      finalRecord = rec;
    }

    return res.status(200).json({
      message: 'Threat intelligence gathered and pipeline completed.',
      recordId: record.id,
      searchCoverage: { queries: parallelQueries.length, results: searchResults.length },
      record: finalRecord,
    });
  } catch (error: any) {
    console.error('[Agent 1] Critical error inside cron handler:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
