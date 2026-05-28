import { supabase } from '../../lib/db/client';
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

/**
 * Speechmatics Voice Ingest Agent Endpoint
 * Receives an audio URL, transcribes it, extracts threat intelligence, and logs it to Supabase.
 */
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
    // 1. Transcribe the audio using Speechmatics
    const transcriptionResult = await transcribeAudioUrl(audioUrl);
    const transcriptText = transcriptionResult.text;

    console.log(`[Voice Ingest Agent] Transcription complete. Length: ${transcriptText.length} characters.`);
    console.log(`[Voice Ingest Agent] Transcript: "${transcriptText}"`);

    // 2. Perform AI-powered entity extraction & reasoning using AI/ML API
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
  "advisoryUrl": "URL to the official advisory (extract if mentioned, otherwise construct a reasonable placeholder link on the vendor domain)",
  "breachedDataTypes": ["array", "of", "breached", "data", "types"]
}`
          }
        ];
        const aiResponse = await chatCompletion(messages, {
          response_format: { type: 'json_object' }
        });
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
            console.log('[Voice Ingest Agent] Successfully parsed threat payload from voice using AI/ML API:', threatPayload);
          }
        }
      } catch (e: any) {
        console.warn('[Voice Ingest Agent] AI/ML API analysis of voice transcript failed, using fallback:', e.message);
      }
    }

    // 3. Validate threat payload structure with Zod
    const validationResult = ThreatPayloadSchema.safeParse(threatPayload);
    if (!validationResult.success) {
      console.error('[Voice Ingest Agent] Threat validation failed:', validationResult.error.format());
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.format(),
      });
    }

    // 4. Insert RAW_DETECTED record into Supabase
    const { data: record, error: dbError } = await supabase
      .from('security_threats_pipeline')
      .insert({
        status: 'RAW_DETECTED',
        threat_source: 'Speechmatics Voice Alert Ingest',
        threat_payload: validationResult.data,
      })
      .select('id, status')
      .single();

    if (dbError) {
      console.error('[Voice Ingest Agent] Database insert failed:', dbError);
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

    console.log(`[Voice Ingest Agent] Voice alert threat logged. Record ID: ${record.id}, Status: ${record.status}`);

    // 5. Propagate state to Agent 2 (Risk Assessment Agent)
    const propagationSuccess = await propagateWebhook('/api/webhook/assess', {
      recordId: record.id,
      status: 'RAW_DETECTED',
    });

    if (!propagationSuccess) {
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
      message: 'Audio alert transcribed, processed, and pipeline initiated.',
      recordId: record.id,
      transcript: transcriptText,
    });
  } catch (error: any) {
    console.error('[Voice Ingest Agent] Critical error inside voice handler:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
