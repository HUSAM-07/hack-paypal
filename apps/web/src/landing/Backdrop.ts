/**
 * The fixed scene behind the chapter titles: a WebGL2 quad that cover-fits the
 * current chapter's photo, adds moving film grain and sparkle, and dissolves between
 * scenes through a blocky noise threshold. Raw WebGL keeps it a few KB; it renders at
 * reduced resolution (the grain hides it) and stops drawing whenever nothing is visible.
 */
const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D a; uniform sampler2D b;
uniform float mixv; uniform float t; uniform float scroll;
uniform vec2 res; uniform vec2 ia; uniform vec2 ib;
float h(vec2 q) { return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 q) {
  vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
vec2 cover(vec2 u, vec2 img) {
  float r = (res.x / res.y) / (img.x / img.y);
  vec2 s = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
  float z = 1.06 + scroll * 0.04;
  vec2 drift = vec2(sin(t * 0.05) * 0.01, scroll * 0.02 + cos(t * 0.04) * 0.008);
  return (u - 0.5) * s / z + 0.5 + drift;
}
void main() {
  vec2 px = uv * res;
  vec3 ca = texture(a, vec2(cover(uv, ia).x, 1.0 - cover(uv, ia).y)).rgb;
  vec3 cb = texture(b, vec2(cover(uv, ib).x, 1.0 - cover(uv, ib).y)).rgb;
  // Blocky dissolve: coarse noise cells flip from scene a to b as mixv rises.
  float cell = n(floor(px / 6.0) * 0.37 + t * 0.15);
  float k = smoothstep(cell - 0.08, cell + 0.08, mixv * 1.16 - 0.08);
  vec3 c = mix(ca, cb, k);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float g = h(px + fract(t * 37.0) * 91.0) - 0.5;
  c += g * (0.18 + 0.12 * (1.0 - lum));
  // Sparse bright speckles in the highlights read as drifting particles.
  float sp = step(0.985, h(floor(px / 2.0) + floor(t * 12.0)));
  c += sp * lum * 0.35;
  float v = smoothstep(1.25, 0.35, length(uv - vec2(0.5, 0.45)));
  // Darkened and slightly contrasted so white type stays readable on bright scenes.
  c = (c - 0.5) * 1.08 + 0.46;
  o = vec4(c * mix(0.32, 0.74, v), 1.0);
}`;

export interface BackdropHandle {
  /** Scene index to show; changes dissolve over ~1.2s. */
  setScene(i: number): void;
  /** Pause drawing when no transparent section is on screen. */
  setVisible(v: boolean): void;
}

export function startBackdrop(canvas: HTMLCanvasElement, urls: string[]): BackdropHandle | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  gl.uniform1i(u("a"), 0);
  gl.uniform1i(u("b"), 1);

  const textures: (WebGLTexture | null)[] = urls.map(() => null);
  const sizes: [number, number][] = urls.map(() => [16, 9]);
  const loading = new Set<number>();
  const load = (i: number, then?: () => void) => {
    if (textures[i] || loading.has(i)) return then?.();
    loading.add(i);
    const img = new Image();
    img.decoding = "async";
    img.src = urls[i] as string;
    img
      .decode()
      .then(() => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        textures[i] = tex;
        sizes[i] = [img.naturalWidth, img.naturalHeight];
        then?.();
      })
      .catch(() => loading.delete(i));
  };

  let from = 0;
  let to = 0;
  let mixStart = 0;
  let visible = true;
  let raf = 0;
  const start = performance.now();

  const resize = () => {
    // Half resolution, capped: the grain makes upscaling invisible and halves fill cost.
    const scale = Math.min(window.devicePixelRatio, 1.5) * 0.5;
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const frame = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const ta = textures[from];
    const tb = textures[to] ?? ta;
    if (ta && tb) {
      const m = Math.min(1, (now - mixStart) / 1200);
      if (m === 1 && from !== to && textures[to]) from = to;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ta);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tb);
      gl.uniform1f(u("mixv"), from === to ? 0 : m);
      gl.uniform1f(u("t"), (now - start) / 1000);
      gl.uniform1f(u("scroll"), Math.min(1, window.scrollY / (document.body.scrollHeight || 1)));
      gl.uniform2f(u("res"), canvas.width, canvas.height);
      gl.uniform2f(u("ia"), ...(sizes[from] as [number, number]));
      gl.uniform2f(u("ib"), ...(sizes[to] as [number, number]));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.dataset.ready = "";
    }
    raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  document.addEventListener("visibilitychange", kick);

  load(0, kick);
  // Warm the remaining scenes once the page is idle.
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => urls.forEach((_, i) => void load(i)));

  return {
    setScene(i) {
      if (i === to) return;
      load(i);
      if (from !== to) from = to;
      to = i;
      mixStart = performance.now();
      kick();
    },
    setVisible(v) {
      visible = v;
      kick();
    },
  };
}
