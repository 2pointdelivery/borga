// The layout of each return, line by line, so that what is exported matches the form the preparer is looking at. A line either
// takes its amount from the books (`value` names an entry of FilingFigures.values) or is left blank with a note saying where the
// amount comes from. The app never invents a number it cannot support: payroll tax, depreciation, credits and carry-forwards
// are always left for the preparer.
//
// The references (line numbers, "Rubrik A") are the ones printed on the authority's form as best we know them. Forms change from
// year to year, so every export says to check the current form; lines we are unsure of have no reference, only a name.

import type { FilingFigures } from './filing-figures';
import type { Obligation } from './filing-catalog';

export interface TemplateRow {
  /** The line or box reference on the form, if it has one. */
  ref?: string;
  label: string;
  /** Name of a value in FilingFigures.values. Left out for a line the books cannot fill. */
  value?: string;
  /** Where the amount comes from when the books do not supply it. */
  hint?: string;
  /** A heading row, with no amount. */
  section?: boolean;
}

export interface FormTemplate {
  /** The form's own title, as filed. */
  title: string;
  rows: TemplateRow[];
}

const S = (label: string): TemplateRow => ({ label, section: true });
const BLANK_PAYROLL = 'From your payroll provider or the payroll year-end report.';
const BLANK_ACCOUNTANT = 'From your accountant.';

const SOURCE: Record<string, string> = {
  sales: 'Invoices issued in the period, before tax',
  taxCharged: 'Tax charged on those invoices',
  purchases: 'Bills received in the period, before tax',
  taxPaid: 'Tax on those bills',
  netTax: 'Tax charged less tax paid (positive = owing, negative = refund)',
  revenue: 'Invoices issued in the period, before tax',
  expenses: 'Bills received in the period, before tax (no payroll or depreciation)',
  profit: 'Revenue less bills (indicative only)',
  employees: 'Employees on the People page',
  grossPay: 'Annual salaries on the People page, for the period (indicative)',
};
export const sourceOf = (value: string): string => {
  if (SOURCE[value]) return SOURCE[value];
  const m = /^(taxCharged|taxPaid)\.(.+)$/.exec(value);
  return m ? `${SOURCE[m[1]]} (${m[2]} taxes only)` : '';
};

const T: Record<string, FormTemplate> = {
  // ── Canada ──
  'ca-gsthst': {
    title: 'GST/HST return for registrants (GST34)',
    rows: [
      S('Step 1: Calculate the net tax'),
      { ref: '101', label: 'Sales and other revenue', value: 'sales' },
      { ref: '103', label: 'GST/HST collected or collectible', value: 'taxCharged' },
      { ref: '104', label: 'Adjustments to be added to the tax for the period', hint: 'From your records, for example bad debts recovered.' },
      { ref: '105', label: 'Total GST/HST and adjustments for the period (103 + 104)', value: 'taxCharged' },
      { ref: '106', label: 'Input tax credits (ITCs) for the current period', value: 'taxPaid' },
      { ref: '107', label: 'Adjustments to be deducted', hint: 'From your records.' },
      { ref: '108', label: 'Total ITCs and adjustments (106 + 107)', value: 'taxPaid' },
      { ref: '109', label: 'Net tax (105 − 108)', value: 'netTax' },
      S('Step 2: Other credits and the balance'),
      { ref: '110', label: 'Instalment payments and other credits', hint: 'Instalments paid in this period, from the CRA account.' },
      { ref: '111', label: 'Rebates claimed', hint: BLANK_ACCOUNTANT },
      { ref: '112', label: 'Total other credits (110 + 111)', hint: 'Add lines 110 and 111.' },
      { ref: '113A', label: 'Balance (109 − 112): positive is owing, negative is a refund', value: 'netTax' },
    ],
  },
  'qc-qst': {
    title: 'GST and QST return (VD-403, Revenu Québec)',
    rows: [
      S('GST'),
      { label: 'Total sales and other revenue', value: 'sales' },
      { label: 'GST collected or collectible', value: 'taxCharged.gst' },
      { label: 'GST input tax credits', value: 'taxPaid.gst' },
      S('QST'),
      { label: 'QST collected or collectible', value: 'taxCharged.sales', hint: 'Taken from your tax profiles of type Sales tax.' },
      { label: 'QST input tax refunds', value: 'taxPaid.sales' },
      S('Balance'),
      { label: 'Net GST and QST (collected less credits and refunds)', value: 'netTax' },
      { label: 'Instalments, rebates and other credits', hint: 'From your Revenu Québec account.' },
    ],
  },
  'ca-t2': {
    title: 'T2 corporation income tax return (with Schedule 125, income statement)',
    rows: [
      S('Schedule 125: income statement information'),
      { ref: '8000', label: 'Trade sales of goods and services', value: 'revenue' },
      { ref: '8299', label: 'Total revenue', value: 'revenue' },
      { ref: '9368', label: 'Total operating expenses', value: 'expenses', hint: 'Then add payroll, depreciation, interest and other expenses booked elsewhere.' },
      { ref: '9970', label: 'Net non-farming income before taxes and extraordinary items', value: 'profit' },
      S('From the accountant (not in the books of this app)'),
      { label: 'Net income (loss) per financial statements, Schedule 1', hint: BLANK_ACCOUNTANT },
      { label: 'Taxable income', hint: BLANK_ACCOUNTANT },
      { label: 'Federal and provincial tax payable', hint: BLANK_ACCOUNTANT },
      { label: 'Instalments paid', hint: 'From the CRA account.' },
      { label: 'Balance owing or refund', hint: BLANK_ACCOUNTANT },
    ],
  },
  'ca-t1-business': {
    title: 'Statement of business or professional activities (T2125)',
    rows: [
      { ref: '8000', label: 'Gross sales, commissions or fees', value: 'revenue' },
      { ref: '8299', label: 'Gross income', value: 'revenue' },
      { ref: '9368', label: 'Total expenses', value: 'expenses', hint: 'Then add motor vehicle, home office and capital cost allowance.' },
      { ref: '9369', label: 'Net income (loss) before adjustments', value: 'profit' },
      { label: 'Net income after your share and adjustments', hint: BLANK_ACCOUNTANT },
    ],
  },
  'ca-t5013': {
    title: 'Partnership information return (T5013)',
    rows: [
      { label: 'Total revenue', value: 'revenue' },
      { label: 'Total expenses', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Net income (loss) of the partnership', value: 'profit' },
      { label: 'Each partner\'s share (T5013 slips)', hint: 'From the partnership agreement.' },
    ],
  },
  'ca-payroll': {
    title: 'Remittance of payroll deductions (PD7A)',
    rows: [
      { label: 'Employees paid in the period', value: 'employees' },
      { label: 'Gross payroll for the period', value: 'grossPay' },
      { label: 'CPP contributions (employee and employer)', hint: BLANK_PAYROLL },
      { label: 'EI premiums (employee and employer)', hint: BLANK_PAYROLL },
      { label: 'Income tax deducted', hint: BLANK_PAYROLL },
      { label: 'Total remittance', hint: BLANK_PAYROLL },
    ],
  },
  'ca-t4': {
    title: 'T4 slips and T4 Summary',
    rows: [
      { ref: 'Line 88', label: 'Total number of T4 slips filed', value: 'employees' },
      { ref: 'Box 14', label: 'Total employment income', value: 'grossPay' },
      { label: 'Total CPP contributions (employee and employer)', hint: BLANK_PAYROLL },
      { label: 'Total EI premiums (employee and employer)', hint: BLANK_PAYROLL },
      { label: 'Total income tax deducted', hint: BLANK_PAYROLL },
      { label: 'Total deductions reported', hint: BLANK_PAYROLL },
      { label: 'Remittances made during the year', hint: 'From the CRA account.' },
    ],
  },
  'on-eht': {
    title: 'Employer Health Tax (Ontario)',
    rows: [
      { label: 'Total Ontario remuneration for the year', value: 'grossPay' },
      { label: 'Exemption claimed', hint: 'Check the current exemption on the Ontario Ministry of Finance site.' },
      { label: 'Taxable remuneration', hint: BLANK_PAYROLL },
      { label: 'Employer Health Tax payable', hint: BLANK_PAYROLL },
      { label: 'Instalments paid', hint: 'From the Ontario account.' },
    ],
  },
  'qc-co17': {
    title: 'Quebec corporation income tax return (CO-17)',
    rows: [
      { label: 'Revenue', value: 'revenue' },
      { label: 'Expenses', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Net income per financial statements', value: 'profit' },
      { label: 'Taxable income for Quebec', hint: BLANK_ACCOUNTANT },
      { label: 'Quebec tax payable', hint: BLANK_ACCOUNTANT },
      { label: 'Instalments paid', hint: 'From the Revenu Québec account.' },
    ],
  },
  'qc-rl1': {
    title: 'RL-1 slips and summary',
    rows: [
      { label: 'Number of RL-1 slips', value: 'employees' },
      { ref: 'Box A', label: 'Employment income', value: 'grossPay' },
      { label: 'QPP, QPIP and Quebec income tax withheld', hint: BLANK_PAYROLL },
      { label: 'Remittances made during the year', hint: 'From the Revenu Québec account.' },
    ],
  },
  'ab-at1': {
    title: 'Alberta corporation tax return (AT1)',
    rows: [
      { label: 'Revenue', value: 'revenue' },
      { label: 'Expenses', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Net income per financial statements', value: 'profit' },
      { label: 'Taxable income earned in Alberta', hint: BLANK_ACCOUNTANT },
      { label: 'Alberta tax payable', hint: BLANK_ACCOUNTANT },
      { label: 'Instalments paid', hint: 'From the Alberta account.' },
    ],
  },
  'bc-pst': {
    title: 'Provincial sales tax return (British Columbia)',
    rows: [
      { label: 'Gross sales', value: 'sales' },
      { label: 'PST collected', value: 'taxCharged' },
      { label: 'PST paid on purchases for resale and other deductions', value: 'taxPaid', hint: 'Only what the PST rules let you deduct.' },
      { label: 'Net PST payable', value: 'netTax' },
    ],
  },
  'sk-pst': {
    title: 'Provincial sales tax return (Saskatchewan)',
    rows: [
      { label: 'Total sales', value: 'sales' },
      { label: 'PST collected', value: 'taxCharged' },
      { label: 'Deductions and credits', value: 'taxPaid', hint: 'Only what the PST rules let you deduct.' },
      { label: 'Net PST payable', value: 'netTax' },
    ],
  },
  'mb-rst': {
    title: 'Retail sales tax return (Manitoba)',
    rows: [
      { label: 'Total sales', value: 'sales' },
      { label: 'RST collected', value: 'taxCharged' },
      { label: 'Deductions and credits', value: 'taxPaid', hint: 'Only what the RST rules let you deduct.' },
      { label: 'Net RST payable', value: 'netTax' },
    ],
  },

  // ── United States ──
  'us-1120': {
    title: 'Form 1120, U.S. Corporation Income Tax Return',
    rows: [
      S('Income'),
      { ref: 'Line 1a', label: 'Gross receipts or sales', value: 'revenue' },
      { ref: 'Line 2', label: 'Cost of goods sold (Form 1125-A)', hint: BLANK_ACCOUNTANT },
      { ref: 'Line 11', label: 'Total income', value: 'revenue', hint: 'Then add other income and subtract cost of goods sold.' },
      S('Deductions'),
      { ref: 'Line 27', label: 'Total deductions', value: 'expenses', hint: 'Then add salaries, depreciation, interest and taxes.' },
      { ref: 'Line 28', label: 'Taxable income before net operating loss and special deductions (11 − 27)', value: 'profit' },
      S('Tax and payments'),
      { ref: 'Line 30', label: 'Taxable income', hint: BLANK_ACCOUNTANT },
      { ref: 'Line 31', label: 'Total tax', hint: BLANK_ACCOUNTANT },
      { label: 'Estimated tax payments made', hint: 'From the EFTPS account.' },
      { label: 'Amount owed or overpaid', hint: BLANK_ACCOUNTANT },
    ],
  },
  'us-1120s': {
    title: 'Form 1120-S, U.S. Income Tax Return for an S Corporation',
    rows: [
      { ref: 'Line 1a', label: 'Gross receipts or sales', value: 'revenue' },
      { ref: 'Line 6', label: 'Total income (loss)', value: 'revenue', hint: 'Then subtract cost of goods sold.' },
      { ref: 'Line 20', label: 'Total deductions', value: 'expenses', hint: 'Then add compensation of officers, wages, depreciation and taxes.' },
      { ref: 'Line 21', label: 'Ordinary business income (loss)', value: 'profit' },
      { label: 'Shareholders\' shares (Schedule K-1)', hint: 'From the shareholder records.' },
    ],
  },
  'us-1065': {
    title: 'Form 1065, U.S. Return of Partnership Income',
    rows: [
      { ref: 'Line 1a', label: 'Gross receipts or sales', value: 'revenue' },
      { ref: 'Line 8', label: 'Total income (loss)', value: 'revenue', hint: 'Then subtract cost of goods sold.' },
      { ref: 'Line 21', label: 'Total deductions', value: 'expenses', hint: 'Then add salaries, guaranteed payments, depreciation and taxes.' },
      { ref: 'Line 22', label: 'Ordinary business income (loss)', value: 'profit' },
      { label: 'Partners\' shares (Schedule K-1)', hint: 'From the partnership agreement.' },
    ],
  },
  'us-schc': {
    title: 'Schedule C (Form 1040), Profit or Loss From Business',
    rows: [
      { ref: 'Line 1', label: 'Gross receipts or sales', value: 'revenue' },
      { ref: 'Line 7', label: 'Gross income', value: 'revenue', hint: 'Then subtract returns and cost of goods sold.' },
      { ref: 'Line 28', label: 'Total expenses before business use of home', value: 'expenses', hint: 'Then add vehicle, home office and depreciation.' },
      { ref: 'Line 31', label: 'Net profit (loss)', value: 'profit' },
    ],
  },
  'us-941': {
    title: 'Form 941, Employer\'s Quarterly Federal Tax Return',
    rows: [
      { ref: 'Line 1', label: 'Number of employees who received wages, tips or other compensation', value: 'employees' },
      { ref: 'Line 2', label: 'Wages, tips and other compensation', value: 'grossPay' },
      { ref: 'Line 3', label: 'Federal income tax withheld', hint: BLANK_PAYROLL },
      { ref: 'Line 5a', label: 'Taxable social security wages and tax', hint: BLANK_PAYROLL },
      { ref: 'Line 5c', label: 'Taxable Medicare wages and tax', hint: BLANK_PAYROLL },
      { ref: 'Line 10', label: 'Total taxes after adjustments', hint: BLANK_PAYROLL },
      { ref: 'Line 13', label: 'Total deposits for the quarter', hint: 'From the EFTPS account.' },
      { ref: 'Line 14', label: 'Balance due or overpayment', hint: BLANK_PAYROLL },
    ],
  },
  'us-w2': {
    title: 'Forms W-2 and W-3 (and 1099-NEC)',
    rows: [
      { ref: 'W-3 box b', label: 'Number of Forms W-2', value: 'employees' },
      { ref: 'W-3 box 1', label: 'Wages, tips and other compensation', value: 'grossPay' },
      { ref: 'W-3 box 2', label: 'Federal income tax withheld', hint: BLANK_PAYROLL },
      { ref: 'W-3 box 3 and 5', label: 'Social security and Medicare wages', hint: BLANK_PAYROLL },
      { label: 'Forms 1099-NEC issued and total non-employee compensation', hint: 'From the accounts payable records for contractors.' },
    ],
  },
  'us-940': {
    title: 'Form 940, Employer\'s Annual Federal Unemployment (FUTA) Tax Return',
    rows: [
      { ref: 'Line 3', label: 'Total payments to all employees', value: 'grossPay' },
      { ref: 'Line 5', label: 'Payments above $7,000 per employee', hint: BLANK_PAYROLL },
      { ref: 'Line 7', label: 'Total taxable FUTA wages', hint: BLANK_PAYROLL },
      { label: 'FUTA tax and credit for state unemployment tax paid', hint: BLANK_PAYROLL },
    ],
  },
  'us-state-sales': {
    title: 'State sales and use tax return',
    rows: [
      { label: 'Gross sales', value: 'sales' },
      { label: 'Taxable sales', hint: 'Gross sales less exempt and out-of-state sales.' },
      { label: 'Sales tax collected', value: 'taxCharged' },
      { label: 'Use tax due on purchases', hint: 'From your purchase records.' },
      { label: 'Discounts, credits and prior payments', hint: 'From the state account.' },
      { label: 'Net tax due', value: 'netTax', hint: 'Sales tax is not offset by tax paid on purchases in most states: check your state\'s form.' },
    ],
  },
  'us-state-income': {
    title: 'State income or franchise tax return',
    rows: [
      { label: 'Gross receipts', value: 'revenue' },
      { label: 'Total deductions', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Net income before state adjustments', value: 'profit' },
      { label: 'State adjustments and apportionment', hint: BLANK_ACCOUNTANT },
      { label: 'State tax payable', hint: BLANK_ACCOUNTANT },
    ],
  },
  'us-ca-100': {
    title: 'California Form 100, Corporation Franchise or Income Tax Return',
    rows: [
      { ref: 'Line 1a', label: 'Gross receipts or sales', value: 'revenue' },
      { label: 'Total deductions', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Net income before California adjustments', value: 'profit' },
      { label: 'California adjustments and apportionment', hint: BLANK_ACCOUNTANT },
      { label: 'Tax (the greater of 8.84% of net income and the $800 minimum franchise tax)', hint: BLANK_ACCOUNTANT },
    ],
  },
  'us-ca-100s': {
    title: 'California Form 100S, S Corporation Franchise or Income Tax Return',
    rows: [
      { ref: 'Line 1a', label: 'Gross receipts or sales', value: 'revenue' },
      { label: 'Total deductions', value: 'expenses', hint: 'Then add expenses booked elsewhere.' },
      { label: 'Ordinary business income', value: 'profit' },
      { label: 'Tax (1.5% of net income, with the $800 minimum franchise tax)', hint: BLANK_ACCOUNTANT },
    ],
  },
  'us-tx-franchise': {
    title: 'Texas franchise tax report',
    rows: [
      { label: 'Total revenue', value: 'revenue' },
      { label: 'Cost of goods sold or compensation deduction', hint: BLANK_ACCOUNTANT },
      { label: 'Margin', hint: BLANK_ACCOUNTANT },
      { label: 'Taxable margin after apportionment', hint: BLANK_ACCOUNTANT },
      { label: 'Franchise tax due', hint: 'No tax is due below the no-tax-due threshold. Check the current threshold.' },
    ],
  },
  'us-state-payroll': {
    title: 'State payroll withholding and unemployment returns',
    rows: [
      { label: 'Employees paid in the period', value: 'employees' },
      { label: 'Gross wages', value: 'grossPay' },
      { label: 'State income tax withheld', hint: BLANK_PAYROLL },
      { label: 'Taxable wages for state unemployment insurance', hint: BLANK_PAYROLL },
      { label: 'Contribution due', hint: BLANK_PAYROLL },
    ],
  },

  // ── Denmark ──
  'dk-moms': {
    title: 'Momsangivelse (VAT return)',
    rows: [
      S('Moms'),
      { label: 'Salgsmoms (output VAT)', value: 'taxCharged' },
      { label: 'Købsmoms (input VAT)', value: 'taxPaid' },
      { label: 'Moms af varekøb i udlandet (reverse charge on goods bought abroad)', hint: 'From your purchase records for EU and non-EU goods.' },
      { label: 'Moms af ydelseskøb i udlandet (reverse charge on services bought abroad)', hint: 'From your purchase records.' },
      { label: 'Moms i alt: positive is payable, negative is refundable', value: 'netTax' },
      S('Rubrikker (value of foreign trade, without VAT)'),
      { ref: 'Rubrik A', label: 'Værdien uden moms af varekøb i andre EU-lande (goods purchased in other EU countries)', hint: 'From your purchase records.' },
      { ref: 'Rubrik B', label: 'Værdien uden moms af ydelseskøb i udlandet med omvendt betalingspligt (services purchased abroad)', hint: 'From your purchase records.' },
      { ref: 'Rubrik C', label: 'Værdien af varesalg uden moms til andre EU-lande (goods sold to other EU countries)', hint: 'From your sales records, with the buyer\'s VAT number.' },
      { ref: 'Rubrik D', label: 'Værdien af ydelsessalg uden moms til andre EU-lande (services sold to other EU countries)', hint: 'From your sales records.' },
      S('Memo'),
      { label: 'Nettoomsætning (sales before VAT, for reference)', value: 'sales' },
    ],
  },
  'dk-corp-tax': {
    title: 'Selskabsselvangivelse (corporate income tax return)',
    rows: [
      { label: 'Nettoomsætning (net turnover)', value: 'revenue' },
      { label: 'Omkostninger (costs)', value: 'expenses', hint: 'Then add payroll, depreciation and interest booked elsewhere.' },
      { label: 'Resultat før skat (profit before tax)', value: 'profit' },
      { label: 'Skattemæssige reguleringer (tax adjustments)', hint: BLANK_ACCOUNTANT },
      { label: 'Skattepligtig indkomst (taxable income)', hint: BLANK_ACCOUNTANT },
      { label: 'Selskabsskat (corporate tax, 22%)', hint: BLANK_ACCOUNTANT },
      { label: 'Acontoskat betalt (preliminary tax paid)', hint: 'From the TastSelv account.' },
    ],
  },
  'dk-annual-report': {
    title: 'Årsrapport (annual report)',
    rows: [
      S('Resultatopgørelse (income statement)'),
      { label: 'Nettoomsætning (net turnover)', value: 'revenue' },
      { label: 'Omkostninger (costs)', value: 'expenses', hint: 'Then add payroll, depreciation and financial items.' },
      { label: 'Årets resultat før skat (profit for the year before tax)', value: 'profit' },
      S('From the accountant'),
      { label: 'Balance (balance sheet)', hint: BLANK_ACCOUNTANT },
      { label: 'Noter og ledelsespåtegning (notes and management statement)', hint: BLANK_ACCOUNTANT },
    ],
  },
  'dk-sole': {
    title: 'Oplysningsskema (personal return with business income)',
    rows: [
      { label: 'Virksomhedens omsætning (business turnover)', value: 'revenue' },
      { label: 'Driftsomkostninger (operating costs)', value: 'expenses', hint: 'Then add payroll and depreciation booked elsewhere.' },
      { label: 'Virksomhedens overskud (business profit)', value: 'profit' },
      { label: 'Skattemæssige reguleringer (tax adjustments)', hint: BLANK_ACCOUNTANT },
    ],
  },
  'dk-payroll': {
    title: 'eIndkomst: A-skat og AM-bidrag',
    rows: [
      { label: 'Antal ansatte (employees paid)', value: 'employees' },
      { label: 'Samlet bruttoløn (total gross pay)', value: 'grossPay' },
      { label: 'A-skat (withheld income tax)', hint: BLANK_PAYROLL },
      { label: 'AM-bidrag (labour market contribution, 8%)', hint: BLANK_PAYROLL },
      { label: 'Total til betaling (total payable)', hint: BLANK_PAYROLL },
    ],
  },

  // ── Ghana ──
  'gh-vat': {
    title: 'VAT return (Ghana Revenue Authority)',
    rows: [
      S('Output tax'),
      { label: 'Total taxable supplies (standard rated)', value: 'sales' },
      { label: 'Output VAT', value: 'taxCharged.vat' },
      { label: 'NHIL, GETFund and other levies charged', value: 'taxCharged.custom', hint: 'Taken from your tax profiles of type Custom.' },
      { label: 'Zero-rated and exempt supplies', hint: 'From your sales records.' },
      S('Input tax'),
      { label: 'Taxable purchases', value: 'purchases' },
      { label: 'Input VAT claimed', value: 'taxPaid.vat', hint: 'Only on purchases supported by a valid tax invoice.' },
      S('Result'),
      { label: 'Net VAT payable (positive) or refundable (negative)', value: 'netTax' },
    ],
  },
  'gh-cit': {
    title: 'Annual company income tax return',
    rows: [
      { label: 'Gross income', value: 'revenue' },
      { label: 'Allowable expenses', value: 'expenses', hint: 'Then add salaries, depreciation and other expenses booked elsewhere.' },
      { label: 'Profit before adjustments', value: 'profit' },
      { label: 'Capital allowances and adjustments', hint: BLANK_ACCOUNTANT },
      { label: 'Chargeable income', hint: BLANK_ACCOUNTANT },
      { label: 'Income tax payable', hint: BLANK_ACCOUNTANT },
      { label: 'Provisional tax paid', hint: 'From the GRA account.' },
    ],
  },
  'gh-pit': {
    title: 'Annual income tax return (self-employed)',
    rows: [
      { label: 'Business income', value: 'revenue' },
      { label: 'Allowable expenses', value: 'expenses', hint: 'Then add other expenses booked elsewhere.' },
      { label: 'Business profit before adjustments', value: 'profit' },
      { label: 'Reliefs and capital allowances', hint: BLANK_ACCOUNTANT },
      { label: 'Chargeable income and tax payable', hint: BLANK_ACCOUNTANT },
    ],
  },
  'gh-paye': {
    title: 'PAYE return (monthly)',
    rows: [
      { label: 'Number of employees', value: 'employees' },
      { label: 'Total emoluments (gross pay)', value: 'grossPay' },
      { label: 'Pension contributions deducted', hint: BLANK_PAYROLL },
      { label: 'PAYE deducted', hint: BLANK_PAYROLL },
      { label: 'Total payable', hint: BLANK_PAYROLL },
    ],
  },
  'gh-ssnit': {
    title: 'SSNIT contributions (monthly)',
    rows: [
      { label: 'Number of employees', value: 'employees' },
      { label: 'Total basic salaries', value: 'grossPay', hint: 'SSNIT is charged on basic salary, not on allowances: adjust if they differ.' },
      { label: 'Employee and employer contributions', hint: 'From the current SSNIT contribution rates.' },
      { label: 'Total payable to SSNIT', hint: BLANK_PAYROLL },
    ],
  },
};

const GENERIC_BY_BASIS: Record<string, FormTemplate> = {
  salesTax: { title: 'Sales tax return', rows: [
    { label: 'Sales, before tax', value: 'sales' }, { label: 'Tax charged', value: 'taxCharged' }, { label: 'Purchases, before tax', value: 'purchases' },
    { label: 'Tax paid on purchases', value: 'taxPaid' }, { label: 'Net tax', value: 'netTax' },
  ] },
  income: { title: 'Income tax return', rows: [
    { label: 'Revenue', value: 'revenue' }, { label: 'Expenses', value: 'expenses' }, { label: 'Profit before adjustments', value: 'profit' },
    { label: 'Adjustments and tax payable', hint: BLANK_ACCOUNTANT },
  ] },
  payroll: { title: 'Payroll return', rows: [
    { label: 'Employees paid', value: 'employees' }, { label: 'Gross pay', value: 'grossPay' }, { label: 'Tax and contributions', hint: BLANK_PAYROLL },
  ] },
  none: { title: 'Payment', rows: [
    { label: 'Amount due', hint: 'From the authority\'s notice or online account.' }, { label: 'Amount paid', hint: 'From your bank statement.' },
  ] },
};

/** The template for an obligation: its own form where we have it, otherwise a generic one for its kind of return. */
export function templateFor(ob: Obligation): FormTemplate {
  const own = T[ob.id];
  if (own) return own;
  return { ...GENERIC_BY_BASIS[ob.figures] ?? GENERIC_BY_BASIS.none, title: ob.name };
}

export interface FilledRow {
  ref: string;
  label: string;
  /** null = the preparer fills it in. */
  amount: number | null;
  count: boolean;
  /** Where the amount comes from, or what the preparer should use. */
  source: string;
  section: boolean;
}

/** The template with the books' figures dropped in, one row per form line. */
export function fillTemplate(t: FormTemplate, f: FilingFigures | null): FilledRow[] {
  return t.rows.map((r) => {
    if (r.section) return { ref: '', label: r.label, amount: null, count: false, source: '', section: true };
    // a tax category with nothing in it (no PST on any invoice, say) is a real zero, not a missing figure
    const zero = r.value && f && /^(taxCharged|taxPaid)\./.test(r.value) && f.values[r.value] === undefined ? 0 : undefined;
    const v = r.value && f ? f.values[r.value] ?? zero : undefined;
    const has = typeof v === 'number';
    const base = has ? sourceOf(r.value as string) : r.hint ?? 'Enter from your records.';
    return {
      ref: r.ref ?? '', label: r.label, amount: has ? v : null,
      count: r.value === 'employees', source: has && r.hint ? `${base}. ${r.hint}` : base, section: false,
    };
  });
}

export const hasOwnTemplate = (id: string) => id in T;
