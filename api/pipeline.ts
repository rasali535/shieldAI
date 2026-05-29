import { supabase } from '../lib/db/client';

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
  if (recordId === 'debug') {
    return res.status(200).json({
      supabaseUrl: process.env.SUPABASE_URL || 'missing',
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'missing',
      cronSecret: process.env.CRON_SECRET ? 'present' : 'missing',
      aimlApiKey: process.env.AIML_API_KEY ? 'present' : 'missing',
      nodeVersion: process.version,
    });
  }

  if (!recordId || typeof recordId !== 'string') {
    return res.status(400).json({ error: 'Missing recordId query' });
  }

  try {
    const { data: record, error: fetchError } = await supabase
      .from('security_threats_pipeline')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    return res.status(200).json(record);
  } catch (error: any) {
    console.error('Fetch pipeline state failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
