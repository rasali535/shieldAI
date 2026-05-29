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
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        format: 'json',
      }),
    });

    if (!response.ok) {
      throw new Error(`Bright Data SERP API call failed: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    const organic = data.organic_results || [];
    return organic.map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      snippet: item.snippet || '',
      source: item.source || '',
    }));
  } catch (error: any) {
    console.warn(`Bright Data SERP API call failed (${error.message}). Falling back to mock search results.`);
    return mockResults;
  }
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

import puppeteer from 'puppeteer-core';

/**
 * Scrape raw text content from a target URL using Bright Data Scraping Browser.
 */
export async function scrapeWebpage(url: string): Promise<string> {
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
