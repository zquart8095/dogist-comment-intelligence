import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Audience Intelligence Report — The Dogist',
  description:
    'Scrollytelling audience-research report for the Vitality Chew launch, grounded in the @thedogist comment corpus.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
