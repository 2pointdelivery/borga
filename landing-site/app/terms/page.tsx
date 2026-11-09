import { PolicyLayout } from '@/components/PolicyLayout';

export default function TermsPage() {
  return (
    <PolicyLayout title="Terms of service" updated="October 2026">
      <p>These terms govern your use of Borga, the AI company operating system. By creating an account you agree to them.</p>
      <h2>1. The service</h2>
      <p>Borga provides workspaces for sales, marketing, finance, HR, communications and AI agents. Features marked beta, experimental or simulated may change or be withdrawn. Availability targets do not constitute a service-level guarantee unless separately agreed.</p>
      <h2>2. Accounts and acceptable use</h2>
      <ul>
        <li>You are responsible for activity under your account and for keeping credentials secret.</li>
        <li>You must have the right to upload the company data you enter, and to connect the third-party accounts you link.</li>
        <li>No unlawful content, no abuse of other tenants, no probing other workspaces, no reselling access without agreement.</li>
      </ul>
      <h2>3. Third-party integrations</h2>
      <p>Linking Gmail, social networks, banks or other apps authorizes Borga to act through those providers on your behalf, within the permissions you grant there. Provider outages or policy changes are outside our control; posting, sending and sync actions follow each provider&apos;s terms.</p>
      <h2>4. AI features</h2>
      <p>AI output is generated and may be wrong — verify anything consequential before acting on it. Autonomous agent actions that send messages or move value always pause for your approval first.</p>
      <h2>5. Billing and termination</h2>
      <p>Paid plans bill per workspace as shown at checkout. Either side may terminate; on termination your workspaces become read-only for 30 days and are then deleted. You may export your data at any time before deletion.</p>
      <h2>6. Liability</h2>
      <p>To the maximum extent permitted by law, Borga is not liable for indirect or consequential loss, including loss of profit or data. Total liability is capped at the fees paid in the 12 months before the claim. Nothing here limits liability that cannot be limited by law, or your statutory consumer rights in the EU, UK, US states, Canada, Nigeria, South Africa or Kenya.</p>
    </PolicyLayout>
  );
}
