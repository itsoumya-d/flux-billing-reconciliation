import { describe, expect, it } from "vitest";
import { duplicateCount, eventStream, expectedIntervals, maxDemandKw, periodFor, rateFor, reconcile, round, timeToMinutes, type IntervalRead, type Tariff } from "../src/engine.js";

const tariff: Tariff = {
  dailyFixed: 2.5,
  demandRatePerKw: 1.2,
  exportRatePerKwh: 0.08,
  periods: [
    { period: "peak", startHour: 7, endHour: 11, ratePerKwh: 0.32 },
    { period: "shoulder", startHour: 11, endHour: 17, ratePerKwh: 0.24 },
    { period: "offpeak", startHour: 21, endHour: 7, ratePerKwh: 0.16 },
  ],
};

const reads: IntervalRead[] = [
  { start: "07:00", kwh: 2 },
  { start: "07:30", kwh: 2 },
  { start: "08:00", kwh: 2 },
  { start: "08:30", kwh: 2 },
  { start: "09:00", kwh: 2 },
  { start: "09:30", kwh: 2 },
];

describe("time", () => {
  it("parses minutes", () => expect(timeToMinutes("07:30")).toBe(450));
  it("rejects invalid hour", () => expect(() => timeToMinutes("25:00")).toThrow());
  it("rejects invalid minutes", () => expect(() => timeToMinutes("07:90")).toThrow());
});
describe("periods", () => {
  it("maps peak", () => expect(periodFor("08:00", tariff)).toBe("peak"));
  it("maps shoulder", () => expect(periodFor("12:00", tariff)).toBe("shoulder"));
  it("maps offpeak evening", () => expect(periodFor("22:00", tariff)).toBe("offpeak"));
  it("maps overnight as offpeak", () => expect(periodFor("02:00", tariff)).toBe("offpeak"));
  it("returns peak rate", () => expect(rateFor("08:00", tariff)).toBe(0.32));
  it("returns shoulder rate", () => expect(rateFor("12:00", tariff)).toBe(0.24));
});
describe("intervals", () => {
  it("counts expected intervals", () => expect(expectedIntervals(reads)).toBe(6));
  it("counts duplicates", () => expect(duplicateCount([...reads, reads[0]])).toBe(1));
  it("does not count unique", () => expect(duplicateCount(reads)).toBe(0));
  it("derives demand from 30-minute kWh", () => expect(maxDemandKw([{ start: "08:00", kwh: 5 }])).toBe(10));
  it("handles empty demand", () => expect(maxDemandKw([])).toBe(0));
});
describe("reconcile", () => {
  it("calculates energy", () => expect(reconcile(reads, tariff, []).expectedEnergy).toBe(3.84));
  it("calculates demand", () => expect(reconcile(reads, tariff, []).expectedDemand).toBe(4.8));
  it("calculates fixed", () => expect(reconcile(reads, tariff, []).expectedFixed).toBe(2.5));
  it("calculates expected total", () => expect(reconcile(reads, tariff, []).expectedTotal).toBe(11.14));
  it("calculates variance", () => expect(reconcile(reads, tariff, [{ description: "Invoice", amount: 12.5 }]).variance).toBe(1.36));
  it("calculates variance percent", () => expect(reconcile(reads, tariff, [{ description: "Invoice", amount: 12.5 }]).variancePercent).toBe(12.21));
  it("flags bill shock", () => expect(reconcile(reads, tariff, [{ description: "Invoice", amount: 30 }]).flags).toContain("bill_shock"));
  it("does not flag normal invoice", () => expect(reconcile(reads, tariff, [{ description: "Invoice", amount: 11.14 }]).flags).not.toContain("bill_shock"));
  it("flags missing intervals", () => expect(reconcile([reads[0], reads[2]], tariff, []).flags[0]).toContain("missing_intervals"));
  it("flags duplicate intervals", () => expect(reconcile([...reads, reads[0]], tariff, []).flags).toContain("duplicate_intervals:1"));
  it("handles no reads", () => expect(reconcile([], tariff, []).flags).toContain("no_reads"));
  it("preserves invoiced total", () => expect(reconcile(reads, tariff, [{ description: "A", amount: 2 }, { description: "B", amount: 3 }]).invoicedTotal).toBe(5));
  it("calculates peak kWh", () => expect(reconcile(reads, tariff, []).peakKwh).toBe(12));
  it("calculates offpeak kWh", () => expect(reconcile(reads, tariff, []).offpeakKwh).toBe(0));
  it("calculates shoulder kWh", () => expect(reconcile(reads, tariff, []).periodBreakdown.shoulder).toBe(0));
  it("rounds money", () => expect(round(1.005)).toBe(1.01));
  it("emits read events plus reconciliation", () => expect(eventStream(reads, reconcile(reads, tariff, [])).length).toBe(7));
  it("flags export above import", () => expect(reconcile([{ start: "08:00", kwh: 1, exportKwh: 2 }], tariff, []).flags).toContain("export_exceeds_import"));
});
