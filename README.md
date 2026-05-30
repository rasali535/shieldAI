# ShieldRadius AI 🛡️
### Serverless Event-Driven State-Machine Multi-Agent Coordinator

ShieldRadius AI is a high-stakes enterprise multi-agent system designed for serverless execution. Built on Node.js, TypeScript, and Supabase (PostgreSQL), the platform monitors the open web for vendor security breaches or compliance failures, evaluates enterprise risk, identifies affected customer accounts, and launches automated GTM outreach workflows.

Because Vercel Serverless Functions have strict execution limits, the platform avoids persistent in-memory loops. State coordination is executed as an asynchronous, event-driven state machine managed via database states and secure webhook invocations.

---

## 👥 Agent Topology & Lifecycle

```
[Agent 1: Threat Intel] ---> (RAW_DETECTED) ---> [Agent 2: Risk Assessment]
                                                         |
                                                         v
                                                  (RISK_QUALIFIED)
                                                         |
                                                         v
[Agent 4: Outreach Engine] <--- (TARGETS_ENRICHED) <--- [Agent 3: GTM Enrichment]
```

1. **Threat_Intelligence_Agent (`/api/cron/monitor`)**: Orchesrates web monitoring for threat indicators, regulatory updates, or data exposures. Uses the Bright Data SERP API. Triggers Agent 2.
2. **Risk_Assessment_Agent (`/api/webhook/assess`)**: Evaluates risk exposure (Gdpr, CCPA, SOC2) and computes a severity risk score (0–100). Triggers Agent 3.
3. **GTM_Enrichment_Agent (`/api/webhook/enrich`)**: Triggers asynchronous firmographic harvesting using Bright Data Web Scraper API callbacks to prevent serverless function timeouts. Triggers Agent 4.
4. **Outreach_Engine_Agent (`/api/webhook/outreach`)**: Compiles target client profiles and generates personalized security notification email drafts.

---

## 🛠️ Bright Data Tool Integration

- **SERP API**: Used by Agent 1 to crawl search engines for live news updates regarding vendor vulnerabilities.
- **Web Unlocker**: Used to fetch HTML from block-heavy security advisory pages and vendor status feeds.
- **Web Scraper (Async API)**: Dispatches background crawler crawls that post response webhook callbacks directly to the state machine endpoint.
- **Scraping Browser**: Programmatic integration connection via WebSocket endpoint (`brd.superproxy.io`) for dynamic target sites.

---

## 💎 Advanced Features

### 🔍 DeepSeek Company URL Resolver
When a user types a target company name in the orchestrator panel, a debounced handler requests `/api/resolve-url`. The endpoint uses the **Bright Data SERP API** to look up search listings for the official homepages, and feeds the top listings to **DeepSeek** to select the precise official domain. The orchestrator then automatically populates the scraping target URL input.

### 🌐 Layman-Friendly Interactive UI
To ensure that threat intelligence is accessible to non-technical users, the dashboard features a **Layman Mode** on all details tabs:
- **Incident Reports**: Converts raw JSON feeds into easy-to-read cards outlining target companies, dates, and sources.
- **Impact Evaluation**: Features high-visibility risk score dials, colored severity badges, and structured regulatory compliance chips (e.g. GDPR, CCPA, SOC2) with plain-English justifications.
- **Client Accounts**: Renders target contacts and technology stacks in structured HTML tables.
- **Developer JSON Toggles**: Simple buttons that allow developers to toggle the underlying raw JSON schemas when debugging.

---

## 🚀 Getting Started

### 1. Prerequisite Environment Variables
Create a `.env` file at the root of the project:
```env
BRIGHTDATA_API_KEY=your_brightdata_api_key
BRIGHTDATA_ZONE=your_serp_zone
BRIGHTDATA_CUSTOMER_ID=your_customer_id
BRIGHTDATA_PASSWORD=your_zone_password
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SHIELDRADIUS_SECRET_KEY=your_webhook_hmac_secret
BASE_URL=http://localhost:3000
AIML_API_KEY=your_aiml_api_key
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Dev Server and Dashboard
Run the Express mock server locally. This serves the interactive glassmorphic dashboard UI and mounts your serverless API endpoints:
```bash
npm start
```
👉 Open **[http://localhost:3000/index.html](http://localhost:3000/index.html)** in your browser.

### 4. Run E2E Integration Suite
Run the E2E TypeScript test runner to test database mock state-transitions and Zod validations:
```bash
npm test
```

