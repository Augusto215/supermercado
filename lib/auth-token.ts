/**
 * Deterministic session token using Web Crypto HMAC-SHA256.
 * Works in Node.js (API routes) and Edge (middleware).
 *
 * Token = HMAC-SHA256(email, key = password)
 * No session store needed — changing the password invalidates all sessions.
 */

export const SESSION_COOKIE = "rhid_auth";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateToken(email: string, password: string): Promise<string> {
  return hmacHex(email, password);
}

export async function validateToken(token: string, email: string, password: string): Promise<boolean> {
  const expected = await hmacHex(email, password);
  // Constant-time comparison
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
