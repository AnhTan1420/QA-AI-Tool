import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  // Đảm bảo Vercel copy đúng file từ node_modules vào deployment.
  // QUAN TRỌNG: bất kỳ route nào (trực tiếp hoặc gián tiếp qua lib/automation/batch-runner.ts)
  // gọi inspectEnvironment()/runGeneratedScript() trong lib/automation/browser-runner.ts đều PHẢI
  // có mặt ở đây - thiếu 1 route nghĩa là function đó sẽ launch Chromium thất bại khi deploy lên
  // Vercel (binary không được bundle kèm), dù chạy `next dev` ở local vẫn pass bình thường (vì
  // IS_SERVERLESS=false ở local nên code dùng package `playwright` đầy đủ, không đụng tới
  // @sparticuz/chromium) - bug loại này chỉ lộ ra ở production. batch-run/[id]/process-next
  // trước đây bị thiếu ở đây khiến "Run Automation" hàng loạt luôn lỗi khi deploy thật.
  outputFileTracingIncludes: {
    '/api/automation/inspect': ['./node_modules/@sparticuz/chromium/**/*'],
    '/api/automation/run': ['./node_modules/@sparticuz/chromium/**/*'],
    '/api/automation/batch-run/[id]/process-next': ['./node_modules/@sparticuz/chromium/**/*'],
  },
};

export default nextConfig;
