import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Borga — Agentic Command Center',
  description:
    'Borga is an animated agentic assistant dashboard with a voice assistant, real-time agent status, task progress and per-department KPIs. Orchestrate your business, delegate tasks by voice and watch agents collaborate.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
