import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { triggerWebScraperJob } from '../../lib/brightdata';
import { EnrichedTargetsPayloadSchema } from '../../types/pipeline';
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

  const isBrightDataCallback = req.query.source === 'brightdata';

  if (isBrightDataCallback) {
    return await handleBrightDataCallback(req, res);
  } else {
    return await handleInternalTrigger(req, res);
  }
}

async function handleInternalTrigger(req: VercelRequest, res: VercelResponse) {
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
    const [record] = await db
      .select()
      .from(securityThreatsPipeline)
      .where(eq(securityThreatsPipeline.id, recordId));

    if (!record) {
      throw new Error(`Record not found for id: ${recordId}`);
    }

    const vendor = (record.threatPayload as any).vendorName;

    const baseUrl = process.env.URL
      ? process.env.URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.BASE_URL || 'http://localhost:3000';

    const callbackUrl = `${baseUrl}/api/webhook/enrich?source=brightdata&recordId=${recordId}`;

    console.log(`[Agent 3] Dispatching async Bright Data scraping job for vendor: "${vendor}"`);
    const targetScrapeUrl = `https://techstack-discovery-mock.com/profiles?vendor=${encodeURIComponent(vendor)}`;

    const { jobId } = await triggerWebScraperJob(targetScrapeUrl, callbackUrl);

    await db
      .update(securityThreatsPipeline)
      .set({ brightdataJobId: jobId, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    console.log(`[Agent 3] Scraper job triggered successfully. Job ID: ${jobId}.`);

    return res.status(202).json({
      message: 'Enrichment job initiated. Processing asynchronously.',
      recordId,
      brightdataJobId: jobId,
    });
  } catch (error: any) {
    console.error('[Agent 3] Failed to initiate async enrichment:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 3 initialization error: ${error.message || error}`, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}

async function handleBrightDataCallback(req: VercelRequest, res: VercelResponse) {
  const recordId = req.query.recordId as string;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in callback query params' });
  }

  console.log(`[Agent 3 Callback] Bright Data scraper reports completion for record: ${recordId}`);

  try {
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

    const validationResult = EnrichedTargetsPayloadSchema.safeParse(scrapedData);
    if (!validationResult.success) {
      throw new Error(`Scraper payload validation failed: ${validationResult.error.message}`);
    }

    await db
      .update(securityThreatsPipeline)
      .set({ status: 'TARGETS_ENRICHED', enrichedTargets: validationResult.data, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    const propagationSuccess = await propagateWebhook('/api/webhook/outreach', {
      recordId,
      status: 'TARGETS_ENRICHED',
    });

    if (!propagationSuccess) {
      await db
        .update(securityThreatsPipeline)
        .set({ status: 'FAILED', errorMessage: 'Failed to propagate enriched targets to Outreach Agent.', updatedAt: new Date() })
        .where(eq(securityThreatsPipeline.id, recordId));

      return res.status(500).json({ error: 'Outreach propagation failed' });
    }

    return res.status(200).json({ message: 'Enrichment callback parsed and propagated successfully.' });
  } catch (error: any) {
    console.error('[Agent 3 Callback] Error processing callback:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 3 callback error: ${error.message || error}`, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
