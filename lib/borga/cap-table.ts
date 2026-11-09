// Cap table Carta-lite: pure math, no I/O. Tested in lib/cap-table.test.ts (created below).
// Post-money SAFEs: ownership % = amount / cap (includes all SAFEs+notes in Company Capitalization).
// Convertible notes: conversion price = min(capPrice, discountPrice); capPrice = cap / preMoneyShares.

export interface Stakeholder { id: string; name: string; email?: string; phone?: string; kind: 'founder' | 'investor' | 'employee' | 'advisor'; }
export interface ShareClass { id: string; name: string; seniority: number; liquidationMultiple?: number; }
export interface Holding { stakeholderId: string; classId: string; shares: number; }
export interface SafeNote {
  id: string; stakeholderId: string; amount: number;
  cap?: number; discount?: number; // discount as 0.8 for 20% off
  mfn?: boolean; kind: 'safe' | 'note'; interestPct?: number;
}
export interface OptionGrant { id: string; stakeholderId: string; granted: number; vested: number; strike?: number; }
export interface CapTableState {
  stakeholders: Stakeholder[];
  classes: ShareClass[];
  holdings: Holding[];
  safes: SafeNote[];
  options: OptionGrant[];
  optionPoolAuthorized: number;
}

export const EMPTY_CAP_TABLE: CapTableState = {
  stakeholders: [], classes: [{ id: 'common', name: 'Common', seniority: 0 }], holdings: [], safes: [], options: [], optionPoolAuthorized: 0,
};

/** Authorized share capital used as the 100% baseline when owners state % ownership. */
export const AUTHORIZED_DEFAULT = 10_000_000;

export function sharesForPct(pct: number, totalAuthorized = AUTHORIZED_DEFAULT): number {
  return Math.max(0, Math.round((Math.max(0, Math.min(100, pct)) / 100) * totalAuthorized));
}

/** % of authorized capital issued as shares — over 100 means over-allocated. (FD % always sums to 100 by construction, so allocation is measured against authorized.) */
export function allocatedPct(s: CapTableState, totalAuthorized = AUTHORIZED_DEFAULT): number {
  if (totalAuthorized <= 0) return 0;
  return (totalShares(s) / totalAuthorized) * 100;
}

/**
 * Sets an owner's % by writing their common holding to pct of totalAuthorized.
 * Other owners are untouched; the UI warns when the allocated total exceeds 100%.
 */
export function applyOwnershipPct(s: CapTableState, stakeholderId: string, pct: number, totalAuthorized = AUTHORIZED_DEFAULT): CapTableState {
  if (!s.stakeholders.some((t) => t.id === stakeholderId)) throw new Error('Unknown stakeholder.');
  const target = sharesForPct(pct, totalAuthorized);
  const rest = s.holdings.filter((h) => !(h.stakeholderId === stakeholderId && h.classId === 'common'));
  return { ...s, holdings: [...rest, { stakeholderId, classId: 'common', shares: target }] };
}

export function totalShares(s: CapTableState): number {
  return s.holdings.reduce((t, h) => t + Math.max(0, h.shares), 0);
}
export function fullyDiluted(s: CapTableState): number {
  const opts = s.options.reduce((t, o) => t + Math.max(0, o.granted), 0);
  return totalShares(s) + opts + Math.max(0, s.optionPoolAuthorized - opts);
}

/** Post-money SAFE conversion at a priced round: returns new shares per SAFE. */
export function convertSafesPostMoney(s: CapTableState, roundPreMoneyShares: number, roundPricePerShare: number): Array<{ safeId: string; shares: number; price: number }> {
  // Company Capitalization per YC post-money: pre-money FD + all SAFE/notes + pool. Approximate with pre + pool.
  const companyCap = roundPreMoneyShares + fullyDiluted(s) - totalShares(s);
  return s.safes.filter((x) => x.kind === 'safe').map((x) => {
    const capPrice = x.cap && companyCap > 0 ? x.cap / companyCap : Infinity;
    const discPrice = x.discount ? roundPricePerShare * x.discount : Infinity;
    const price = Math.min(capPrice, discPrice, roundPricePerShare);
    const p = price > 0 && Number.isFinite(price) ? price : roundPricePerShare;
    return { safeId: x.id, shares: x.amount / p, price: p };
  });
}

/** Convertible note conversion: lesser of cap price and discount price. */
export function convertNotes(s: CapTableState, preMoneyShares: number, roundPrice: number): Array<{ safeId: string; shares: number; price: number }> {
  return s.safes.filter((x) => x.kind === 'note').map((x) => {
    const capPrice = x.cap && preMoneyShares > 0 ? x.cap / preMoneyShares : Infinity;
    const discPrice = x.discount ? roundPrice * x.discount : Infinity;
    const price = Math.min(capPrice, discPrice, roundPrice);
    const p = price > 0 && Number.isFinite(price) ? price : roundPrice;
    return { safeId: x.id, shares: x.amount / p, price: p };
  });
}

export function ownershipPct(s: CapTableState, stakeholderId: string): number {  const fd = fullyDiluted(s);
  if (fd <= 0) return 0;
  const mine = s.holdings.filter((h) => h.stakeholderId === stakeholderId).reduce((t, h) => t + h.shares, 0)
    + s.options.filter((o) => o.stakeholderId === stakeholderId).reduce((t, o) => t + o.granted, 0);
  return (mine / fd) * 100;
}

/** Simple waterfall: proceeds distributed by seniority, pro-rata within class. */
export function waterfall(s: CapTableState, proceeds: number): Array<{ stakeholderId: string; amount: number }> {
  const byClass = [...s.classes].sort((a, b) => b.seniority - a.seniority);
  const out = new Map<string, number>();
  let remaining = Math.max(0, proceeds);
  for (const c of byClass) {
    if (remaining <= 0) break;
    const holders = s.holdings.filter((h) => h.classId === c.id);
    const classShares = holders.reduce((t, h) => t + h.shares, 0);
    if (classShares <= 0) continue;
    const mult = Math.max(1, c.liquidationMultiple ?? 1);
    // pay liquidation preference up to mult * implied (use shares as proxy units); remainder shared pro-rata at end
    for (const h of holders) {
      const share = (h.shares / classShares) * Math.min(remaining, classShares * mult);
      out.set(h.stakeholderId, (out.get(h.stakeholderId) ?? 0) + share);
    }
    remaining -= Math.min(remaining, classShares * mult);
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    const fd = fullyDiluted(s);
    if (fd > 0) {
      for (const h of s.holdings) out.set(h.stakeholderId, (out.get(h.stakeholderId) ?? 0) + (h.shares / fd) * remaining);
    }
  }
  return [...out.entries()].map(([stakeholderId, amount]) => ({ stakeholderId, amount }));
}

// ── Pre/post round math (plain-English fundraising answers) ──────────────────
// preMoney  = what the company is worth BEFORE new money (we take it from the Valuation tab).
// postMoney = preMoney + SAFEs/notes converting now + the new cash being raised.
// Everyone's % is shown before → after, so dilution is visible, not implied.

export interface RoundMath {
  preMoney: number;
  convertingAmount: number;
  convertingShares: number;
  newMoney: number;
  newShares: number;
  postMoney: number;
  fdPre: number;
  fdPost: number;
  rows: Array<{ stakeholderId: string; prePct: number; postPct: number; convertedShares: number }>;
}

export function roundMath(s: CapTableState, o: { preMoney: number; pricePerShare: number; newMoney: number; preMoneyShares: number }): RoundMath {
  const price = Math.max(0, o.pricePerShare);
  const conv = price > 0 && o.preMoneyShares > 0
    ? [...convertSafesPostMoney(s, o.preMoneyShares, price), ...convertNotes(s, o.preMoneyShares, price)]
    : [];
  const convertingShares = conv.reduce((t, x) => t + x.shares, 0);
  const convertingAmount = s.safes.reduce((t, x) => t + x.amount, 0);
  const newShares = price > 0 ? Math.max(0, o.newMoney) / price : 0;
  const preMoney = Math.max(0, o.preMoney);
  const postMoney = preMoney + convertingAmount + Math.max(0, o.newMoney);
  const fdPre = fullyDiluted(s);
  const fdPost = fdPre + convertingShares + newShares;
  const bySafe = new Map(conv.map((x) => [x.safeId, x.shares] as const));
  const rows = s.stakeholders.map((t) => {
    const mine = s.holdings.filter((h) => h.stakeholderId === t.id).reduce((a, h) => a + h.shares, 0)
      + s.options.filter((x) => x.stakeholderId === t.id).reduce((a, x) => a + x.granted, 0);
    const convertedShares = s.safes.filter((x) => x.stakeholderId === t.id).reduce((a, x) => a + (bySafe.get(x.id) ?? 0), 0);
    return {
      stakeholderId: t.id,
      prePct: fdPre > 0 ? (mine / fdPre) * 100 : 0,
      postPct: fdPost > 0 ? ((mine + convertedShares) / fdPost) * 100 : 0,
      convertedShares,
    };
  });
  return { preMoney, convertingAmount, convertingShares, newMoney: Math.max(0, o.newMoney), newShares, postMoney, fdPre, fdPost, rows };
}

// ── Share-type CRUD ──────────────────────────────────────────────────────────

/** How many holdings point at a class (used to guard deletes). */
export function classUsage(s: CapTableState, classId: string): number {
  return s.holdings.filter((h) => h.classId === classId).length;
}

export function updateShareClass(
  s: CapTableState,
  classId: string,
  patch: { name?: string; seniority?: number; liquidationMultiple?: number | null },
): CapTableState {
  if (!s.classes.some((c) => c.id === classId)) throw new Error('Unknown share type.');
  return {
    ...s,
    classes: s.classes.map((c) => {
      if (c.id !== classId) return c;
      const next = { ...c };
      if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
      if (patch.seniority !== undefined && Number.isFinite(patch.seniority)) next.seniority = Math.max(0, Math.floor(patch.seniority));
      next.liquidationMultiple = patch.liquidationMultiple === null || patch.liquidationMultiple === undefined || !(patch.liquidationMultiple > 0)
        ? undefined
        : patch.liquidationMultiple;
      // keep existing multiple when the field is untouched (undefined means "not provided" only for name/seniority above;
      // for multiple, undefined clears — callers pass the current value to keep it)
      return next;
    }),
  };
}

export function deleteShareClass(s: CapTableState, classId: string): CapTableState {
  if (s.classes.length <= 1) throw new Error('Keep at least one share type.');
  const used = classUsage(s, classId);
  if (used > 0) throw new Error(`“${s.classes.find((c) => c.id === classId)?.name ?? classId}” still holds ${used} holding(s) — move them first.`);
  return { ...s, classes: s.classes.filter((c) => c.id !== classId) };
}
