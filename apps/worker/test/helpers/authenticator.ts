/**
 * A software WebAuthn authenticator (ES256, attestation "none") so tests exercise the
 * real passkey verification paths instead of mocking @simplewebauthn/server.
 */
import { b64url, fromB64url } from "../../src/ids";

export const ORIGIN = "http://localhost:5173";
const enc = new TextEncoder();

export class VirtualAuthenticator {
  private counter = 0;

  private constructor(
    private keys: CryptoKeyPair,
    readonly credentialId: Uint8Array,
    private userHandle = "",
  ) {}

  static async create(): Promise<VirtualAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    return new VirtualAuthenticator(keys, crypto.getRandomValues(new Uint8Array(16)));
  }

  async register(options: { challenge: string; rp: { id?: string }; user: { id: string } }) {
    this.userHandle = options.user.id;
    const clientDataJSON = enc.encode(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin: ORIGIN,
        crossOrigin: false,
      }),
    );
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x as string)],
        [-3, fromB64url(jwk.y as string)],
      ]),
    );
    const idLen = new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    const authData = concat(
      await rpIdHash(options.rp.id ?? "localhost"),
      new Uint8Array([0x45]), // UP | UV | AT
      u32(this.counter),
      new Uint8Array(16), // aaguid
      idLen,
      this.credentialId,
      cose,
    );
    const attestationObject = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  async assert(challenge: string, opts: { rpId?: string; origin?: string } = {}) {
    this.counter++;
    const clientDataJSON = enc.encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: opts.origin ?? ORIGIN,
        crossOrigin: false,
      }),
    );
    const authData = concat(
      await rpIdHash(opts.rpId ?? "localhost"),
      new Uint8Array([0x05]),
      u32(this.counter),
    );
    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keys.privateKey,
        concat(authData, clientHash),
      ),
    );
    const id = b64url(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(derSignature(raw)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}

async function rpIdHash(rpId: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(rpId)));
}

function u32(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** WebCrypto returns raw r||s; WebAuthn wants an ASN.1 DER ECDSA-Sig-Value. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if ((v[0] as number) & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

/** Just enough CBOR for attestation objects and COSE keys. */
function cbor(value: unknown): Uint8Array {
  const head = (major: number, n: number): Uint8Array => {
    if (n < 24) return new Uint8Array([(major << 5) | n]);
    if (n < 256) return new Uint8Array([(major << 5) | 24, n]);
    return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const b = enc.encode(value);
    return concat(head(3, b.length), b);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (value instanceof Map) {
    const parts: Uint8Array[] = [head(5, value.size)];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return concat(...parts);
  }
  throw new Error("unsupported cbor value");
}
