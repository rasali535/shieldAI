import express from 'express';
import path from 'path';
import Module from 'module';

// 1. Setup in-memory mock database state
const mockDatabase = new Map<string, any>();

// 2. Intercept require('cross-fetch') to route all database requests to our mock database
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string) {
  if (id === 'cross-fetch') {
    const mockFetch = (url: any, options: any) => global.fetch(url, options);
    (mockFetch as any).default = mockFetch;
    return mockFetch;
  }
  return originalRequire.apply(this, arguments as any);
};

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

// 3. Mock global.fetch to intercept Supabase operations
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

  if (urlString.startsWith('https://mock-supabase-url.supabase.co')) {
    const urlObj = new URL(urlString);
    const apiPath = urlObj.pathname;
    const method = options.method || 'GET';
    
    // Check key
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
    if (apiPath === '/rest/v1/security_threats_pipeline' && method === 'POST') {
      const body = JSON.parse(options.body);
      const recordId = `record_${Math.random().toString(36).substring(7)}`;
      const record = {
        id: recordId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...body,
      };
      mockDatabase.set(recordId, record);
      console.log(`[DB MOCK] Inserted record: ${recordId} (Status: ${record.status})`);
      
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
    if (apiPath === '/rest/v1/security_threats_pipeline' && method === 'PATCH') {
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
      console.log(`[DB MOCK] Updated record: ${recordId} (New Status: ${updatedRecord.status})`);

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
    if (apiPath === '/rest/v1/security_threats_pipeline' && method === 'GET') {
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

  // Webhook propagation interceptor (route webhooks internally via direct JS calls to handlers!)
  if (urlString.startsWith('http://localhost:3000/api/webhook/')) {
    const urlObj = new URL(urlString);
    const route = urlObj.pathname;
    const body = JSON.parse(options.body || '{}');
    
    console.log(`[HTTP MOCK] Intercepted Webhook Route propagation: ${route}`);

    const mockReq = {
      method: options.method || 'POST',
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

    if (route === '/api/webhook/assess') {
      await assessHandler(mockReq as any, mockRes);
    } else if (route === '/api/webhook/enrich') {
      await enrichHandler(mockReq as any, mockRes);
    } else if (route === '/api/webhook/outreach') {
      await outreachHandler(mockReq as any, mockRes);
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

  // Fallback for Bright Data API search / scraper triggers
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
      id: 'bd_job_' + Math.random().toString(36).substring(7)
    }),
    text: async () => JSON.stringify({ id: 'bd_job_' + Math.random().toString(36).substring(7) }),
  };
};

// 4. Express Server Initialization
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Endpoint to check state by recordId
app.get('/api/pipeline', (req, res) => {
  const { recordId } = req.query;
  if (!recordId || typeof recordId !== 'string') {
    return res.status(400).json({ error: 'Missing recordId query' });
  }
  const record = mockDatabase.get(recordId);
  if (!record) {
    return res.status(404).json({ error: 'Record not found' });
  }
  res.json(record);
});

// Import Agent Handlers dynamically so they get the mocked require cache
let monitorHandler: any;
let assessHandler: any;
let enrichHandler: any;
let outreachHandler: any;

async function loadHandlers() {
  monitorHandler = (await import('../api/cron/monitor')).default;
  assessHandler = (await import('../api/webhook/assess')).default;
  enrichHandler = (await import('../api/webhook/enrich')).default;
  outreachHandler = (await import('../api/webhook/outreach')).default;
}

// Wrap Serverless handlers to Express Middleware format
function wrapHandler(handler: any) {
  return async (req: any, res: any) => {
    try {
      const mockReq = {
        method: req.method,
        headers: req.headers,
        query: req.query,
        body: req.body
      };
      
      const mockRes = {
        status: (code: number) => {
          res.status(code);
          return mockRes;
        },
        json: (data: any) => {
          res.json(data);
        },
        send: (data: any) => {
          res.send(data);
        }
      };

      await handler(mockReq, mockRes);
    } catch (err: any) {
      console.error('Wrapped handler crash:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  };
}

// Mount Serverless endpoints to Express
app.post('/api/cron/monitor', async (req, res, next) => {
  if (!monitorHandler) await loadHandlers();
  // Support UI-driven custom breach scenarios
  if (req.body.simulateVendor) {
    req.query = { 
      simulateVendor: req.body.simulateVendor,
      simulateSeverity: req.body.simulateSeverity
    };
  }
  next();
}, wrapHandler((req: any) => monitorHandler(req)));

app.post('/api/webhook/assess', async (req, res, next) => {
  if (!assessHandler) await loadHandlers();
  next();
}, wrapHandler((req: any) => assessHandler(req)));

app.post('/api/webhook/enrich', async (req, res, next) => {
  if (!enrichHandler) await loadHandlers();
  next();
}, wrapHandler((req: any) => enrichHandler(req)));

app.post('/api/webhook/outreach', async (req, res, next) => {
  if (!outreachHandler) await loadHandlers();
  next();
}, wrapHandler((req: any) => outreachHandler(req)));

// Start Server
const PORT = 3000;
app.listen(PORT, async () => {
  await loadHandlers();
  console.log(`==================================================`);
  console.log(`ShieldRadius AI Mock Server running on http://localhost:${PORT}`);
  console.log(`Dashboard served at http://localhost:${PORT}/index.html`);
  console.log(`==================================================`);
});
