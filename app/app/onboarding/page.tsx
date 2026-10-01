import { Suspense } from 'react';
import { OnboardingWizard } from '@/components/borga/OnboardingWizard';

export default function OnboardingPage() {
  // useSearchParams (the wizard follows ?step=) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <OnboardingWizard />
    </Suspense>
  );
}
