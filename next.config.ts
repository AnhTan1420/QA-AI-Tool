import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  // Next's automatic serverless bundler (file tracing) can't always detect
  // files a package loads dynamically at runtime rather than via static
  // import/require. @sparticuz/chromium is exactly that case: it ships its
  // Chromium binary + required shared libraries (libnss3.so and friends) as
  // compressed archives under bin/*.tar.br and extracts them to /tmp at cold
  // start (see lib/automation/browser-runner.ts). Without this, the deployed
  // function launches Chromium successfully but is missing those .so files,
  // which fails with "libnss3.so: cannot open shared object file" — this
  // explicitly forces them (and playwright-core's own files) into the bundle
  // for the two routes that actually launch a browser.
  outputFileTracingIncludes: {
    '/api/automation/inspect': [
      './node_modules/@sparticuz/chromium/**/*',
      './node_modules/playwright-core/**/*',
    ],
    '/api/automation/run': [
      './node_modules/@sparticuz/chromium/**/*',
      './node_modules/playwright-core/**/*',
    ],
  },
};

export default nextConfig;
