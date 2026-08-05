import type { AutomationRunSchema, AutomationScriptSchema } from '@/lib/validators/automation';
import type { z } from 'zod';

export type AutomationScript = z.infer<typeof AutomationScriptSchema>;
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export type GenerateConfig = {
  environment: 'chromium' | 'firefox' | 'webkit';
  target_url: string;
  cookie_token?: string;
  credentials?: { username: string; password: string };
  browser_profile_id?: string;
  useCredentials: boolean;
};

export type GenerateResult = {
  generated_code: string;
  detected_elements: string[];
  requires_auth: boolean;
  estimated_duration_ms: number;
};

export type BrowserProfile = {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
};

export type DiscoveryCase = {
  title: string;
  category: string;
  priority: string;
  steps: string[];
  expected_result: string;
  target_elements: string[];
  risk: string;
};
