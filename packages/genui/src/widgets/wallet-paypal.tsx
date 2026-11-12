import { PayPalProvider, PayPalSavePaymentButton } from "@paypal/react-paypal-js/sdk-v6";
import { useState } from "react";
import type { WidgetContext } from "../context";
import { setupTokenOf } from "./wallet-token";

/**
 * The real PayPal v6 save-payment (vault without purchase) button. Loaded lazily, only when the
 * host passes `ctx.paypal`: `wallet.startConnect` mints the setup token server-side, the person
 * approves in PayPal, `wallet.completeConnect` exchanges it for a vault id the server keeps.
 */
export default function RealPayPalSave({
  ctx,
  onStart,
  onDone,
  onError,
}: {
  ctx: WidgetContext;
  onStart: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  // The provider needs a referentially stable promise.
  const [clientToken] = useState(() => ctx.paypal?.clientToken() ?? Promise.resolve(""));
  return (
    <PayPalProvider
      clientToken={clientToken}
      environment={ctx.paypal?.environment ?? "sandbox"}
      components={["paypal-payments"]}
      pageType="checkout"
    >
      <PayPalSavePaymentButton
        presentationMode="auto"
        createVaultToken={async () => {
          onStart();
          return { vaultSetupToken: setupTokenOf(await ctx.invoke("wallet.startConnect", {})) };
        }}
        onApprove={async ({ vaultSetupToken }: { vaultSetupToken: string }) => {
          try {
            await ctx.invoke("wallet.completeConnect", { setupTokenId: vaultSetupToken });
            onDone();
          } catch (e) {
            onError(e);
          }
        }}
        onCancel={() => onError(new Error("PayPal was closed before saving. Nothing changed."))}
        onError={onError}
      />
    </PayPalProvider>
  );
}
