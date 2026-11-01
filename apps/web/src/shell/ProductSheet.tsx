import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ProductImage } from "@/genui/components/products";
import type { ProductData } from "@/genui/refs";
import { formatMoney } from "@/lib/money";

/** Host sheet for `openProduct`: details from the resolved ref, never from model text. */
export function ProductSheet({
  product,
  onOpenChange,
  onUse,
}: {
  product: ProductData | null;
  onOpenChange: (o: boolean) => void;
  onUse: (p: ProductData) => void;
}) {
  return (
    <Sheet
      open={!!product}
      onOpenChange={onOpenChange}
      title={product?.title ?? "Product"}
      {...(product ? { description: product.merchant } : {})}
    >
      {product && (
        <div>
          <ProductImage product={product} className="mx-auto w-full max-w-[260px]" />
          <div className="mt-5 flex items-baseline gap-2">
            <span className="tabular text-2xl font-semibold tracking-tight">
              {formatMoney(product.price)}
            </span>
            {product.listPrice && product.listPrice.amountMinor > product.price.amountMinor && (
              <span className="tabular text-sm text-subtle-foreground line-through">
                {formatMoney(product.listPrice)}
              </span>
            )}
            {product.rating !== undefined && (
              <span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="size-3.5 fill-current text-warning" /> {product.rating.toFixed(1)}
              </span>
            )}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {product.features.map((f) => (
              <li
                key={f}
                className="flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-[13px]"
              >
                <Check className="size-3.5 text-success" /> {f}
              </li>
            ))}
          </ul>
          <Button className="mt-5 w-full" size="lg" onClick={() => onUse(product)}>
            Use this in a pact
          </Button>
          <p className="mt-2 text-center text-[11px] text-subtle-foreground">
            Sold by a PayPal sandbox merchant for this demo.
          </p>
        </div>
      )}
    </Sheet>
  );
}
