import { describe, expect, it } from "vitest";
import { reconcile, type Tariff, type InvoiceLine, type IntervalRead } from "../src/engine.js";
import { reconcileSplitSettlement, type PaymentMethodConfig, type BasketLineItem } from "../src/split_settlement.js";

describe("smoke integration tests", () => {
  it("boots and reconciles end-to-end invoice", () => {
    const tariff: Tariff = {
      dailyFixed: 2.0,
      demandRatePerKw: 1.0,
      exportRatePerKwh: 0.05,
      periods: [{ period: "peak", startHour: 8, endHour: 18, ratePerKwh: 0.3 }],
    };
    const reads: IntervalRead[] = [{ start: "09:00", kwh: 1.5 }];
    const invoice: InvoiceLine[] = [{ description: "Energy", amount: 2.45 }];
    const res = reconcile(reads, tariff, invoice);
    expect(res.expectedTotal).toBeGreaterThan(0);
  });

  it("boots and reconciles split settlement workflow", () => {
    const payment: PaymentMethodConfig = { type: "card", processingFeePercent: 2.0, fixedFeeAmount: 0.3 };
    const items: BasketLineItem[] = [{ id: "item-s", description: "Smoke Service", amount: 50, merchantId: "m-s" }];
    const res = reconcileSplitSettlement("b-s", items, payment, 2.5);
    expect(res.isBalanced).toBe(true);
  });
});
