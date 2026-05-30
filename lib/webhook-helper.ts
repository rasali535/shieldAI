import crypto from 'crypto';
import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';
import { triggerWorkflowEvent } from './triggerware';
import { db } from '../db/index';
import { eq } from 'drizzle-orm';
import { securityThreatsPipeline } from '../db/schema';

dotenv.config();

const SHIELDRADIUS_SECRET_KEY = process.env.SHIELDRADIUS_SECRET_KEY || 'default-secret-key';

/**
 * Sign a payload using SHA-256 HMAC
 */
export function signPayload(payload: any, secret: string = SHIELDRADIUS_SECRET_KEY): string {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
}

/**
 * Verify a payload's signature
 */
export function verifySignature(
  payload: any,
  signature: string,
  secret: string = SHIELDRADIUS_SECRET_KEY
): boolean {
  const expectedSignature = signPayload(payload, secret);
  // Constant time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Propagate a payload to the next serverless agent endpoint
 * Includes retry mechanisms to ensure resilience
 */
export async function propagateWebhook(
  endpointPath: string, // e.g., '/api/webhook/assess'
  payload: { recordId: string; status: string },
  maxRetries = 3
): Promise<boolean> {
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.BASE_URL || 'http://localhost:3000';
  
  const targetUrl = `${baseUrl}${endpointPath}`;

  // Hydrate payload with full database record to support stateless fallback databases
  let dbRecord: any = null;
  try {
    const [record] = await db
      .select()
      .from(securityThreatsPipeline)
      .where(eq(securityThreatsPipeline.id, payload.recordId));
    if (record) {
      dbRecord = record;
    }
  } catch (err: any) {
    console.warn(`[Webhook Propagator] Failed to query record state for hydration:`, err.message);
  }

  const fullPayload = {
    ...payload,
    __dbRecord: dbRecord,
  };

  const signature = signPayload(fullPayload);

  let attempt = 0;
  let delay = 500; // ms

  while (attempt < maxRetries) {
    try {
      console.log(`[Webhook Propagator] Transitioning state: ${payload.status} to ${targetUrl} (Attempt ${attempt + 1})`);
      
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shieldradius-signature': signature,
        },
        body: JSON.stringify(fullPayload),
      });

      if (response.ok) {
        console.log(`[Webhook Propagator] Transition successfully accepted by ${targetUrl} (Status: ${response.status})`);
        
        // Trigger event-driven workflow automation in TriggerWare.ai
        const eventName = `pipeline.${payload.status.toLowerCase()}`;
        try {
          await triggerWorkflowEvent(eventName, payload);
        } catch (twError: any) {
          console.warn('[Webhook Propagator] TriggerWare automation trigger failed:', twError.message);
        }

        return true;
      }

      console.warn(`[Webhook Propagator] ${targetUrl} returned status ${response.status}. Retrying...`);
    } catch (error: any) {
      console.error(`[Webhook Propagator] Error calling ${targetUrl}: ${error.message || error}`);
    }

    attempt++;
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }

  console.error(`[Webhook Propagator] Failed to propagate state to ${targetUrl} after ${maxRetries} attempts.`);
  return false;
}
