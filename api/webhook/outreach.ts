import { supabase } from '../../lib/db/client';
import { OutreachDraftsPayloadSchema, OutreachDraftsPayload } from '../../types/pipeline';
import { verifySignature } from '../../lib/webhook-helper';

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
    const outreachDrafts: OutreachDraftsPayload = targets.map((target: any) => {
      const primaryContact = target.contacts[0] || { name: 'IT Security Lead', role: 'Security Ops', email: 'security@company.com' };
      
      const subject = `Urgent Compliance & Risk Assessment regarding ${threat.vendorName}`;
      
      const body = `Hi ${primaryContact.name},\n\n` +
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

      return {
        companyName: target.companyName,
        contactEmail: primaryContact.email,
        contactName: primaryContact.name,
        emailSubject: subject,
        emailBody: body,
      };
    });

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
