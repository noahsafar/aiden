/**
 * Playwright + LLM Browser Assistant for Aiden
 *
 * This script launches a browser, navigates to Aiden's dev server,
 * captures page context, and uses Claude to decide what actions to take.
 *
 * Usage:
 *   1. Start the Aiden dev server:  npm run dev  (runs on localhost:1420)
 *   2. Run this script:  npx ts-node browser-assistant.ts
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { chromium, Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';

const APP_URL = process.env.APP_URL || 'http://localhost:1420';
const client = new Anthropic({
  baseURL: 'https://api.z.ai/api/anthropic',
});

interface PageContext {
  url: string;
  title: string;
  visibleText: string;
  buttons: string[];
  links: string[];
  inputs: string[];
}

/** Extract structured context from the current page */
async function getPageContext(page: Page): Promise<PageContext> {
  const url = page.url();
  const title = await page.title();

  const visibleText = await page.evaluate(() => {
    return document.body.innerText.substring(0, 3000);
  });

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .map(btn => btn.textContent?.trim() || btn.getAttribute('title') || '')
      .filter(Boolean)
      .slice(0, 20);
  });

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => {
        const text = a.textContent?.trim() || '';
        const href = a.getAttribute('href') || '';
        return text ? `${text} (${href})` : href;
      })
      .filter(Boolean)
      .slice(0, 20);
  });

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, textarea, select'))
      .map(el => {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute('type') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const label = el.getAttribute('aria-label') || el.getAttribute('name') || '';
        return `${tag}[type=${type}] placeholder="${placeholder}" label="${label}"`;
      })
      .slice(0, 20);
  });

  return { url, title, visibleText, buttons, links, inputs };
}

/** Ask Claude to analyze the page and suggest an action */
async function askLLM(context: PageContext, goal: string): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a browser assistant analyzing a web application called Aiden (an AI email client).

Current page state:
- URL: ${context.url}
- Title: ${context.title}
- Visible text (first 3000 chars): ${context.visibleText}
- Buttons: ${JSON.stringify(context.buttons)}
- Links: ${JSON.stringify(context.links)}
- Input fields: ${JSON.stringify(context.inputs)}

Goal: ${goal}

Based on the page state, describe:
1. What you see on this page (brief summary)
2. What action you recommend to achieve the goal
3. The specific element to interact with (button text, link text, or input selector)

Respond in this JSON format:
{
  "observation": "what you see",
  "recommended_action": "click_button" | "click_link" | "type_text" | "navigate" | "done",
  "target": "the element text or selector to interact with",
  "value": "text to type (only for type_text)",
  "reasoning": "why this action"
}`
    }]
  });

  const text = message.content[0];
  return text.type === 'text' ? text.text : '';
}

/** Execute an LLM-recommended action on the page */
async function executeAction(page: Page, action: any): Promise<boolean> {
  try {
    switch (action.recommended_action) {
      case 'click_button': {
        const btn = page.getByRole('button', { name: action.target });
        await btn.first().click({ timeout: 5000 });
        console.log(`  Clicked button: "${action.target}"`);
        return true;
      }
      case 'click_link': {
        const link = page.getByRole('link', { name: action.target });
        await link.first().click({ timeout: 5000 });
        console.log(`  Clicked link: "${action.target}"`);
        return true;
      }
      case 'type_text': {
        const input = page.getByPlaceholder(action.target);
        await input.first().fill(action.value || '');
        console.log(`  Typed "${action.value}" into "${action.target}"`);
        return true;
      }
      case 'navigate': {
        await page.goto(action.target);
        console.log(`  Navigated to: ${action.target}`);
        return true;
      }
      case 'done': {
        console.log(`  Goal achieved: ${action.reasoning}`);
        return false;
      }
      default:
        console.log(`  Unknown action: ${action.recommended_action}`);
        return false;
    }
  } catch (err) {
    console.error(`  Action failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function main() {
  const goal = process.argv[2] || 'Navigate to the Calendar page and describe what you see';
  console.log(`\nBrowser Assistant starting...`);
  console.log(`Goal: ${goal}`);
  console.log(`App URL: ${APP_URL}\n`);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Navigate to the app
    console.log('Step 1: Navigating to Aiden...');
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const MAX_STEPS = 5;
    for (let step = 0; step < MAX_STEPS; step++) {
      console.log(`\nStep ${step + 2}: Analyzing page...`);
      const context = await getPageContext(page);
      console.log(`  URL: ${context.url}`);
      console.log(`  Title: ${context.title}`);
      console.log(`  Buttons: ${context.buttons.slice(0, 5).join(', ')}`);

      const llmResponse = await askLLM(context, goal);
      console.log(`\n  LLM Response:`);

      // Parse the JSON response
      let action;
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        action = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        console.log(`  Could not parse action, raw response: ${llmResponse}`);
        break;
      }

      if (!action) {
        console.log('  No action returned');
        break;
      }

      console.log(`  Observation: ${action.observation}`);
      console.log(`  Action: ${action.recommended_action} -> "${action.target}"`);
      console.log(`  Reasoning: ${action.reasoning}`);

      const shouldContinue = await executeAction(page, action);
      if (!shouldContinue) break;

      // Wait for page to settle after action
      await page.waitForTimeout(2000);
    }

    // Take a final screenshot
    const screenshotPath = 'playwright/screenshot-final.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`\nFinal screenshot saved to ${screenshotPath}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
}

main();
