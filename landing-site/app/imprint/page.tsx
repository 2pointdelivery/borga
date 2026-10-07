import { PolicyLayout } from '@/components/PolicyLayout';

export default function ImprintPage() {
  return (
    <PolicyLayout title="Imprint" updated="October 2026">
      <p>Provider identification for this website and the Borga service.</p>
      <h2>Operator</h2>
      <p>
        Borga — AI Company OS<br />
        [Legal entity name, to be completed by the operator]<br />
        [Street and number, to be completed]<br />
        [Postal code, city, country]
      </p>
      <h2>Contact</h2>
      <p>
        Email: [contact email]<br />
        Phone: [phone number]
      </p>
      <h2>Represented by</h2>
      <p>[Managing director(s) / authorized representative(s)]</p>
      <h2>Registrations</h2>
      <p>[Commercial register / tax numbers, as applicable to the operator&apos;s jurisdiction]</p>
      <p className="text-sm text-muted-foreground">
        Bracketed items are placeholders the deploying operator completes before publishing; the service must not go live with them unfilled.
      </p>
    </PolicyLayout>
  );
}
