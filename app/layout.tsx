import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-jakarta',
  display: 'swap',
  weight: ['600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'QAForge - QA Toolkit & AI Test Case Generator',
  description:
    'Nền tảng QA Toolkit và AI Test Case Generator có RAG, review agent độc lập và requirement traceability.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="bg-ink-50 font-sans text-ink-900 antialiased">{children}</body>
    </html>
  );
}
