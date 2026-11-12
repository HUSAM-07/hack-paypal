import type { Money } from "@shop/agent-protocol";
import {
  AutoBuyApprovalDetails,
  type AutoBuyRule,
  type Offer,
  PurchaseApprovalDetails,
} from "@shop/commerce/contract";
import { Fingerprint, MonitorPlay, ShieldCheck, ShoppingCart, Wrench, Zap } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { ApprovalCard, type ApprovalDetail, type ApprovalStatus } from "../aui/approval-card";
import { useWidgetContext } from "../context";
import { formatMoney, moneyToInput, parseMajorToMinor } from "../money";
import { MerchantChip, Price, Thumb } from "../primitives";
import type { ApprovalItem } from "./types";
import { WalletConnectCard } from "./wallet";

function statusOf(item: ApprovalItem, local: ApprovalStatus): ApprovalStatus {
  if (item.decision === "approved") return "approved";
  if (item.decision === "denied" || item.decision === "expired") return "denied";
  return local;
}

function OfferLine({ offer }: { offer: Offer }) {
  return (
    <div className="g-offerline">
      <Thumb src={offer.imageUrl} alt="" size="md" />
      <div className="g-offerline__text">
        <span className="g-offerline__title">{offer.title}</span>
        <MerchantChip merchant={offer.merchant} />
      </div>
      <Price value={offer.price} size="md" />
    </div>
  );
}

/** Major-unit input that only ever yields integer minor units. */
function MoneyField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: Money;
  onChange: (m: Money | undefined) => void;
  hint?: ReactNode;
}) {
  const id = useId();
  const [text, setText] = useState(() => moneyToInput(value));
  const parsed = parseMajorToMinor(text, value.currency);
  const invalid = parsed === undefined || parsed <= 0;
  return (
    <div className="g-field">
      <label htmlFor={id} className="g-field__label">
        {label}
      </label>
      <div className="aui-field g-field__box" data-invalid={invalid ? "" : undefined}>
        <span className="g-muted g-mono" aria-hidden>
          {value.currency}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseMajorToMinor(e.target.value, value.currency);
            onChange(
              p !== undefined && p > 0 ? { amountMinor: p, currency: value.currency } : undefined,
            );
          }}
          onKeyDown={(e) => {
            // Esc denies the whole card; keep it from firing while editing a number.
            if (e.key === "Escape") e.stopPropagation();
          }}
        />
      </div>
      {hint && (
        <span id={`${id}-hint`} className="g-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

const EXPIRY_DAYS = [7, 30, 90] as const;

type RuleDraft = {
  maxUnitPrice: Money | undefined;
  maxTotal: Money | undefined;
  quantity: number;
  expiresAt: string;
};

function RuleEditor({
  rule,
  draft,
  setDraft,
}: {
  rule: Omit<AutoBuyRule, "mandateId">;
  draft: RuleDraft;
  setDraft: (d: RuleDraft) => void;
}) {
  const qtyId = useId();
  const expId = useId();
  const days = Math.max(1, Math.round((Date.parse(draft.expiresAt) - Date.now()) / 86_400_000));
  return (
    <fieldset className="g-rule-edit">
      <legend className="g-label">Limits you can tighten</legend>
      <MoneyField
        label="Buy at or below (each)"
        value={rule.maxUnitPrice}
        onChange={(m) => setDraft({ ...draft, maxUnitPrice: m })}
      />
      <MoneyField
        label="Never spend more than (total)"
        value={rule.maxTotal}
        hint="Includes shipping and tax"
        onChange={(m) => setDraft({ ...draft, maxTotal: m })}
      />
      <div className="g-field">
        <label htmlFor={qtyId} className="g-field__label">
          Quantity
        </label>
        <select
          id={qtyId}
          className="aui-field g-select"
          value={draft.quantity}
          onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="g-field">
        <label htmlFor={expId} className="g-field__label">
          Rule ends
        </label>
        <select
          id={expId}
          className="aui-field g-select"
          value={EXPIRY_DAYS.includes(days as 7) ? String(days) : "keep"}
          onChange={(e) =>
            setDraft({
              ...draft,
              expiresAt:
                e.target.value === "keep"
                  ? rule.expiresAt
                  : new Date(Date.now() + Number(e.target.value) * 86_400_000).toISOString(),
            })
          }
        >
          {!EXPIRY_DAYS.includes(days as 7) && (
            <option value="keep">{new Date(rule.expiresAt).toLocaleDateString()}</option>
          )}
          {EXPIRY_DAYS.map((d) => (
            <option key={d} value={d}>
              In {d} days
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

function ruleEdits(rule: Omit<AutoBuyRule, "mandateId">, d: RuleDraft): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  if (d.maxUnitPrice && d.maxUnitPrice.amountMinor !== rule.maxUnitPrice.amountMinor)
    edits.maxUnitPrice = d.maxUnitPrice;
  if (d.maxTotal && d.maxTotal.amountMinor !== rule.maxTotal.amountMinor)
    edits.maxTotal = d.maxTotal;
  if (d.quantity !== rule.quantity) edits.quantity = d.quantity;
  if (d.expiresAt !== rule.expiresAt) edits.expiresAt = d.expiresAt;
  return edits;
}

const KIND_ICON = {
  purchase: <ShoppingCart size={16} />,
  autoBuyRule: <Zap size={16} />,
  browserAction: <MonitorPlay size={16} />,
  tool: <Wrench size={16} />,
} as const;

/**
 * The money gate. Amounts come from the server item, never from model text. Approve needs a
 * connected wallet for purchases and a passkey when the server asks for step-up.
 */
export function ApprovalWidget({ item }: { item: ApprovalItem }) {
  const ctx = useWidgetContext();
  const [local, setLocal] = useState<ApprovalStatus>("pending");
  const [expiresIn] = useState(() =>
    Math.max(0, Math.round((Date.parse(item.expiresAt) - Date.now()) / 1000)),
  );
  // Already past its expiry on arrival (a replay): show it closed rather than counting from zero.
  const status = statusOf(item, expiresIn === 0 && item.status === "inProgress" ? "denied" : local);
  const [error, setError] = useState<string | null>(null);

  const purchase = useMemo(
    () => (item.kind === "purchase" ? PurchaseApprovalDetails.safeParse(item.details) : undefined),
    [item.kind, item.details],
  );
  const autoBuy = useMemo(
    () =>
      item.kind === "autoBuyRule" ? AutoBuyApprovalDetails.safeParse(item.details) : undefined,
    [item.kind, item.details],
  );
  const rule = autoBuy?.success ? autoBuy.data.rule : undefined;
  const [draft, setDraft] = useState<RuleDraft | undefined>(() =>
    rule
      ? {
          maxUnitPrice: rule.maxUnitPrice,
          maxTotal: rule.maxTotal,
          quantity: rule.quantity,
          expiresAt: rule.expiresAt,
        }
      : undefined,
  );

  const needsWallet =
    (item.kind === "purchase" || item.kind === "autoBuyRule") &&
    ctx.state !== undefined &&
    !ctx.state.wallet.connected;
  const draftInvalid = draft !== undefined && (!draft.maxUnitPrice || !draft.maxTotal);

  const details: ApprovalDetail[] = [];
  const amount = item.amount ?? (purchase?.success ? purchase.data.total : undefined);
  if (purchase?.success) {
    const p = purchase.data;
    details.push({ label: "Quantity", value: String(p.quantity) });
    if (amount) details.push({ label: "Total", value: <Price value={amount} size="sm" /> });
    details.push({
      label: "Undo window",
      value:
        p.coolingOffMinutes > 0
          ? `${p.coolingOffMinutes} min after purchase, nothing charged until then`
          : "None: charged at once",
    });
  } else if (amount) {
    details.push({ label: "Amount", value: <Price value={amount} size="sm" /> });
  }
  if ((item.kind === "purchase" || item.kind === "autoBuyRule") && ctx.state?.wallet.connected) {
    details.push({ label: "Pay with", value: ctx.state.wallet.label ?? "PayPal" });
  }

  const preview = (
    <div className="g-approval__body">
      {purchase?.success && <OfferLine offer={purchase.data.offer} />}
      {autoBuy?.success && <OfferLine offer={autoBuy.data.offer} />}
      {rule && draft && status === "pending" && (
        <RuleEditor rule={rule} draft={draft} setDraft={setDraft} />
      )}
      {rule && status !== "pending" && (
        <p className="g-muted">
          Up to {formatMoney(rule.maxUnitPrice)} each, {formatMoney(rule.maxTotal)} total.
        </p>
      )}
      {item.summary && <p className="g-approval__summary">{item.summary}</p>}
      {needsWallet && status === "pending" && <WalletConnectCard />}
      {item.stepUp && status === "pending" && (
        <p className="g-stepup">
          <Fingerprint aria-hidden className="g-ico" /> Above your step-up limit: you'll confirm
          with your passkey.
        </p>
      )}
      {error && (
        <p className="g-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  const approve = async () => {
    setError(null);
    try {
      const assertion = item.stepUp ? await ctx.stepUp?.() : undefined;
      if (item.stepUp && assertion === undefined && ctx.stepUp)
        throw new Error("Passkey check cancelled.");
      const edits = rule && draft ? ruleEdits(rule, draft) : {};
      await ctx.respondApproval(item.approvalId, "approve", {
        ...(Object.keys(edits).length ? { edits } : {}),
        ...(assertion !== undefined ? { assertion } : {}),
      });
    } catch (e) {
      setError((e as Error)?.message || "Couldn't send your approval. Try again.");
      throw e;
    }
  };

  const approveLabel =
    item.kind === "purchase" && amount
      ? `Buy for ${formatMoney(amount)}`
      : item.kind === "autoBuyRule"
        ? "Turn on auto-buy"
        : "Approve";

  return (
    <div className="genui g-approval">
      <ApprovalCard
        title={item.title}
        description={
          item.kind === "autoBuyRule"
            ? "Standing rule: buys for you when the price is right"
            : undefined
        }
        icon={KIND_ICON[item.kind]}
        details={details}
        preview={preview}
        status={status}
        onStatusChange={setLocal}
        allowAlways={false}
        label={
          status === "pending" ? (
            <span className="g-approval__label">
              <ShieldCheck aria-hidden className="g-ico" /> Needs your OK
            </span>
          ) : undefined
        }
        approveLabel={approveLabel}
        denyLabel="Not now"
        approveDisabled={needsWallet || draftInvalid}
        {...(expiresIn > 0 ? { expiresIn } : {})}
        onApprove={approve}
        onDeny={() => {
          ctx.respondApproval(item.approvalId, "deny").catch(() => {});
        }}
      />
    </div>
  );
}
