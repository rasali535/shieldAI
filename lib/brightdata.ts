import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
const BRIGHTDATA_ZONE = process.env.BRIGHTDATA_ZONE || 'serp_zone';
const BRIGHTDATA_CUSTOMER_ID = process.env.BRIGHTDATA_CUSTOMER_ID || 'cust_123';
const BRIGHTDATA_PASSWORD = process.env.BRIGHTDATA_PASSWORD || 'pass_123';

/**
 * Interface representing the structure of a SERP API response
 */
export interface SerpResult {
  title: string;
  link: string;
  snippet: string;
  source: string;
}

/**
 * 1. SERP API: For broad web searches monitoring news channels and compliance alerts.
 */
export async function searchSerpApi(query: string): Promise<SerpResult[]> {
  const mockResults = [
    {
      title: `Security alert for vendor: ${query}`,
      link: 'https://security-advisory.example.com/advisory-102',
      snippet: 'A critical vulnerability was disclosed that allows unauthorized data access due to misconfigured access controls.',
      source: 'Security Wire News',
    },
  ];

  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock search results.');
    return mockResults;
  }

  try {
    const endpoint = `https://api.brightdata.com/request`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: BRIGHTDATA_ZONE,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`,
        format: 'json',
        data_format: 'parsed_light',
      }),
    });

    if (!response.ok) {
      throw new Error(`Bright Data SERP API call failed: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();

    // BrightData may return results under different keys depending on zone/format
    const organic: any[] = data.organic_results || data.organic || data.results || [];

    if (organic.length === 0) {
      console.warn('[Bright Data] SERP returned 0 organic results (zone may need parsed_light format or different configuration). Using mock fallback.');
      return mockResults;
    }

    return organic.map((item: any) => ({
      title: item.title || '',
      link: item.link || item.url || '',
      snippet: item.snippet || item.description || '',
      source: item.source || item.domain || '',
    }));
  } catch (error: any) {
    console.warn(`Bright Data SERP API call failed (${error.message}). Falling back to mock search results.`);
    return mockResults;
  }
}

/**
 * 1b. Parallel SERP Search: Fire multiple queries simultaneously and merge results.
 * Deduplicates by URL so the caller gets a wider, unique result set at the same
 * wall-clock latency as a single call.
 */
export async function parallelSerpSearch(queries: string[]): Promise<SerpResult[]> {
  if (queries.length === 0) return [];

  console.log(`[Bright Data] Launching ${queries.length} parallel SERP queries...`);

  const settled = await Promise.allSettled(queries.map(q => searchSerpApi(q)));

  const seen = new Set<string>();
  const merged: SerpResult[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        const key = item.link || item.title;
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
    }
  }

  console.log(`[Bright Data] Parallel search complete — ${merged.length} unique results from ${queries.length} queries.`);
  return merged;
}

/**
 * 2. Web Unlocker: Fetch raw HTML from highly protected compliance/vendor security pages
 */
export async function fetchWebUnlocker(targetUrl: string): Promise<string> {
  const mockHtml = `<html><body><h1>Security Advisory for Example Vendor</h1><p>Vulnerability CVE-2026-9999 has compromised user data.</p></body></html>`;

  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock HTML content.');
    return mockHtml;
  }

  try {
    const endpoint = 'https://api.brightdata.com/web_unlocker/request';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Bright Data Web Unlocker failed to fetch URL ${targetUrl}: ${response.statusText} (${response.status})`);
    }

    return await response.text();
  } catch (error: any) {
    console.warn(`Bright Data Web Unlocker failed (${error.message}). Returning mock HTML content.`);
    return mockHtml;
  }
}

/**
 * 3. Web Scraper API: Launch async scraper jobs to prevent serverless function timeouts
 */
export async function triggerWebScraperJob(
  targetUrl: string,
  callbackUrl: string
): Promise<{ jobId: string }> {
  const mockJobId = `bd_job_${Math.random().toString(36).substring(7)}`;

  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock jobId.');
    return { jobId: mockJobId };
  }

  try {
    const endpoint = `https://api.brightdata.com/dca/trigger`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        callback: callbackUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to trigger Bright Data Web Scraper Job: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return { jobId: data.id || data.job_id };
  } catch (error: any) {
    console.warn(`Bright Data Web Scraper failed to trigger (${error.message}). Returning mock jobId.`);
    return { jobId: mockJobId };
  }
}

/**
 * 4. Scraping Browser: Configuration details for connecting with Puppeteer/Playwright
 * Since Vercel Serverless Functions have small size limits, Puppeteer should run via connection string.
 */
export function getScrapingBrowserConnectOptions(): { browserWSEndpoint: string } {
  const customUrl = process.env.BRIGHTDATA_BROWSER_URL;
  if (customUrl) {
    return { browserWSEndpoint: customUrl };
  }

  const customerId = process.env.BRIGHTDATA_CUSTOMER_ID || 'cust_123';
  const zone = process.env.BRIGHTDATA_ZONE || 'scraping_browser';
  const password = process.env.BRIGHTDATA_PASSWORD || 'pass_123';
  
  // Connection string format for Bright Data Scraping Browser using secure WebSocket
  const endpoint = `wss://brd-customer-${customerId}-zone-${zone}:${password}@brd.superproxy.io:9222`;
  return {
    browserWSEndpoint: endpoint,
  };
}

/**
 * Scrape raw text content from a target URL using Bright Data Scraping Browser.
 */
export async function scrapeWebpage(url: string): Promise<string> {
  const puppeteer = require('puppeteer-core');
  const connectOptions = getScrapingBrowserConnectOptions();
  console.log(`[Bright Data Browser] Connecting to Scraping Browser for URL: ${url}`);
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: connectOptions.browserWSEndpoint,
    });
    
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    
    console.log(`[Bright Data Browser] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    console.log(`[Bright Data Browser] Extracting body text...`);
    const textContent = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script, style');
      scripts.forEach(s => s.remove());
      return document.body.innerText || '';
    });
    
    return textContent;
  } catch (error: any) {
    console.error(`[Bright Data Browser] Failed to scrape webpage:`, error.message || error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
