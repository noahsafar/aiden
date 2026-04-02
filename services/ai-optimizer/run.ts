#!/usr/bin/env npx tsx
/**
 * Aiden Unified AI Pipeline Test Runner
 *
 * Single workflow that:
 * 1. Imports shared test cases from src/tests/testCases.ts
 * 2. Reads current prompts from src-tauri/src/commands/ai.rs
 * 3. Runs test emails through the real Claude API
 * 4. Scores accuracy across all dimensions (including new ones)
 * 5. Simulates pipeline logic (deadline display, CRM extraction)
 * 6. Outputs structured JSON report for automated analysis
 *
 * Usage:
 *   npx tsx services/ai-optimizer/run.ts                    # Full run (all tests)
 *   npx tsx services/ai-optimizer/run.ts --quick            # 5-case smoke test
 *   npx tsx services/ai-optimizer/run.ts --dry-run          # Parse only, no API calls
 *   npx tsx services/ai-optimizer/run.ts --json-report      # Write JSON report file
 *   npx tsx services/ai-optimizer/run.ts --filter N         # Only run test IDs starting with 'N'
 *   npx tsx services/ai-optimizer/run.ts --optimize         # Run tests + generate prompt optimization suggestions
 *   npx tsx services/ai-optimizer/run.ts --json-report --optimize  # Full run + JSON + optimize
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import shared test cases and matchers
import {
  TEST_CASES, QUICK_TEST_IDS,
  type TestCase, type ExpectedAnalysis, type LifeDataFieldExpectation,
} from '../../src/tests/testCases.ts';
import {
  datesMatch, toneMatches, categoryMatches, lifeDataTypesMatch,
  countInRange, keywordsPresent, formalityInRange,
  simulateDeadlineDisplay, deadlineDisplayMatches,
  simulateCRMExtraction,
} from '../../src/tests/matchers.ts';

// ==================== CONFIGURATION ====================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AI_RS_PATH = path.join(PROJECT_ROOT, 'src-tauri/src/commands/ai.rs');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const LOG_DIR = path.join(PROJECT_ROOT, 'services/ai-optimizer/logs');
const REPORT_DIR = path.join(PROJECT_ROOT, 'services/ai-optimizer/reports');

const API_URL = 'https://api.z.ai/api/anthropic/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;
const DELAY_BETWEEN_TESTS_MS = 1200;
const MAX_RETRIES = 2;

// ==================== CLI ARGS ====================

const args = process.argv.slice(2);
const isQuick = args.includes('--quick');
const isDryRun = args.includes('--dry-run');
const wantJsonReport = args.includes('--json-report');
const wantOptimize = args.includes('--optimize');
const filterPrefix = (() => {
  const idx = args.indexOf('--filter');
  return idx >= 0 ? args[idx + 1] : null;
})();

const OPTIMIZE_MAX_TOKENS = 8000;

// ==================== API KEY ====================

function getApiKey(): string {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      if (line.startsWith('ANTHROPIC_API_KEY=')) {
        const key = line.slice('ANTHROPIC_API_KEY='.length).trim();
        if (key && !key.startsWith('"')) return key;
      }
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  throw new Error('ANTHROPIC_API_KEY not found in .env or environment');
}

// ==================== CLAUDE API CLIENT ====================

async function callClaude(
  prompt: string,
  system?: string,
  model: string = MODEL,
  maxTokens: number = MAX_TOKENS
): Promise<string> {
  const apiKey = getApiKey();
  const body: any = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const wait = (attempt + 1) * 5000;
        log(`  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await res.json();
      return data.content?.[0]?.text || '';
    } catch (e: any) {
      if (attempt === MAX_RETRIES) throw e;
      log(`  Attempt ${attempt + 1} failed: ${e.message}, retrying...`);
      await sleep(2000);
    }
  }
  throw new Error('Max retries exceeded');
}

function extractJson(text: string): any {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  throw new Error(`Could not extract JSON from: ${text.slice(0, 200)}`);
}

// ==================== PROMPT PARSER ====================

interface ExtractedPrompts {
  analyzeSystemPrompt: string;
  analyzeUserPromptTemplate: string;
  classifyPromptTemplate: string;
}

function readCurrentPrompts(): ExtractedPrompts {
  const source = fs.readFileSync(AI_RS_PATH, 'utf-8');

  const analyzeSystemMatch = source.match(
    /pub async fn analyze_email_claude[\s\S]*?let system_prompt = r#"([\s\S]*?)"#;/
  );
  if (!analyzeSystemMatch) throw new Error('Could not find analyze_email_claude system prompt');

  const analyzeUserMatch = source.match(
    /pub async fn analyze_email_claude[\s\S]*?let prompt = format!\(\s*r#"([\s\S]*?)"#,/
  );
  if (!analyzeUserMatch) throw new Error('Could not find analyze_email_claude user prompt');

  const classifyMatch = source.match(
    /pub async fn classify_email[\s\S]*?let prompt = format!\(\s*r#"([\s\S]*?)"#,/
  );
  if (!classifyMatch) throw new Error('Could not find classify_email prompt');

  return {
    analyzeSystemPrompt: analyzeSystemMatch[1],
    analyzeUserPromptTemplate: analyzeUserMatch[1],
    classifyPromptTemplate: classifyMatch[1],
  };
}

function buildAnalyzePrompt(
  template: string,
  sender: string,
  subject: string,
  body: string,
  hasAttachments: boolean
): string {
  let result = template;
  const today = new Date().toISOString().split('T')[0];
  const placeholders = [today, sender, subject, body, String(hasAttachments)];
  for (const val of placeholders) {
    result = result.replace('{}', val);
  }
  result = result.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  return result;
}

function buildClassifyPrompt(
  template: string,
  sender: string,
  subject: string,
  content: string
): string {
  let result = template;
  const today = new Date().toISOString().split('T')[0];
  const placeholders = [today, sender, subject, content];
  for (const val of placeholders) {
    result = result.replace('{}', val);
  }
  result = result.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  return result;
}

// ==================== ASSERTION ENGINE ====================

interface AssertionResult {
  dimension: string;
  passed: boolean;
  expected: string;
  actual: string;
}

function runAssertions(tc: TestCase, analysis: any, classification: any): AssertionResult[] {
  const results: AssertionResult[] = [];
  const ea = tc.expected_analysis;
  const ec = tc.expected_classification;

  // 1. Classification category
  results.push({
    dimension: 'classification',
    passed: categoryMatches(classification.category, ec.category, ec.acceptable_categories),
    expected: ec.acceptable_categories ? `${ec.category} (or ${ec.acceptable_categories.join(', ')})` : ec.category,
    actual: classification.category || 'null',
  });

  // 2. Requires reply (classification)
  results.push({
    dimension: 'requires_reply_class',
    passed: classification.requires_reply === ec.requires_reply,
    expected: String(ec.requires_reply),
    actual: String(classification.requires_reply),
  });

  // 3. Requires reply (analysis)
  results.push({
    dimension: 'requires_reply_analysis',
    passed: analysis.requires_reply === ea.requires_reply,
    expected: String(ea.requires_reply),
    actual: String(analysis.requires_reply),
  });

  // 4. Deadline detection
  if (ea.deadline_expected) {
    const has = !!analysis.deadline;
    results.push({
      dimension: 'deadline_detection',
      passed: has,
      expected: 'deadline present',
      actual: has ? `"${analysis.deadline}"` : 'no deadline',
    });
    if (ea.deadline_date_approx && analysis.deadline) {
      results.push({
        dimension: 'deadline_accuracy',
        passed: datesMatch(analysis.deadline, ea.deadline_date_approx),
        expected: ea.deadline_date_approx,
        actual: analysis.deadline,
      });
    }
  } else {
    const has = !!analysis.deadline;
    results.push({
      dimension: 'no_false_deadline',
      passed: !has,
      expected: 'no deadline',
      actual: has ? `"${analysis.deadline}"` : 'no deadline',
    });
  }

  // 5. Meeting detection
  if (ea.meeting_expected) {
    const has = !!analysis.meeting_request?.is_meeting;
    results.push({
      dimension: 'meeting_detection',
      passed: has,
      expected: 'meeting detected',
      actual: has ? 'meeting detected' : 'no meeting',
    });
  } else {
    const has = !!analysis.meeting_request?.is_meeting;
    results.push({
      dimension: 'meeting_detection',
      passed: !has,
      expected: 'no meeting',
      actual: has ? 'meeting detected' : 'no meeting',
    });
  }

  // 6. Event type
  if (ea.event_type) {
    const actualType = analysis.meeting_request?.event_type?.toLowerCase();
    const expected = ea.event_type.toLowerCase();
    results.push({
      dimension: 'event_type',
      passed: actualType === expected,
      expected: ea.event_type,
      actual: actualType || 'null',
    });
  }

  // 7. Tone
  if (ea.acceptable_tones?.length) {
    results.push({
      dimension: 'tone',
      passed: toneMatches(analysis.sender_tone, ea.acceptable_tones),
      expected: ea.acceptable_tones.join(' / '),
      actual: analysis.sender_tone || 'null',
    });
  }

  // 8. Life data types
  if (ea.expected_life_data_types !== undefined) {
    const actualTypes = (analysis.life_data || []).map((d: any) => d.data_type?.toLowerCase());
    if (ea.expected_life_data_types.length === 0) {
      // Expect no life data (no hallucination)
      results.push({
        dimension: 'life_data_no_hallucination',
        passed: actualTypes.length === 0,
        expected: 'empty',
        actual: actualTypes.length === 0 ? 'empty' : actualTypes.join(', '),
      });
    } else {
      const allPresent = ea.expected_life_data_types.every((t: string) => actualTypes.includes(t.toLowerCase()));
      results.push({
        dimension: 'life_data',
        passed: allPresent,
        expected: ea.expected_life_data_types.join(', '),
        actual: actualTypes.join(', ') || 'none',
      });
    }
  }

  // 9. Life data field details
  if (ea.expected_life_data_fields?.length) {
    for (const expectedField of ea.expected_life_data_fields) {
      const actualItems = (analysis.life_data || []) as any[];
      const matchingItem = actualItems.find(
        (item: any) => item.data_type?.toLowerCase() === expectedField.data_type.toLowerCase()
      );

      if (!matchingItem) {
        results.push({
          dimension: 'life_data_fields',
          passed: false,
          expected: `${expectedField.data_type} with fields`,
          actual: 'item not found',
        });
        continue;
      }

      // Check individual fields
      if (expectedField.amount !== undefined) {
        const actualAmount = parseFloat(matchingItem.amount);
        results.push({
          dimension: 'life_data_amount',
          passed: !isNaN(actualAmount) && Math.abs(actualAmount - expectedField.amount) < 0.01,
          expected: String(expectedField.amount),
          actual: String(matchingItem.amount ?? 'null'),
        });
      }
      if (expectedField.carrier !== undefined) {
        const actualCarrier = (matchingItem.carrier || matchingItem.provider || '').toLowerCase();
        results.push({
          dimension: 'life_data_carrier',
          passed: actualCarrier.includes(expectedField.carrier.toLowerCase()),
          expected: expectedField.carrier,
          actual: actualCarrier || 'null',
        });
      }
      if (expectedField.tracking_number !== undefined) {
        const actualTracking = matchingItem.tracking_number || matchingItem.trackingNumber || '';
        results.push({
          dimension: 'life_data_tracking',
          passed: actualTracking.includes(expectedField.tracking_number),
          expected: expectedField.tracking_number,
          actual: actualTracking || 'null',
        });
      }
      if (expectedField.confirmation_number !== undefined) {
        const actualConf = matchingItem.confirmation_number || matchingItem.confirmationNumber || matchingItem.reference || '';
        results.push({
          dimension: 'life_data_confirmation',
          passed: actualConf.includes(expectedField.confirmation_number),
          expected: expectedField.confirmation_number,
          actual: actualConf || 'null',
        });
      }
      if (expectedField.frequency !== undefined) {
        const actualFreq = (matchingItem.frequency || matchingItem.billing_cycle || '').toLowerCase();
        results.push({
          dimension: 'life_data_frequency',
          passed: actualFreq.includes(expectedField.frequency.toLowerCase()),
          expected: expectedField.frequency,
          actual: actualFreq || 'null',
        });
      }
    }
  }

  // 10. Questions count
  if (ea.min_questions !== undefined || ea.max_questions !== undefined) {
    const count = (analysis.questions || []).length;
    const inRange = countInRange(count, ea.min_questions, ea.max_questions);
    results.push({
      dimension: 'questions',
      passed: inRange,
      expected: `${ea.min_questions ?? 0}-${ea.max_questions ?? 'inf'}`,
      actual: String(count),
    });
  }

  // 11. Missing attachment
  if (ea.missing_attachment_expected) {
    const has = !!analysis.missing_attachment_warning;
    results.push({
      dimension: 'missing_attachment',
      passed: has,
      expected: 'warning present',
      actual: has ? 'warning present' : 'no warning',
    });
  }

  // 12. Attachment keywords
  if (ea.expected_attachment_keywords?.length) {
    const actualKw = (analysis.attachment_requests || [])
      .map((r: any) => `${r.keyword} ${r.description} ${r.file_type || ''}`)
      .join(' ').toLowerCase();
    const found = keywordsPresent([actualKw], ea.expected_attachment_keywords);
    results.push({
      dimension: 'attachment_keywords',
      passed: found,
      expected: ea.expected_attachment_keywords.join(', '),
      actual: actualKw || 'none',
    });
  }

  // 13. Deadline display simulation
  if (ea.expected_deadline_display && analysis.deadline) {
    const matches = deadlineDisplayMatches(analysis.deadline, ea.expected_deadline_display);
    const simulated = simulateDeadlineDisplay(analysis.deadline);
    results.push({
      dimension: 'deadline_display',
      passed: matches,
      expected: ea.expected_deadline_display,
      actual: simulated,
    });
  }

  // 14. Deadline + category coexistence
  if (ea.deadline_must_coexist_with_category) {
    const hasDeadline = !!analysis.deadline;
    const isUrgentOrImportant = ['urgent', 'important'].includes(
      (classification.category || '').toLowerCase()
    );
    results.push({
      dimension: 'deadline_category_consistency',
      passed: hasDeadline && isUrgentOrImportant,
      expected: 'deadline AND Urgent/Important category',
      actual: `deadline=${hasDeadline}, category=${classification.category || 'null'}`,
    });
  }

  // 15. Formality range
  if (ea.expected_formality_range) {
    const score = analysis.suggested_formality_score;
    results.push({
      dimension: 'formality_range',
      passed: formalityInRange(score, ea.expected_formality_range),
      expected: `[${ea.expected_formality_range[0]}, ${ea.expected_formality_range[1]}]`,
      actual: String(score ?? 'null'),
    });
  }

  // 16. CRM sender parse
  if (ea.expected_crm_category) {
    const crm = simulateCRMExtraction(tc.email.sender);
    // For named senders, verify name was extracted
    const hasName = !!crm.name;
    const hasValidEmail = crm.email.includes('@');
    results.push({
      dimension: 'crm_sender_parse',
      passed: hasValidEmail && (crm.isNoreply || hasName),
      expected: `parseable sender (name or noreply)`,
      actual: `name=${crm.name || 'null'}, email=${crm.email}, noreply=${crm.isNoreply}`,
    });
  }

  // 17. Reply reasoning keywords
  if (ea.requires_reply_reasoning_keywords?.length) {
    const reasoning = (analysis.reply_reasoning || analysis.requires_reply_reasoning || '').toLowerCase();
    const found = ea.requires_reply_reasoning_keywords.some(kw => reasoning.includes(kw.toLowerCase()));
    results.push({
      dimension: 'reply_reasoning',
      passed: found,
      expected: `contains: ${ea.requires_reply_reasoning_keywords.join(' / ')}`,
      actual: reasoning.slice(0, 100) || 'null',
    });
  }

  // 18. Question types validation (if questions exist)
  if ((analysis.questions || []).length > 0) {
    const questions = analysis.questions as any[];
    for (const q of questions) {
      if (q.type === 'choice' && (!q.options || q.options.length === 0)) {
        results.push({
          dimension: 'question_types',
          passed: false,
          expected: 'choice questions have options',
          actual: `choice question "${(q.text || '').slice(0, 50)}" has no options`,
        });
      }
    }
  }

  return results;
}

// ==================== ACCURACY ====================

interface DimensionAccuracy {
  dimension: string;
  total: number;
  passed: number;
  pct: number;
}

function calcAccuracy(allAssertions: AssertionResult[]): DimensionAccuracy[] {
  const dims = new Map<string, { total: number; passed: number }>();
  for (const a of allAssertions) {
    const e = dims.get(a.dimension) || { total: 0, passed: 0 };
    e.total++;
    if (a.passed) e.passed++;
    dims.set(a.dimension, e);
  }
  return Array.from(dims.entries())
    .map(([d, { total, passed }]) => ({
      dimension: d, total, passed,
      pct: Math.round(passed / total * 1000) / 10,
    }))
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

function overallAccuracy(allAssertions: AssertionResult[]): number {
  if (allAssertions.length === 0) return 0;
  return Math.round(allAssertions.filter(a => a.passed).length / allAssertions.length * 1000) / 10;
}

// ==================== LOGGING ====================

let logLines: string[] = [];

function log(msg: string) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function saveLog() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(LOG_DIR, `run-${ts}.log`);
  fs.writeFileSync(logPath, logLines.join('\n'), 'utf-8');
  log(`Log saved: ${logPath}`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ==================== TEST RUNNER ====================

interface TestResult {
  tc: TestCase;
  assertions: AssertionResult[];
  passed: boolean;
  error?: string;
  durationMs: number;
  rawAnalysis?: any;
  rawClassification?: any;
}

async function runTests(
  prompts: ExtractedPrompts,
  cases: TestCase[]
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    log(`  [${i + 1}/${cases.length}] ${tc.id}: ${tc.name}`);
    const start = Date.now();

    try {
      const analyzePrompt = buildAnalyzePrompt(
        prompts.analyzeUserPromptTemplate,
        tc.email.sender, tc.email.subject, tc.email.body_text, tc.email.has_attachments
      );
      const classifyPrompt = buildClassifyPrompt(
        prompts.classifyPromptTemplate,
        tc.email.sender, tc.email.subject, tc.email.body_text
      );

      // Run both API calls in parallel
      const [analyzeRaw, classifyRaw] = await Promise.all([
        callClaude(analyzePrompt, prompts.analyzeSystemPrompt),
        callClaude(classifyPrompt),
      ]);

      const analysis = extractJson(analyzeRaw);
      const classification = extractJson(classifyRaw);
      const assertions = runAssertions(tc, analysis, classification);
      const failCount = assertions.filter(a => !a.passed).length;

      const icon = failCount === 0 ? 'PASS' : 'FAIL';
      log(`    ${icon} (${failCount === 0 ? 'all passed' : `${failCount} failed`}) [${((Date.now() - start) / 1000).toFixed(1)}s]`);

      if (failCount > 0) {
        for (const a of assertions.filter(a => !a.passed)) {
          log(`      X [${a.dimension}] expected: ${a.expected} -> got: ${a.actual}`);
        }
      }

      results.push({
        tc, assertions, passed: failCount === 0,
        durationMs: Date.now() - start,
        rawAnalysis: analysis, rawClassification: classification,
      });
    } catch (e: any) {
      log(`    ERROR: ${e.message}`);
      results.push({
        tc, assertions: [], passed: false,
        error: e.message, durationMs: Date.now() - start,
      });
    }

    if (i < cases.length - 1) await sleep(DELAY_BETWEEN_TESTS_MS);
  }

  return results;
}

// ==================== REPORT ====================

function printReport(results: TestResult[]) {
  const allAssertions = results.flatMap(r => r.assertions);
  const overall = overallAccuracy(allAssertions);
  const dims = calcAccuracy(allAssertions);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log('');
  log('='.repeat(60));
  log('  AI PIPELINE TEST REPORT');
  log('='.repeat(60));
  log(`Tests: ${results.length} total, ${passed} passed, ${failed} failed`);
  log(`Overall accuracy: ${overall}%`);
  log('');
  log('--- Accuracy by Dimension ---');
  for (const d of dims) {
    const indicator = d.pct >= 90 ? '[OK]' : d.pct >= 70 ? '[!!]' : '[XX]';
    log(`${indicator} ${d.dimension.padEnd(30)} ${d.pct.toFixed(1).padStart(5)}%  (${d.passed}/${d.total})`);
  }

  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    log('');
    log('--- Failures ---');
    for (const r of failedResults) {
      if (r.error) {
        log(`  [ERROR] ${r.tc.id}: ${r.tc.name} -- ${r.error}`);
      } else {
        for (const a of r.assertions.filter(a => !a.passed)) {
          log(`  [FAIL]  ${r.tc.id}: ${r.tc.name} -- [${a.dimension}] expected: ${a.expected} -> got: ${a.actual}`);
        }
      }
    }
  }
  log('='.repeat(60));

  return { overall, dims, failedResults };
}

// ==================== JSON REPORT ====================

interface JsonReport {
  timestamp: string;
  overall_accuracy: number;
  total_tests: number;
  passed: number;
  failed: number;
  dimensions: Record<string, { total: number; passed: number; pct: number }>;
  failures: Array<{
    test_id: string;
    test_name: string;
    scenario_category: string;
    failed_dimensions: Array<{
      dimension: string;
      expected: string;
      actual: string;
    }>;
    raw_analysis?: any;
    raw_classification?: any;
  }>;
  suggestions: string[];
}

function generateJsonReport(results: TestResult[], dims: DimensionAccuracy[]): JsonReport {
  const allAssertions = results.flatMap(r => r.assertions);
  const overall = overallAccuracy(allAssertions);
  const passed = results.filter(r => r.passed).length;
  const failedResults = results.filter(r => !r.passed);

  const dimensions: Record<string, { total: number; passed: number; pct: number }> = {};
  for (const d of dims) {
    dimensions[d.dimension] = { total: d.total, passed: d.passed, pct: d.pct };
  }

  const failures = failedResults.map(r => ({
    test_id: r.tc.id,
    test_name: r.tc.name,
    scenario_category: r.tc.scenario_category,
    failed_dimensions: r.assertions
      .filter(a => !a.passed)
      .map(a => ({ dimension: a.dimension, expected: a.expected, actual: a.actual })),
    raw_analysis: r.rawAnalysis,
    raw_classification: r.rawClassification,
  }));

  // Generate suggestions based on patterns in failures
  const suggestions: string[] = [];
  const failedDims = dims.filter(d => d.pct < 90);

  for (const d of failedDims) {
    switch (d.dimension) {
      case 'deadline_display':
        suggestions.push(
          'Deadline display: verify the daysUntil calculation in EmailList.tsx handles negative days and edge cases correctly'
        );
        break;
      case 'deadline_detection':
      case 'no_false_deadline':
        suggestions.push(
          'Deadline detection: review the analyze prompt in ai.rs to ensure clear distinction between actionable deadlines and informational dates'
        );
        break;
      case 'deadline_category_consistency':
        suggestions.push(
          'Deadline-category consistency: emails with deadlines should typically be classified as Urgent or Important, not Normal/Low'
        );
        break;
      case 'meeting_detection':
        suggestions.push(
          'Meeting detection: distinguish between past meeting references and actual upcoming meeting scheduling'
        );
        break;
      case 'event_type':
        suggestions.push(
          'Event type: ensure the analyze prompt distinguishes meetings (1-on-1, team sync) from events (conferences, parties, workshops)'
        );
        break;
      case 'life_data':
      case 'life_data_no_hallucination':
        suggestions.push(
          'Life data: review prompt instructions for life_data extraction — avoid hallucinating data from non-transactional emails'
        );
        break;
      case 'life_data_amount':
      case 'life_data_carrier':
      case 'life_data_tracking':
        suggestions.push(
          `Life data fields (${d.dimension}): the prompt should instruct extraction of specific amounts, carriers, and tracking numbers from transactional emails`
        );
        break;
      case 'classification':
        suggestions.push(
          'Classification: review category assignment rules — newsletters should be Low, boss emails Important/Urgent'
        );
        break;
      case 'tone':
        suggestions.push(
          'Tone detection: the analyze prompt may need more guidance on distinguishing similar tones (e.g., urgent vs demanding)'
        );
        break;
      case 'crm_sender_parse':
        suggestions.push(
          'CRM parsing: verify that the "Display Name <email>" format is parsed correctly in crmStore.ts extractContacts'
        );
        break;
      case 'reply_reasoning':
        suggestions.push(
          'Reply reasoning: the analyze prompt should generate meaningful reply_reasoning text explaining WHY a reply is needed'
        );
        break;
      default:
        if (d.pct < 80) {
          suggestions.push(`${d.dimension}: accuracy at ${d.pct}% needs investigation`);
        }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    overall_accuracy: overall,
    total_tests: results.length,
    passed,
    failed: results.length - passed,
    dimensions,
    failures,
    suggestions,
  };
}

function writeJsonReport(report: JsonReport) {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORT_DIR, `report-${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  log(`JSON report saved: ${reportPath}`);
  return reportPath;
}

// ==================== DRY RUN ====================

function dryRun(cases: TestCase[]) {
  log('DRY RUN: Validating test cases and assertions without API calls...');
  log('');

  // Validate all test cases have required fields
  let issues = 0;
  for (const tc of cases) {
    if (!tc.id || !tc.name || !tc.email || !tc.expected_classification || !tc.expected_analysis) {
      log(`  [ISSUE] ${tc.id}: Missing required fields`);
      issues++;
    }
    if (!tc.email.sender || !tc.email.subject) {
      log(`  [ISSUE] ${tc.id}: Missing sender or subject`);
      issues++;
    }

    // Validate CRM extraction works for all senders
    const crm = simulateCRMExtraction(tc.email.sender);
    if (!crm.email.includes('@') && !tc.email.sender.includes('@')) {
      log(`  [ISSUE] ${tc.id}: Sender "${tc.email.sender}" has no parseable email`);
      issues++;
    }

    // Validate deadline display simulation for cases that expect it
    if (tc.expected_analysis.expected_deadline_display && tc.expected_analysis.deadline_date_approx) {
      const simulated = simulateDeadlineDisplay(tc.expected_analysis.deadline_date_approx);
      if (simulated !== tc.expected_analysis.expected_deadline_display) {
        log(`  [ISSUE] ${tc.id}: Deadline display mismatch: simulated="${simulated}" vs expected="${tc.expected_analysis.expected_deadline_display}"`);
        issues++;
      }
    }
  }

  log('');
  log(`Validated ${cases.length} test cases. ${issues} issues found.`);

  // Show test case summary
  const categories = new Map<string, number>();
  for (const tc of cases) {
    categories.set(tc.scenario_category, (categories.get(tc.scenario_category) || 0) + 1);
  }
  log('');
  log('Test cases by category:');
  for (const [cat, count] of [...categories.entries()].sort()) {
    log(`  ${cat}: ${count}`);
  }
}

// ==================== OPTIMIZE STEP ====================

function buildOptimizePrompt(report: JsonReport, prompts: ExtractedPrompts): string {
  const weakDims = Object.entries(report.dimensions)
    .filter(([, v]) => v.pct < 90)
    .sort((a, b) => a[1].pct - b[1].pct)
    .map(([dim, v]) => `- ${dim}: ${v.pct}% (${v.passed}/${v.total})`)
    .join('\n');

  const topFailures = report.failures.slice(0, 25).map(f => {
    const dims = f.failed_dimensions
      .map(d => `[${d.dimension}] expected: ${d.expected} -> got: ${d.actual}`)
      .join('\n      ');
    const rawSnippet = f.raw_analysis
      ? JSON.stringify(f.raw_analysis).slice(0, 300)
      : 'N/A';
    return `  ${f.test_id} (${f.scenario_category}): ${f.test_name}\n      ${dims}\n      raw: ${rawSnippet}`;
  }).join('\n\n');

  return `You are an AI prompt engineer optimizing an email analysis system called Aiden.

## Test Results Summary
Overall accuracy: ${report.overall_accuracy}% (${report.passed}/${report.total_tests} tests passed)

## Dimensions Below 90% Accuracy
${weakDims || '(none — all dimensions at 90%+)'}

## Top Failures (up to 25)
${topFailures || '(no failures)'}

## Current Prompts

### analyze_email_claude — system prompt
\`\`\`
${prompts.analyzeSystemPrompt}
\`\`\`

### analyze_email_claude — user prompt template
\`\`\`
${prompts.analyzeUserPromptTemplate}
\`\`\`

### classify_email — prompt template
\`\`\`
${prompts.classifyPromptTemplate}
\`\`\`

## Your Task
Analyze the failures and suggest exact prompt edits to improve accuracy on the weakest dimensions.
For each edit, provide the EXACT old text (a substring of the current prompt) and the replacement text.
Do NOT rewrite entire prompts — target the minimal change that fixes the failing pattern.

Output your response in this exact format:

# AI Optimization Report
Overall accuracy: ${report.overall_accuracy}% (${report.passed}/${report.total_tests} passed)

## Suggested Prompt Edits

### Edit N: [short description]
File: src-tauri/src/commands/ai.rs
Function: [analyze_email_claude | classify_email]
Dimension(s): [which failing dimensions this targets]
Reasoning: [1-2 sentences on why this fixes the pattern]

Old:
[exact substring from current prompt]

New:
[replacement text]

## Code Issues (Non-Prompt)
- File: [path] — [description of any code-level issues you noticed, or "None"]`;
}

async function runOptimizeStep(report: JsonReport, prompts: ExtractedPrompts): Promise<string> {
  log('');
  log('Running optimization step (calling Claude for prompt suggestions)...');

  const optimizePrompt = buildOptimizePrompt(report, prompts);
  const result = await callClaude(
    optimizePrompt,
    'You are an expert prompt engineer. Respond ONLY with the optimization report in the specified format.',
    MODEL,
    OPTIMIZE_MAX_TOKENS,
  );

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(REPORT_DIR, `optimize-${ts}.md`);
  fs.writeFileSync(reportPath, result, 'utf-8');
  log(`Optimization report saved: ${reportPath}`);
  return reportPath;
}

// ==================== MAIN ====================

async function main() {
  log('');
  log('========================================');
  log('  AIDEN UNIFIED AI PIPELINE TESTER');
  log('========================================');
  log('');

  // Select test cases
  let cases = TEST_CASES;
  if (isQuick) {
    cases = TEST_CASES.filter(tc => QUICK_TEST_IDS.includes(tc.id));
  }
  if (filterPrefix) {
    cases = TEST_CASES.filter(tc => tc.id.startsWith(filterPrefix));
  }

  log(`Mode: ${isDryRun ? 'dry-run' : isQuick ? 'quick (5 tests)' : `full (${cases.length} tests)`}`);
  if (filterPrefix) log(`Filter: IDs starting with "${filterPrefix}"`);
  log(`JSON report: ${wantJsonReport ? 'yes' : 'no'}`);
  log(`Optimize: ${wantOptimize ? 'yes' : 'no'}`);
  log(`API: ${API_URL} / ${MODEL}`);
  log(`Test cases: ${cases.length}`);
  log('');

  if (cases.length === 0) {
    log('No test cases match the filter. Exiting.');
    return;
  }

  // Dry run mode — validate without API calls
  if (isDryRun) {
    if (wantOptimize) log('Note: --optimize is ignored in --dry-run mode');
    dryRun(cases);
    saveLog();
    return;
  }

  // Read prompts from ai.rs
  let prompts: ExtractedPrompts;
  try {
    prompts = readCurrentPrompts();
    log('Read prompts from ai.rs');
  } catch (e: any) {
    log(`Failed to read prompts: ${e.message}`);
    return;
  }

  // Run test suite
  log('');
  log('Running test suite...');
  const results = await runTests(prompts, cases);
  const allAssertions = results.flatMap(r => r.assertions);
  const dims = calcAccuracy(allAssertions);
  const { overall } = printReport(results);

  // Generate JSON report if requested (or needed by optimize)
  const jsonReport = (wantJsonReport || wantOptimize)
    ? generateJsonReport(results, dims)
    : null;

  if (wantJsonReport && jsonReport) {
    const reportPath = writeJsonReport(jsonReport);
    log('');
    log(`Report: ${reportPath}`);
  }

  // Optimization step — feed failures to Claude for prompt edit suggestions
  if (wantOptimize && jsonReport) {
    const optimizePath = await runOptimizeStep(jsonReport, prompts);
    log(`Optimize report: ${optimizePath}`);
  }

  saveLog();

  // Exit with non-zero if accuracy is below 80%
  if (overall < 80) {
    process.exit(1);
  }
}

// ==================== RUN ====================

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
