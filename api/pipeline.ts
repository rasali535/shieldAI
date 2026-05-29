import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { securityThreatsPipeline } from '../db/schema';

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const recordId = req.query.recordId;
  if (!recordId || typeof recordId !== 'string') {
    return res.status(400).json({ error: 'Missing recordId query' });
  }

  try {
    const [record] = await db
      .select()
      .from(securityThreatsPipeline)
      .where(eq(securityThreatsPipeline.id, recordId));

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    return res.status(200).json(record);
  } catch (error: any) {
    console.error('Fetch pipeline state failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
