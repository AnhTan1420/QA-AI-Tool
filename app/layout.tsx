import type { Metadata } from 'next';
import './globals.css'; // Nhập CSS toàn cục (Tailwind CSS)

export const metadata: Metadata = {
  title: 'QAForge - AI QA & Testing Platform',
  description: 'Nền tảng hỗ trợ tạo Test Case tự động bằng AI và quản lý tiến độ kiểm thử chuyên nghiệp.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}