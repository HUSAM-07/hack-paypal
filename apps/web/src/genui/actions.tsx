import { type ActionName, Actions } from "@pact/catalog";
import { createContext, useContext } from "react";
import type { z } from "zod";

export type ActionPayload<N extends ActionName> = z.infer<(typeof Actions)[N]>;

export interface HostActionHandlers {
  issueTurn: (p: ActionPayload<"issueTurn">) => void;
  openProduct: (p: ActionPayload<"openProduct">) => void;
  openCommit: (p: ActionPayload<"openCommit">) => void;
  copy: (p: ActionPayload<"copy">) => void;
  /** Local UI state (sliders, toggles) staged for the next turn as `uiState`. */
  stageUiState: (patch: Record<string, unknown>) => void;
}

export interface HostActionsValue {
  run: <N extends ActionName>(name: N, payload: ActionPayload<N>) => void;
  stageUiState: (patch: Record<string, unknown>) => void;
  /** False while the message is still streaming or the viewer can't act on it. */
  interactive: boolean;
  viewerId: string;
}

/**
 * Generated components can only reach the host through `run(name, payload)`, and
 * only for names in the catalog's `Actions`. Payloads are re-validated here, so a
 * component (or a prop the model filled) can't smuggle anything else through.
 */
export function createHostActions(
  h: HostActionHandlers,
  opts: { interactive: boolean; viewerId: string },
): HostActionsValue {
  return {
    interactive: opts.interactive,
    viewerId: opts.viewerId,
    stageUiState: h.stageUiState,
    run(name, payload) {
      const schema = Actions[name];
      if (!schema) return;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        console.warn(`[pact] blocked invalid ${name} action`);
        return;
      }
      (h[name] as (p: unknown) => void)(parsed.data);
    },
  };
}

const noop: HostActionsValue = {
  run: () => {},
  stageUiState: () => {},
  interactive: false,
  viewerId: "",
};

export const HostActionsContext = createContext<HostActionsValue>(noop);
export const useHostActions = () => useContext(HostActionsContext);
