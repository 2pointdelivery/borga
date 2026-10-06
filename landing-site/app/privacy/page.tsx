import { PolicyLayout } from '@/components/PolicyLayout';

export default function PrivacyPage() {
  return (
    <PolicyLayout title="Privacy notice" updated="October 2026">
      <p>
        Borga (“we”, “us”) provides an AI-powered company operating system. This notice explains what personal data we
        collect, why, and which rights you have — in North America, Europe and Africa. The operator details are on the{' '}
        <a href="/imprint">imprint page</a>.
      </p>
      <h2>1. Data we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address and login credentials when you register or are invited.</li>
        <li><strong>Company data you enter:</strong> customers, deals, invoices, people and other records you create in your workspace. Each workspace is isolated to its own tenant.</li>
        <li><strong>Support and contact data:</strong> messages you send us and tickets you open.</li>
        <li><strong>Technical data:</strong> device, browser, approximate region (for showing the right cookie rules), security logs and — only with your consent — anonymized usage statistics.</li>
      </ul>
      <h2>2. Why we use it</h2>
      <ul>
        <li>To provide the service you signed up for (contract).</li>
        <li>To keep accounts secure and prevent abuse (legitimate interest / legal obligation).</li>
        <li>For product improvement and marketing — only with consent where the law requires it (see <a href="/cookies">cookie policy</a>).</li>
      </ul>
      <p>We do not sell personal data. AI features process your workspace content only to answer your requests; prompts sent to third-party model providers are covered in-app before you enable them.</p>
      <h2>3. Your rights by region</h2>
      <h3>Europe (GDPR)</h3>
      <p>Access, rectification, erasure, restriction, portability, objection, and withdrawal of consent at any time. You may complain to your national supervisory authority. Transfers outside the EEA use standard contractual clauses.</p>
      <h3>North America</h3>
      <p>Under US state laws (including California&apos;s CCPA/CPRA) you may know what we collect, delete it, correct it, and opt out of sale/sharing and targeted advertising — a Global Privacy Control (GPC) signal is honored automatically as an opt-out. Canada&apos;s PIPEDA gives equivalent access and challenge rights.</p>
      <h3>Africa</h3>
      <p>Under Nigeria&apos;s NDPR, South Africa&apos;s POPIA, Kenya&apos;s DPA and similar laws you may be informed, access, correct, delete and object to processing, and processing of your data needs a lawful basis — we rely on consent for everything optional.</p>
      <h2>4. Retention and security</h2>
      <p>Workspace data lives as long as your account does and can be deleted on request. Security logs are kept for 12 months. Data is encrypted in transit and at rest, and access is scoped per workspace.</p>
      <h2>5. Contact</h2>
      <p>For access, deletion or any privacy question, contact us via the <a href="/#contact">contact section</a>. We answer within 30 days (45 days where US law allows an extension).</p>
    </PolicyLayout>
  );
}
