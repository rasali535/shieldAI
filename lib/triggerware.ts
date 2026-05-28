import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const TRIGGERWARE_API_URL = process.env.TRIGGERWARE_API_URL || 'https://api.triggerware.com/v1';
const TRIGGERWARE_API_KEY = process.env.TRIGGERWARE_API_KEY;
const TRIGGERWARE_WORKFLOW_ID = process.env.TRIGGERWARE_WORKFLOW_ID || 'shield-incident-response-workflow';

/**
 * Dispatch an automation event to TriggerWare.ai to run event-driven tasks
 */
export async function triggerWorkflowEvent(eventName: string, payload: any): Promise<boolean> {
  console.log(`[TriggerWare.ai] Dispatching event "${eventName}" for Record ID: ${payload.recordId}`);

  if (!TRIGGERWARE_API_KEY || TRIGGERWARE_API_KEY === 'your_triggerware_api_key') {
    console.log(`[TriggerWare.ai] No API Key configured. Event simulated locally for workflow trace.`);
    return true;
  }

  try {
    const response = await fetch(`${TRIGGERWARE_API_URL}/workflows/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': TRIGGERWARE_API_KEY,
      },
      body: JSON.stringify({
        workflowId: TRIGGERWARE_WORKFLOW_ID,
        eventName,
        payload,
      }),
    });

    if (!response.ok) {
      console.warn(`[TriggerWare.ai] Trigger request returned status: ${response.status} (${response.statusText})`);
      return false;
    }

    console.log(`[TriggerWare.ai] Workflow successfully triggered for event: "${eventName}"`);
    return true;
  } catch (error: any) {
    console.error('[TriggerWare.ai] Automation dispatch failed:', error.message);
    return false;
  }
}
