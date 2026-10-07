import { Suspense } from 'react';
import { OnboardingWizard } from '@/components/borga/OnboardingWizard';
import { BillingGuard } from '@/components/borga/BillingGate';

export default function OnboardingPage() {
  // useSearchParams (the wizard follows ?step=) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <BillingGuard>
        <OnboardingWizard />
      </BillingGuard>
    </Suspense>
  );
}
