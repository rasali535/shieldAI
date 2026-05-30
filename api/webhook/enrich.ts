import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { scrapeWebpage, parallelSerpSearch } from '../../lib/brightdata';
import { EnrichedTargetsPayloadSchema } from '../../types/pipeline';
import { verifySignature, propagateWebhook } from '../../lib/webhook-helper';
import { deepSeekCompletion } from '../../lib/aimlapi';

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

  if (req.body && req.body.__dbRecord) {
    const { hydrateMockStore } = require('../../db/index');
    hydrateMockStore(req.body.__dbRecord);
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

    const vendor   = (record.threatPayload as any).vendorName;
    let scrapeUrl  = (record.threatPayload as any).scrapeUrl;

    let scrapedText    = '';
    let scrapingSource = '';

    // ── Option A: scrape a specific URL via Bright Data Browser ─────────────
    if (scrapeUrl) {
      console.log(`[Agent 3] Connecting to Scraping Browser for: "${scrapeUrl}"`);
      scrapingSource = `Bright Data Browser: ${scrapeUrl}`;
      try {
        scrapedText = await scrapeWebpage(scrapeUrl);
        console.log(`[Agent 3] Scraped ${scrapedText.length} characters.`);
      } catch (err: any) {
        console.warn(`[Agent 3] Browser scraping failed: ${err.message}. Falling back to parallel SERP.`);
        scrapeUrl = null;
      }
    }

    // ── Option B: parallel SERP across multiple customer-discovery angles ────
    if (!scrapeUrl || !scrapedText) {
      const parallelQueries = [
        `companies using "${vendor}" customers tech stack`,
        `"${vendor}" clients site:linkedin.com OR site:crunchbase.com`,
        `"${vendor}" integration partners case study`,
        `"${vendor}" customer list enterprise software`,
      ];

      console.log(`[Agent 3] Running ${parallelQueries.length} parallel SERP queries for customer discovery...`);
      scrapingSource = `Bright Data SERP API (${parallelQueries.length} parallel queries)`;

      try {
        const results = await parallelSerpSearch(parallelQueries);
        scrapedText = results
          .map(r => `Title: ${r.title}\nSnippet: ${r.snippet}\nLink: ${r.link}`)
          .join('\n\n');
        console.log(`[Agent 3] Fetched ${results.length} unique results across all queries.`);
      } catch (err: any) {
        console.warn(`[Agent 3] Parallel SERP search failed: ${err.message}.`);
      }
    }

    // ── Default fallback targets ─────────────────────────────────────────────
    let enrichedTargets = [
      {
        companyName: 'ShieldedTech Solutions',
        domain: 'https://shieldedtech.com',
        techStackSignals: [vendor, 'Next.js', 'PostgreSQL'],
        contacts: [{ name: 'Bruce Wayne', role: 'CISO Officer', email: 'bwayne@shieldedtech.com' }]
      },
      {
        companyName: 'NovaBank Corp',
        domain: 'https://novabank.com',
        techStackSignals: [vendor, 'Okta', 'React'],
        contacts: [{ name: 'Diana Prince', role: 'Head of Information Security', email: 'dprince@novabank.com' }]
      }
    ];

    // ── DeepSeek-V3 extraction (wide 64k context — feeds all parallel results) ─
    if (scrapedText && process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Agent 3] Extracting client data with DeepSeek-V3 (wide-context)...');

        const prompt = `You are a tech stack discovery agent. Extract companies that use or are clients of "${vendor}" from the search results below.
Return ONLY a valid JSON array — no markdown, no explanation, no code fences.

Schema:
[
  {
    "companyName": "Company Name",
    "domain": "https://company-domain.com",
    "techStackSignals": ["${vendor}", "other tech"],
    "contacts": [
      { "name": "Full Name", "role": "Job Title (e.g. CISO, VP of IT)", "email": "contact@company.com" }
    ]
  }
]

Search results to analyse (${scrapedText.length} chars):
${scrapedText.substring(0, 6000)}`;

        const response = await deepSeekCompletion([
          { role: 'system', content: 'You extract client companies and contacts from raw text. Return only a valid JSON array.' },
          { role: 'user', content: prompt }
        ], { max_tokens: 2048, temperature: 0.1 });

        if (response) {
          const clean = response.replace(/```json\n?|```\n?/g, '').trim();
          let parsed = JSON.parse(clean);

          // Unwrap if wrapped in an object
          if (parsed && !Array.isArray(parsed)) {
            parsed = parsed.results || parsed.companies || parsed.data || [];
          }

          if (Array.isArray(parsed) && parsed.length > 0) {
            enrichedTargets = parsed.map((item: any) => ({
              companyName: item.companyName || 'Unknown Corp',
              domain: item.domain || 'https://unknown.com',
              techStackSignals: Array.isArray(item.techStackSignals) ? item.techStackSignals : [vendor],
              contacts: Array.isArray(item.contacts)
                ? item.contacts.map((c: any) => ({
                    name:  c.name  || 'Admin',
                    role:  c.role  || 'IT Lead',
                    email: c.email && c.email.includes('@') ? c.email : 'security@unknown.com'
                  }))
                : [{ name: 'Admin', role: 'IT Manager', email: 'security@unknown.com' }]
            }));
            console.log(`[Agent 3] DeepSeek extracted ${enrichedTargets.length} target accounts.`);
          }
        }
      } catch (err: any) {
        console.warn(`[Agent 3] DeepSeek extraction failed: ${err.message}. Using default targets.`);
      }
    }

    const validationResult = EnrichedTargetsPayloadSchema.safeParse(enrichedTargets);
    if (!validationResult.success) {
      throw new Error(`Validation failed for enriched targets: ${validationResult.error.message}`);
    }

    await db
      .update(securityThreatsPipeline)
      .set({
        status: 'TARGETS_ENRICHED',
        enrichedTargets: validationResult.data,
        brightdataJobId: scrapingSource,
        updatedAt: new Date()
      })
      .where(eq(securityThreatsPipeline.id, recordId));

    console.log(`[Agent 3] Targets enriched. Propagating to Outreach...`);

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

    return res.status(200).json({
      message: 'Enrichment completed and propagated.',
      recordId,
      source: scrapingSource,
      targetsCount: validationResult.data.length
    });

  } catch (error: any) {
    console.error('[Agent 3] Failed to execute enrichment:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 3 error: ${error.message || error}`, updatedAt: new Date() })
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
    const scrapedData = req.body.results || [];

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
