import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QAForge - QA Toolkit & AI Test Case Generator',
  description:
    'Nền tảng QA Toolkit và AI Test Case Generator có RAG, review agent độc lập và requirement traceability.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className="bg-slate-50 text-slate-950 antialiased">{children}</body>
    </html>
  );
}
