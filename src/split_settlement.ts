/**
 * Multi-party split settlement and payout reconciliation engine.
 * Supports multi-merchant revenue allocation, staff commission sharing,
 * embedded finance platform fees, BNPL installment schedules, and penny-perfect audit reconciliation.
 */

export interface BasketLineItem {
  id: string;
  description: string;
  amount: number;
  merchantId: string;
  staffId?: string;
  taxRatePercent?: number;
  commissionRatePercent?: number;
}

export interface PaymentMethodConfig {
  type: "card" | "bnpl" | "embedded_finance" | "deposit";
  processingFeePercent: number;
  fixedFeeAmount: number;
  installments?: number;
}

export interface SplitPartyPayout {
  partyId: string;
  role: "merchant" | "staff" | "platform" | "tax_authority";
  grossAllocation: number;
  feeDeduction: number;
  netPayout: number;
}

export interface SettlementReconciliationResult {
  basketId: string;
  grossTotal: number;
  netTotal: number;
  totalTax: number;
  totalProcessingFees: number;
  payouts: SplitPartyPayout[];
  installmentSchedule?: { installmentNumber: number; dueDateOffsetDays: number; amount: number }[];
  isBalanced: boolean;
  unallocatedVariance: number;
  flags: string[];
}

export function roundCurrency(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Reconciles multi-merchant revenue, staff commission splits, and payment processing fees.
 * Follows double-entry conservation:
 * Gross Total = Total Merchant Net + Total Staff Net + Platform Net Fee + Total Processing Fee + Total Tax
 */
export function reconcileSplitSettlement(
  basketId: string,
  items: BasketLineItem[],
  payment: PaymentMethodConfig,
  platformFeePercent = 2.5
): SettlementReconciliationResult {
  const flags: string[] = [];

  if (!items || items.length === 0) {
    return {
      basketId,
      grossTotal: 0,
      netTotal: 0,
      totalTax: 0,
      totalProcessingFees: 0,
      payouts: [],
      isBalanced: true,
      unallocatedVariance: 0,
      flags: ["EMPTY_BASKET"],
    };
  }

  let grossTotal = 0;
  let totalTax = 0;
  const merchantGrossMap = new Map<string, number>();
  const staffGrossMap = new Map<string, number>();

  for (const item of items) {
    if (item.amount < 0) {
      flags.push(`NEGATIVE_ITEM_AMOUNT_${item.id}`);
    }
    const itemAmt = roundCurrency(item.amount);
    grossTotal = roundCurrency(grossTotal + itemAmt);

    const taxRate = item.taxRatePercent ?? 0;
    const taxAmt = roundCurrency((itemAmt * taxRate) / 100);
    totalTax = roundCurrency(totalTax + taxAmt);

    const commissionRate = item.commissionRatePercent ?? 0;
    if (commissionRate < 0 || commissionRate > 100) {
      flags.push(`INVALID_COMMISSION_RATE_${item.id}`);
    }

    const netItemAfterTax = roundCurrency(itemAmt - taxAmt);
    const staffAmt = item.staffId
      ? roundCurrency((netItemAfterTax * Math.min(100, Math.max(0, commissionRate))) / 100)
      : 0;
    const merchantAmt = roundCurrency(netItemAfterTax - staffAmt);

    merchantGrossMap.set(
      item.merchantId,
      roundCurrency((merchantGrossMap.get(item.merchantId) ?? 0) + merchantAmt)
    );

    if (item.staffId && staffAmt > 0) {
      staffGrossMap.set(
        item.staffId,
        roundCurrency((staffGrossMap.get(item.staffId) ?? 0) + staffAmt)
      );
    }
  }

  // Calculate payment gateway & platform processing fees
  const processingFee = roundCurrency(
    (grossTotal * payment.processingFeePercent) / 100 + payment.fixedFeeAmount
  );
  const platformFee = roundCurrency((grossTotal * platformFeePercent) / 100);
  const totalDeductions = roundCurrency(processingFee + platformFee);

  // Allocate fees proportionally across merchants based on merchant gross subtotal
  let totalMerchantGross = 0;
  for (const gross of merchantGrossMap.values()) {
    totalMerchantGross = roundCurrency(totalMerchantGross + gross);
  }

  const payouts: SplitPartyPayout[] = [];
  let allocatedNetSum = 0;
  let feesDeductedSoFar = 0;
  const merchantEntries = Array.from(merchantGrossMap.entries());

  merchantEntries.forEach(([merchantId, gross], index) => {
    const isLast = index === merchantEntries.length - 1;
    const share = totalMerchantGross > 0 ? gross / totalMerchantGross : 0;
    const feeDeduction = isLast
      ? roundCurrency(totalDeductions - feesDeductedSoFar)
      : roundCurrency(totalDeductions * share);
    feesDeductedSoFar = roundCurrency(feesDeductedSoFar + feeDeduction);

    const net = roundCurrency(gross - feeDeduction);
    if (net < 0) {
      flags.push(`NEGATIVE_PAYOUT_DETECTED_${merchantId}`);
    }

    payouts.push({
      partyId: merchantId,
      role: "merchant",
      grossAllocation: gross,
      feeDeduction,
      netPayout: net,
    });
    allocatedNetSum = roundCurrency(allocatedNetSum + net);
  });

  for (const [staffId, gross] of staffGrossMap.entries()) {
    payouts.push({
      partyId: staffId,
      role: "staff",
      grossAllocation: gross,
      feeDeduction: 0,
      netPayout: gross,
    });
    allocatedNetSum = roundCurrency(allocatedNetSum + gross);
  }

  // Add platform payout (platform collects platformFee)
  payouts.push({
    partyId: "platform_operator",
    role: "platform",
    grossAllocation: totalDeductions,
    feeDeduction: processingFee,
    netPayout: platformFee,
  });
  allocatedNetSum = roundCurrency(allocatedNetSum + platformFee);

  // Add tax authority allocation
  if (totalTax > 0) {
    payouts.push({
      partyId: "tax_authority_escrow",
      role: "tax_authority",
      grossAllocation: totalTax,
      feeDeduction: 0,
      netPayout: totalTax,
    });
    allocatedNetSum = roundCurrency(allocatedNetSum + totalTax);
  }

  const effectiveNet = roundCurrency(grossTotal - processingFee);
  const unallocatedVariance = roundCurrency(effectiveNet - allocatedNetSum);
  const isBalanced = Math.abs(unallocatedVariance) <= 0.02;

  if (!isBalanced) {
    flags.push(`SPLIT_ALLOCATION_MISMATCH_VARIANCE_${unallocatedVariance}`);
  }

  // Build BNPL installments schedule if configured
  let installmentSchedule: { installmentNumber: number; dueDateOffsetDays: number; amount: number }[] | undefined;
  if (payment.type === "bnpl" && payment.installments && payment.installments > 1) {
    installmentSchedule = [];
    const baseInstallment = roundCurrency(grossTotal / payment.installments);
    let cumulative = 0;

    for (let i = 1; i <= payment.installments; i += 1) {
      const isLast = i === payment.installments;
      const amt = isLast ? roundCurrency(grossTotal - cumulative) : baseInstallment;
      cumulative = roundCurrency(cumulative + amt);
      installmentSchedule.push({
        installmentNumber: i,
        dueDateOffsetDays: (i - 1) * 14, // Fortnightly schedule
        amount: amt,
      });
    }
  }

  return {
    basketId,
    grossTotal,
    netTotal: effectiveNet,
    totalTax,
    totalProcessingFees: processingFee,
    payouts,
    installmentSchedule,
    isBalanced,
    unallocatedVariance,
    flags,
  };
}
