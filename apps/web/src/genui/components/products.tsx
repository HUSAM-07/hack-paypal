import type { ComponentRenderProps } from "@openuidev/react-lang";
import type { PropsOf } from "@pact/catalog";
import { ChevronLeft, ChevronRight, ExternalLink, Gamepad2, Star, Table2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { blockEnter, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useHostActions } from "../actions";
import { GenCard, Skeleton } from "../primitives";
import { type ProductData, RefsContext, resolveRef } from "../refs";

type R<P> = ComponentRenderProps<P>;

export function ProductImage({ product, className }: { product: ProductData; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "relative flex aspect-square items-center justify-center overflow-hidden rounded-[14px] bg-gradient-to-b from-white to-neutral-100 dark:from-neutral-100 dark:to-neutral-300",
        className,
      )}
    >
      {product.imageUrl && !failed ? (
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-[78%] object-contain transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      ) : (
        <Gamepad2 className="size-1/3 text-neutral-400" strokeWidth={1.4} />
      )}
    </div>
  );
}

function discount(p: ProductData): number | null {
  if (!p.listPrice || p.listPrice.currency !== p.price.currency) return null;
  if (p.listPrice.amountMinor <= p.price.amountMinor) return null;
  return Math.round((1 - p.price.amountMinor / p.listPrice.amountMinor) * 100);
}

function MerchantMark({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="flex size-4 items-center justify-center rounded-full bg-surface-3 text-[8px] font-bold text-foreground"
      >
        {name[0]}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function ProductTile({ refId, index }: { refId: string; index: number }) {
  const refs = useContext(RefsContext);
  const product = resolveRef(refs, refId, "product");
  const { run } = useHostActions();
  const reduce = useReducedMotion();
  if (!product) {
    return (
      <div
        data-testid="ref-skeleton"
        className="w-[206px] shrink-0 snap-start rounded-[20px] p-1.5 shadow-card sm:w-[220px]"
      >
        <Skeleton className="aspect-square w-full rounded-[14px]" />
        <div className="space-y-2 px-1.5 py-3">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="mt-3 h-5 w-20" />
        </div>
      </div>
    );
  }
  const off = discount(product);
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: reduce ? 0 : index * 0.06 }}
      className="group flex w-[206px] shrink-0 snap-start flex-col rounded-[20px] bg-surface p-1.5 shadow-card transition-shadow hover:shadow-pop sm:w-[220px]"
    >
      <ProductImage product={product} />
      <div className="flex flex-1 flex-col px-1.5 pb-1.5 pt-3">
        <h4 className="line-clamp-2 min-h-10 text-[13px] font-medium leading-5">{product.title}</h4>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className="tabular text-[17px] font-semibold tracking-tight">
            {formatMoney(product.price)}
          </span>
          {off !== null && product.listPrice && (
            <>
              <span className="tabular text-xs text-subtle-foreground line-through">
                {formatMoney(product.listPrice)}
              </span>
              <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
                {off}% off
              </span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <MerchantMark name={product.merchant} />
          {product.rating !== undefined && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <Star className="size-3 fill-current text-warning" />
              <span className="tabular">{product.rating.toFixed(1)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => run("openProduct", { productRef: refId })}
          className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--border-strong)] transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-[0.97]"
        >
          View product <ExternalLink className="size-3.5" />
        </button>
      </div>
    </motion.article>
  );
}

export function ProductCardsView({ props }: R<PropsOf<"ProductCards">>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const reduce = useReducedMotion();
  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft < 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  const page = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * 228, behavior: reduce ? "auto" : "smooth" });

  return (
    <motion.section
      {...(reduce ? {} : blockEnter)}
      aria-label={props.caption ?? "Products"}
      className="w-full"
    >
      {props.caption && (
        <p className="mb-2 px-0.5 text-xs font-medium text-muted-foreground">{props.caption}</p>
      )}
      <div
        ref={scroller}
        onScroll={update}
        className={cn(
          "scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 pt-0.5",
          !edges.start && !edges.end && "mask-fade-x",
          edges.start && !edges.end && "mask-fade-r",
          !edges.start && edges.end && "mask-fade-l",
        )}
      >
        {props.productRefs.map((id, i) => (
          <ProductTile key={id} refId={id} index={i} />
        ))}
      </div>
      {props.productRefs.length > 2 && (
        <div className="mt-1 flex justify-end gap-1.5">
          {([-1, 1] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-label={d < 0 ? "Previous products" : "Next products"}
              disabled={d < 0 ? edges.start : edges.end}
              onClick={() => page(d)}
              className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-foreground transition-[opacity,transform,background-color] hover:bg-surface-3 active:scale-90 disabled:opacity-35"
            >
              {d < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function cellFor(p: ProductData, label: string): string {
  const spec = p.specs?.[label];
  if (spec) return spec;
  const hit = p.features.find((f) => f.toLowerCase().includes(label.toLowerCase()));
  return hit ?? "—";
}

export function ProductCompareView({ props }: R<PropsOf<"ProductCompare">>) {
  const refs = useContext(RefsContext);
  const products = props.productRefs.map((id) => ({ id, p: resolveRef(refs, id, "product") }));
  const resolved = products.filter((x): x is { id: string; p: ProductData } => !!x.p);
  const cheapest = resolved.length
    ? resolved.reduce((a, b) => (b.p.price.amountMinor < a.p.price.amountMinor ? b : a)).id
    : null;
  const rows = props.highlight ?? [];
  return (
    <GenCard icon={Table2} title="Compare" tone="neutral">
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-24 bg-surface" />
              {products.map(({ id, p }) => (
                <th key={id} scope="col" className="px-2 pb-3 text-left align-bottom font-normal">
                  {p ? (
                    <div className="flex flex-col gap-2">
                      <ProductImage product={p} className="size-14 rounded-xl" />
                      <span className="line-clamp-2 text-[13px] font-medium leading-[18px]">
                        {p.title}
                      </span>
                    </div>
                  ) : (
                    <div data-testid="ref-skeleton" className="space-y-2">
                      <Skeleton className="size-14 rounded-xl" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompareRow label="Price">
              {products.map(({ id, p }) => (
                <td key={id} className="border-t border-border px-2 py-2.5">
                  {p ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="tabular font-semibold">{formatMoney(p.price)}</span>
                      {id === cheapest && resolved.length > 1 && (
                        <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
                          Best price
                        </span>
                      )}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-14" />
                  )}
                </td>
              ))}
            </CompareRow>
            <CompareRow label="Seller">
              {products.map(({ id, p }) => (
                <td key={id} className="border-t border-border px-2 py-2.5 text-muted-foreground">
                  {p ? p.merchant : <Skeleton className="h-4 w-16" />}
                </td>
              ))}
            </CompareRow>
            {rows.map((label) => (
              <CompareRow key={label} label={label}>
                {products.map(({ id, p }) => (
                  <td key={id} className="border-t border-border px-2 py-2.5">
                    {p ? cellFor(p, label) : <Skeleton className="h-4 w-12" />}
                  </td>
                ))}
              </CompareRow>
            ))}
          </tbody>
        </table>
      </div>
    </GenCard>
  );
}

function CompareRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 border-t border-border bg-surface py-2.5 pr-2 text-left text-[13px] font-normal text-muted-foreground"
      >
        {label}
      </th>
      {children}
    </tr>
  );
}
