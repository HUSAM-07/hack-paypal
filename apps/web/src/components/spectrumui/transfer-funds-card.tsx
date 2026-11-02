import { ChevronsUpDown, X } from "lucide-react";
import { motion } from "motion/react";
import type * as React from "react";

import { cn } from "@/lib/utils";

export interface TransferSummaryRow {
  label: string;
  value: string;
  emphasized?: boolean;
}

export interface TransferFundsCardProps {
  title?: string;
  description?: string;
  amountLabel?: string;
  currencySymbol?: string;
  amount?: string;
  fromLabel?: string;
  fromAccount?: string;
  toLabel?: string;
  toAccount?: string;
  summary?: TransferSummaryRow[];
  buttonLabel?: string;
  onConfirm?: () => void;
  onClose?: () => void;
  className?: string;
  /** Pact: disables the confirm button (e.g. while streaming or after confirming). */
  confirmDisabled?: boolean;
  /** Pact: replaces the confirm button (e.g. a sent state). */
  footer?: React.ReactNode;
  /** Pact: server-drafted accounts can't be changed here; hide the picker affordance. */
  fieldsReadOnly?: boolean;
}

const DEFAULT_SUMMARY: TransferSummaryRow[] = [
  { label: "Estimated arrival", value: "Today, Apr 14" },
  { label: "Transaction fee", value: "$0.00" },
  { label: "Total amount", value: "$1,200.00", emphasized: true },
];

function SelectField({ value, readOnly }: { value: string; readOnly?: boolean | undefined }) {
  return (
    <motion.div
      whileHover="hover"
      whileTap={{ scale: 0.99 }}
      className="mt-3 flex h-9 cursor-pointer items-center justify-between rounded-[22px] bg-surface-2 pl-3 pr-3 transition-colors hover:bg-surface-3"
    >
      <span className="truncate text-sm leading-5 text-foreground">{value}</span>
      {!readOnly && (
        <motion.span
          variants={{
            hover: { y: [0, -2, 2, 0], transition: { duration: 0.4 } },
          }}
          className="flex shrink-0"
        >
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </motion.span>
      )}
    </motion.div>
  );
}

export function TransferFundsCard({
  title = "Transfer Funds",
  description = "Move money between your connected accounts.",
  amountLabel = "Amount to Transfer",
  currencySymbol = "$",
  amount = "1,200.00",
  fromLabel = "From Account",
  fromAccount = "Main Checking (··8402) — $12,450.00",
  toLabel = "To Account",
  toAccount = "High Yield Savings (··1192) — $42,100.00",
  summary = DEFAULT_SUMMARY,
  buttonLabel = "Confirm Transfer",
  onConfirm,
  onClose,
  className,
  confirmDisabled,
  footer,
  fieldsReadOnly,
}: TransferFundsCardProps) {
  return (
    <div
      className={cn(
        "relative w-full rounded-[26px] bg-white p-6",
        "shadow-[0_0_0_1px_rgba(10,10,10,0.05),0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)]",
        "dark:bg-surface dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_4px_6px_-1px_rgba(0,0,0,0.5)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-[16px] font-medium leading-6 text-foreground">{title}</h3>
        {onClose && (
          <motion.button
            type="button"
            onClick={onClose}
            whileTap={{ scale: 0.88 }}
            aria-label="Close"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground transition-colors hover:bg-surface-3"
          >
            <motion.span
              whileHover={{ rotate: 90 }}
              transition={{ type: "spring", bounce: 0.4, duration: 0.4 }}
              className="flex"
            >
              <X className="h-4 w-4" />
            </motion.span>
          </motion.button>
        )}
      </div>
      <p className="mt-1.5 max-w-[254px] text-sm leading-5 text-muted-foreground">{description}</p>

      {/* Amount */}
      <div className="mt-6">
        <p className="text-sm font-medium leading-[14px] text-foreground">{amountLabel}</p>
        <div className="mt-3 flex h-9 items-center gap-1.5 rounded-[26px] bg-surface-2 px-3 transition-colors hover:bg-surface-3">
          <span className="text-sm font-medium leading-5 text-muted-foreground">
            {currencySymbol}
          </span>
          <span className="text-sm text-foreground">{amount}</span>
        </div>
      </div>

      {/* From */}
      <div className="mt-7">
        <p className="text-sm font-medium leading-[14px] text-foreground">{fromLabel}</p>
        <SelectField value={fromAccount} readOnly={fieldsReadOnly} />
      </div>

      {/* To */}
      <div className="mt-7">
        <p className="text-sm font-medium leading-[14px] text-foreground">{toLabel}</p>
        <SelectField value={toAccount} readOnly={fieldsReadOnly} />
      </div>

      {/* Summary */}
      <div className="mt-7 rounded-[18px] bg-surface-2 px-4">
        {summary.map((row, index) => (
          <div
            key={row.label}
            className={cn(
              "flex h-[46px] items-center justify-between",
              index > 0 && "border-t border-border",
            )}
          >
            <span
              className={cn(
                "text-sm leading-5",
                row.emphasized ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {row.label}
            </span>
            <span
              className={cn(
                "text-sm leading-5 text-foreground",
                row.emphasized ? "font-semibold" : "font-medium",
              )}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Confirm */}
      {footer ?? (
        <motion.button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", bounce: 0.4, duration: 0.35 }}
          className="mt-[25px] flex h-[34px] w-full disabled:pointer-events-none disabled:opacity-45 items-center justify-center rounded-[26px] bg-primary text-sm font-medium leading-5 text-primary-foreground transition-opacity hover:opacity-90"
        >
          {buttonLabel}
        </motion.button>
      )}
    </div>
  );
}
