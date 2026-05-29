import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { transcribeAudioUrl } from '../../lib/speechmatics';
import { chatCompletion } from '../../lib/aimlapi';
import { ThreatPayloadSchema, ThreatPayload } from '../../types/pipeline';
import { propagateWebhook } from '../../lib/webhook-helper';

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

  const { audioUrl } = req.body;
  if (!audioUrl) {
    return res.status(400).json({ error: 'Missing audioUrl in request body' });
  }

  console.log(`[Voice Ingest Agent] Initiating speech-to-text threat processing for: ${audioUrl}`);

  try {
    const transcriptionResult = await transcribeAudioUrl(audioUrl);
    const transcriptText = transcriptionResult.text;

    console.log(`[Voice Ingest Agent] Transcription complete. Length: ${transcriptText.length} characters.`);

    let threatPayload: ThreatPayload = {
      vendorName: 'AcmeCloud Corp',
      breachDate: new Date().toISOString().split('T')[0],
      impactDescription: transcriptText,
      advisoryUrl: 'https://security-advisory.example.com/voice-alert',
      breachedDataTypes: ['API Keys', 'Customer Records'],
    };

    if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
      try {
        console.log('[Voice Ingest Agent] Parsing transcription with AI/ML API...');
        const messages = [
          {
            role: 'system' as const,
            content: 'You are an advanced Threat Intelligence AI assistant. Analyze the transcribed speech text from a security podcast or audio advisory and extract breach details in strict JSON format.',
          },
          {
            role: 'user' as const,
            content: `Analyze this transcript text:
"${transcriptText}"

Please respond with a JSON object matching this schema:
{
  "vendorName": "name of vendor/company breached",
  "breachDate": "YYYY-MM-DD format (use today's date if not specified)",
  "impactDescription": "detailed impact description (at least 15 characters long summarizing the incident)",
  "advisoryUrl": "URL to the official advisory",
  "breachedDataTypes": ["array", "of", "breached", "data", "types"]
}`
          }
        ];
        const aiResponse = await chatCompletion(messages, { response_format: { type: 'json_object' } });
        if (aiResponse) {
          const parsed = JSON.parse(aiResponse);
          if (parsed.vendorName && parsed.impactDescription && Array.isArray(parsed.breachedDataTypes)) {
            threatPayload = {
              vendorName: parsed.vendorName,
              breachDate: parsed.breachDate || new Date().toISOString().split('T')[0],
              impactDescription: parsed.impactDescription,
              advisoryUrl: parsed.advisoryUrl || 'https://security-advisory.example.com/voice-alert',
              breachedDataTypes: parsed.breachedDataTypes
            };
          }
        }
      } catch (e: any) {
        console.warn('[Voice Ingest Agent] AI/ML API analysis of voice transcript failed, using fallback:', e.message);
      }
    }

    const validationResult = ThreatPayloadSchema.safeParse(threatPayload);
    if (!validationResult.success) {
      console.error('[Voice Ingest Agent] Threat validation failed:', validationResult.error.format());
      return res.status(400).json({ error: 'Validation failed', details: validationResult.error.format() });
    }

    const [record] = await db
      .insert(securityThreatsPipeline)
      .values({
        status: 'RAW_DETECTED',
        threatSource: 'Speechmatics Voice Alert Ingest',
        threatPayload: validationResult.data,
      })
      .returning({ id: securityThreatsPipeline.id, status: securityThreatsPipeline.status });

    if (!record) {
      throw new Error('Database insert returned no record.');
    }

    console.log(`[Voice Ingest Agent] Voice alert threat logged. Record ID: ${record.id}, Status: ${record.status}`);

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

    return res.status(202).json({
      message: 'Audio alert transcribed, processed, and pipeline initiated.',
      recordId: record.id,
      transcript: transcriptText,
    });
  } catch (error: any) {
    console.error('[Voice Ingest Agent] Critical error inside voice handler:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
