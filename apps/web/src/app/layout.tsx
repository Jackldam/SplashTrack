import type { Metadata } from 'next';
import './globals.css';

import { appConfig } from '@/lib/env';

export const metadata: Metadata = {
  title: appConfig.appName,
  description: 'Modern Next.js foundation for SplashTrack.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
