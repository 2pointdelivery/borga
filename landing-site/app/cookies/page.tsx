import { PolicyLayout } from '@/components/PolicyLayout';

export default function CookiesPage() {
  return (
    <PolicyLayout title="Cookie policy" updated="October 2026">
      <p>
        This policy explains the cookies and similar storage Borga uses on this website and inside the app, and the rules
        that apply where you are. You can change your choice at any time: on this site via the cookie banner (clear this
        site&apos;s storage to see it again), in the app under your consent prompt.
      </p>
      <h2>1. Categories</h2>
      <table>
        <thead><tr><th>Category</th><th>What it does</th><th>Examples</th></tr></thead>
        <tbody>
          <tr><td>Strictly necessary</td><td>Sign-in, security, load balancing, remembering your cookie choice. Always on.</td><td>session cookie, <code>borga-consent</code></td></tr>
          <tr><td>Website analysis</td><td>Aggregated, anonymized usage statistics.</td><td>Umami (cookieless - only with consent)</td></tr>
          <tr><td>Advertising</td><td>Relevant ads elsewhere and campaign measurement.</td><td>Only set after opt-in / unless opted out by region</td></tr>
          <tr><td>Personalization</td><td>Remembered preferences for a tailored visit.</td><td>Theme, region, dismissed hints</td></tr>
          <tr><td>Security</td><td>Fraud prevention and abuse detection beyond the baseline.</td><td>Rate-limit and device checks</td></tr>
        </tbody>
      </table>
      <h2>2. Rules by region</h2>
      <h3>Europe — opt-in (GDPR + ePrivacy)</h3>
      <p>Nothing optional runs before you accept. Rejecting works the whole site; withdrawing consent is one click and takes effect immediately. Consent is versioned — when this policy changes materially we ask again.</p>
      <h3>Africa — opt-in (NDPR Nigeria, POPIA South Africa, Kenya DPA and equivalents)</h3>
      <p>Same opt-in standard as Europe: optional cookies and any cross-border processing need your prior consent, and you may withdraw it at any time with the same ease.</p>
      <h3>North America — opt-out (US state laws incl. CCPA/CPRA, PIPEDA Canada)</h3>
      <p>Analytics may run until you reject. You may opt out of sale/sharing and targeted advertising at any time; a Global Privacy Control (GPC) signal in your browser is honored automatically as an opt-out, including inside the app, where it overrides any stored choice for analytics and advertising.</p>
      <h2>3. Backend enforcement</h2>
      <ul>
        <li>Your choice is stored as a signed, tamper-evident cookie; forged or outdated choices read as “no consent”.</li>
        <li>Analytics scripts are injected only when the effective choice allows them — never before, never against a GPC opt-out.</li>
        <li>Policy updates bump a consent version; older choices are re-asked instead of silently carried over.</li>
      </ul>
      <h2>4. Managing cookies in your browser</h2>
      <p>Every modern browser lets you block or delete cookies per site. Blocking strictly-necessary cookies will sign you out and break core features; blocking the rest only disables the conveniences above.</p>
    </PolicyLayout>
  );
}
