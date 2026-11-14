import { createHmac, timingSafeEqual } from "node:crypto";

/** Computes the `x-hub-signature-256` value GitHub sends with webhooks. */
export function signPayload(secret: string, payload: string): string {
  const digest = createHmac("sha256", secret).update(payload, "utf8").digest("hex");

  return `sha256=${digest}`;
}

export function verifySignature(
  secret: string,
  payload: string,
  signature: string | undefined
): boolean {
  if (!signature) {
    return false;
  }

  const expected = Buffer.from(signPayload(secret, payload), "utf8");
  const received = Buffer.from(signature, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
