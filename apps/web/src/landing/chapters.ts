import type { LucideIcon } from "lucide-react";
import {
  Fingerprint,
  FlaskConical,
  KeyRound,
  RotateCcw,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import type { ArtName } from "./art";

export type Scene = "dawn" | "bloom" | "dusk" | "night";
export const SCENES: readonly Scene[] = ["dawn", "bloom", "dusk", "night"];

export type Media =
  | { kind: "video"; name: "v-watch" | "v-split" | "v-schedule" | "v-send" | "v-approve" }
  | { kind: "still"; art: ArtName }
  | { kind: "browser" }
  | { kind: "split" }
  | { kind: "phones" };

export interface Feature {
  title: string;
  body: string;
  link?: { label: string; href: string };
  media: Media;
}

export interface Card {
  title: string;
  body: string;
  art?: ArtName;
  icon?: LucideIcon;
}

export interface Chapter {
  id: string;
  /** Short name for the chapter navs. */
  nav: string;
  title: string;
  subtitle: string;
  scene: Scene;
  features: Feature[];
  cards: Card[];
}

const open = { label: "Open Pact", href: "/app" };

export const CHAPTERS: Chapter[] = [
  {
    id: "agent",
    nav: "Agent",
    title: "Agent",
    subtitle: "Say the plan in chat. Pact turns it into a pact.",
    scene: "dawn",
    features: [
      {
        title: "Drafts the plan, never decides it",
        body: "Describe what your group wants in plain words. Pact searches, compares and drafts a pact with prices it looked up itself.",
        link: open,
        media: { kind: "browser" },
      },
    ],
    cards: [
      {
        art: "c-search",
        title: "Product search",
        body: "Ask for a thing and a budget. Pact finds options and shows real prices.",
      },
      {
        art: "c-edit",
        title: "Plans you can edit",
        body: "Change the target, the deadline or who's in before anyone commits.",
      },
      {
        art: "c-group",
        title: "Built for group threads",
        body: "Everyone in the thread sees the same plan and commits their own part.",
      },
    ],
  },
  {
    id: "price-watch",
    nav: "Price watch",
    title: "Price watch",
    subtitle: "Buy it the moment it drops.",
    scene: "dawn",
    features: [
      {
        title: "Set a target and walk away",
        body: "Pick a price and a deadline. Pact checks the price and buys as soon as it's at or below your target.",
        media: { kind: "video", name: "v-watch" },
      },
    ],
    cards: [
      {
        art: "c-target",
        title: "Targets that mean it",
        body: "At or below your price triggers the buy. Not a cent over.",
      },
      {
        art: "c-deadline",
        title: "Deadlines",
        body: "If the price never drops, the watch ends and nobody is charged.",
      },
      {
        art: "c-check",
        title: "Always watching",
        body: "Prices are checked on a schedule, so you don't have to.",
      },
    ],
  },
  {
    id: "group-buys",
    nav: "Group buys",
    title: "Group buys",
    subtitle: "Split it before you buy it.",
    scene: "bloom",
    features: [
      {
        title: "Everyone in, or no one pays",
        body: "Each member commits their share. Pact holds every share first and only captures when the whole group is in.",
        media: { kind: "video", name: "v-split" },
      },
      {
        title: "Fair shares, even with caps",
        body: "Anyone who can't cover an even share pays their cap, and the rest is divided by everyone else. Try it.",
        media: { kind: "split" },
      },
    ],
    cards: [
      {
        art: "c-hold",
        title: "Hold, then capture",
        body: "Shares are authorized first and captured together.",
      },
      {
        art: "c-quorum",
        title: "All or nothing",
        body: "If someone drops out, every hold is voided.",
      },
      {
        art: "c-weights",
        title: "Weighted splits",
        body: "Split by weight when one person should pay more.",
      },
    ],
  },
  {
    id: "standing-orders",
    nav: "Standing orders",
    title: "Standing orders",
    subtitle: "Pay on a schedule you set once.",
    scene: "bloom",
    features: [
      {
        title: "Rent, subs and the coffee fund",
        body: "Set the payee, the amount and how often. Each run stays inside the limits you signed.",
        media: { kind: "video", name: "v-schedule" },
      },
    ],
    cards: [
      {
        art: "c-cap",
        title: "A cap on every charge",
        body: "A run that would go over your cap asks you first.",
      },
      {
        art: "c-end",
        title: "End dates",
        body: "Every standing order expires when you said it would.",
      },
      {
        art: "c-revoke",
        title: "Revoke anytime",
        body: "One tap stops future runs. Past ones stay on the record.",
      },
    ],
  },
  {
    id: "send",
    nav: "Send & request",
    title: "Send & request",
    subtitle: "Settle up without leaving the thread.",
    scene: "dusk",
    features: [
      {
        title: "Money between friends, in chat",
        body: "Ask for someone's half or pay them back from the conversation where you made the plan.",
        media: { kind: "video", name: "v-send" },
      },
    ],
    cards: [
      {
        art: "c-request",
        title: "Request a share",
        body: "Pact sends the request with the amount already worked out.",
      },
      {
        art: "c-payback",
        title: "Pay back in one step",
        body: "Approve and it's sent. The thread shows it's settled.",
      },
      {
        art: "c-payout",
        title: "Straight to PayPal",
        body: "Payouts land in your friend's PayPal account.",
      },
    ],
  },
  {
    id: "approvals",
    nav: "Approvals",
    title: "Approvals",
    subtitle: "Nothing moves without you.",
    scene: "dusk",
    features: [
      {
        title: "Hold to approve, sign with a passkey",
        body: "Every payment outside a mandate waits for you. Hold to approve, and larger amounts ask for your passkey too.",
        media: { kind: "video", name: "v-approve" },
      },
      {
        title: "The approval is yours, not the agent's",
        body: "The approval card is drawn by the app, never by the model, so the amount you see is the amount you sign.",
        media: { kind: "phones" },
      },
    ],
    cards: [],
  },
  {
    id: "paypal",
    nav: "PayPal",
    title: "PayPal",
    subtitle: "Real payments, not IOUs.",
    scene: "night",
    features: [
      {
        title: "Pact decides when. PayPal moves the money.",
        body: "Saved payment methods, authorize-then-capture for group buys, and payouts to friends all run on PayPal.",
        media: { kind: "still", art: "c-rails" },
      },
    ],
    cards: [
      {
        title: "Saved payment methods",
        body: "Members connect PayPal once. Pact charges it only inside the caps and dates they agreed to.",
      },
      {
        title: "Authorize, then capture",
        body: "Group buys hold every share and capture only when everyone is in.",
      },
      {
        title: "Payouts",
        body: "Pay a friend back or settle a split straight to their PayPal.",
      },
    ],
  },
  {
    id: "safety",
    nav: "Safety",
    title: "Safety",
    subtitle: "Built to be trusted with money.",
    scene: "night",
    features: [],
    cards: [
      {
        icon: Fingerprint,
        title: "Passkey approvals",
        body: "Every payment you approve is signed on your device.",
      },
      {
        icon: ShieldCheck,
        title: "A policy engine, in code",
        body: "Caps, payees and expiry dates are checked before any PayPal call.",
      },
      {
        icon: KeyRound,
        title: "The AI never types money",
        body: "Prices and amounts come from the server, never from the model.",
      },
      {
        icon: ScrollText,
        title: "Safe retries",
        body: "Each PayPal request carries an idempotency key, so a retry can't charge twice.",
      },
      {
        icon: RotateCcw,
        title: "Automatic unwinds",
        body: "If a group buy falls through, held funds are voided or refunded.",
      },
      {
        icon: FlaskConical,
        title: "Red-teamed",
        body: "Passes 100% of our prompt-injection and money-safety evals.",
      },
    ],
  },
];
