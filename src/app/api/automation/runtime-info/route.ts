import { NextResponse } from 'next/server';
import { isSelfHostedRuntimeAvailable } from '@/models/validators/playwright';

/**
 * Tells the client whether this deployment can actually run self-hosted "Full run"
 * automation (real @playwright/test, see docs/automation-agent-rebuild.md §4.2) —
 * true only when AUTOMATION_RUNTIME=local and NOT on Vercel. No auth required: this
 * is deployment-wide configuration, not project/user data. The client uses this to
 * disable the "Self-hosted" option in the Environment form with an explanatory
 * tooltip rather than letting someone pick it and only discover it's rejected by
 * assertExecutionModeAllowed() on submit.
 */
export async function GET() {
  return NextResponse.json({ success: true, data: { self_hosted_available: isSelfHostedRuntimeAvailable() } });
}
