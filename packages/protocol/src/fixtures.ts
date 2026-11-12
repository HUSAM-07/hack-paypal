import airlabWinix from "../fixtures/airlab-winix-vs-levoit.json";
import crumblabPlaceboJson from "../fixtures/crumblab-placebo-steam-mop.json";
import crumblabRoborock from "../fixtures/crumblab-roborock-vs-roomba.json";
import housefreshPlaceboJson from "../fixtures/housefresh-placebo-humidifier.json";
import housefreshWinix from "../fixtures/housefresh-winix-vs-levoit.json";
import narrowClose from "../fixtures/narrow-close-verdict.json";
import { VerifiedTest } from "./cited";

// Placeholder UPCs, shared across fixtures so sales can join to tests.
export const UPC_WINIX_A230 = "100000000001";
export const UPC_LEVOIT_CORE300 = "100000000002";
export const UPC_CIRRUS_HUMIDIFIER = "100000000003";
export const UPC_QUIETMAX_QM5 = "100000000004";
export const UPC_BREEZELINE_BL8 = "100000000005";
// Second category (robot vacuums): the tested pair, and the placebo's steam mop.
export const UPC_ROBOROCK_Q7MAX = "100000000006";
export const UPC_ROOMBA_J5 = "100000000007";
export const UPC_STEAMLINE_SM2 = "100000000008";

export const housefreshWinixTest = VerifiedTest.parse(housefreshWinix);
export const housefreshPlacebo = VerifiedTest.parse(housefreshPlaceboJson);
export const airlabWinixTest = VerifiedTest.parse(airlabWinix);
export const narrowCloseTest = VerifiedTest.parse(narrowClose);

export const crumblabRoborockTest = VerifiedTest.parse(crumblabRoborock);
export const crumblabPlacebo = VerifiedTest.parse(crumblabPlaceboJson);

/** The purifier fixtures behind the demo. The robot-vacuum pair is `vacuumFixtures`. */
export const fixtures: VerifiedTest[] = [
  housefreshWinixTest,
  housefreshPlacebo,
  airlabWinixTest,
  narrowCloseTest,
];

export const vacuumFixtures: VerifiedTest[] = [crumblabRoborockTest, crumblabPlacebo];

/**
 * Demo shop prices, shared by the catalogue MCP and the shops so they never disagree.
 * Levoit is priced the same as Winix in every shop, matching the price-matched eval
 * (packages/evals/results/cited-price-matched). Lumen is $4 under Northwind for both.
 */
export const DEMO_SHOP_PRICES = {
  northwind: { [UPC_WINIX_A230]: 9999, [UPC_LEVOIT_CORE300]: 9999 },
  lumen: { [UPC_WINIX_A230]: 9599, [UPC_LEVOIT_CORE300]: 9599 },
  megamart: { [UPC_WINIX_A230]: 10299, [UPC_LEVOIT_CORE300]: 10299 },
} as const satisfies Record<string, Record<string, number>>;

/**
 * Robot-vacuum prices, same shape and the same seller gaps as the purifiers: both vacuums cost
 * the same at a given seller, and Lumen is $4 under Northwind. Kept apart from DEMO_SHOP_PRICES
 * so the purifier demo and its committed evals never see them.
 */
export const VACUUM_SHOP_PRICES = {
  northwind: { [UPC_ROBOROCK_Q7MAX]: 29999, [UPC_ROOMBA_J5]: 29999 },
  lumen: { [UPC_ROBOROCK_Q7MAX]: 29599, [UPC_ROOMBA_J5]: 29599 },
  megamart: { [UPC_ROBOROCK_Q7MAX]: 30299, [UPC_ROOMBA_J5]: 30299 },
} as const satisfies Record<string, Record<string, number>>;
