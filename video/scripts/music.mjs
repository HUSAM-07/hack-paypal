/**
 * Synthesises the film's background music (original, no samples): a warm pad on a four-chord
 * loop, a plucked arpeggio, a sub bass and light percussion, 100 BPM, as long as the film.
 * Writes a 16-bit stereo WAV; encode it with ffmpeg (see README).
 *
 *   node video/scripts/music.mjs video/assets/music.wav 67
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "music.wav";
const seconds = Number(process.argv[3] ?? 67);
const SR = 44100;
const N = Math.round(seconds * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Cmaj9 · Am9 · Fmaj7(9) · G6: bright, calm, unresolved enough to loop.
const CHORDS = [
  { root: 36, pad: [55, 59, 62, 64, 67], arp: [72, 76, 79, 83, 86, 83, 79, 76] },
  { root: 33, pad: [52, 55, 60, 64, 67], arp: [69, 72, 76, 79, 83, 79, 76, 72] },
  { root: 29, pad: [53, 57, 60, 64, 67], arp: [69, 72, 77, 79, 84, 79, 77, 72] },
  { root: 31, pad: [55, 59, 62, 64, 69], arp: [71, 74, 79, 81, 86, 81, 79, 74] },
];

// Deterministic noise (no Math.random) for the shaker.
let seed = 1234567;
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x3fffffff - 1;
};

const add = (buf, i, v) => {
  if (i >= 0 && i < N) buf[i] += v;
};

const bars = Math.ceil(seconds / BAR) + 1;
for (let b = 0; b < bars; b++) {
  const chord = CHORDS[b % CHORDS.length];
  const t0 = b * BAR;
  const s0 = Math.round(t0 * SR);

  // Pad: two slightly detuned sines per note, slow attack, overlapping release.
  const padLen = Math.round((BAR + 1.2) * SR);
  chord.pad.forEach((m, k) => {
    const f = hz(m);
    const pan = (k / (chord.pad.length - 1)) * 0.6 - 0.3;
    for (let i = 0; i < padLen; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.6) * (t > BAR ? Math.max(0, 1 - (t - BAR) / 1.2) : 1);
      const v =
        0.028 *
        env *
        (Math.sin(2 * Math.PI * f * 0.998 * t) + Math.sin(2 * Math.PI * f * 1.002 * t + k) +
          0.25 * Math.sin(2 * Math.PI * f * 2 * t));
      add(L, s0 + i, v * (1 - pan));
      add(R, s0 + i, v * (1 + pan));
    }
  });

  // Sub bass: root on beats 1 and 3, round and short.
  for (const beat of [0, 2]) {
    const st = s0 + Math.round(beat * BEAT * SR);
    const f = hz(chord.root);
    for (let i = 0; i < Math.round(1.1 * SR); i++) {
      const t = i / SR;
      const v = 0.16 * Math.min(1, t / 0.01) * Math.exp(-t * 2.6) * Math.sin(2 * Math.PI * f * t);
      add(L, st + i, v);
      add(R, st + i, v);
    }
  }

  // Plucked arpeggio in eighths, from bar 2; ping-pong across the stereo field.
  if (b >= 1) {
    chord.arp.forEach((m, k) => {
      const st = s0 + Math.round(k * (BEAT / 2) * SR);
      const f = hz(m);
      const pan = k % 2 ? 0.35 : -0.35;
      for (let i = 0; i < Math.round(0.9 * SR); i++) {
        const t = i / SR;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 7);
        const v = 0.05 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 12));
        add(L, st + i, v * (1 - pan));
        add(R, st + i, v * (1 + pan));
        // A quiet dotted-eighth echo.
        const e = st + i + Math.round(BEAT * 0.75 * SR);
        add(L, e, v * 0.3 * (1 + pan));
        add(R, e, v * 0.3 * (1 - pan));
      }
    });
  }

  // Soft kick on every beat and a shaker on the offbeats, from bar 4.
  if (b >= 3) {
    for (let beat = 0; beat < 4; beat++) {
      const st = s0 + Math.round(beat * BEAT * SR);
      let ph = 0;
      for (let i = 0; i < Math.round(0.25 * SR); i++) {
        const t = i / SR;
        ph += (2 * Math.PI * (50 + 70 * Math.exp(-t * 30))) / SR;
        const v = 0.22 * Math.exp(-t * 14) * Math.sin(ph);
        add(L, st + i, v);
        add(R, st + i, v);
      }
      const sh = st + Math.round((BEAT / 2) * SR);
      for (let i = 0; i < Math.round(0.08 * SR); i++) {
        const t = i / SR;
        const v = 0.025 * Math.exp(-t * 60) * noise();
        add(L, sh + i, v * 0.8);
        add(R, sh + i, v * 1.2);
      }
    }
  }
}

// Gentle low-pass on the whole mix, fades, normalise to -1 dBFS.
let pl = 0;
let pr = 0;
const a = 0.35;
let peak = 0;
for (let i = 0; i < N; i++) {
  pl += a * (L[i] - pl);
  pr += a * (R[i] - pr);
  const t = i / SR;
  const fade = Math.min(1, t / 1.5) * Math.min(1, (seconds - t) / 3);
  L[i] = pl * fade;
  R[i] = pr * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2);
}
const head = Buffer.alloc(44);
head.write("RIFF", 0);
head.writeUInt32LE(36 + data.length, 4);
head.write("WAVEfmt ", 8);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 4, 28);
head.writeUInt16LE(4, 32);
head.writeUInt16LE(16, 34);
head.write("data", 36);
head.writeUInt32LE(data.length, 40);
writeFileSync(out, Buffer.concat([head, data]));
console.log(`wrote ${out} (${seconds}s)`);
