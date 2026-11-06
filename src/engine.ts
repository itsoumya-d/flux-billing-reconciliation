export type Period = "peak" | "offpeak" | "shoulder";

export interface IntervalRead {
  start: string;
  kwh: number;
  exportKwh?: number;
}

export interface RatePeriod {
  period: Period;
  startHour: number;
  endHour: number;
  ratePerKwh: number;
}

export interface Tariff {
  dailyFixed: number;
  demandRatePerKw: number;
  exportRatePerKwh: number;
  periods: RatePeriod[];
}

export interface InvoiceLine {
  description: string;
  amount: number;
}

export interface Reconciliation {
  expectedEnergy: number;
  expectedDemand: number;
  expectedFixed: number;
  expectedExport: number;
  expectedTotal: number;
  invoicedTotal: number;
  variance: number;
  variancePercent: number;
  peakKwh: number;
  offpeakKwh: number;
  shoulderKwh: number;
  maxDemandKw: number;
  missingIntervals: number;
  duplicateIntervals: number;
  flags: string[];
  periodBreakdown: Record<Period, number>;
}

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hours * 60 + minutes;
}

export function periodFor(start: string, tariff: Tariff): Period {
  const minute = timeToMinutes(start);
  for (const period of tariff.periods) {
    const from = period.startHour * 60;
    const to = period.endHour * 60;
    if (from < to && minute >= from && minute < to) return period.period;
    if (from > to && (minute >= from || minute < to)) return period.period;
  }
  return "offpeak";
}

export function rateFor(start: string, tariff: Tariff): number {
  const period = periodFor(start, tariff);
  const match = tariff.periods.find((item) => item.period === period);
  if (!match) throw new Error(`No rate for ${period}`);
  return match.ratePerKwh;
}

export function expectedIntervals(reads: IntervalRead[], minutes = 30): number {
  if (reads.length < 2) return reads.length;
  const sorted = [...reads].sort((a, b) => a.start.localeCompare(b.start));
  const first = timeToMinutes(sorted[0].start);
  const last = timeToMinutes(sorted[sorted.length - 1].start);
  return Math.max(0, Math.floor((last - first) / minutes) + 1);
}

export function duplicateCount(reads: IntervalRead[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const read of reads) {
    if (seen.has(read.start)) duplicates += 1;
    seen.add(read.start);
  }
  return duplicates;
}

export function maxDemandKw(reads: IntervalRead[]): number {
  if (reads.length === 0) return 0;
  return round(Math.max(...reads.map((read) => read.kwh * 2)), 3);
}

export function reconcile(reads: IntervalRead[], tariff: Tariff, invoice: InvoiceLine[], intervalMinutes = 30): Reconciliation {
  if (reads.length === 0) {
    return {
      expectedEnergy: 0,
      expectedDemand: 0,
      expectedFixed: 0,
      expectedExport: 0,
      expectedTotal: 0,
      invoicedTotal: round(invoice.reduce((sum, line) => sum + line.amount, 0)),
      variance: round(invoice.reduce((sum, line) => sum + line.amount, 0)),
      variancePercent: 0,
      peakKwh: 0,
      offpeakKwh: 0,
      shoulderKwh: 0,
      maxDemandKw: 0,
      missingIntervals: 0,
      duplicateIntervals: 0,
      flags: ["no_reads"],
      periodBreakdown: { peak: 0, offpeak: 0, shoulder: 0 },
    };
  }
  const periodTotals: Record<Period, number> = { peak: 0, offpeak: 0, shoulder: 0 };
  let energy = 0;
  let exportCredit = 0;
  for (const read of reads) {
    const period = periodFor(read.start, tariff);
    periodTotals[period] += read.kwh;
    energy += read.kwh * rateFor(read.start, tariff);
    exportCredit += (read.exportKwh ?? 0) * tariff.exportRatePerKwh;
  }
  const demandKw = maxDemandKw(reads);
  const demand = demandKw * tariff.demandRatePerKw;
  const fixed = tariff.dailyFixed;
  const expected = round(fixed + energy + demand - exportCredit);
  const invoiced = round(invoice.reduce((sum, line) => sum + line.amount, 0));
  const variance = round(invoiced - expected);
  const variancePercent = expected === 0 ? 0 : round((variance / expected) * 100, 2);
  const missing = Math.max(0, expectedIntervals(reads, intervalMinutes) - reads.length);
  const duplicates = duplicateCount(reads);
  const flags: string[] = [];
  if (missing > 0) flags.push(`missing_intervals:${missing}`);
  if (duplicates > 0) flags.push(`duplicate_intervals:${duplicates}`);
  if (Math.abs(variancePercent) > 10) flags.push("bill_shock");
  if (demandKw > 0 && reads.some((read) => read.kwh === 0)) flags.push("zero_usage_interval");
  if (reads.some((read) => (read.exportKwh ?? 0) > read.kwh)) flags.push("export_exceeds_import");
  if (exportCredit > energy) flags.push("export_credit_exceeds_energy");
  return {
    expectedEnergy: round(energy),
    expectedDemand: round(demand),
    expectedFixed: round(fixed),
    expectedExport: round(exportCredit),
    expectedTotal: expected,
    invoicedTotal: invoiced,
    variance,
    variancePercent,
    peakKwh: round(periodTotals.peak),
    offpeakKwh: round(periodTotals.offpeak),
    shoulderKwh: round(periodTotals.shoulder),
    maxDemandKw: demandKw,
    missingIntervals: missing,
    duplicateIntervals: duplicates,
    flags,
    periodBreakdown: {
      peak: round(periodTotals.peak),
      offpeak: round(periodTotals.offpeak),
      shoulder: round(periodTotals.shoulder),
    },
  };
}

export interface BillingEvent {
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export function eventStream(reads: IntervalRead[], result: Reconciliation): BillingEvent[] {
  return [
    ...reads.map((read) => ({ type: "MeterReadIngested", at: read.start, payload: { kwh: read.kwh, exportKwh: read.exportKwh ?? 0 } })),
    { type: "BillReconciled", at: new Date().toISOString(), payload: { variance: result.variance, flags: result.flags } },
  ];
}
