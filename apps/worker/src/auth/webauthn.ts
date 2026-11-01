import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { allowedOrigins, type Env } from "../env";
import { fromB64url } from "../ids";

/** Minimal structural check before handing client JSON to the verifier. */
export const AssertionJSON = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().max(8192),
    authenticatorData: z.string().max(8192),
    signature: z.string().max(2048),
    userHandle: z.string().max(1024).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

function userStub(env: Env, userId: string) {
  return env.USER.get(env.USER.idFromName(userId));
}

/**
 * Verify an assertion made by `userId` over `expectedChallenge` (base64url) and advance
 * the credential counter. Returns false on any mismatch; never throws on bad input.
 */
export async function verifyAssertion(
  env: Env,
  userId: string,
  raw: unknown,
  expectedChallenge: string,
): Promise<boolean> {
  const parsed = AssertionJSON.safeParse(raw);
  if (!parsed.success) return false;
  const response = parsed.data as AuthenticationResponseJSON;
  const user = userStub(env, userId);
  const cred = await user.getCredential(response.id);
  if (!cred) return false;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: allowedOrigins(env),
      expectedRPID: env.RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports as never,
      },
      requireUserVerification: false,
    });
    if (!result.verified) return false;
    await user.bumpCounter(cred.id, result.authenticationInfo.newCounter);
    return true;
  } catch {
    return false;
  }
}

/** Request options bound to a server-issued challenge (step-up for an approval). */
export async function stepUpOptions(env: Env, userId: string, challenge: string) {
  const creds = await userStub(env, userId).listCredentials();
  return generateAuthenticationOptions({
    rpID: env.RP_ID,
    challenge: fromB64url(challenge),
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: "preferred",
  });
}
