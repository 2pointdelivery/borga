// What each accounting framework lets a company do with property, plant and equipment. The fixed asset engine reads this table and
// refuses what the framework forbids (for example an upward revaluation under US GAAP or ASPE), so the register cannot quietly
// produce numbers the company's own standard would not accept. It is the framework the company's country maps to
// (getAccountingStandard in data.ts): Canada ASPE, United States US GAAP, Denmark and Ghana IFRS, anything else IFRS.
//
// This is a summary of the main rules for reference, in our own words, not a substitute for the standards or for an accountant.

import { getAccountingStandard, type AccountingFramework } from './data';

export type ImpairmentTest = 'recoverable-amount' | 'recoverability-then-fair-value';

export interface AssetPolicy {
  framework: AccountingFramework;
  /** Name shown to the user, for example "IFRS (IAS 16, IAS 36, IFRS 5)". */
  label: string;
  /** Revaluing a class of assets to fair value after acquisition. */
  allowsRevaluation: boolean;
  /** Reversing an impairment loss on assets held and used. */
  allowsImpairmentReversal: boolean;
  /**
   * recoverable-amount (IAS 36): compare the carrying amount with the higher of fair value less costs of disposal and value in use.
   * recoverability-then-fair-value (US GAAP ASC 360, ASPE 3063): first test whether the asset's undiscounted cash flows cover its
   * carrying amount; only if they do not, write it down to fair value.
   */
  impairmentTest: ImpairmentTest;
  /** Significant parts with different lives are depreciated separately. */
  components: 'required' | 'encouraged';
  /** Where the rules sit, for the screen. */
  references: { depreciation: string; revaluation: string; impairment: string; heldForSale: string };
  notes: string[];
}

const IFRS: AssetPolicy = {
  framework: 'IFRS',
  label: 'IFRS (IAS 16, IAS 36, IFRS 5)',
  allowsRevaluation: true,
  allowsImpairmentReversal: true,
  impairmentTest: 'recoverable-amount',
  components: 'required',
  references: { depreciation: 'IAS 16', revaluation: 'IAS 16.31 to 42', impairment: 'IAS 36', heldForSale: 'IFRS 5' },
  notes: [
    'Each asset is carried at cost or, if the company chooses it for a whole class, at a revalued amount (fair value less later depreciation and impairment).',
    'A revaluation increase goes to equity (revaluation surplus) unless it reverses an earlier loss on the same asset that went through profit or loss; a decrease first uses up that asset\'s surplus.',
    'An impairment loss is the carrying amount above the recoverable amount, the higher of fair value less costs of disposal and value in use. It can be reversed later, but never above what the carrying amount would have been without it.',
    'Depreciation starts when the asset is available for use and stops when it is classified held for sale. Useful life, residual value and method are reviewed at least each year; a change applies from then on, not to past years.',
    'Significant parts with different useful lives are depreciated separately: add each part as its own asset.',
  ],
};

const US_GAAP: AssetPolicy = {
  framework: 'US-GAAP',
  label: 'US GAAP (ASC 360)',
  allowsRevaluation: false,
  allowsImpairmentReversal: false,
  impairmentTest: 'recoverability-then-fair-value',
  components: 'encouraged',
  references: { depreciation: 'ASC 360-10-35', revaluation: 'not permitted', impairment: 'ASC 360-10-35-17 to 35-21', heldForSale: 'ASC 360-10-45-9' },
  notes: [
    'Assets are carried at cost less accumulated depreciation. Upward revaluation to fair value is not permitted.',
    'An asset held and used is tested for impairment only when something suggests it may not be recoverable. If its undiscounted future cash flows are below its carrying amount, it is written down to fair value. The write-down is never reversed.',
    'An asset held for sale is measured at the lower of its carrying amount and fair value less cost to sell, and is not depreciated while held for sale.',
    'Depreciation uses a systematic method over the useful life; the method, life and residual value are estimates that can change going forward.',
  ],
};

const ASPE: AssetPolicy = {
  framework: 'ASPE',
  label: 'ASPE (CPA Canada Handbook, Part II, sections 3061 and 3063)',
  allowsRevaluation: false,
  allowsImpairmentReversal: false,
  impairmentTest: 'recoverability-then-fair-value',
  components: 'encouraged',
  references: { depreciation: 'Section 3061', revaluation: 'not permitted', impairment: 'Section 3063', heldForSale: 'Section 3475' },
  notes: [
    'Property, plant and equipment is carried at cost less accumulated amortization. Revaluation to fair value is not permitted.',
    'When an asset is no longer expected to contribute to the business as before and its undiscounted cash flows fall below its carrying amount, it is written down to fair value. The write-down is not reversed.',
    'An asset held for sale is measured at the lower of its carrying amount and fair value less cost to sell, and is not amortized while held for sale.',
    'Canadian accounting uses the word "amortization" for tangible assets as well; this screen says depreciation throughout. Capital cost allowance for tax is a separate calculation and is not made here.',
  ],
};

const POLICIES: Record<AccountingFramework, AssetPolicy> = { IFRS, 'US-GAAP': US_GAAP, ASPE };

export function assetPolicyFor(country?: string | null): AssetPolicy {
  const std = getAccountingStandard(country ?? undefined);
  return POLICIES[std.framework];
}

export function assetPolicyForFramework(f: AccountingFramework): AssetPolicy {
  return POLICIES[f];
}

// ── categories ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DepreciationMethod = 'straight-line' | 'declining-balance' | 'sum-of-years' | 'units-of-production' | 'none';

export const METHOD_LABEL: Record<DepreciationMethod, string> = {
  'straight-line': 'Straight-line',
  'declining-balance': 'Declining balance',
  'sum-of-years': 'Sum of the years\' digits',
  'units-of-production': 'Units of production',
  none: 'Not depreciated',
};

export interface AssetCategory {
  id: string;
  label: string;
  method: DepreciationMethod;
  /** A common starting point only: management sets the real useful life from how the company uses the asset. */
  lifeMonths: number;
  /** Residual value as a share of cost, a starting point only. */
  residualPct: number;
}

export const ASSET_CATEGORIES: AssetCategory[] = [
  { id: 'land', label: 'Land', method: 'none', lifeMonths: 0, residualPct: 0 },
  { id: 'buildings', label: 'Buildings', method: 'straight-line', lifeMonths: 480, residualPct: 0 },
  { id: 'leasehold', label: 'Leasehold improvements', method: 'straight-line', lifeMonths: 120, residualPct: 0 },
  { id: 'machinery', label: 'Machinery and equipment', method: 'straight-line', lifeMonths: 120, residualPct: 0 },
  { id: 'vehicles', label: 'Vehicles', method: 'straight-line', lifeMonths: 60, residualPct: 10 },
  { id: 'computers', label: 'Computers and IT equipment', method: 'straight-line', lifeMonths: 36, residualPct: 0 },
  { id: 'furniture', label: 'Furniture and fittings', method: 'straight-line', lifeMonths: 84, residualPct: 0 },
  { id: 'construction', label: 'Under construction', method: 'none', lifeMonths: 0, residualPct: 0 },
  { id: 'other', label: 'Other equipment', method: 'straight-line', lifeMonths: 60, residualPct: 0 },
];

export const categoryOf = (id: string): AssetCategory => ASSET_CATEGORIES.find((c) => c.id === id) ?? ASSET_CATEGORIES[ASSET_CATEGORIES.length - 1];

// ── ledger accounts the engine posts to ───────────────────────────────────────────────────────────────────────────────

export interface AssetAccountDef {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'equity' | 'revenue' | 'expense';
  description: string;
}

/** Added to a company's chart of accounts the first time the register is used (existing accounts are never changed). */
export const ASSET_ACCOUNTS: Record<'cost' | 'accumulated' | 'expense' | 'surplus' | 'retained' | 'impairment' | 'lossOnDisposal' | 'gainOnDisposal' | 'reversal', AssetAccountDef> = {
  cost: { id: 'gl-1400', code: '1400', name: 'Fixed Assets', type: 'asset', description: 'Property, plant and equipment at cost or revalued amount' },
  accumulated: { id: 'gl-1410', code: '1410', name: 'Accumulated Depreciation & Impairment', type: 'asset', description: 'Contra asset: depreciation and impairment losses to date' },
  expense: { id: 'gl-5900', code: '5900', name: 'Depreciation & Amortisation', type: 'expense', description: 'Periodic depreciation of fixed assets' },
  surplus: { id: 'gl-3300', code: '3300', name: 'Revaluation Surplus', type: 'equity', description: 'Revaluation gains held in equity (other comprehensive income)' },
  retained: { id: 'gl-3100', code: '3100', name: 'Retained Earnings', type: 'equity', description: 'Accumulated profits' },
  impairment: { id: 'gl-5910', code: '5910', name: 'Impairment & Revaluation Losses', type: 'expense', description: 'Impairment of fixed assets and revaluation decreases through profit or loss' },
  lossOnDisposal: { id: 'gl-5920', code: '5920', name: 'Loss on Disposal of Assets', type: 'expense', description: 'Carrying amount above the proceeds when an asset is sold or scrapped' },
  gainOnDisposal: { id: 'gl-4610', code: '4610', name: 'Gain on Disposal of Assets', type: 'revenue', description: 'Proceeds above the carrying amount when an asset is sold' },
  reversal: { id: 'gl-4620', code: '4620', name: 'Impairment Reversal & Revaluation Gains', type: 'revenue', description: 'Reversal of earlier impairment or revaluation losses through profit or loss' },
};
