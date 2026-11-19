import { describe, expect, it } from "vitest";
import { reconcileSplitSettlement, roundCurrency, type BasketLineItem, type PaymentMethodConfig } from "../src/split_settlement.js";

describe("reconcileSplitSettlement", () => {
  const cardPayment: PaymentMethodConfig = {
    type: "card",
    processingFeePercent: 1.5,
    fixedFeeAmount: 0.2,
  };

  const bnplPayment: PaymentMethodConfig = {
    type: "bnpl",
    processingFeePercent: 3.99,
    fixedFeeAmount: 0.3,
    installments: 4,
  };

  it("handles empty basket cleanly", () => {
    const result = reconcileSplitSettlement("b-empty", [], cardPayment);
    expect(result.grossTotal).toBe(0);
    expect(result.isBalanced).toBe(true);
    expect(result.flags).toContain("EMPTY_BASKET");
  });

  it("reconciles single merchant basket without staff commission", () => {
    const items: BasketLineItem[] = [
      { id: "item-1", description: "Standard Service", amount: 100, merchantId: "m-1" },
    ];
    const result = reconcileSplitSettlement("b-1", items, cardPayment, 2.0);

    expect(result.grossTotal).toBe(100);
    expect(result.totalProcessingFees).toBe(1.7); // 1.5% of 100 + 0.20
    expect(result.isBalanced).toBe(true);

    const merchantPayout = result.payouts.find((p) => p.partyId === "m-1");
    expect(merchantPayout).toBeDefined();
    expect(merchantPayout?.grossAllocation).toBe(100);
    expect(merchantPayout?.feeDeduction).toBe(3.7); // 1.70 proc + 2.00 plat
    expect(merchantPayout?.netPayout).toBe(96.3);
  });

  it("allocates multi-merchant and staff commission accurately", () => {
    const items: BasketLineItem[] = [
      { id: "item-1", description: "Hair Treatment", amount: 150, merchantId: "salon-1", staffId: "stylist-a", commissionRatePercent: 40 },
      { id: "item-2", description: "Retail Shampoo", amount: 50, merchantId: "salon-1" },
    ];
    const result = reconcileSplitSettlement("b-2", items, cardPayment, 2.5);

    expect(result.grossTotal).toBe(200);
    const stylist = result.payouts.find((p) => p.partyId === "stylist-a");
    expect(stylist).toBeDefined();
    expect(stylist?.netPayout).toBe(60); // 40% of 150

    const salon = result.payouts.find((p) => p.partyId === "salon-1");
    expect(salon).toBeDefined();
    expect(salon?.grossAllocation).toBe(140); // (150 - 60) + 50
    expect(result.isBalanced).toBe(true);
  });

  it("handles tax authority deduction and escrow separation", () => {
    const items: BasketLineItem[] = [
      { id: "item-tax", description: "Aesthetic Treatment", amount: 123, merchantId: "clinic-1", taxRatePercent: 23 },
    ];
    const result = reconcileSplitSettlement("b-tax", items, cardPayment);

    expect(result.totalTax).toBe(28.29); // 23% of 123 = 28.29
    const taxAuthority = result.payouts.find((p) => p.partyId === "tax_authority_escrow");
    expect(taxAuthority).toBeDefined();
    expect(taxAuthority?.netPayout).toBe(28.29);
    expect(result.isBalanced).toBe(true);
  });

  it("generates deterministic 4-part installment schedule for BNPL", () => {
    const items: BasketLineItem[] = [
      { id: "bnpl-pack", description: "Executive Wellness Package", amount: 200, merchantId: "spa-1" },
    ];
    const result = reconcileSplitSettlement("b-bnpl", items, bnplPayment);

    expect(result.installmentSchedule).toBeDefined();
    expect(result.installmentSchedule?.length).toBe(4);
    expect(result.installmentSchedule?.[0].amount).toBe(50);
    expect(result.installmentSchedule?.[0].dueDateOffsetDays).toBe(0);
    expect(result.installmentSchedule?.[1].dueDateOffsetDays).toBe(14);
    expect(result.installmentSchedule?.[2].dueDateOffsetDays).toBe(28);
    expect(result.installmentSchedule?.[3].dueDateOffsetDays).toBe(42);

    const totalScheduled = result.installmentSchedule!.reduce((sum, inst) => sum + inst.amount, 0);
    expect(roundCurrency(totalScheduled)).toBe(200);
  });

  it("handles uneven installment divisions without cent loss", () => {
    const items: BasketLineItem[] = [
      { id: "bnpl-odd", description: "Consultation & Styling", amount: 100, merchantId: "spa-1" },
    ];
    const customBnpl: PaymentMethodConfig = {
      type: "bnpl",
      processingFeePercent: 4.0,
      fixedFeeAmount: 0.5,
      installments: 3,
    };
    const result = reconcileSplitSettlement("b-odd", items, customBnpl);

    expect(result.installmentSchedule?.length).toBe(3);
    const sum = result.installmentSchedule!.reduce((acc, inst) => acc + inst.amount, 0);
    expect(roundCurrency(sum)).toBe(100);
    expect(result.installmentSchedule![0].amount).toBe(33.33);
    expect(result.installmentSchedule![1].amount).toBe(33.33);
    expect(result.installmentSchedule![2].amount).toBe(33.34);
  });

  it("flags negative line item amounts", () => {
    const items: BasketLineItem[] = [
      { id: "neg-1", description: "Erroneous Credit", amount: -50, merchantId: "m-bad" },
    ];
    const result = reconcileSplitSettlement("b-neg", items, cardPayment);
    expect(result.flags.some((f) => f.includes("NEGATIVE_ITEM_AMOUNT_neg-1"))).toBe(true);
  });

  it("flags invalid commission bounds (>100%)", () => {
    const items: BasketLineItem[] = [
      { id: "comm-bad", description: "Hair Service", amount: 80, merchantId: "m-1", staffId: "s-1", commissionRatePercent: 120 },
    ];
    const result = reconcileSplitSettlement("b-comm", items, cardPayment);
    expect(result.flags.some((f) => f.includes("INVALID_COMMISSION_RATE_comm-bad"))).toBe(true);
  });

  it("preserves precision in fractional multi-party splits", () => {
    const items: BasketLineItem[] = [
      { id: "item-1", description: "Cut & Color", amount: 89.95, merchantId: "m-1", staffId: "s-1", commissionRatePercent: 33.33 },
      { id: "item-2", description: "Deep Conditioning", amount: 45.5, merchantId: "m-2", staffId: "s-2", commissionRatePercent: 50 },
    ];
    const result = reconcileSplitSettlement("b-frac", items, cardPayment, 3.25);
    expect(result.isBalanced).toBe(true);
    expect(Math.abs(result.unallocatedVariance)).toBeLessThanOrEqual(0.02);
  });

  it("handles multi-vendor basket with 3 distinct merchants", () => {
    const items: BasketLineItem[] = [
      { id: "v1-item", description: "Service 1", amount: 60, merchantId: "m-1" },
      { id: "v2-item", description: "Service 2", amount: 90, merchantId: "m-2" },
      { id: "v3-item", description: "Service 3", amount: 50, merchantId: "m-3" },
    ];
    const result = reconcileSplitSettlement("b-3m", items, cardPayment, 3.0);
    expect(result.grossTotal).toBe(200);
    expect(result.payouts.filter((p) => p.role === "merchant").length).toBe(3);
    expect(result.isBalanced).toBe(true);
  });

  it("supports embedded finance payment method with custom platform take", () => {
    const embeddedPayment: PaymentMethodConfig = {
      type: "embedded_finance",
      processingFeePercent: 1.0,
      fixedFeeAmount: 0.15,
    };
    const items: BasketLineItem[] = [
      { id: "ef-1", description: "B2B Subscription", amount: 300, merchantId: "m-b2b" },
    ];
    const result = reconcileSplitSettlement("b-ef", items, embeddedPayment, 4.0);
    expect(result.grossTotal).toBe(300);
    expect(result.totalProcessingFees).toBe(3.15); // 1% of 300 + 0.15
    const platform = result.payouts.find((p) => p.role === "platform");
    expect(platform?.netPayout).toBe(12.0); // 4% of 300
    expect(result.isBalanced).toBe(true);
  });

  it("handles deposit payment type cleanly", () => {
    const depositPayment: PaymentMethodConfig = {
      type: "deposit",
      processingFeePercent: 1.8,
      fixedFeeAmount: 0.25,
    };
    const items: BasketLineItem[] = [
      { id: "dep-1", description: "Online Booking Deposit", amount: 50, merchantId: "m-dep", staffId: "stylist-dep", commissionRatePercent: 20 },
    ];
    const result = reconcileSplitSettlement("b-dep", items, depositPayment, 2.0);
    expect(result.grossTotal).toBe(50);
    expect(result.isBalanced).toBe(true);
    const staff = result.payouts.find((p) => p.partyId === "stylist-dep");
    expect(staff?.netPayout).toBe(10); // 20% of 50
  });

  it("handles zero percent platform fee without variance", () => {
    const items: BasketLineItem[] = [
      { id: "z-1", description: "Fee Free Service", amount: 75, merchantId: "m-free" },
    ];
    const result = reconcileSplitSettlement("b-zero", items, cardPayment, 0.0);
    expect(result.grossTotal).toBe(75);
    expect(result.isBalanced).toBe(true);
    const platform = result.payouts.find((p) => p.role === "platform");
    expect(platform?.netPayout).toBe(0);
  });
});
