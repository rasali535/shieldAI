import Module from 'module';

// 1. Intercept require('cross-fetch') to return a redirect to global.fetch
// This intercepts fetch calls inside @supabase/supabase-js and lib/webhook-helper.ts
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string) {
  if (id === 'cross-fetch') {
    const mockFetch = (url: any, options: any) => global.fetch(url, options);
    (mockFetch as any).default = mockFetch;
    return mockFetch;
  }
  return originalRequire.apply(this, arguments as any);
};

// 2. Setup in-memory mock database state
const mockDatabase = new Map<string, any>();

console.log('--------------------------------------------------');
console.log('ShieldRadius AI - State Machine Integration Test');
console.log('--------------------------------------------------');

// Set environment variables for testing
process.env.SUPABASE_URL = 'https://mock-supabase-url.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
process.env.SHIELDRADIUS_SECRET_KEY = 'test-secret-key';
process.env.BASE_URL = 'http://localhost:3000';

const mockHeaders = {
  get: (name: string) => {
    const lowerName = name.toLowerCase();
    if (lowerName === 'content-type') return 'application/json';
    if (lowerName === 'content-range') return '0-0/1';
    return null;
  }
};

// 3. Intercept and mock global fetch to simulate Supabase and Webhooks BEFORE importing handlers
global.fetch = async (url: any, options: any = {}): Promise<any> => {
  const urlString = url.toString();
  
  const getHeader = (name: string): string | null => {
    const headers = options.headers;
    if (!headers) return null;
    if (typeof headers.get === 'function') {
      return headers.get(name);
    }
    const foundKey = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return foundKey ? (headers as any)[foundKey] : null;
  };

  // A. Supabase API Interceptor
  if (urlString.startsWith('https://mock-supabase-url.supabase.co')) {
    const urlObj = new URL(urlString);
    const path = urlObj.pathname;
    const method = options.method || 'GET';
    
    // Check for service role key
    if (getHeader('apikey') !== 'mock-service-role-key') {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: mockHeaders,
        json: async () => ({ error: 'Unauthorized' }),
        text: async () => JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const accept = getHeader('Accept') || '';
    const returnSingle = accept.includes('vnd.pgrst.object');

    // Insert operation
    if (path === '/rest/v1/security_threats_pipeline' && method === 'POST') {
      const body = JSON.parse(options.body);
      const recordId = `record_${Math.random().toString(36).substring(7)}`;
      const record = {
        id: recordId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      };
      mockDatabase.set(recordId, record);
      
      const responseBody = returnSingle ? record : [record];
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: mockHeaders,
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      };
    }

    // Update / PATCH operation
    if (path === '/rest/v1/security_threats_pipeline' && method === 'PATCH') {
      const query = urlObj.searchParams.get('id');
      const recordId = query ? query.replace('eq.', '') : null;
      
      if (!recordId || !mockDatabase.has(recordId)) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: mockHeaders,
          json: async () => ({ error: 'Record not found' }),
          text: async () => JSON.stringify({ error: 'Record not found' }),
        };
      }

      const current = mockDatabase.get(recordId);
      const updates = JSON.parse(options.body);
      const updatedRecord = {
        ...current,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      mockDatabase.set(recordId, updatedRecord);

      const responseBody = returnSingle ? updatedRecord : [updatedRecord];
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      };
    }

    // Select / GET single operation
    if (path === '/rest/v1/security_threats_pipeline' && method === 'GET') {
      const query = urlObj.searchParams.get('id');
      const recordId = query ? query.replace('eq.', '') : null;
      
      if (!recordId || !mockDatabase.has(recordId)) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: mockHeaders,
          json: async () => ({ error: 'Record not found' }),
          text: async () => JSON.stringify({ error: 'Record not found' }),
        };
      }

      const record = mockDatabase.get(recordId);
      const responseBody = returnSingle ? record : [record];
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      };
    }
  }

  // B. Webhook Propagation Interceptor
  if (urlString.startsWith('http://localhost:3000/api/webhook/')) {
    const urlObj = new URL(urlString);
    const route = urlObj.pathname;
    const method = options.method || 'POST';
    const body = JSON.parse(options.body || '{}');
    
    console.log(`[Mock Fetch] Intercepted Webhook Route: ${route}`);

    // Create Mock Request and Response for handlers
    const mockReq = {
      method,
      headers: {
        'x-shieldradius-signature': getHeader('x-shieldradius-signature') || undefined,
      },
      query: Object.fromEntries(urlObj.searchParams.entries()),
      body,
    };

    let responseStatus = 200;
    let responseBody = {};

    const mockRes = {
      status: (code: number) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        responseBody = data;
      },
      send: (data: string) => {
        responseBody = { message: data };
      }
    };

    // Dynamically load handlers to avoid import hoisting issues
    const { default: assessHandler } = await import('../api/webhook/assess');
    const { default: enrichHandler } = await import('../api/webhook/enrich');
    const { default: outreachHandler } = await import('../api/webhook/outreach');

    // Run the correct handler based on route
    if (route === '/api/webhook/assess') {
      await assessHandler(mockReq as any, mockRes);
    } else if (route === '/api/webhook/enrich') {
      await enrichHandler(mockReq as any, mockRes);
    } else if (route === '/api/webhook/outreach') {
      await outreachHandler(mockReq as any, mockRes);
    } else {
      console.log(`[Mock Fetch] Falling through to 404 else block for route: ${route}`);
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: mockHeaders,
        text: async () => 'Not Found',
      };
    }

    return {
      ok: responseStatus >= 200 && responseStatus < 300,
      status: responseStatus,
      statusText: responseStatus === 200 ? 'OK' : 'Accepted',
      headers: mockHeaders,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  }

  // Fallback / unmocked calls (e.g. mock Bright Data API calls)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: mockHeaders,
    json: async () => ({
      organic_results: [
        {
          title: 'Critical CVE security advisory AcmeCloud Corp',
          link: 'https://security-advisory.example.com/advisory-102',
          snippet: 'AcmeCloud Corp reports customer data compromised via critical API exposure.',
          source: 'Security Network Advisory'
        }
      ],
      id: 'bd_job_scraped_targets_123'
    }),
    text: async () => JSON.stringify({ id: 'bd_job_scraped_targets_123' }),
  };
};

/**
 * Execute the full E2E pipeline simulation
 */
async function runTest() {
  try {
    // Dynamically load handlers AFTER fetch is mocked
    const { default: monitorHandler } = await import('../api/cron/monitor');

    // --- STAGE 1: Threat Detection (Agent 1 Cron) ---
    console.log('\n[STAGE 1] Triggering Agent 1 Cron (Monitor)...');
    let cronStatus = 200;
    let cronData: any = {};
    const mockCronRes = {
      status: (code: number) => { cronStatus = code; return mockCronRes; },
      json: (data: any) => { cronData = data; }
    } as any;

    await monitorHandler({ headers: {}, query: {} }, mockCronRes);
    
    if (cronStatus !== 202) {
      throw new Error(`Cron initiation failed with status: ${cronStatus}. Data: ${JSON.stringify(cronData)}`);
    }
    
    const recordId = cronData.recordId;
    console.log(`[STAGE 1 SUCCESS] Pipeline started. DB Record Created: ${recordId}`);
    
    const initialRecord = mockDatabase.get(recordId);
    console.log(`- Record ID: ${initialRecord.id}`);
    console.log(`- Status: ${initialRecord.status}`);
    console.log(`- Threat Vendor: ${initialRecord.threat_payload.vendorName}`);

    // --- STAGE 2: Risk Assessment and Async Scraping Trigger (Agent 2 -> Agent 3) ---
    // The webhook propagator automatically kicked off Agent 2, which then kicked off Agent 3.
    // Agent 3 triggers the async Bright Data Scraper job and then exits gracefully.
    
    const recordStateAfterStage2 = mockDatabase.get(recordId);
    console.log(`\n[STAGE 2 STATUS] Current State:`);
    console.log(`- Status: ${recordStateAfterStage2.status}`);
    console.log(`- Risk Score: ${recordStateAfterStage2.risk_score}/100`);
    console.log(`- Bright Data Job ID: ${recordStateAfterStage2.brightdata_job_id}`);

    if (!recordStateAfterStage2.brightdata_job_id) {
      throw new Error('Bright Data async job ID was not stored.');
    }
    
    // --- STAGE 3: Simulating Bright Data Scraper Webhook Callback ---
    console.log(`\n[STAGE 3] Simulating async callback from Bright Data for Job: ${recordStateAfterStage2.brightdata_job_id}...`);
    
    const mockCallbackBody = {
      job_id: recordStateAfterStage2.brightdata_job_id,
      results: [
        {
          companyName: 'ShieldedTech Solutions',
          domain: 'https://shieldedtech.com',
          techStackSignals: ['AcmeCloud Portal', 'Next.js', 'Vercel'],
          contacts: [
            { name: 'Bruce Wayne', role: 'CISO Officer', email: 'bwayne@shieldedtech.com' }
          ]
        },
        {
          companyName: 'NovaBank Corp',
          domain: 'https://novabank.com',
          techStackSignals: ['AcmeCloud Enterprise Storage', 'Okta'],
          contacts: [
            { name: 'Diana Prince', role: 'Head of Information Security', email: 'dprince@novabank.com' }
          ]
        }
      ]
    };

    const callbackUrl = `http://localhost:3000/api/webhook/enrich?source=brightdata&recordId=${recordId}`;
    const callbackResponse = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockCallbackBody)
    });

    if (!callbackResponse.ok) {
      const err = await callbackResponse.json();
      throw new Error(`Bright Data callback simulation failed: ${JSON.stringify(err)}`);
    }

    console.log('[STAGE 3 SUCCESS] Bright Data callback processed and state progressed.');

    // --- STAGE 4: Final Validation of Outreach Output (Agent 4) ---
    // The callback automatically propagated to Agent 4 (Outreach), which updates the record.
    const finalRecord = mockDatabase.get(recordId);
    
    console.log(`\n[STAGE 4 STATUS] Final State Machine Pipeline Record:`);
    console.log(`- Record ID: ${finalRecord.id}`);
    console.log(`- Final Status: ${finalRecord.status}`);
    console.log(`- Threat Source: ${finalRecord.threat_source}`);
    console.log(`- Threat Vendor: ${finalRecord.threat_payload.vendorName}`);
    console.log(`- Risk Analysis Severity: ${finalRecord.risk_analysis.severity}`);
    console.log(`- Enriched Targets Count: ${finalRecord.enriched_targets.length}`);
    console.log(`- Generated Outreach Count: ${finalRecord.outreach_drafts.length}`);
    
    console.log('\n--- SAMPLE Personalised Outreach Generated ---');
    const firstDraft = finalRecord.outreach_drafts[0];
    console.log(`To: ${firstDraft.contactName} <${firstDraft.contactEmail}>`);
    console.log(`Subject: ${firstDraft.emailSubject}`);
    console.log(`Body Snippet:\n${firstDraft.emailBody.split('\n').slice(0, 5).join('\n')}...\n`);
    
    console.log('--------------------------------------------------');
    console.log('E2E STATE MACHINE TEST COMPLETED SUCCESSFULLY!');
    console.log('--------------------------------------------------');
  } catch (error: any) {
    console.error('Integration Test Failed:', error.message || error);
    process.exit(1);
  }
}

runTest();
