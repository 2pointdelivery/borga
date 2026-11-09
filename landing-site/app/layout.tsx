import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Borga — AI Company OS for Sales, Marketing, Finance & Agents',
  description:
    'Borga runs your whole company in one workspace: sales pipeline, social and paid marketing, double-entry finance, HR, and a fleet of AI agents — with regional privacy (GDPR, CCPA, NDPR, POPIA) built in.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
