import { SignJWT, jwtVerify } from "jose";
import type { Store } from "./store";
export function createAuth(secret: string, store: Store) {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32)
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  return {
    sign(inboxId: string) {
      return new SignJWT({})
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer("slop-or-not")
        .setAudience("slop-or-not")
        .setSubject(inboxId)
        .sign(key);
    },
    async authenticate(request: Request) {
      const header = request.headers.get("authorization");
      if (!header?.startsWith("Bearer ")) return null;
      try {
        const { payload } = await jwtVerify(header.slice(7), key, {
          algorithms: ["HS256"],
          issuer: "slop-or-not",
          audience: "slop-or-not",
          typ: "JWT",
          requiredClaims: ["sub", "iss", "aud"],
        });
        return payload.sub && store.hasInbox(payload.sub) ? payload.sub : null;
      } catch {
        return null;
      }
    },
  };
}
