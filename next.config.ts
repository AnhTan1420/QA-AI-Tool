import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  // Đảm bảo Vercel copy đúng file từ node_modules vào deployment.
  outputFileTracingIncludes: {
    '/api/automation/inspect': [
      './node_modules/@sparticuz/chromium/**/*',
      './node_modules/playwright-core/**/*', // Bổ sung dòng này
    ],
    '/api/automation/run': [
      './node_modules/@sparticuz/chromium/**/*',
      './node_modules/playwright-core/**/*', // Bổ sung dòng này
    ],
    '/api/automation/batch-run/[id]/process-next': [
      './node_modules/@sparticuz/chromium/**/*',
      './node_modules/playwright-core/**/*', // Bổ sung dòng này
    ],
  },
};

export default nextConfig;