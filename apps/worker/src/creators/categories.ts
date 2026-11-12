/**
 * The categories a creator can publish a test in: the same three the public catalogue sells.
 * `searchFor` is what an agent should type to be shown the test; a test pins that it lands in
 * the category (`categoryOfQuery`). `placeboBan` keeps the placebo article off the test's topic.
 */
import type { Category } from "@cited/catalogue-mcp";

export interface CreatorCategory {
  id: Category;
  /** Heading for the picker. */
  label: string;
  /** Lower-case plural, as it reads in a sentence. */
  noun: string;
  /** What an agent searches for. */
  searchFor: string;
  /** A placebo topic matching this is about the category itself, so it is not a placebo. */
  placeboBan: RegExp;
}

export const CREATOR_CATEGORIES: readonly CreatorCategory[] = [
  {
    id: "air-purifier",
    label: "Air purifiers",
    noun: "air purifiers",
    searchFor: "air purifiers",
    placeboBan: /purifier/i,
  },
  {
    id: "robot-vacuum",
    label: "Robot vacuums",
    noun: "robot vacuums",
    searchFor: "robot vacuums",
    placeboBan: /vacuum|robot|roomba|roborock|mop/i,
  },
  {
    id: "headphones",
    label: "Noise-cancelling headphones",
    noun: "noise-cancelling headphones",
    searchFor: "noise-cancelling headphones",
    placeboBan: /headphone|earphone|earbud|headset|noise|cancel/i,
  },
];

/** What the form has always done when no category is sent. */
export const DEFAULT_CREATOR_CATEGORY: Category = "air-purifier";

export const creatorCategory = (id: unknown): CreatorCategory | undefined =>
  CREATOR_CATEGORIES.find((c) => c.id === id);
