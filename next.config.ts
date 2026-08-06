import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
  // Đảm bảo Vercel copy đúng file từ node_modules vào deployment
  outputFileTracingIncludes: {
    '/api/automation/inspect': ['./node_modules/@sparticuz/chromium-min/**/*'],
    '/api/automation/run': ['./node_modules/@sparticuz/chromium-min/**/*'],
  },
};

export default nextConfig;