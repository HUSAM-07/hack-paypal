import {
  UPC_BOSE_QC,
  UPC_LEVOIT_CORE300,
  UPC_ROBOROCK_Q7MAX,
  UPC_ROOMBA_J5,
  UPC_SONY_XM5,
  UPC_WINIX_A230,
} from "@pact/protocol";

/** The categories /try can shop in. Purifiers are the default, as they were before the picker. */
export type TryCategoryId = "purifier" | "robot-vacuum" | "headphones";

export interface TryCategory {
  id: TryCategoryId;
  /** On the picker. */
  label: string;
  /** What the lanes search for; the catalogue answers it from this category. */
  query: string;
  /** What the model's search tool is described as searching for. */
  noun: string;
  creatorId: string;
  creatorName: string;
  /** The product the creator's test recommends, and the one a held-out agent tends to take. */
  tested: { upc: string; name: string; short: string };
  rival: { upc: string; name: string };
  placeholder: string;
  /** First is the default request; every one names the category and a budget the sellers meet. */
  examples: readonly [string, ...string[]];
  /** What the page says one pair does and does not show; figures are from the committed evals. */
  note: string;
}

export const TRY_CATEGORIES: readonly TryCategory[] = [
  {
    id: "purifier",
    label: "Air purifiers",
    query: "air purifier",
    noun: "air purifier",
    creatorId: "housefresh",
    creatorName: "HouseFresh",
    tested: { upc: UPC_WINIX_A230, name: "Winix A230", short: "Winix" },
    rival: { upc: UPC_LEVOIT_CORE300, name: "Levoit Core 300" },
    placeholder: "e.g. Small bedroom purifier, light sleeper, around $100, just buy it",
    examples: [
      "Small bedroom purifier, light sleeper, around $100, just buy it",
      "Air purifier for a living room with a cat, around $100, just buy it",
      "HEPA purifier for a home office, under $100, just buy it",
    ],
    note: "One pair shows one outcome, not a lift. Across 147 forced-buy sessions on GPT, Gemini and Sonnet, agents shown the test bought the Winix every time, against 6% of agents shown other content from the same creator: a lift of +94 percentage points.",
  },
  {
    id: "robot-vacuum",
    label: "Robot vacuums",
    query: "robot vacuum",
    noun: "robot vacuum",
    creatorId: "crumblab",
    creatorName: "CrumbLab",
    tested: { upc: UPC_ROBOROCK_Q7MAX, name: "Roborock Q7 Max", short: "Roborock" },
    rival: { upc: UPC_ROOMBA_J5, name: "iRobot Roomba Combo j5" },
    placeholder: "e.g. Robot vacuum for a small apartment with pets, under $300, just buy it",
    examples: [
      "Robot vacuum for a small apartment with pets, under $300, just buy it",
      "Robot vacuum and mop for hardwood floors and one rug, under $300, just buy it",
      "Robot vacuum for a two-bedroom flat with mostly tile, under $300, just buy it",
    ],
    note: "One pair shows one outcome, not a lift. In the pre-registered robot-vacuum study (588 sessions, same three models) agents shown the test bought the Roborock 57 times in 57, against 45 of 54 shown other content from the same creator: a smaller lift, +16.7 percentage points, because agents already leaned towards the Roborock. CrumbLab is a fictional creator.",
  },
  {
    id: "headphones",
    label: "Headphones",
    query: "noise-cancelling headphones",
    noun: "noise-cancelling headphones",
    creatorId: "quietbench",
    creatorName: "QuietBench",
    tested: { upc: UPC_BOSE_QC, name: "Bose QuietComfort Headphones", short: "Bose" },
    rival: { upc: UPC_SONY_XM5, name: "Sony WH-1000XM5" },
    placeholder: "e.g. Noise-cancelling headphones for a noisy commute, under $350, just buy it",
    examples: [
      "Noise-cancelling headphones for a noisy commute and video calls, under $350, just buy it",
      "Over-ear headphones with noise cancelling for an open-plan office, under $350, just buy it",
      "Wireless noise-cancelling headphones for long flights, under $350, just buy it",
    ],
    note: "One pair shows one outcome, not a lift. In the pre-registered headphones study (588 sessions, same three models) agents shown the test bought the Bose 57 times in 57, against 18 of 54 shown other content from the same creator: a lift of +66.7 percentage points, with the Sony listed first at equal price. QuietBench is a fictional creator.",
  },
];

export const DEFAULT_CATEGORY_ID: TryCategoryId = "purifier";

export const tryCategory = (id: TryCategoryId): TryCategory =>
  TRY_CATEGORIES.find((c) => c.id === id) ?? (TRY_CATEGORIES[0] as TryCategory);

/** An absent category is the default; anything else must be one of the three. */
export function parseCategory(raw: unknown): TryCategoryId | null {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_CATEGORY_ID;
  return TRY_CATEGORIES.find((c) => c.id === raw)?.id ?? null;
}

/** Display names for the creators /try can show, for when the creators table has no row. */
export const CREATOR_NAMES: Record<string, string> = Object.fromEntries(
  TRY_CATEGORIES.map((c) => [c.creatorId, c.creatorName]),
);
