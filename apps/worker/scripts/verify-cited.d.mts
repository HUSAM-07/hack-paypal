export declare const LOCKED: {
  causedUnits: number;
  exposedSales: number;
  firstPayoutMinor: number;
  programmePaidMinor: number;
  batches: number;
  heldMinor: number;
};
export declare function checkCited(data: {
  lift: unknown;
  payouts: unknown;
  invoices: unknown;
  flags: unknown;
}): string[];
export declare function verifyCited(
  origin: string,
  opts?: { log?: (line: string) => void },
): Promise<void>;
