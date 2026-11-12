import { describe, expect, it } from "vitest";
import {
  creditsCsv,
  csvCell,
  csvFileName,
  decimal,
  journeysCsv,
  scopeSlug,
  toCsv,
  trustCsv,
  whatIfCsv,
} from "./csvExport";

const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("csv cells", () => {
  it("prints money as plain decimals, never a symbol or a float tail", () => {
    expect(decimal(3.84)).toBe("3.84");
    expect(decimal(1234.5)).toBe("1234.50");
    expect(decimal(0.1 + 0.2)).toBe("0.30");
    expect(decimal(null)).toBe("");
  });
  it("quotes commas, quotes and line breaks, and defuses formulas", () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell("x\ny")).toBe('"x\ny"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-3.84")).toBe("-3.84");
    expect(csvCell(null)).toBe("");
  });
  it("starts with a byte-order mark and ends each row with CRLF", () => {
    const csv = toCsv({ headers: ["A", "B"], rows: [["1", "2"]] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("2\r\n")).toBe(true);
  });
});

describe("file names", () => {
  it("says what, which view and the engine's date", () => {
    expect(csvFileName(["journeys", scopeSlug("first")], "2027-02-10T09:00:00Z")).toBe(
      "cited-journeys-first-payout-2027-02-10.csv",
    );
    expect(csvFileName(["journeys", scopeSlug("todate")], "2027-02-10")).toBe(
      "cited-journeys-programme-to-date-2027-02-10.csv",
    );
  });
  it("slugs odd parts and falls back to today without an engine date", () => {
    expect(csvFileName(["what-if", "12.5%"], null, new Date("2026-11-12T10:00:00Z"))).toBe(
      "cited-what-if-12-5-2026-11-12.csv",
    );
    expect(csvFileName(["credits", ""], "x", new Date("2026-11-12T10:00:00Z"))).toBe(
      "cited-credits-2026-11-12.csv",
    );
  });
});

const journey = {
  orderId: "ORD1",
  capturedAt: "2027-01-11T10:00:00Z",
  model: "GPT",
  arm: "Test",
  product: "Winix 5500",
  firstStore: "levoit",
  firstPrice: 199,
  storeChosen: "winix",
  price: 179.5,
  saved: 19.5,
  commission: 3.84,
  voided: 0,
  currency: "GBP",
  holdStatus: "held",
  holdUntil: "2027-02-10",
  creators: "AirLab + HouseFresh",
  shares: [
    { creator: "AirLab", amount: 1.92 },
    { creator: "HouseFresh", amount: 1.92 },
  ],
};

describe("journeys", () => {
  it("has human headers, plain decimals, a currency column and the Shapley split", () => {
    const [head, row] = lines(toCsv(journeysCsv([journey])));
    expect(head).toBe(
      "PayPal order,Sale captured,Agent,Group,Product,Store read first,Price at first store,Store paid,Price paid,Saved,Commission,Voided commission,Currency,30-day hold,Hold ends,Creators read,Shapley split",
    );
    expect(row).toBe(
      "ORD1,2027-01-11T10:00:00Z,GPT,Test,Winix 5500,levoit,199.00,winix,179.50,19.50,3.84,0.00,GBP,held,2027-02-10,AirLab + HouseFresh,AirLab 1.92; HouseFresh 1.92",
    );
  });
  it("leaves a missing saving and an empty split blank, and defaults to USD", () => {
    const [, row] = lines(
      toCsv(
        journeysCsv([{ ...journey, saved: null, currency: undefined, shares: [], creators: "–" }]),
      ),
    );
    expect(row?.split(",")[9]).toBe("");
    expect(row).toContain(",USD,");
    expect(row?.endsWith(",")).toBe(true);
  });
  it("keeps the order the grid hands over", () => {
    const rows = journeysCsv([
      { ...journey, orderId: "B" },
      { ...journey, orderId: "A" },
    ]).rows;
    expect(rows.map((r) => r[0])).toEqual(["B", "A"]);
  });
  it("never says arm", () => {
    expect(journeysCsv([journey]).headers.join(" ").toLowerCase()).not.toMatch(/\barm\b/);
  });
});

describe("what-if", () => {
  it("labels both rates and gives cents as decimals", () => {
    const [head, a, total] = lines(
      toCsv(
        whatIfCsv(
          [
            { creator: "AirLab", today: 192, what: 230 },
            { creator: "All creators", today: 192, what: 230 },
          ],
          "10%",
          "12%",
        ),
      ),
    );
    expect(head).toBe(
      "Creator,Earns today at 10% commission,Earns at 12% commission,Change,Currency",
    );
    expect(a).toBe("AirLab,1.92,2.30,0.38,USD");
    expect(total).toBe("All creators,1.92,2.30,0.38,USD");
  });
});

describe("trust", () => {
  it("exports each stopped credit with its reason", () => {
    const [head, row] = lines(
      toCsv(
        trustCsv([
          {
            id: "c1",
            creator: "HouseFresh",
            brand: "Winix",
            orderId: "O9",
            amount: 7.68,
            currency: "USD",
            status: "Waiting for a reviewer",
            reason: "Creator bought through their own PayPal",
            why: "Paid, then bought",
            date: "2027-01-12",
          },
        ]),
      ),
    );
    expect(head).toBe(
      "Credit,Creator,Brand,PayPal order,Amount,Currency,Status,Reason,Why,Sale date",
    );
    expect(row).toBe(
      'c1,HouseFresh,Winix,O9,7.68,USD,Waiting for a reviewer,Creator bought through their own PayPal,"Paid, then bought",2027-01-12',
    );
  });
});

describe("creator credits", () => {
  const credit = {
    orderId: "O1",
    brand: "Winix",
    amount: 1.92,
    currency: "USD",
    state: "pending",
    voidReason: "–",
    holdReason: "–",
    holdUntil: "2027-02-10",
    payoutBatch: "Not paid yet",
    captureId: "cap1",
    creatorId: "airlab",
  };
  it("names who shared the sale, from the shares table, as plain decimals", () => {
    const shares = [
      { captureId: "cap1", creatorId: "airlab", creator: "AirLab", amount: 1.92 },
      { captureId: "cap1", creatorId: "housefresh", creator: "HouseFresh", amount: 1.92 },
      { captureId: "other", creatorId: "x", creator: "X", amount: 9 },
    ];
    const [head, row] = lines(toCsv(creditsCsv([credit], shares)));
    expect(head).toBe(
      "PayPal order,Brand,Amount,Currency,State,Void reason,Held for review because,Hold ends,Payout batch,Shapley split with",
    );
    expect(row).toBe("O1,Winix,1.92,USD,pending,,,2027-02-10,Not paid yet,HouseFresh 1.92");
  });
  it("is empty in the split column when the creator had the sale alone", () => {
    const [, row] = lines(toCsv(creditsCsv([credit], [])));
    expect(row?.endsWith("Not paid yet,")).toBe(true);
  });
});
