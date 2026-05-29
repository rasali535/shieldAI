import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { securityThreatsPipeline } from '../../db/schema';
import { OutreachDraftsPayloadSchema, OutreachDraftsPayload } from '../../types/pipeline';
import { verifySignature } from '../../lib/webhook-helper';
import { chatCompletion } from '../../lib/aimlapi';

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

  const signature = req.headers['x-shieldradius-signature'] as string;
  if (!signature || !verifySignature(req.body, signature)) {
    console.error('[Agent 4] Invalid signature header.');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Hydrate local mock store if database record state is passed in body (for stateless environments)
  if (req.body && req.body.__dbRecord) {
    const { hydrateMockStore } = require('../../db/index');
    hydrateMockStore(req.body.__dbRecord);
  }

  const { recordId } = req.body;
  if (!recordId) {
    return res.status(400).json({ error: 'Missing recordId in payload' });
  }

  console.log(`[Agent 4] Synthesizing Outreach briefs for record: ${recordId}`);

  try {
    const [record] = await db
      .select()
      .from(securityThreatsPipeline)
      .where(eq(securityThreatsPipeline.id, recordId));

    if (!record) {
      throw new Error(`Record not found for id: ${recordId}`);
    }

    const threat = record.threatPayload as any;
    const targets = (record.enrichedTargets as any[]) || [];

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
  "body": "Highly professional email body tailored to their role and tech stack."
}`
              }
            ];
            const aiResponse = await chatCompletion(messages, { response_format: { type: 'json_object' } });
            if (aiResponse) {
              const parsed = JSON.parse(aiResponse);
              if (parsed.subject && parsed.body) {
                subject = parsed.subject;
                body = parsed.body;
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

    const validationResult = OutreachDraftsPayloadSchema.safeParse(outreachDrafts);
    if (!validationResult.success) {
      throw new Error(`Outreach payload validation failed: ${validationResult.error.message}`);
    }

    await db
      .update(securityThreatsPipeline)
      .set({ status: 'OUTREACH_GENERATED', outreachDrafts: validationResult.data, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));


    console.log(`[Agent 4] Outreach successfully compiled for ${validationResult.data.length} targets. Pipeline complete!`);

    return res.status(200).json({
      message: 'Autonomous outreach briefs generated successfully. Pipeline execution complete.',
      recordId,
      draftCount: validationResult.data.length,
    });
  } catch (error: any) {
    console.error('[Agent 4] Outreach compilation failed:', error.message || error);
    await db
      .update(securityThreatsPipeline)
      .set({ status: 'FAILED', errorMessage: `Agent 4 error: ${error.message || error}`, updatedAt: new Date() })
      .where(eq(securityThreatsPipeline.id, recordId));

    return res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
}
