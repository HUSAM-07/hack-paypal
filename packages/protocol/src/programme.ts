import { COMMISSION_BPS } from "./cited";
import { UPC_LEVOIT_CORE300, UPC_ROBOROCK_Q7MAX, UPC_ROOMBA_J5, UPC_WINIX_A230 } from "./fixtures";

// Brand self-serve: what a brand can pick when it starts a programme, and the one validator the
// engine and Studio both run, so a private demo programme is refused exactly when a real one is.

/**
 * The categories the catalogue can test. Ids are what shopper sessions are reported under
 * (`agent_sessions.category`), which is what joins a programme to its lift.
 */
export type ProgrammeCategoryId = "purifier" | "robot-vacuum";

export interface ProgrammeProduct {
  /** The brand's programme id: one programme per product, never one per click. */
  brandId: string;
  brand: string;
  product: string;
  upc: string;
}

export interface ProgrammeCategory {
  id: ProgrammeCategoryId;
  label: string;
  products: readonly ProgrammeProduct[];
}

/** Mirrors the catalogue's PRODUCTS (apps/catalogue-mcp/src/sellers.ts); a test keeps them equal. */
export const PROGRAMME_CATEGORIES: readonly ProgrammeCategory[] = [
  {
    id: "purifier",
    label: "Air purifiers",
    products: [
      { brandId: "winix", brand: "Winix", product: "A230", upc: UPC_WINIX_A230 },
      { brandId: "levoit", brand: "Levoit", product: "Core 300", upc: UPC_LEVOIT_CORE300 },
    ],
  },
  {
    id: "robot-vacuum",
    label: "Robot vacuums",
    products: [
      { brandId: "roborock", brand: "Roborock", product: "Q7 Max", upc: UPC_ROBOROCK_Q7MAX },
      { brandId: "irobot", brand: "iRobot", product: "Roomba Combo j5", upc: UPC_ROOMBA_J5 },
    ],
  },
];

export const PROGRAMME_LIMITS = {
  /** $100.00 to $10,000.00, in cents. */
  minDepositMinor: 10_000,
  maxDepositMinor: 1_000_000,
  defaultDepositMinor: 50_000,
  /** 1% to 20%, in basis points. */
  minCommissionBps: 100,
  maxCommissionBps: 2_000,
  defaultCommissionBps: COMMISSION_BPS,
} as const;

export interface ProgrammeTermsInput {
  category: string;
  upc: string;
  depositMinor: number;
  commissionBps: number;
}

export interface ProgrammeTerms {
  brandId: string;
  name: string;
  product: string;
  category: ProgrammeCategoryId;
  upc: string;
  depositMinor: number;
  commissionBps: number;
}

export type ProgrammeRefusal =
  | "unknown_category"
  | "unknown_product"
  | "deposit_out_of_range"
  | "commission_out_of_range"
  | "programme_exists";

export type ProgrammeCheck =
  | { ok: true; terms: ProgrammeTerms }
  | { ok: false; error: ProgrammeRefusal; message: string };

const dollars = (minor: number) => `$${(minor / 100).toLocaleString("en-US")}`;

/**
 * Checks the choices against the catalogue and the programmes that already run (by UPC).
 * Pure. Money is integer minor units; the rate is integer basis points.
 */
export function checkProgrammeTerms(
  input: ProgrammeTermsInput,
  runningUpcs: ReadonlySet<string>,
): ProgrammeCheck {
  const category = PROGRAMME_CATEGORIES.find((c) => c.id === input.category);
  if (!category)
    return {
      ok: false,
      error: "unknown_category",
      message: "Pick air purifiers or robot vacuums.",
    };
  const product = category.products.find((p) => p.upc === input.upc);
  if (!product)
    return {
      ok: false,
      error: "unknown_product",
      message: "That product is not in the catalogue for this category.",
    };
  const { minDepositMinor: lo, maxDepositMinor: hi } = PROGRAMME_LIMITS;
  if (
    !Number.isSafeInteger(input.depositMinor) ||
    input.depositMinor < lo ||
    input.depositMinor > hi
  )
    return {
      ok: false,
      error: "deposit_out_of_range",
      message: `The deposit must be between ${dollars(lo)} and ${dollars(hi)}.`,
    };
  const { minCommissionBps: cLo, maxCommissionBps: cHi } = PROGRAMME_LIMITS;
  if (
    !Number.isSafeInteger(input.commissionBps) ||
    input.commissionBps < cLo ||
    input.commissionBps > cHi
  )
    return {
      ok: false,
      error: "commission_out_of_range",
      message: `The commission must be between ${cLo / 100}% and ${cHi / 100}%.`,
    };
  if (runningUpcs.has(product.upc))
    return {
      ok: false,
      error: "programme_exists",
      message: `${product.brand} ${product.product} already has a programme. Each product has one, so no sale is ever paid for twice.`,
    };
  return {
    ok: true,
    terms: {
      brandId: product.brandId,
      name: product.brand,
      product: product.product,
      category: category.id,
      upc: product.upc,
      depositMinor: input.depositMinor,
      commissionBps: input.commissionBps,
    },
  };
}
