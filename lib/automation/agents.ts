// lib/automation/agents.ts
// Orchestrates AI agents for automation features
// DO NOT import 'callAI' or 'buildPrompt' directly here — use named builders below.

import { runAIAgent, runDocumentVisionAgent, type VisionImageInput } from '@/lib/ai/provider';
import { extractJson } from '@/lib/ai/parse';
import {
  buildAutomationGenerationPrompt,
  buildBugAnalysisPrompt,
  buildSelfHealingPrompt,
  buildVisualRegressionPrompt,
  buildNaturalLanguageTaskPrompt,
  buildElementDiscoveryPrompt,
  type AutomationGenerationInput,
} from '@/lib/ai/prompts/automation-agent';
import {
  GenerateAutomationResponseSchema,
  BugAnalysisSchema,
  SelfHealingResponseSchema,
  VisualRegressionResponseSchema,
  NaturalLanguagePlanSchema,
  ElementDiscoveryResponseSchema,
} from '@/lib/validators/automation';

/**
 * Safely parse AI output through Zod.
 * Handles both string (raw AI text) and object (already parsed) inputs.
 */
function parseAIJson<T>(raw: unknown, schema: { parse: (v: unknown) => T }): T {
  let obj = raw;
  if (typeof raw === 'string') {
    obj = extractJson(raw);
  }
  return schema.parse(obj);
}

/** Generate Playwright TypeScript code from a test case */
export async function runPlaywrightGenerationAgent(input: AutomationGenerationInput) {
  const prompt = buildAutomationGenerationPrompt(input);
  const raw = await runAIAgent(prompt, 'generation');
  return parseAIJson(raw, GenerateAutomationResponseSchema);
}

/** Analyze a failure screenshot with AI vision */
export async function runBugAnalysisAgent(
  input: {
    title: string;
    failed_step: string;
    expected_result: string;
    error_message: string;
    target_url: string;
  },
  screenshotBase64: string,
) {
  const prompt = buildBugAnalysisPrompt(input);
  const images: VisionImageInput[] = [{ mimeType: 'image/png', base64Data: screenshotBase64 }];
  const raw = await runDocumentVisionAgent(prompt, images);
  return parseAIJson(raw, BugAnalysisSchema);
}

/** Attempt to heal a broken selector using visual + DOM context */
export async function runSelfHealingAgent(
  input: {
    dom_snapshot: string;
    original_selector: string;
    element_description: string;
    action: string;
    url: string;
  },
  screenshotBase64: string,
) {
  const prompt = buildSelfHealingPrompt(input);
  const images: VisionImageInput[] = [{ mimeType: 'image/png', base64Data: screenshotBase64 }];
  const raw = await runDocumentVisionAgent(prompt, images);
  return parseAIJson(raw, SelfHealingResponseSchema);
}

/** Compare baseline vs current screenshot for visual regression */
export async function runVisualRegressionAgent(
  input: { title: string; url: string },
  baselineBase64: string,
  currentBase64: string,
) {
  const prompt = buildVisualRegressionPrompt(input);
  const images: VisionImageInput[] = [
    { mimeType: 'image/png', base64Data: baselineBase64 },
    { mimeType: 'image/png', base64Data: currentBase64 },
  ];
  const raw = await runDocumentVisionAgent(prompt, images);
  return parseAIJson(raw, VisualRegressionResponseSchema);
}

/** Convert natural language task into structured automation plan */
export async function runNaturalLanguageTaskAgent(input: {
  task: string;
  target_url: string;
  browser: string;
}) {
  const prompt = buildNaturalLanguageTaskPrompt(input);
  const raw = await runAIAgent(prompt, 'generation');
  return parseAIJson(raw, NaturalLanguagePlanSchema);
}

/** Discover testable elements from a webpage screenshot + DOM */
export async function runElementDiscoveryAgent(
  input: { url: string; dom_snapshot: string; page_purpose?: string },
  screenshotBase64: string,
) {
  const prompt = buildElementDiscoveryPrompt(input);
  const images: VisionImageInput[] = [{ mimeType: 'image/png', base64Data: screenshotBase64 }];
  const raw = await runDocumentVisionAgent(prompt, images);
  return parseAIJson(raw, ElementDiscoveryResponseSchema);
}