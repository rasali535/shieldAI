import { supabase } from '../../lib/db/client';
import { searchSerpApi } from '../../lib/brightdata';
import { ThreatPayloadSchema, ThreatPayload } from '../../types/pipeline';
import { propagateWebhook } from '../../lib/webhook-helper';

// Interface for standard Vercel Serverless Function signature
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
  // 1. Verify Vercel Cron Secret (Standard Security Practice)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('[Agent 1] Unauthorized cron attempt.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Agent 1] Initiating Threat Intelligence Scan...');

  try {
    // 2. Query Bright Data SERP API for recent breach advisory pages
    const searchQuery = 'site:security-advisory.example.com vendor data breach';
    console.log(`[Agent 1] Executing broad web scan with query: "${searchQuery}"`);
    const searchResults = await searchSerpApi(searchQuery);

    if (searchResults.length === 0) {
      console.log('[Agent 1] Scan complete. No new threat indicators detected.');
      return res.status(200).json({ message: 'No threats detected' });
    }

    // 3. Process the first detected threat (or iterate over all)
    const primaryResult = searchResults[0];
    
    // Structure threat payload matching schema
    const threatPayload: ThreatPayload = {
      vendorName: 'AcmeCloud Corp', // In production, extract this dynamically from result.title
      breachDate: new Date().toISOString().split('T')[0],
      impactDescription: primaryResult.snippet || 'A major data breach exposing client session data and configuration endpoints.',
      advisoryUrl: primaryResult.link || 'https://security-advisory.example.com/advisory-102',
      breachedDataTypes: ['API Keys', 'Customer Records', 'Session Tokens'],
    };

    // 4. Validate the payload using Zod
    const validationResult = ThreatPayloadSchema.safeParse(threatPayload);
    if (!validationResult.success) {
      console.error('[Agent 1] Threat validation failed:', validationResult.error.format());
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.format(),
      });
    }

    console.log('[Agent 1] Threat payload validated successfully.');

    // 5. Store initial state in Supabase 'RAW_DETECTED'
    const { data: record, error: dbError } = await supabase
      .from('security_threats_pipeline')
      .insert({
        status: 'RAW_DETECTED',
        threat_source: 'Bright Data SERP API',
        threat_payload: validationResult.data,
      })
      .select('id, status')
      .single();

    console.log('[Agent 1] Supabase insert result:', { record, dbError });

    if (dbError) {
      console.error('[Agent 1] Detailed database insert error:', JSON.stringify(dbError, null, 2), dbError);
      throw new Error(`Database insert failed: ${dbError.message || JSON.stringify(dbError)}`);
    }

    console.log(`[Agent 1] State logged. Record ID: ${record.id}, Status: ${record.status}`);

    // 6. Propagate state to Agent 2 (Risk Assessment Agent)
    const propagationSuccess = await propagateWebhook('/api/webhook/assess', {
      recordId: record.id,
      status: 'RAW_DETECTED',
    });

    if (!propagationSuccess) {
      // Update record to FAILED if propagation fails
      await supabase
        .from('security_threats_pipeline')
        .update({
          status: 'FAILED',
          error_message: 'Failed to propagate threat to Risk Assessment Agent webhook.',
        })
        .eq('id', record.id);
      
      return res.status(500).json({ error: 'Propagation failed' });
    }

    return res.status(202).json({
      message: 'Threat intelligence gathered and pipeline initiated.',
      recordId: record.id,
    });
  } catch (error: any) {
    console.error('[Agent 1] Critical error inside cron handler:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
