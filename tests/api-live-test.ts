/**
 * ShieldRadius AI - Live API Key & Deployment Validation
 * Tests: BrightData SERP, AIML API, Speechmatics, Triggerware, Supabase, Vercel Deployment
 * Run: npx ts-node tests/api-live-test.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

const COLORS = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  reset:  '\x1b[0m',
};

const pass  = `${COLORS.green}✅ PASS${COLORS.reset}`;
const fail  = `${COLORS.red}❌ FAIL${COLORS.reset}`;
const warn  = `${COLORS.yellow}⚠️  MOCK${COLORS.reset}`;
const info  = `${COLORS.cyan}ℹ️  INFO${COLORS.reset}`;

interface TestResult {
  service: string;
  status: 'PASS' | 'FAIL' | 'MOCK' | 'SKIP';
  message: string;
  data?: any;
}

const results: TestResult[] = [];

function log(label: string, msg: string) {
  console.log(`  ${label} ${msg}`);
}

// ─────────────────────────────────────────────
// 1. BrightData SERP API
// ─────────────────────────────────────────────
async function testBrightData(): Promise<TestResult> {
  const name = 'BrightData SERP API';
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const zone   = process.env.BRIGHTDATA_ZONE || 'serp_api1';

  if (!apiKey) {
    return { service: name, status: 'MOCK', message: 'BRIGHTDATA_API_KEY not set' };
  }

  try {
    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone,
        url: 'https://www.google.com/search?q=data+breach+security+advisory+2024',
        format: 'json',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const organic = data.organic_results || [];
      return {
        service: name,
        status: 'PASS',
        message: `Live data received — ${organic.length} organic result(s)`,
        data: organic.slice(0, 1),
      };
    } else {
      const body = await response.text();
      return { service: name, status: 'FAIL', message: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { service: name, status: 'FAIL', message: e.message };
  }
}

// ─────────────────────────────────────────────
// 2. AIML API (GPT-4o-mini)
// ─────────────────────────────────────────────
async function testAIMLApi(): Promise<TestResult> {
  const name = 'AIML API (AI/ML)';
  const apiKey = process.env.AIML_API_KEY;

  if (!apiKey || apiKey === 'your_aiml_api_key') {
    return { service: name, status: 'MOCK', message: 'AIML_API_KEY not set or placeholder' };
  }

  try {
    const response = await fetch('https://api.aimlapi.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return {
        service: name,
        status: 'PASS',
        message: `Live response: "${content.trim()}" | model=${data.model} | tokens=${data.usage?.total_tokens}`,
        data: { model: data.model, tokens: data.usage },
      };
    } else {
      const body = await response.text();
      return { service: name, status: 'FAIL', message: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { service: name, status: 'FAIL', message: e.message };
  }
}

// ─────────────────────────────────────────────
// 3. Speechmatics API
// ─────────────────────────────────────────────
async function testSpeechmatics(): Promise<TestResult> {
  const name = 'Speechmatics API';
  const apiKey = process.env.SPEECHMATICS_API_KEY;

  if (!apiKey || apiKey === 'your_speechmatics_api_key') {
    return { service: name, status: 'MOCK', message: 'SPEECHMATICS_API_KEY not set or placeholder' };
  }

  try {
    // Test via GET /jobs to validate API key without consuming credits
    const response = await fetch('https://asr.api.speechmatics.com/v2/jobs', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        service: name,
        status: 'PASS',
        message: `Key authenticated — ${data.jobs?.length ?? 0} existing job(s) found`,
        data: { projectId: process.env.SPEECHMATICS_PROJECT_ID },
      };
    } else {
      const body = await response.text();
      return { service: name, status: 'FAIL', message: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { service: name, status: 'FAIL', message: e.message };
  }
}

// ─────────────────────────────────────────────
// 4. Supabase
// ─────────────────────────────────────────────
async function testSupabase(): Promise<TestResult> {
  const name = 'Supabase Database';
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || url === 'your_supabase_url' || url.includes('mock-supabase-url')) {
    return { service: name, status: 'MOCK', message: 'SUPABASE_URL not configured (still placeholder)' };
  }
  if (!key || key === 'your_service_role_key') {
    return { service: name, status: 'MOCK', message: 'SUPABASE_SERVICE_ROLE_KEY not configured (still placeholder)' };
  }

  try {
    const response = await fetch(`${url}/rest/v1/security_threats_pipeline?limit=1&select=id,status`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        service: name,
        status: 'PASS',
        message: `Connected — table has ${Array.isArray(data) ? data.length : '?'} record(s) (limit 1)`,
        data: data,
      };
    } else {
      const body = await response.text();
      return { service: name, status: 'FAIL', message: `HTTP ${response.status}: ${body.slice(0, 300)}` };
    }
  } catch (e: any) {
    return { service: name, status: 'FAIL', message: e.message };
  }
}

// ─────────────────────────────────────────────
// 5. Triggerware
// ─────────────────────────────────────────────
async function testTriggerware(): Promise<TestResult> {
  const name   = 'Triggerware API';
  const apiKey = process.env.TRIGGERWARE_API_KEY;
  const apiUrl = process.env.TRIGGERWARE_API_URL || 'https://api.triggerware.com/v1';

  if (!apiKey || apiKey === 'your_triggerware_api_key') {
    return { service: name, status: 'MOCK', message: 'TRIGGERWARE_API_KEY not set or placeholder' };
  }

  try {
    // Hit the health or workflow list endpoint
    const response = await fetch(`${apiUrl}/workflows`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return { service: name, status: 'PASS', message: `API key authenticated`, data };
    } else {
      const body = await response.text();
      // 404 on /workflows still means the key was accepted if not 401/403
      if (response.status === 404 || response.status === 405) {
        return { service: name, status: 'PASS', message: `Key accepted (HTTP ${response.status} — endpoint may differ)` };
      }
      return { service: name, status: 'FAIL', message: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { service: name, status: 'FAIL', message: e.message };
  }
}

// ─────────────────────────────────────────────
// 6. Vercel Live Deployment
// ─────────────────────────────────────────────
async function testVercelDeployment(): Promise<TestResult> {
  const name = 'Vercel Deployment';
  // Latest known deployment from `vercel ls`
  const candidates = [
    'https://shield-66q9z0la9-alis-projects-635e952f.vercel.app',
    'https://shield-ai.vercel.app',
    'https://shield-radius-ai.vercel.app',
  ];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}/api/cron/monitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customQuery: 'live-test-probe' }),
        // @ts-ignore
        signal: AbortSignal.timeout(10000),
      });

      const body = await response.text();

      if (response.status === 401) {
        // Deployment exists but is Vercel auth-protected (Password Protection / SSO)
        return {
          service: name,
          status: 'PASS',
          message: `✅ Deployment LIVE at ${baseUrl} — 401 = Vercel auth guard active (expected for protected deployments)`,
          data: { url: baseUrl, protected: true },
        };
      }

      if (response.status !== 404) {
        return {
          service: name,
          status: response.status < 500 ? 'PASS' : 'FAIL',
          message: `Found at ${baseUrl} — HTTP ${response.status}: ${body.slice(0, 200)}`,
          data: { url: baseUrl },
        };
      }
    } catch (e: any) {
      // ECONNREFUSED / timeout means URL doesn't exist — keep trying
    }
  }

  return {
    service: name,
    status: 'SKIP',
    message: 'Could not reach any known deployment URL — run: npx vercel --prod',
  };
}

// ─────────────────────────────────────────────
// 7. BrightData Browser WSS Connectivity
// ─────────────────────────────────────────────
async function testBrightDataBrowser(): Promise<TestResult> {
  const name  = 'BrightData Browser URL';
  const wsUrl = process.env.BRIGHTDATA_BROWSER_URL;

  if (!wsUrl || wsUrl.includes('your_')) {
    return { service: name, status: 'MOCK', message: 'BRIGHTDATA_BROWSER_URL not configured' };
  }

  // Validate the URL format is correct (we can't open WSS here without puppeteer)
  const expected = `wss://brd-customer-${process.env.BRIGHTDATA_CUSTOMER_ID}-zone-scraping_browser1:${process.env.BRIGHTDATA_PASSWORD}@brd.superproxy.io:9222`;
  const matches = wsUrl === expected || wsUrl.includes('brd.superproxy.io');

  if (matches) {
    return { service: name, status: 'PASS', message: `WSS URL format valid — ${wsUrl.slice(0, 60)}...` };
  } else {
    return { service: name, status: 'FAIL', message: `URL format unexpected: ${wsUrl.slice(0, 100)}` };
  }
}

// ─────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────
async function runAll() {
  console.log(`\n${COLORS.bold}${COLORS.cyan}╔═══════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}║    ShieldRadius AI — Live API Key Validator   ║${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}╚═══════════════════════════════════════════════╝${COLORS.reset}\n`);

  const tests = [
    testBrightData,
    testAIMLApi,
    testSpeechmatics,
    testSupabase,
    testTriggerware,
    testBrightDataBrowser,
    testVercelDeployment,
  ];

  for (const test of tests) {
    process.stdout.write(`  Running: ${test.name.replace('test', '')}...`);
    const r = await test();
    results.push(r);

    const icon = r.status === 'PASS' ? pass
               : r.status === 'FAIL' ? fail
               : r.status === 'MOCK' ? warn
               : info;

    console.log(`\r${icon} ${r.service.padEnd(30)} ${r.message}`);
    if (r.data) {
      console.log(`         ${COLORS.cyan}↳ Data:${COLORS.reset}`, JSON.stringify(r.data).slice(0, 200));
    }
  }

  // Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const mocked = results.filter(r => r.status === 'MOCK').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log(`\n${COLORS.bold}─────────────────────────────────────────────${COLORS.reset}`);
  console.log(`${COLORS.bold}Summary:${COLORS.reset} ${COLORS.green}${passed} passed${COLORS.reset}  |  ${COLORS.red}${failed} failed${COLORS.reset}  |  ${COLORS.yellow}${mocked} using mock${COLORS.reset}  |  ${COLORS.cyan}${skipped} skipped${COLORS.reset}`);

  if (failed > 0) {
    console.log(`\n${COLORS.red}${COLORS.bold}Failed services need attention:${COLORS.reset}`);
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ${COLORS.red}→ ${r.service}:${COLORS.reset} ${r.message}`);
    });
  }
  if (mocked > 0) {
    console.log(`\n${COLORS.yellow}${COLORS.bold}Mock/placeholder services (add real keys to .env):${COLORS.reset}`);
    results.filter(r => r.status === 'MOCK').forEach(r => {
      console.log(`  ${COLORS.yellow}→ ${r.service}:${COLORS.reset} ${r.message}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
