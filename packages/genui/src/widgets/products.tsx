import type { Offer } from "@shop/commerce/contract";
import { ArrowUpRight, ChevronLeft, ChevronRight, Eye, Search, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWidgetContext } from "../context";
import { formatMoney } from "../money";
import {
  CardHead,
  MerchantChip,
  Pill,
  PriceStack,
  Skeleton,
  SourceChips,
  Stars,
  Thumb,
} from "../primitives";
import type { ToolWidgetProps } from "./types";

/** PayPal wordmark in the brand's own blue (via the host's `--paypal` token). */
export function PayPalMark() {
  return (
    <span className="g-ppmark" role="img" aria-label="PayPal">
      <span aria-hidden>Pay</span>
      <span aria-hidden className="g-ppmark__pal">
        Pal
      </span>
    </span>
  );
}

export function ProductCard({ offer }: { offer: Offer }) {
  const ctx = useWidgetContext();
  const [showAll, setShowAll] = useState(false);
  const highlights = showAll ? offer.highlights : offer.highlights.slice(0, 1);
  return (
    <article className="g-product" aria-label={offer.title}>
      <div className="g-product__media">
        <Thumb src={offer.imageUrl} alt="" size="fill" />
        <span className="g-product__badge">
          {offer.buyable ? (
            <Pill tone="paypal">PayPal seller</Pill>
          ) : (
            <Pill>{offer.source === "exa" ? "Web" : "Merchant site"}</Pill>
          )}
        </span>
      </div>
      <div className="g-product__body">
        <MerchantChip merchant={offer.merchant} />
        <h4 className="g-product__title" title={offer.title}>
          {offer.title}
        </h4>
        {offer.rating && <Stars value={offer.rating.value} count={offer.rating.count} />}
        <PriceStack price={offer.price} listPrice={offer.listPrice} />
        <p className="g-product__meta">
          <Truck aria-hidden className="g-ico" />
          {offer.shipping
            ? offer.shipping.amountMinor === 0
              ? "Free shipping"
              : `${formatMoney(offer.shipping)} shipping`
            : "Shipping at checkout"}
          {offer.inStock === false && <span className="g-bad"> · Out of stock</span>}
        </p>
        {highlights.length > 0 && (
          <div className="g-product__hl">
            {highlights.map((h) => (
              // Untrusted page text: rendered as text, never as markup or instructions.
              <q key={h} className="g-quote">
                {h}
              </q>
            ))}
            {offer.highlights.length > 1 && (
              <button type="button" className="g-link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Less" : `${offer.highlights.length - 1} more`}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="g-product__actions">
        {offer.buyable ? (
          <button
            type="button"
            className="g-btn g-btn--paypal"
            disabled={offer.inStock === false}
            onClick={() =>
              ctx.sendMessage?.(`Buy the ${offer.title} from ${offer.merchant.name}`, {
                intent: "buy_offer",
                offerId: offer.id,
              })
            }
          >
            Buy with <PayPalMark />
          </button>
        ) : (
          <a
            className="g-btn g-btn--quiet"
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            Buy at merchant <ArrowUpRight aria-hidden className="g-ico" />
            <span className="g-sr"> (opens {offer.merchant.domain})</span>
          </a>
        )}
        <button
          type="button"
          className="g-btn g-btn--ghost g-btn--icon"
          aria-label={`Watch the price of ${offer.title}`}
          title="Watch price"
          onClick={() =>
            ctx.sendMessage?.(`Watch the price of the ${offer.title} at ${offer.merchant.name}`, {
              intent: "create_watch",
              offerId: offer.id,
            })
          }
        >
          <Eye aria-hidden className="g-ico" />
        </button>
      </div>
    </article>
  );
}

function ProductSkeleton() {
  return (
    <div className="g-product g-product--skel" aria-hidden>
      <div className="g-product__media">
        <Skeleton h={1} />
      </div>
      <div className="g-product__body">
        <Skeleton w="40%" h={10} />
        <Skeleton w="90%" h={14} />
        <Skeleton w="70%" h={14} />
        <Skeleton w="35%" h={22} />
      </div>
      <div className="g-product__actions">
        <Skeleton h={34} r={10} />
      </div>
    </div>
  );
}

/** Horizontally scrollable, snap-aligned row of cards with arrow buttons on wide screens. */
export function ProductCarousel({ offers, label }: { offers: Offer[]; label: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 4,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <div className="g-carousel">
      <ul className="g-carousel__track" ref={ref} aria-label={label}>
        {offers.map((o) => (
          <li key={o.id} className="g-carousel__item">
            <ProductCard offer={o} />
          </li>
        ))}
      </ul>
      {offers.length > 1 && (
        <>
          <button
            type="button"
            className="g-carousel__nav"
            data-dir="prev"
            aria-label="Previous products"
            hidden={edges.start}
            onClick={() => page(-1)}
          >
            <ChevronLeft aria-hidden className="g-ico" />
          </button>
          <button
            type="button"
            className="g-carousel__nav"
            data-dir="next"
            aria-label="More products"
            hidden={edges.end}
            onClick={() => page(1)}
          >
            <ChevronRight aria-hidden className="g-ico" />
          </button>
        </>
      )}
    </div>
  );
}

export function SearchProductsWidget({ item, args, result }: ToolWidgetProps<"search_products">) {
  const query = args?.query;
  if (!result) {
    return (
      <section className="genui g-block" aria-busy="true" aria-label="Searching products">
        <CardHead
          icon={<Search />}
          label={<span className="aui-shimmer">{item.progress?.label ?? "Searching shops"}</span>}
          right={query ? <span className="g-muted g-truncate">“{query}”</span> : undefined}
        />
        <div className="g-carousel">
          <ul className="g-carousel__track" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="g-carousel__item">
                <ProductSkeleton />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  const buyable = result.offers.filter((o) => o.buyable).length;
  return (
    <section className="genui g-block" aria-label={`Products for ${query ?? "your search"}`}>
      <CardHead
        icon={<Search />}
        label={`${result.offers.length} ${result.offers.length === 1 ? "offer" : "offers"}`}
        right={
          buyable > 0 ? (
            <Pill tone="paypal">{buyable} buyable with PayPal</Pill>
          ) : (
            <span className="g-muted">Watch-only: no PayPal sellers</span>
          )
        }
      />
      {result.offers.length === 0 ? (
        <p className="g-empty">No offers matched. Try a broader search.</p>
      ) : (
        <ProductCarousel offers={result.offers} label={`Results for ${query ?? "search"}`} />
      )}
      <SourceChips sources={result.sources} />
    </section>
  );
}
