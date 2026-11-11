import * as THREE from "three";

/**
 * The console's replay, told like a short film in three chapters:
 *   1. Without the review: the held-out agent shops, step by step, and nobody is paid.
 *   2. With the review: a second agent gets the same request, is shown the creator's review,
 *      buys something else at another seller, and the creator is paid.
 *   3. The difference: both routes side by side, and what changed.
 * The console server renders the facts and the narration into #scene-data; this file only
 * stages them. Without WebGL the receipts below stand alone; with reduced motion or the live
 * refresh the scene opens on the last chapter, fully drawn.
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
  /** One line per stop: agent, catalogue, each store, PayPal, the engine's verdict. */
  captions: string[];
};
type SceneData = { lanes: SceneLane[]; live: boolean; chapters: string[] };

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

/* The film's clock, in seconds. Each lane runs the same local beats from its own start. */
const START = { held: 2.0, test: 14.6 };
const BEAT = {
  agent: 0.6,
  catalogue: 2.6,
  stores: [5.0, 6.6],
  oneStore: 5.4,
  paypal: 8.4,
  engine: 9.8,
  outcome: 11.0,
};
const CHAPTERS = [0, 13.2, 26.8];
const TITLE_FOR = 1.9;
const END = 28;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

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

type Node = {
  edges: THREE.LineBasicMaterial;
  lit: number;
  color: THREE.Color;
  at: THREE.Vector3;
  lane: SceneLane["kind"] | null;
};
type Way = { p: THREE.Vector3; t: number };
type Tracked = {
  el: HTMLElement;
  at: THREE.Vector3;
  show: number | undefined;
  lane: SceneLane["kind"] | null;
};

/** How much a lane is in the frame at time t: the other lane fades while one is playing. */
function focusOf(kind: SceneLane["kind"], t: number): number {
  if (t >= (CHAPTERS[2] as number)) return 1;
  if (t >= (CHAPTERS[1] as number)) return kind === "test" ? 1 : 0.28;
  return kind === "held" ? 1 : 0.1;
}

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
  const titleEl = host.querySelector<HTMLElement>(".sc-title");
  const captionEl = host.querySelector<HTMLElement>(".sc-caption");
  const compareEl = host.querySelector<HTMLElement>(".sc-compare");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 2, 0.1, 400);
  const glow = glowTexture();

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
  const tracked: Tracked[] = [];
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string,
    );

  function label(
    html: string,
    at: THREE.Vector3,
    cls: string,
    lane: SceneLane["kind"] | null,
    show?: number,
  ) {
    const el = document.createElement("div");
    el.className = `sl ${cls}`;
    el.innerHTML = `<div class="sl-in">${html}</div>`;
    labels.append(el);
    tracked.push({ el, at, show, lane });
  }

  function slab(
    x: number,
    z: number,
    w: number,
    d: number,
    color: THREE.Color,
    lane: SceneLane["kind"] | null,
  ): Node {
    const geo = new THREE.BoxGeometry(w, 0.2, d);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.slab }));
    mesh.position.set(x, 0, z);
    const edges = new THREE.LineBasicMaterial({ color: C.idle.clone(), transparent: true });
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edges);
    line.position.copy(mesh.position);
    scene.add(mesh, line);
    const n = { edges, lit: 0, color, at: new THREE.Vector3(x, 0, z), lane };
    nodes.push(n);
    return n;
  }

  const heads: [number, string][] = [
    [COL.agent, "Agent"],
    [COL.catalogue, "Catalogue"],
    [COL.read, "Offer read"],
    [COL.paid, "Seller paid"],
    [COL.paypal, "PayPal"],
    [COL.engine, "CITED engine"],
    [COL.outcome, "Creator"],
  ];
  for (const [x, t] of heads) label(t, new THREE.Vector3(x, 0, -6.3), "sl-head", null);

  const engine = slab(COL.engine, 0, 2.6, 2.6, C.test, null);
  label("join · hold · void", new THREE.Vector3(COL.engine, 0, 1.7), "sl-node", null);
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
    start: number;
    way: Way[];
    token: THREE.Mesh;
    halo: THREE.Sprite;
    trail: THREE.Line;
    trailPts: number;
    trailT: number[];
    lights: { node: Node; t: number }[];
    outcome: Node;
    beats: { t: number; text: string }[];
  };
  const runs: Run[] = [];

  for (const lane of data.lanes) {
    const z = LANE_Z[lane.kind];
    const k = lane.kind;
    const s0 = START[k];
    const color = k === "test" ? C.test : C.held;
    const agent = slab(COL.agent, z, 2.6, 1.5, color, k);
    label(`<b>${esc(lane.title)}</b>`, new THREE.Vector3(COL.agent, 0, z + 0.95), "sl-node", k);
    const cat = slab(COL.catalogue, z, 2.6, 1.5, color, k);
    label(esc(lane.catalogue), new THREE.Vector3(COL.catalogue, 0, z + 0.95), "sl-node", k);
    label(
      k === "test"
        ? "<span class='sl-k'>Review shown</span>Winix wins"
        : "<span class='sl-k'>Review withheld</span>offers only",
      new THREE.Vector3(COL.catalogue, 0.4, z - 0.85),
      `sl-call sl-${k}`,
      k,
      s0 + BEAT.catalogue,
    );

    const way: Way[] = [
      { p: new THREE.Vector3(COL.agent, 0.35, z), t: s0 + BEAT.agent },
      { p: new THREE.Vector3(COL.catalogue, 0.35, z), t: s0 + BEAT.catalogue },
    ];
    const lights = [
      { node: agent, t: s0 + BEAT.agent },
      { node: cat, t: s0 + BEAT.catalogue },
    ];
    const storeT = lane.stores.length > 1 ? BEAT.stores : [BEAT.oneStore];
    lane.stores.forEach((s, i) => {
      const x = lane.stores.length > 1 ? (i === 0 ? COL.read : COL.paid) : COL.paid;
      const at = s0 + (storeT[i] as number);
      const n = slab(x, z, 2.6, 1.5, color, k);
      label(
        `<b>${esc(s.name)}</b><span>${esc(s.note)}</span>`,
        new THREE.Vector3(x, 0, z + 0.95),
        "sl-node",
        k,
      );
      way.push({ p: new THREE.Vector3(x, 0.35, z), t: at });
      lights.push({ node: n, t: at });
    });
    if (lane.stores.length > 1) {
      label(
        "<span class='sl-k'>Cheaper here</span>pays this seller",
        new THREE.Vector3(COL.paid, 0.4, z - 0.85),
        `sl-call sl-${k}`,
        k,
        s0 + (BEAT.stores[1] as number),
      );
    }
    const pp = slab(COL.paypal, z, 2.6, 1.5, color, k);
    label(
      `<b>Checkout</b><span>${esc(lane.paypal)}</span>`,
      new THREE.Vector3(COL.paypal, 0, z + 0.95),
      "sl-node",
      k,
    );
    label(
      `<span class='sl-k'>custom_id</span>passport · ${k === "test" ? "shown" : "held out"}`,
      new THREE.Vector3(COL.paypal, 0.4, z - 0.85),
      `sl-call sl-${k}`,
      k,
      s0 + BEAT.paypal,
    );
    way.push({ p: new THREE.Vector3(COL.paypal, 0.35, z), t: s0 + BEAT.paypal });
    lights.push({ node: pp, t: s0 + BEAT.paypal });
    way.push({ p: new THREE.Vector3(COL.engine - 0.6, 0.35, z * 0.25), t: s0 + BEAT.engine });
    lights.push({ node: engine, t: s0 + BEAT.engine });

    const outcome = slab(COL.outcome, z, 2.8, 1.5, lane.credited ? color : C.dim, k);
    label(
      `<b>${esc(lane.outcome)}</b><span>${esc(lane.outcomeSub)}</span>`,
      new THREE.Vector3(COL.outcome, 0, z + 0.95),
      `sl-node sl-out ${lane.credited ? "sl-paid" : "sl-zero"}`,
      k,
      s0 + BEAT.outcome,
    );
    way.push({ p: new THREE.Vector3(COL.outcome, 0.35, z), t: s0 + BEAT.outcome });
    lights.push({ node: outcome, t: s0 + BEAT.outcome });

    // Narration: one line per stop; the last one (the verdict) lands with the engine.
    const stops = [s0 + BEAT.agent, s0 + BEAT.catalogue, ...storeT.map((x) => s0 + x)];
    stops.push(s0 + BEAT.paypal, s0 + BEAT.engine);
    const beats = lane.captions.slice(0, stops.length).map((text, i) => ({
      t: (stops[i] as number) - 0.5,
      text,
    }));

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

    const pts: THREE.Vector3[] = [];
    const ts: number[] = [];
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i] as Way;
      const b = way[i + 1] as Way;
      const mid = a.p.clone().lerp(b.p, 0.5);
      mid.y += Math.min(1.6, a.p.distanceTo(b.p) * 0.18);
      const curve = new THREE.QuadraticBezierCurve3(a.p, mid, b.p);
      const start = Math.max(a.t + 0.25, b.t - 1.2);
      const n = 40;
      for (let j = i === 0 ? 0 : 1; j <= n; j++) {
        pts.push(curve.getPoint(ease(j / n)));
        ts.push(start + (b.t - start) * (j / n));
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
      start: s0,
      way,
      token,
      halo,
      trail,
      trailPts: pts.length,
      trailT: ts,
      lights,
      outcome,
      beats,
    });
  }

  const coinTex = glyphTexture("$", "#5fd9a0");
  const coins = Array.from({ length: 40 }, () => {
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
  const narration = runs.flatMap((r) => r.beats).sort((a, b) => a.t - b.t);

  function tokenAt(r: Run, t: number): THREE.Vector3 {
    const w = r.way;
    if (t <= (w[0] as Way).t) return (w[0] as Way).p.clone();
    for (let i = 0; i < w.length - 1; i++) {
      const a = w[i] as Way;
      const b = w[i + 1] as Way;
      const start = Math.max(a.t + 0.25, b.t - 1.2);
      if (t < b.t) {
        const k = ease(clamp01((t - start) / (b.t - start)));
        const mid = a.p.clone().lerp(b.p, 0.5);
        mid.y += Math.min(1.6, a.p.distanceTo(b.p) * 0.18);
        return new THREE.QuadraticBezierCurve3(a.p, mid, b.p).getPoint(k);
      }
    }
    return (w[w.length - 1] as Way).p.clone();
  }

  // Controls under the scene: the three chapters, play/pause, replay.
  const chapterEls = [...document.querySelectorAll<HTMLButtonElement>(".scene-ch")];
  const playEl = document.querySelector<HTMLButtonElement>(".scene-play");
  const replayEl = document.querySelector<HTMLButtonElement>(".scene-replay");
  let t = still ? END : 0;
  let playing = !still;
  let last = performance.now();
  const setPlaying = (p: boolean) => {
    playing = p;
    if (playEl) {
      playEl.textContent = p ? "Pause" : "Play";
      playEl.setAttribute("aria-pressed", String(!p));
    }
  };
  setPlaying(playing);
  chapterEls.forEach((b, i) => {
    b.addEventListener("click", () => {
      t = CHAPTERS[i] as number;
      setPlaying(true);
    });
  });
  playEl?.addEventListener("click", () => {
    if (t >= END) t = 0;
    setPlaying(!playing);
  });
  replayEl?.addEventListener("click", () => {
    t = 0;
    setPlaying(true);
  });

  const v = new THREE.Vector3();
  let follow = false;
  let dist = 39;
  let camX = CENTER_X;
  let camZ = 0.4;
  let zoom = 1;
  function place(x: number, z: number, zm: number) {
    const d = dist * zm;
    camera.position.set(x, d * 0.76, z + d * 0.65);
    camera.lookAt(x, 0, z);
  }
  function size() {
    const w = host?.clientWidth ?? 800;
    const h = host?.clientHeight ?? 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    follow = camera.aspect < 1.4;
    dist = follow ? 14 / (0.389 * camera.aspect) : 39 * Math.max(1, 2.5 / camera.aspect) ** 0.95;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(host);
  size();

  let shownCaption = "";
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      t += dt;
      if (t >= END) {
        t = END;
        setPlaying(false);
      }
    }
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    // Camera: frame the lane that is playing, then pull back for the comparison.
    const chapter = t >= (CHAPTERS[2] as number) ? 2 : t >= (CHAPTERS[1] as number) ? 1 : 0;
    const active = chapter === 0 ? "held" : "test";
    // Chapter 3 lifts both lanes into the top of the frame, clear of the comparison card.
    const wantZ = chapter === 2 ? 4.2 : LANE_Z[active] * 0.55;
    const wantZoom = chapter === 2 ? 1.12 : 0.84;
    let wantX = CENTER_X + (chapter === 2 && !still ? Math.sin(now / 6000) * 0.8 : 0);
    if (follow) {
      const r = runs.find((x) => x.lane.kind === active);
      const tx = chapter === 2 || !r ? COL.outcome - 3 : tokenAt(r, t).x;
      wantX = Math.min(COL.outcome - 3, Math.max(COL.agent + 3, tx));
    }
    const k = still ? 1 : 0.05;
    camX = lerp(camX, wantX, k);
    camZ = lerp(camZ, follow ? (chapter === 2 ? 3.6 : LANE_Z[active] * 0.8) : wantZ, k);
    zoom = lerp(zoom, follow ? 1 : wantZoom, k);
    place(camX, camZ, zoom);

    for (const r of runs) {
      const f = focusOf(r.lane.kind, t);
      const p = tokenAt(r, t);
      r.token.position.copy(p);
      r.halo.position.copy(p);
      const started = t >= r.start;
      const done = t >= (r.way[r.way.length - 1] as Way).t;
      const grey = done && !r.lane.credited;
      const tm = r.token.material as THREE.MeshBasicMaterial;
      tm.color.copy(grey ? C.dim : r.color);
      tm.opacity = started ? f : 0;
      (r.halo.material as THREE.SpriteMaterial).opacity = started
        ? (0.55 + Math.sin(now / 260) * 0.15) * (grey ? 0.3 : 1) * f
        : 0;
      (r.trail.material as THREE.LineBasicMaterial).opacity = 0.75 * f;
      let n = 0;
      while (n < r.trailPts && (r.trailT[n] as number) <= t) n++;
      r.trail.geometry.setDrawRange(0, n);
      for (const l of r.lights) if (l.node.lane) l.node.lit = t >= l.t ? 1 : 0;
    }
    engine.lit = runs.some((r) => t >= r.start + BEAT.engine) ? 1 : 0;
    for (const n of nodes) {
      const f = n.lane ? focusOf(n.lane, t) : 1;
      n.edges.color.copy(C.idle).lerp(n.color, n.lit);
      n.edges.opacity = 0.25 + 0.75 * f;
    }
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    ringMat.color.copy(C.idle).lerp(C.test, engine.lit);
    ring.rotation.z = now / 1800;
    const pulse = runs.map((r) => t - (r.start + BEAT.engine)).find((x) => x >= 0 && x < 0.8);
    ring.scale.setScalar(1 + (pulse !== undefined ? Math.sin((pulse / 0.8) * Math.PI) * 0.12 : 0));

    if (paidRun) {
      const dtb = t - (paidRun.start + BEAT.outcome);
      for (const c of coins) {
        const m = c.s.material as THREE.SpriteMaterial;
        if (dtb < 0 || dtb > 2.2 || still) {
          m.opacity = 0;
          continue;
        }
        c.s.position.set(
          paidRun.outcome.at.x + c.v.x * dtb * 0.6,
          0.4 + c.v.y * dtb - 2.6 * dtb * dtb,
          paidRun.outcome.at.z + c.v.z * dtb * 0.6,
        );
        m.opacity = clamp01(1 - dtb / 2.2);
      }
    }

    for (const l of tracked) {
      v.copy(l.at).project(camera);
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      // Callouts belong to their chapter; the comparison shows routes and results only.
      const call = l.el.classList.contains("sl-call");
      const visible = (l.show === undefined || t >= l.show) && !(call && chapter === 2);
      l.el.classList.toggle("on", visible);
      l.el.style.opacity = String((l.lane ? focusOf(l.lane, t) : 1) * (visible ? 1 : 0));
    }

    // Title cards open chapters 1 and 2; narration runs underneath; the comparison closes.
    if (titleEl) {
      const at = [0, 1].find((i) => {
        const s = CHAPTERS[i] as number;
        return t >= s && t < s + TITLE_FOR;
      });
      titleEl.classList.toggle("on", at !== undefined && !still);
      if (at !== undefined) {
        titleEl.innerHTML = `<span>${at + 1} / 3</span>${esc(data.chapters[at] ?? "")}`;
      }
    }
    if (captionEl) {
      const beat = chapter === 2 ? undefined : [...narration].reverse().find((b) => t >= b.t);
      const text = beat && t < (CHAPTERS[chapter + 1] as number) - 0.3 ? beat.text : "";
      if (text !== shownCaption) {
        shownCaption = text;
        captionEl.classList.remove("on");
        captionEl.textContent = text;
        void captionEl.offsetWidth;
        if (text) captionEl.classList.add("on");
      }
    }
    compareEl?.classList.toggle("on", t >= (CHAPTERS[2] as number) + 0.6);
    chapterEls.forEach((b, i) => {
      b.setAttribute("aria-current", i === chapter ? "step" : "false");
      const s = CHAPTERS[i] as number;
      const e = (CHAPTERS[i + 1] as number | undefined) ?? END;
      b.style.setProperty("--p", String(clamp01((t - s) / (e - s))));
    });

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
