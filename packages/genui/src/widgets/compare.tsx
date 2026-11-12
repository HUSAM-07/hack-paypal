import { Columns3, Sparkles } from "lucide-react";
import { useWidgetContext } from "../context";
import { CardHead, MerchantChip, Pill, Price, Skeleton, Thumb } from "../primitives";
import { PayPalMark } from "./products";
import type { ToolWidgetProps } from "./types";

export function CompareOffersWidget({ item, args, result }: ToolWidgetProps<"compare_offers">) {
  const ctx = useWidgetContext();
  if (!result) {
    const n = args?.offerIds?.length ?? 3;
    return (
      <section className="genui g-block g-card" aria-busy="true" aria-label="Comparing offers">
        <CardHead
          icon={<Columns3 />}
          label={<span className="aui-shimmer">{item.progress?.label ?? "Comparing"}</span>}
        />
        <div className="g-compare-skel" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {Array.from({ length: n * 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder grid
            <Skeleton key={i} h={i < n ? 64 : 12} />
          ))}
        </div>
      </section>
    );
  }
  const pick = result.offers.find((o) => o.id === result.pick);
  return (
    <section className="genui g-block g-card g-card--flush" aria-label="Comparison">
      <div className="g-pad">
        <CardHead icon={<Columns3 />} label={`Comparing ${result.offers.length} offers`} />
      </div>
      {/* Focusable so keyboard users can scroll a table wider than the card. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be focusable */}
      <section className="g-compare" aria-label="Comparison table" tabIndex={0}>
        <table>
          <caption className="g-sr">Offers compared side by side</caption>
          <thead>
            <tr>
              <th scope="col" className="g-compare__corner">
                <span className="g-sr">Attribute</span>
              </th>
              {result.offers.map((o) => (
                <th
                  scope="col"
                  key={o.id}
                  data-pick={o.id === result.pick ? "" : undefined}
                  className="g-compare__offer"
                >
                  {o.id === result.pick && (
                    <span className="g-compare__flag">
                      <Sparkles aria-hidden className="g-ico" /> Pick
                    </span>
                  )}
                  <Thumb src={o.imageUrl} alt="" size="sm" />
                  <span className="g-compare__title">{o.title}</span>
                  <MerchantChip merchant={o.merchant} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Price</th>
              {result.offers.map((o) => (
                <td key={o.id} data-pick={o.id === result.pick ? "" : undefined}>
                  <Price value={o.price} size="md" />
                </td>
              ))}
            </tr>
            {result.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {result.offers.map((o, i) => (
                  <td key={o.id} data-pick={o.id === result.pick ? "" : undefined}>
                    {row.values[i] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Checkout</th>
              {result.offers.map((o) => (
                <td key={o.id} data-pick={o.id === result.pick ? "" : undefined}>
                  {o.buyable ? (
                    <Pill tone="paypal">
                      <PayPalMark />
                    </Pill>
                  ) : (
                    <span className="g-muted">At merchant</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
      {pick && (
        <div className="g-compare__reason">
          <p>
            <strong>Recommended: {pick.title}.</strong> {result.reason}
          </p>
          {pick.buyable && ctx.sendMessage && (
            <button
              type="button"
              className="g-btn g-btn--paypal g-btn--sm"
              onClick={() =>
                ctx.sendMessage?.(`Buy the ${pick.title} from ${pick.merchant.name}`, {
                  intent: "buy_offer",
                  offerId: pick.id,
                })
              }
            >
              Buy with <PayPalMark />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
