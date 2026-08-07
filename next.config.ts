import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  // Đảm bảo Vercel copy đúng file từ node_modules vào deployment
  outputFileTracingIncludes: {
    '/api/automation/inspect': ['./node_modules/@sparticuz/chromium/**/*'],
    '/api/automation/run': ['./node_modules/@sparticuz/chromium/**/*'],
  },
};

export default nextConfig;
