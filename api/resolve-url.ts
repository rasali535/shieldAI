import { deepSeekCompletion } from '../lib/aimlapi';
import { searchSerpApi } from '../lib/brightdata';

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
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const company = (req.method === 'GET' ? req.query.company : req.body.company);

  if (!company || typeof company !== 'string' || !company.trim()) {
    return res.status(400).json({ error: 'Missing company query/body parameter' });
  }

  const query = company.trim();
  console.log(`[URL Resolver] Resolving URL for company: "${query}"`);

  try {
    // 1. Search SERP for the company's official homepage
    const searchResults = await searchSerpApi(`${query} official website homepage domain`);
    const resultsContext = searchResults
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] Title: "${r.title}"\nLink: "${r.link}"\nSnippet: "${r.snippet}"`)
      .join('\n\n');

    // 2. Prompt DeepSeek to extract the best URL
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      {
        role: 'system',
        content: `You are an expert website URL extractor. Given a company name and a list of search results, you must extract or output the official homepage website URL for that company.
Format requirements:
- Respond ONLY with a single valid absolute website URL (e.g., "https://www.snowflake.com" or "https://okta.com").
- Do NOT include any markdown code blocks, explanation text, or extra characters. Just the URL string.`,
      },
      {
        role: 'user',
        content: `Company: ${query}

Search Results:
${resultsContext || 'None available.'}

Based on this, what is the official website URL of the company?`,
      },
    ];

    let resolvedUrl = await deepSeekCompletion(messages, { max_tokens: 128, temperature: 0.1 });
    resolvedUrl = resolvedUrl.replace(/```[a-z]*\n?|```\n?/gi, '').trim();

    // Verify it is a valid URL, otherwise fall back to simple prediction
    try {
      new URL(resolvedUrl);
    } catch (_) {
      const cleanName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      resolvedUrl = `https://www.${cleanName}.com`;
    }

    console.log(`[URL Resolver] Resolved to: "${resolvedUrl}"`);
    return res.status(200).json({ url: resolvedUrl });
  } catch (error: any) {
    console.error('[URL Resolver] Resolution failed:', error.message || error);
    const cleanName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    return res.status(200).json({ url: `https://www.${cleanName}.com` });
  }
}
