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
  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock search results.');
    return [
      {
        title: `Security alert for vendor: ${query}`,
        link: 'https://security-advisory.example.com/advisory-102',
        snippet: 'A critical vulnerability was disclosed that allows unauthorized data access due to misconfigured access controls.',
        source: 'Security Wire News',
      },
    ];
  }

  const endpoint = `https://api.brightdata.com/serp/search`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      zone: BRIGHTDATA_ZONE,
      num: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`Bright Data SERP API call failed: ${response.statusText}`);
  }

  const data = await response.json();
  // Standardize Bright Data SERP result payload
  const organic = data.organic_results || [];
  return organic.map((item: any) => ({
    title: item.title || '',
    link: item.link || '',
    snippet: item.snippet || '',
    source: item.source || '',
  }));
}

/**
 * 2. Web Unlocker: Fetch raw HTML from highly protected compliance/vendor security pages
 */
export async function fetchWebUnlocker(targetUrl: string): Promise<string> {
  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock HTML content.');
    return `<html><body><h1>Security Advisory for Example Vendor</h1><p>Vulnerability CVE-2026-9999 has compromised user data.</p></body></html>`;
  }

  // Web Unlocker uses Bright Data HTTP proxy network (brd.superproxy.io:22225)
  // Or can be accessed via their HTTP trigger endpoint
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
    throw new Error(`Bright Data Web Unlocker failed to fetch URL ${targetUrl}: ${response.statusText}`);
  }

  return await response.text();
}

/**
 * 3. Web Scraper API: Launch async scraper jobs to prevent serverless function timeouts
 */
export async function triggerWebScraperJob(
  targetUrl: string,
  callbackUrl: string
): Promise<{ jobId: string }> {
  if (!BRIGHTDATA_API_KEY) {
    console.warn('BRIGHTDATA_API_KEY not configured. Returning mock jobId.');
    return { jobId: `bd_job_${Math.random().toString(36).substring(7)}` };
  }

  // Calls the Bright Data Web Scraper API endpoint to trigger a job
  const endpoint = `https://api.brightdata.com/dca/trigger`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BRIGHTDATA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: targetUrl,
      // The callback endpoint on our serverless API to handle results asynchronously
      callback: callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger Bright Data Web Scraper Job: ${response.statusText}`);
  }

  const data = await response.json();
  return { jobId: data.id || data.job_id };
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
