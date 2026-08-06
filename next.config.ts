import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  // We use @sparticuz/chromium-min (not the full @sparticuz/chromium), which
  // ships NO Chromium binary at all - it fetches the chromium-pack.tar from a
  // remote URL at cold start (see CHROMIUM_REMOTE_EXEC_PATH in
  // lib/automation/browser-runner.ts). That's a deliberate fix for a size
  // problem: the full @sparticuz/chromium package + playwright-core pushed
  // these two routes' function bundles past Vercel's size limit, so Vercel
  // silently dropped files (bin/*.tar.br, incl. libnss3.so) from the deployed
  // bundle even with outputFileTracingIncludes forcing them in - symptom was
  // "libnss3.so: cannot open shared object file" at browser launch.
  // playwright-core itself is small and still needs to be force-included
  // since Next's file tracer doesn't see its dynamically-loaded files.
  outputFileTracingIncludes: {
    '/api/automation/inspect': ['./node_modules/playwright-core/**/*'],
    '/api/automation/run': ['./node_modules/playwright-core/**/*'],
  },
};

export default nextConfig;