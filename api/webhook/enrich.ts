import { supabase } from '../../lib/db/client';
import { triggerWebScraperJob } from '../../lib/brightdata';
import { EnrichedTargetsPayloadSchema, EnrichedTargetsPayload } from '../../types/pipeline';
import { verifySignature, propagateWebhook, signPayload } from '../../lib/webhook-helper';

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

  // Determine if this is a Bright Data Webhook Callback or an Internal Agent trigger
  const isBrightDataCallback = req.query.source === 'brightdata';

  if (isBrightDataCallback) {
    return await handleBrightDataCallback(req, res);
  } else {
    return await handleInternalTrigger(req, res);
  }
}

/**
 * Handle trigger from Agent 2 (Risk Assessment)
 * Kick off async Bright Data job and exit immediately to avoid timeouts
 */
async function handleInternalTrigger(req: VercelRequest, res: VercelResponse) {
  // 1. Verify internal HMAC signature
  const signature = req.headers['x-shieldradius-signature'] as string;
  if (!signature || !verifySignature(req.body, signature)) {
    console.error('[Agent 3] Invalid signature header.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { recordId } = req.body;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in payload' });
  }

  console.log(`[Agent 3] Initiating enrichment for record: ${recordId}`);

  try {
    // 2. Retrieve threat vendor info
    const { data: record, error: fetchError } = await supabase
      .from('security_threats_pipeline')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      throw new Error(`Record not found: ${fetchError?.message}`);
    }

    const vendor = record.threat_payload.vendorName;

    // 3. Define callback URL pointing back to ourselves with query param
    const baseUrl = process.env.URL
      ? process.env.URL
      : process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : process.env.BASE_URL || 'http://localhost:3000';
    
    // We add recordId in query parameters to map the async response back to the DB row
    const callbackUrl = `${baseUrl}/api/webhook/enrich?source=brightdata&recordId=${recordId}`;

    // 4. Trigger the Bright Data scraper job
    console.log(`[Agent 3] Dispatching async Bright Data scraping job for vendor: "${vendor}"`);
    const targetScrapeUrl = `https://techstack-discovery-mock.com/profiles?vendor=${encodeURIComponent(vendor)}`;
    
    const { jobId } = await triggerWebScraperJob(targetScrapeUrl, callbackUrl);

    // 5. Store the job_id in the database to reconcile later
    const { error: updateError } = await supabase
      .from('security_threats_pipeline')
      .update({
        brightdata_job_id: jobId,
        // Optional: you can set status or keep it RISK_QUALIFIED while job runs
      })
      .eq('id', recordId);

    if (updateError) {
      throw new Error(`Failed to update job ID: ${updateError.message}`);
    }

    console.log(`[Agent 3] Scraper job triggered successfully. Job ID: ${jobId}. Exiting function to avoid timeout.`);
    
    // 6. Return 202 accepted (acknowledging start of long-running job)
    return res.status(202).json({
      message: 'Enrichment job initiated. Processing asynchronously.',
      recordId,
      brightdataJobId: jobId,
    });
  } catch (error: any) {
    console.error('[Agent 3] Failed to initiate async enrichment:', error.message || error);
    await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'FAILED',
        error_message: `Agent 3 initialization error: ${error.message || error}`,
      })
      .eq('id', recordId);
    
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}

/**
 * Handle webhook callback sent by Bright Data when scraping concludes
 */
async function handleBrightDataCallback(req: VercelRequest, res: VercelResponse) {
  const recordId = req.query.recordId as string;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in callback query params' });
  }

  console.log(`[Agent 3 Callback] Bright Data scraper reports completion for record: ${recordId}`);

  try {
    // In production, Bright Data sends scraped data in the body
    // We mock/extract this data:
    const scrapedData = req.body.results || [
      {
        companyName: 'ApexCorp Finance',
        domain: 'https://apexcorp.com',
        techStackSignals: ['AcmeCloud API', 'React', 'AWS'],
        contacts: [
          { name: 'Sarah Connor', role: 'Chief Information Security Officer', email: 'sconnor@apexcorp.com' },
        ],
      },
      {
        companyName: 'Quantum Logistics',
        domain: 'https://quantumlogistics.com',
        techStackSignals: ['AcmeCloud Storage', 'PostgreSQL'],
        contacts: [
          { name: 'John Doe', role: 'VP of Infrastructure', email: 'jdoe@quantumlogistics.com' },
        ],
      },
    ];

    // Validate the schema using Zod
    const validationResult = EnrichedTargetsPayloadSchema.safeParse(scrapedData);
    if (!validationResult.success) {
      throw new Error(`Scraper payload validation failed: ${validationResult.error.message}`);
    }

    console.log(`[Agent 3 Callback] Enriched target profiles validated. Found ${validationResult.data.length} affected accounts.`);

    // Update state to 'TARGETS_ENRICHED' and store data
    const { error: dbError } = await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'TARGETS_ENRICHED',
        enriched_targets: validationResult.data,
      })
      .eq('id', recordId);

    if (dbError) {
      throw new Error(`Failed to update enriched data: ${dbError.message}`);
    }

    // Trigger Agent 4 (Autonomous Outreach Agent)
    const propagationSuccess = await propagateWebhook('/api/webhook/outreach', {
      recordId,
      status: 'TARGETS_ENRICHED',
    });

    if (!propagationSuccess) {
      await supabase
        .from('security_threats_pipeline')
        .update({
          status: 'FAILED',
          error_message: 'Failed to propagate enriched targets to Outreach Agent.',
        })
        .eq('id', recordId);
      
      return res.status(500).json({ error: 'Outreach propagation failed' });
    }

    return res.status(200).json({ message: 'Enrichment callback parsed and propagated successfully.' });
  } catch (error: any) {
    console.error('[Agent 3 Callback] Error processing callback:', error.message || error);
    await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'FAILED',
        error_message: `Agent 3 callback error: ${error.message || error}`,
      })
      .eq('id', recordId);
    
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
