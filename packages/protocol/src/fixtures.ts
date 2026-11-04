import airlabWinix from "../fixtures/airlab-winix-vs-levoit.json";
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

export const housefreshWinixTest = VerifiedTest.parse(housefreshWinix);
export const housefreshPlacebo = VerifiedTest.parse(housefreshPlaceboJson);
export const airlabWinixTest = VerifiedTest.parse(airlabWinix);
export const narrowCloseTest = VerifiedTest.parse(narrowClose);

export const fixtures: VerifiedTest[] = [
  housefreshWinixTest,
  housefreshPlacebo,
  airlabWinixTest,
  narrowCloseTest,
];
