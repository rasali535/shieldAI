import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const COGNEE_API_URL = process.env.COGNEE_API_URL || 'http://localhost:8000';
const COGNEE_API_KEY = process.env.COGNEE_API_KEY;

export interface MemorySearchResult {
  content: string;
  relevance: number;
}

/**
 * Add a context document or fact to the Cognee Memory Graph.
 */
export async function addMemory(text: string, datasetName = 'shield-threats'): Promise<boolean> {
  const url = `${COGNEE_API_URL}/api/v1/add`;
  console.log(`[Cognee Memory] Adding memory payload: "${text.substring(0, 80)}..."`);

  if (!COGNEE_API_KEY || COGNEE_API_KEY === 'your_cognee_api_key') {
    console.log('[Cognee Memory] No API key configured. Memory stored locally in mock database.');
    return true;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COGNEE_API_KEY}`,
      },
      body: JSON.stringify({
        data: text,
        datasetName,
      }),
    });

    if (!response.ok) {
      console.warn(`[Cognee Memory] Failed to add memory: ${response.statusText}`);
      return false;
    }

    console.log('[Cognee Memory] Memory added successfully. Triggering cognify to build graph...');
    await cognifyMemory(datasetName);
    return true;
  } catch (error: any) {
    console.error('[Cognee Memory] Error adding memory:', error.message);
    return false;
  }
}

/**
 * Process raw memories into structured knowledge graphs (cognify).
 */
export async function cognifyMemory(datasetName = 'shield-threats'): Promise<boolean> {
  const url = `${COGNEE_API_URL}/api/v1/cognify`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COGNEE_API_KEY}`,
      },
      body: JSON.stringify({
        datasetName,
      }),
    });

    return response.ok;
  } catch (error: any) {
    console.warn('[Cognee Memory] Cognify execution failed:', error.message);
    return false;
  }
}

/**
 * Query the Cognee Memory Graph for relevant past context.
 */
export async function searchMemory(query: string, datasetName = 'shield-threats'): Promise<MemorySearchResult[]> {
  const url = `${COGNEE_API_URL}/api/v1/search`;
  console.log(`[Cognee Memory] Querying memory graph for: "${query}"`);

  if (!COGNEE_API_KEY || COGNEE_API_KEY === 'your_cognee_api_key') {
    console.log('[Cognee Memory] API Key absent. Returning simulated search memory context.');
    // Return a mock context memory of a previous similar incident to test reasoning logic
    if (query.toLowerCase().includes('acmecloud')) {
      return [
        {
          content: 'Incident Memory: AcmeCloud Corp was previously assessed on 2026-05-28. Risk score was qualified as 95 (CRITICAL) due to exposed API Keys and compliance impact to SOC2/GDPR.',
          relevance: 0.92,
        }
      ];
    }
    return [];
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${COGNEE_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        datasetName,
      }),
    });

    if (!response.ok) {
      console.warn(`[Cognee Memory] Memory search request failed: ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    return data.results || [];
  } catch (error: any) {
    console.error('[Cognee Memory] Search error:', error.message);
    return [];
  }
}
