/**
 * CSV export for CITED's own tables in Studio. Pure shaping only: the widgets hand over the rows
 * they are showing (after the grid's filter and sort), and this turns them into a file with human
 * column headers, money as plain decimals beside a Currency column, and a name that says what and
 * when. Read only; nothing here talks to the engine.
 */
import type { Scope } from "@cited/studio/tables";

type Cell = string | number | boolean | null | undefined;
type Rec = Record<string, unknown>;
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Money in major units as a plain decimal, "3.84": no symbol, no thousands separator. */
export const decimal = (n: unknown): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "";

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
/** The tables write "–" for "nothing here"; a CSV leaves the cell empty. */
const plain = (v: unknown): string => {
  const s = text(v);
  return s === "–" ? "" : s;
};
const currencyOf = (r: Rec): string =>
  typeof r.currency === "string" && r.currency ? r.currency : "USD";

/** RFC 4180: quote a cell that holds a comma, quote or line break; double its quotes. */
export function csvCell(v: Cell): string {
  let s = v === null || v === undefined ? "" : String(v);
  // A cell that starts like a formula would run in a spreadsheet; prefix it so it reads as text.
  if (/^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row then data rows, CRLF-separated, with a byte-order mark so Excel reads UTF-8. */
export function toCsv(table: CsvTable): string {
  const lines = [table.headers, ...table.rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `cited-journeys-first-payout-2027-02-10.csv`: what it is, which view, the engine's date. */
export function csvFileName(parts: string[], date: string | null, now = new Date()): string {
  const day =
    date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : now.toISOString().slice(0, 10);
  return `${["cited", ...parts.map(slug).filter(Boolean), day].join("-")}.csv`;
}

export const scopeSlug = (scope: Scope): string =>
  scope === "first" ? "first-payout" : "programme-to-date";

/** "AirLab 3.84; HouseFresh 3.84": a sale's creators and what each earned, as plain decimals. */
const splitText = (shares: Rec[]): string =>
  shares.map((s) => `${text(s.creator)} ${decimal(s.amount)}`).join("; ");

/** Cross-store journeys: one row per order, with the Shapley split of the sale in one cell. */
export function journeysCsv(journeys: Rec[]): CsvTable {
  return {
    headers: [
      "PayPal order",
      "Sale captured",
      "Agent",
      "Group",
      "Product",
      "Store read first",
      "Price at first store",
      "Store paid",
      "Price paid",
      "Saved",
      "Commission",
      "Voided commission",
      "Currency",
      "30-day hold",
      "Hold ends",
      "Creators read",
      "Shapley split",
    ],
    rows: journeys.map((j) => [
      text(j.orderId),
      text(j.capturedAt),
      text(j.model),
      text(j.arm),
      text(j.product),
      text(j.firstStore),
      decimal(j.firstPrice),
      text(j.storeChosen),
      decimal(j.price),
      decimal(j.saved),
      decimal(j.commission),
      decimal(j.voided),
      currencyOf(j),
      text(j.holdStatus),
      text(j.holdUntil),
      plain(j.creators),
      splitText(Array.isArray(j.shares) ? (j.shares as Rec[]) : []),
    ]),
  };
}

/** The what-if creator table. `todayPct` and `whatPct` label the two earnings columns. */
export function whatIfCsv(
  rows: { creator: string; today: number; what: number }[],
  todayPct: string,
  whatPct: string,
  currency = "USD",
): CsvTable {
  return {
    headers: [
      "Creator",
      `Earns today at ${todayPct} commission`,
      `Earns at ${whatPct} commission`,
      "Change",
      "Currency",
    ],
    rows: rows.map((r) => [
      r.creator,
      decimal(r.today / 100),
      decimal(r.what / 100),
      decimal((r.what - r.today) / 100),
      currency,
    ]),
  };
}

/** The Trust review list: every stopped credit with its reason. */
export function trustCsv(rows: Rec[]): CsvTable {
  return {
    headers: [
      "Credit",
      "Creator",
      "Brand",
      "PayPal order",
      "Amount",
      "Currency",
      "Status",
      "Reason",
      "Why",
      "Sale date",
    ],
    rows: rows.map((r) => [
      text(r.id),
      text(r.creator),
      text(r.brand),
      text(r.orderId),
      decimal(r.amount),
      currencyOf(r),
      text(r.status),
      text(r.reason),
      text(r.why),
      text(r.date),
    ]),
  };
}

/** A creator's credits. `shares` are the Shapley shares table, to say who shared each sale. */
export function creditsCsv(credits: Rec[], shares: Rec[]): CsvTable {
  const byCapture = new Map<string, Rec[]>();
  for (const s of shares)
    byCapture.set(text(s.captureId), [...(byCapture.get(text(s.captureId)) ?? []), s]);
  return {
    headers: [
      "PayPal order",
      "Brand",
      "Amount",
      "Currency",
      "State",
      "Void reason",
      "Held for review because",
      "Hold ends",
      "Payout batch",
      "Shapley split with",
    ],
    rows: credits.map((c) => [
      text(c.orderId),
      text(c.brand),
      decimal(c.amount),
      currencyOf(c),
      text(c.state),
      plain(c.voidReason),
      plain(c.holdReason),
      text(c.holdUntil),
      plain(c.payoutBatch),
      splitText(
        (byCapture.get(text(c.captureId)) ?? []).filter((s) => s.creatorId !== c.creatorId),
      ),
    ]),
  };
}

/** Hand a CSV to the browser as a download. The only browser-touching part of this module. */
export function downloadCsv(name: string, table: CsvTable): void {
  const url = URL.createObjectURL(new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
