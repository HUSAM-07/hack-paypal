import * as THREE from "three";

/**
 * The console's replay: two passport tokens run the same route at the same time, one per
 * agent, and only the one whose agent was shown the creator's test ends in a payout. The
 * console server renders the facts (stores, prices, verdicts) into #scene-data; this file
 * only draws them. Without WebGL, or with reduced motion, the page shows the final frame or
 * just the receipts below it.
 */

type SceneLane = {
  kind: "test" | "held";
  title: string;
  stores: { name: string; note: string; paid: boolean }[];
  catalogue: string;
  paypal: string;
  outcome: string;
  outcomeSub: string;
  credited: boolean;
};
type SceneData = { lanes: SceneLane[]; live: boolean };

const COL = {
  agent: -11,
  catalogue: -6,
  read: -1,
  paid: 2.5,
  paypal: 6.5,
  engine: 11,
  outcome: 15.5,
};
const LANE_Z = { test: -3.4, held: 3.4 };
const CENTER_X = 2.25;
const C = {
  test: new THREE.Color("#5fd9a0"),
  held: new THREE.Color("#f0b545"),
  idle: new THREE.Color("#3b3a35"),
  dim: new THREE.Color("#55534d"),
  slab: new THREE.Color("#141413"),
};
const STEPS = [0, 1.2, 3.2, 6.0, 7.8];
const END = 11.2;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,.35)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function glyphTexture(ch: string, color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = color;
  g.font = "600 46px 'Geist Mono', ui-monospace, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, 32, 34);
  return new THREE.CanvasTexture(c);
}

type Node = { edges: THREE.LineBasicMaterial; lit: number; color: THREE.Color; at: THREE.Vector3 };

/** A waypoint the token reaches at time `t`. */
type Way = { p: THREE.Vector3; t: number };

function main() {
  const host = document.getElementById("scene");
  const raw = document.getElementById("scene-data")?.textContent;
  if (!host || !raw) return;
  const data = JSON.parse(raw) as SceneData;
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
  const still = data.live || matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("has-scene");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.prepend(renderer.domElement);
  const labels = document.createElement("div");
  labels.className = "sl-layer";
  host.append(labels);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 2, 0.1, 400);
  const glow = glowTexture();

  // Dot floor.
  const dots: number[] = [];
  for (let x = -20; x <= 24; x += 1) for (let z = -10; z <= 10; z += 1) dots.push(x, -0.12, z);
  const floor = new THREE.BufferGeometry();
  floor.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3));
  scene.add(
    new THREE.Points(
      floor,
      new THREE.PointsMaterial({ color: "#2b2a26", size: 0.07, sizeAttenuation: true }),
    ),
  );

  const nodes: Node[] = [];
  const tracked: { el: HTMLElement; at: THREE.Vector3; show: number | undefined }[] = [];

  function label(html: string, at: THREE.Vector3, cls = "", show?: number) {
    const el = document.createElement("div");
    el.className = `sl ${cls}`;
    el.innerHTML = `<div class="sl-in">${html}</div>`;
    labels.append(el);
    tracked.push({ el, at, show });
    return el;
  }

  function slab(x: number, z: number, w: number, d: number, color: THREE.Color): Node {
    const geo = new THREE.BoxGeometry(w, 0.2, d);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.slab }));
    mesh.position.set(x, 0, z);
    const edges = new THREE.LineBasicMaterial({ color: C.idle.clone(), transparent: true });
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edges);
    line.position.copy(mesh.position);
    scene.add(mesh, line);
    const n = { edges, lit: 0, color, at: new THREE.Vector3(x, 0, z) };
    nodes.push(n);
    return n;
  }

  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string,
    );

  // Column heads.
  const heads: [number, string][] = [
    [COL.agent, "Agent"],
    [COL.catalogue, "Catalogue"],
    [COL.read, "Offer read"],
    [COL.paid, "Seller paid"],
    [COL.paypal, "PayPal"],
    [COL.engine, "CITED engine"],
    [COL.outcome, "Creator"],
  ];
  for (const [x, t] of heads) label(t, new THREE.Vector3(x, 0, -6.3), "sl-head");

  // The engine is shared: both sales go through the same rules.
  const engine = slab(COL.engine, 0, 2.6, 2.6, C.test);
  label("join · hold · void", new THREE.Vector3(COL.engine, 0, 1.7), "sl-node");
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.9, 0.025, 8, 96),
    new THREE.MeshBasicMaterial({ color: C.idle.clone(), transparent: true }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(COL.engine, 0.05, 0);
  scene.add(ring);

  type Run = {
    lane: SceneLane;
    color: THREE.Color;
    way: Way[];
    token: THREE.Mesh;
    halo: THREE.Sprite;
    trail: THREE.Line;
    trailPts: number;
    trailT: number[];
    lights: { node: Node; t: number }[];
    outcome: Node;
  };
  const runs: Run[] = [];

  for (const lane of data.lanes) {
    const z = LANE_Z[lane.kind];
    const color = lane.kind === "test" ? C.test : C.held;
    const agent = slab(COL.agent, z, 2.6, 1.5, color);
    label(`<b>${esc(lane.title)}</b>`, new THREE.Vector3(COL.agent, 0, z + 0.95), "sl-node");
    const cat = slab(COL.catalogue, z, 2.6, 1.5, color);
    label(esc(lane.catalogue), new THREE.Vector3(COL.catalogue, 0, z + 0.95), "sl-node");
    // The catalogue's call: the review shown, or withheld.
    label(
      lane.kind === "test"
        ? "<span class='sl-k'>Review shown</span>Winix wins"
        : "<span class='sl-k'>Review withheld</span>offers only",
      new THREE.Vector3(COL.catalogue, 0.4, z - 0.85),
      `sl-call sl-${lane.kind}`,
      2.2,
    );

    const way: Way[] = [
      { p: new THREE.Vector3(COL.agent, 0.35, z), t: 0.6 },
      { p: new THREE.Vector3(COL.catalogue, 0.35, z), t: 2.2 },
    ];
    const lights = [
      { node: agent, t: 0.6 },
      { node: cat, t: 2.2 },
    ];
    const storeT = lane.stores.length > 1 ? [4.2, 5.4] : [4.6];
    lane.stores.forEach((s, i) => {
      const x = lane.stores.length > 1 ? (i === 0 ? COL.read : COL.paid) : COL.read;
      const n = slab(x, z, 2.6, 1.5, color);
      label(
        `<b>${esc(s.name)}</b><span>${esc(s.note)}</span>`,
        new THREE.Vector3(x, 0, z + 0.95),
        "sl-node",
      );
      way.push({ p: new THREE.Vector3(x, 0.35, z), t: storeT[i] as number });
      lights.push({ node: n, t: storeT[i] as number });
    });
    if (lane.stores.length > 1) {
      label(
        "<span class='sl-k'>Cheaper here</span>pays this seller",
        new THREE.Vector3(COL.paid, 0.4, z - 0.85),
        `sl-call sl-${lane.kind}`,
        5.4,
      );
    }
    const pp = slab(COL.paypal, z, 2.6, 1.5, color);
    label(
      `<b>Checkout</b><span>${esc(lane.paypal)}</span>`,
      new THREE.Vector3(COL.paypal, 0, z + 0.95),
      "sl-node",
    );
    label(
      "<span class='sl-k'>custom_id</span>signed passport",
      new THREE.Vector3(COL.paypal, 0.4, z - 0.85),
      `sl-call sl-${lane.kind}`,
      7.2,
    );
    way.push({ p: new THREE.Vector3(COL.paypal, 0.35, z), t: 7.2 });
    lights.push({ node: pp, t: 7.2 });
    way.push({ p: new THREE.Vector3(COL.engine - 0.6, 0.35, z * 0.25), t: 8.6 });
    lights.push({ node: engine, t: 8.6 });

    const outcome = slab(COL.outcome, z, 2.8, 1.5, lane.credited ? color : C.dim);
    label(
      `<b>${esc(lane.outcome)}</b><span>${esc(lane.outcomeSub)}</span>`,
      new THREE.Vector3(COL.outcome, 0, z + 0.95),
      `sl-node sl-out ${lane.credited ? "sl-paid" : "sl-zero"}`,
      9.6,
    );
    way.push({ p: new THREE.Vector3(COL.outcome, 0.35, z), t: 9.6 });
    lights.push({ node: outcome, t: 9.6 });

    const token = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 0.45),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(2.2, 2.2, 1);
    scene.add(token, halo);

    // Trail: the whole route sampled once, revealed as the token moves.
    const pts: THREE.Vector3[] = [];
    const ts: number[] = [];
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i] as Way;
      const b = way[i + 1] as Way;
      const mid = a.p.clone().lerp(b.p, 0.5);
      mid.y += Math.min(1.6, a.p.distanceTo(b.p) * 0.18);
      const curve = new THREE.QuadraticBezierCurve3(a.p, mid, b.p);
      const n = 40;
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        pts.push(curve.getPoint(k / n));
        ts.push(a.t + (b.t - a.t) * (k / n));
      }
    }
    const tg = new THREE.BufferGeometry().setFromPoints(pts);
    const trail = new THREE.Line(
      tg,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    );
    tg.setDrawRange(0, 0);
    scene.add(trail);
    runs.push({
      lane,
      color,
      way,
      token,
      halo,
      trail,
      trailPts: pts.length,
      trailT: ts,
      lights,
      outcome,
    });
  }

  // $ burst for the credited sale.
  const coinTex = glyphTexture("$", "#5fd9a0");
  const coins = Array.from({ length: 36 }, () => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: coinTex, transparent: true, depthWrite: false, opacity: 0 }),
    );
    s.scale.set(0.55, 0.55, 1);
    scene.add(s);
    return {
      s,
      v: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        3 + Math.random() * 3.5,
        (Math.random() - 0.5) * 3,
      ),
    };
  });
  const paidRun = runs.find((r) => r.lane.credited);

  function tokenAt(r: Run, t: number): THREE.Vector3 {
    const w = r.way;
    if (t <= (w[0] as Way).t) return (w[0] as Way).p.clone();
    for (let i = 0; i < w.length - 1; i++) {
      const a = w[i] as Way;
      const b = w[i + 1] as Way;
      // Each hop starts once the previous one has landed, after a short dwell.
      const start = Math.max(a.t + 0.25, b.t - 1.0);
      if (t < b.t) {
        const k = ease(clamp01((t - start) / (b.t - start)));
        const mid = a.p.clone().lerp(b.p, 0.5);
        mid.y += Math.min(1.6, a.p.distanceTo(b.p) * 0.18);
        return new THREE.QuadraticBezierCurve3(a.p, mid, b.p).getPoint(k);
      }
    }
    return (w[w.length - 1] as Way).p.clone();
  }

  // Step captions, outside the canvas: they drive and follow the clock.
  const stepEls = [...document.querySelectorAll<HTMLButtonElement>(".scene-step")];
  const replay = document.querySelector<HTMLButtonElement>(".scene-replay");
  let t0 = performance.now();
  let t = still ? END : 0;
  const jump = (to: number) => {
    t0 = performance.now() - to * 1000;
  };
  stepEls.forEach((b, i) => {
    b.addEventListener("click", () => jump(STEPS[i] as number));
  });
  replay?.addEventListener("click", () => jump(0));

  const v = new THREE.Vector3();
  // Narrow screens can't fit the route: the camera follows the tokens instead.
  let follow = false;
  let camX = CENTER_X;
  let dist = 39;
  function place(x: number) {
    camera.position.set(x, dist * 0.76, dist * 0.65);
    camera.lookAt(x, 0, 0.4);
  }
  function size() {
    const w = host?.clientWidth ?? 800;
    const h = host?.clientHeight ?? 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit the 28-unit route to the width: pull back on narrow screens.
    follow = camera.aspect < 1.4;
    dist = follow ? 14 / (0.389 * camera.aspect) : 39 * Math.max(1, 2.5 / camera.aspect) ** 0.95;
    if (follow && still) camX = COL.outcome - 3;
    place(follow ? camX : CENTER_X);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(host);
  size();

  function frame(now: number) {
    if (!still) t = Math.min(END + 30, (now - t0) / 1000);
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    if (follow && !still) {
      const xs = runs.map((r) => tokenAt(r, t).x);
      const target = Math.min(COL.outcome - 3, Math.max(COL.agent + 3, Math.max(...xs)));
      camX += (target - camX) * 0.06;
      place(camX);
    } else if (!still) {
      place(CENTER_X + Math.sin(now / 6000) * 0.8);
    }

    for (const r of runs) {
      const p = tokenAt(r, t);
      r.token.position.copy(p);
      r.halo.position.copy(p);
      const done = t >= (r.way[r.way.length - 1] as Way).t;
      const fade = done && !r.lane.credited ? 0.35 : 1;
      (r.token.material as THREE.MeshBasicMaterial).color.copy(
        done && !r.lane.credited ? C.dim : r.color,
      );
      (r.halo.material as THREE.SpriteMaterial).opacity =
        (0.55 + Math.sin(now / 260) * 0.15) * fade;
      let n = 0;
      while (n < r.trailPts && (r.trailT[n] as number) <= t) n++;
      r.trail.geometry.setDrawRange(0, n);
      for (const l of r.lights) l.node.lit = Math.max(l.node.lit, t >= l.t ? 1 : 0);
    }
    for (const n of nodes) {
      n.edges.color.copy(C.idle).lerp(n.color, n.lit);
    }
    // Engine ring spins once both sales are in.
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    ringMat.color.copy(C.idle).lerp(C.test, t >= 8.6 ? 1 : 0);
    ring.rotation.z = now / 1800;
    ring.scale.setScalar(
      1 + (t >= 8.6 && t < 9.4 ? Math.sin(((t - 8.6) / 0.8) * Math.PI) * 0.12 : 0),
    );

    // Coins rise from the creator's slab when the credited token lands.
    if (paidRun) {
      const tb = 9.6;
      const dt = t - tb;
      for (const c of coins) {
        const m = c.s.material as THREE.SpriteMaterial;
        if (dt < 0 || dt > 2.2 || still) {
          m.opacity = 0;
          continue;
        }
        c.s.position.set(
          paidRun.outcome.at.x + c.v.x * dt * 0.6,
          0.4 + c.v.y * dt - 2.6 * dt * dt,
          paidRun.outcome.at.z + c.v.z * dt * 0.6,
        );
        m.opacity = clamp01(1 - dt / 2.2);
      }
    }

    // Labels follow the camera.
    for (const l of tracked) {
      v.copy(l.at).project(camera);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      if (l.show !== undefined) l.el.classList.toggle("on", t >= l.show);
    }
    let step = 0;
    STEPS.forEach((s, i) => {
      if (t >= s) step = i;
    });
    stepEls.forEach((b, i) => {
      b.setAttribute("aria-current", i === step ? "step" : "false");
      b.classList.toggle("done", i < step || t >= END);
    });

    renderer.render(scene, camera);
    if (!still) requestAnimationFrame(frame);
  }
  if (still) {
    for (const r of runs) for (const l of r.lights) l.node.lit = 1;
  }
  requestAnimationFrame(frame);
  // A still page still needs a frame after the labels have measured their layout.
  if (still) new ResizeObserver(() => requestAnimationFrame(frame)).observe(host);
}

main();
