import {
  type ComponentRenderer,
  type ComponentRenderProps,
  createLibrary,
  defineComponent,
  useIsStreaming,
} from "@openuidev/react-lang";
import { type ComponentName, type ComponentSpec, catalog, HOST_ONLY } from "@pact/catalog";
import type { ComponentType } from "react";
import type { z } from "zod";
import {
  CalloutView,
  PlanCardView,
  QuestionCardView,
  StackView,
  TextView,
} from "./components/basic";
import { ActivityListView, MandateCardView, TransferFundsCardView } from "./components/money";
import {
  PactCardView,
  PriceWatchView,
  ScheduleCardView,
  SplitBreakdownView,
} from "./components/pact";
import { ProductCardsView, ProductCompareView } from "./components/products";
import { CardSkeleton } from "./primitives";

// biome-ignore lint/suspicious/noExplicitAny: each view is typed against its own catalog props
const VIEWS: Record<ComponentName, ComponentType<ComponentRenderProps<any>>> = {
  Stack: StackView,
  Text: TextView,
  Callout: CalloutView,
  ProductCards: ProductCardsView,
  ProductCompare: ProductCompareView,
  PactCard: PactCardView,
  PriceWatch: PriceWatchView,
  SplitBreakdown: SplitBreakdownView,
  ScheduleCard: ScheduleCardView,
  MandateCard: MandateCardView,
  TransferFundsCard: TransferFundsCardView,
  ActivityList: ActivityListView,
  QuestionCard: QuestionCardView,
  PlanCard: PlanCardView,
};

const PROSE = new Set<ComponentName>(["Text", "Callout"]);

/**
 * The OpenUI renderer hands components the parser's raw props. Re-validate against the
 * catalog spec before rendering: a partial node mid-stream shows a skeleton, and an
 * invalid finished node renders nothing (the worker reports it as a diagnostic).
 */
function guarded(name: ComponentName): ComponentRenderer {
  const spec = catalog[name] as ComponentSpec;
  const View = VIEWS[name];
  // biome-ignore lint/correctness/noComponentHookFactories: built once per catalog entry at module load
  function Guarded({ props, renderNode, statementId }: ComponentRenderProps) {
    const streaming = useIsStreaming();
    if (name === "Stack") {
      const children = Array.isArray(props.children) ? props.children.slice(0, 12) : [];
      return <View props={{ children }} renderNode={renderNode} />;
    }
    const parsed = spec.props.safeParse(props);
    if (!parsed.success) {
      if (streaming && !PROSE.has(name))
        return <CardSkeleton lines={2} label={`Loading ${name}`} />;
      return null;
    }
    return (
      <View props={parsed.data} renderNode={renderNode} {...(statementId ? { statementId } : {})} />
    );
  }
  Guarded.displayName = `Guarded(${name})`;
  return Guarded;
}

export const library = createLibrary({
  root: "Stack",
  components: (Object.keys(catalog) as ComponentName[])
    .filter((name) => !(HOST_ONLY as readonly string[]).includes(name))
    .map((name) =>
      defineComponent({
        name,
        props: catalog[name].props as z.ZodObject,
        description: catalog[name].description,
        component: guarded(name),
      }),
    ),
});
