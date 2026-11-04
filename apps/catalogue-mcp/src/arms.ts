import { type Arm, armProbabilities, type HoldoutSchedule } from "@pact/protocol";

/** cyrb53: small, fast, well-mixed 53-bit string hash. Not cryptographic; only for seeded bucketing. */
function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Uniform value in [0, 1), a pure function of seed and session. */
export function unit(seed: string, sessionId: string): number {
  return hash53(`${seed}:${sessionId}`) / 2 ** 53;
}

const ORDER: Arm[] = ["test", "placebo", "none"];

/** Reproducible: the same seed, session and day always give the same arm. */
export function assignArm(
  seed: string,
  sessionId: string,
  day: number,
  schedule: HoldoutSchedule,
): Arm {
  const p = armProbabilities(day, schedule);
  const u = unit(seed, sessionId);
  let acc = 0;
  for (const arm of ORDER) {
    acc += p[arm];
    if (u < acc) return arm;
  }
  return "none";
}
