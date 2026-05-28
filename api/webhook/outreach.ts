import { supabase } from '../../lib/db/client';
import { OutreachDraftsPayloadSchema, OutreachDraftsPayload } from '../../types/pipeline';
import { verifySignature } from '../../lib/webhook-helper';
import { chatCompletion } from '../../lib/aimlapi';
import { addMemory } from '../../lib/cognee';

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

  // 1. Verify incoming webhook signature
  const signature = req.headers['x-shieldradius-signature'] as string;
  if (!signature || !verifySignature(req.body, signature)) {
    console.error('[Agent 4] Invalid signature header.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { recordId } = req.body;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in payload' });
  }

  console.log(`[Agent 4] Synthesizing Outreach briefs for record: ${recordId}`);

  try {
    // 2. Fetch record from Supabase
    const { data: record, error: fetchError } = await supabase
      .from('security_threats_pipeline')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !record) {
      throw new Error(`Record not found: ${fetchError?.message}`);
    }

    const threat = record.threat_payload;
    const targets = record.enriched_targets || [];

    // 3. Generate hyper-personalized outreach campaigns
    const outreachDrafts: OutreachDraftsPayload = await Promise.all(
      targets.map(async (target: any) => {
        const primaryContact = target.contacts[0] || { name: 'IT Security Lead', role: 'Security Ops', email: 'security@company.com' };
        
        let subject = `Urgent Compliance & Risk Assessment regarding ${threat.vendorName}`;
        let body = `Hi ${primaryContact.name},\n\n` +
          `I am reaching out from ShieldRadius AI because we detected a major security incident at ${threat.vendorName} on ${threat.breachDate}. ` +
          `Our signals show that your tech stack utilizes services from ${threat.vendorName}, placing you at risk.\n\n` +
          `Incident Details:\n` +
          `- Exposed Assets: ${threat.breachedDataTypes.join(', ')}\n` +
          `- Threat Description: ${threat.impactDescription}\n` +
          `- Official Advisory: ${threat.advisoryUrl}\n\n` +
          `Given your role as ${primaryContact.role} at ${target.companyName}, we wanted to share our preliminary mitigation checklist to protect your integration channels. ` +
          `Please let us know if you would like to run a dedicated security scan.\n\n` +
          `Best regards,\n` +
          `ShieldRadius Autonomous Response Team`;

        if (process.env.AIML_API_KEY && process.env.AIML_API_KEY !== 'your_aiml_api_key') {
          try {
            console.log(`[Agent 4] Generating AI-personalized email for ${target.companyName}...`);
            const messages = [
              {
                role: 'system' as const,
                content: 'You are an elite, highly professional cybersecurity outreach agent. Generate a concise, urgent, but non-alarmist and helpful security notification email to the contact in JSON format.',
              },
              {
                role: 'user' as const,
                content: `Security Incident:
Vendor: ${threat.vendorName}
Breach Date: ${threat.breachDate}
Incident Details: ${threat.impactDescription}
Exposed Data: ${threat.breachedDataTypes.join(', ')}
Advisory URL: ${threat.advisoryUrl}

Recipient details:
Name: ${primaryContact.name}
Role: ${primaryContact.role}
Company: ${target.companyName}
Tech Stack Signals: ${target.techStackSignals.join(', ')}

Please respond with a JSON object matching this schema:
{
  "subject": "Clear, professional, urgent subject line",
  "body": "Highly professional email body tailored to their role and tech stack. Emphasize how ShieldRadius AI can help, reference the exact exposed assets, and include a helpful checklist. Signature should be 'ShieldRadius Autonomous Response Team'."
}`
              }
            ];
            const aiResponse = await chatCompletion(messages, {
              response_format: { type: 'json_object' }
            });
            if (aiResponse) {
              const parsed = JSON.parse(aiResponse);
              if (parsed.subject && parsed.body) {
                subject = parsed.subject;
                body = parsed.body;
                console.log(`[Agent 4] Successfully generated AI-personalized email for ${target.companyName}`);
              }
            }
          } catch (e: any) {
            console.warn(`[Agent 4] AI email generation failed for ${target.companyName}, using template:`, e.message);
          }
        }

        return {
          companyName: target.companyName,
          contactEmail: primaryContact.email,
          contactName: primaryContact.name,
          emailSubject: subject,
          emailBody: body,
        };
      })
    );

    // 4. Validate output schema using Zod
    const validationResult = OutreachDraftsPayloadSchema.safeParse(outreachDrafts);
    if (!validationResult.success) {
      throw new Error(`Outreach payload validation failed: ${validationResult.error.message}`);
    }

    // 5. Update state in database to 'OUTREACH_GENERATED'
    const { error: dbError } = await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'OUTREACH_GENERATED',
        outreach_drafts: validationResult.data,
      })
      .eq('id', recordId);

    if (dbError) {
      throw new Error(`Failed to update outreach drafts: ${dbError.message}`);
    }

    // Persist outreach briefs to Cognee memory so the agent has a trace of what was communicated
    try {
      for (const draft of validationResult.data) {
        const memoryString = `Outreach Memory: Generated notification for contact ${draft.contactName} (${draft.contactEmail}) at ${draft.companyName} regarding the incident with ${threat.vendorName}. Subject: "${draft.emailSubject}".`;
        await addMemory(memoryString);
      }
    } catch (memStoreError: any) {
      console.warn('[Agent 4] Failed to save outreach details to Cognee memory:', memStoreError.message);
    }

    console.log(`[Agent 4] Outreach successfully compiled for ${validationResult.data.length} targets. Pipeline complete!`);

    return res.status(200).json({
      message: 'Autonomous outreach briefs generated successfully. Pipeline execution complete.',
      recordId,
      draftCount: validationResult.data.length,
    });
  } catch (error: any) {
    console.error('[Agent 4] Outreach compilation failed:', error.message || error);
    await supabase
      .from('security_threats_pipeline')
      .update({
        status: 'FAILED',
        error_message: `Agent 4 error: ${error.message || error}`,
      })
      .eq('id', recordId);

    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
