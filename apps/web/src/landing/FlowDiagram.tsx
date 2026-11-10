/**
 * Fig. 2: the money path, agent to creator. Two drawings of the same graph, one
 * wide and one tall; CSS shows the one that fits. Both are decorative for screen
 * readers: the figcaption and the numbered steps carry the same content as text.
 */

type Node = { title: string; sub: string };

const NODES: Node[] = [
  { title: "Shopper agent", sub: "Any agent, over MCP" },
  { title: "Agent catalogue", sub: "" },
  { title: "PayPal checkout", sub: "saved wallet · seller as payee" },
  { title: "Seller paid", sub: "Northwind · Lumen · MegaMart" },
  { title: "CITED engine", sub: "join · hold · void" },
  { title: "Creator", sub: "batch Payouts" },
];

const ARMS = [
  { label: "test", cls: "arm-test" },
  { label: "placebo", cls: "arm-placebo" },
  { label: "nothing", cls: "arm-none" },
];

function Arms({ x, y }: { x: number; y: number }) {
  // Coloured dot + label per arm, laid out on one line.
  let cx = x;
  return (
    <g>
      {ARMS.map((a) => {
        const g = (
          <g key={a.label}>
            <circle className={a.cls} cx={cx + 3.5} cy={y - 4} r={3.5} />
            <text className="fd-sub" x={cx + 10} y={y}>
              {a.label}
            </text>
          </g>
        );
        cx += 11 + a.label.length * 6.2 + 7;
        return g;
      })}
    </g>
  );
}

function Box({
  x,
  y,
  w,
  h,
  node,
  i,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  node: Node;
  i: number;
}) {
  const engine = i === 4;
  return (
    <g>
      <rect
        className={engine ? "fd-box fd-box-engine" : "fd-box"}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
      />
      <text className="fd-title" x={x + 14} y={y + 28}>
        {node.title}
      </text>
      {i === 1 ? (
        <Arms x={x + 14} y={y + 52} />
      ) : (
        <text className="fd-sub" x={x + 14} y={y + 52}>
          {node.sub}
        </text>
      )}
    </g>
  );
}

export function FlowWide() {
  const w = 168;
  const gap = 22;
  const y = 70;
  const h = 72;
  const xs = (i: number) => i * (w + gap);
  const passportY = y + h + 58;
  return (
    <svg className="fd fd-wide" viewBox="0 0 1118 250" aria-hidden="true" focusable="false">
      <defs>
        <marker
          id="fd-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L9 5 L0 9" className="fd-arrowhead" />
        </marker>
      </defs>
      <text className="fd-note" x={xs(1)} y={34}>
        ranking identical in every arm
      </text>
      {NODES.slice(0, -1).map((n, i) => (
        <line
          key={n.title}
          className="fd-edge"
          x1={xs(i) + w + 2}
          y1={y + h / 2}
          x2={xs(i + 1) - 4}
          y2={y + h / 2}
          markerEnd="url(#fd-arrow)"
        />
      ))}
      {NODES.map((n, i) => (
        <Box key={n.title} x={xs(i)} y={y} w={w} h={h} node={n} i={i} />
      ))}
      <path
        className="fd-passport"
        d={`M${xs(1) + w / 2} ${y + h} V${passportY} H${xs(4) + w / 2} V${y + h + 6}`}
        markerEnd="url(#fd-arrow)"
      />
      <text
        className="fd-passport-label"
        x={(xs(1) + xs(4) + w) / 2}
        y={passportY + 24}
        textAnchor="middle"
      >
        signed Agent Affiliate Passport, carried in purchase_units[].custom_id
      </text>
    </svg>
  );
}

export function FlowTall() {
  const x = 0;
  const w = 236;
  const h = 72;
  const gap = 34;
  const ys = (i: number) => i * (h + gap);
  const lane = w + 34;
  return (
    <svg className="fd fd-tall" viewBox="0 0 330 618" aria-hidden="true" focusable="false">
      <defs>
        <marker
          id="fd-arrow-t"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L9 5 L0 9" className="fd-arrowhead" />
        </marker>
      </defs>
      {NODES.slice(0, -1).map((n, i) => (
        <line
          key={n.title}
          className="fd-edge"
          x1={x + 40}
          y1={ys(i) + h + 2}
          x2={x + 40}
          y2={ys(i + 1) - 4}
          markerEnd="url(#fd-arrow-t)"
        />
      ))}
      {NODES.map((n, i) => (
        <Box key={n.title} x={x} y={ys(i)} w={w} h={h} node={n} i={i} />
      ))}
      <path
        className="fd-passport"
        d={`M${w + 2} ${ys(1) + h / 2} H${lane} V${ys(4) + h / 2} H${w + 6}`}
        markerEnd="url(#fd-arrow-t)"
      />
      <text
        className="fd-passport-label"
        transform={`translate(${lane + 16} ${(ys(1) + ys(4) + h) / 2}) rotate(90)`}
        textAnchor="middle"
      >
        signed passport in custom_id
      </text>
    </svg>
  );
}
