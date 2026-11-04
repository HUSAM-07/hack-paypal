export function usd(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const SHOP_NAMES: Record<string, string> = {
  northwind: "Northwind",
  lumen: "Lumen",
  megamart: "MegaMart",
};

export function shopName(id: string): string {
  return SHOP_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Plain words for what the catalogue showed the agent. */
export function armLabel(arm: string | null): { title: string; detail: string } {
  switch (arm) {
    case "test":
      return { title: "Shown the test", detail: "Reads the creator's test of both purifiers." };
    case "placebo":
      return {
        title: "Shown other content",
        detail: "Reads other content from the same creator, not the test.",
      };
    case "none":
      return { title: "Held out", detail: "Sees everything except the test." };
    default:
      return { title: "Unknown", detail: "No arm recorded for this run." };
  }
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
