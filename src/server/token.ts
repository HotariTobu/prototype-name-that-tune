import { SignJWT, importPKCS8 } from "jose";

const teamId = process.env.APPLE_TEAM_ID ?? "";
const keyId = process.env.APPLE_KEY_ID ?? "";
const privateKey = (process.env.APPLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

export function hasCredentials(): boolean {
  return !!(teamId && keyId && privateKey);
}

export async function generateToken(
  expiresIn: number
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresIn;

  const key = await importPKCS8(privateKey, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  return { token, expiresAt: new Date(exp * 1000) };
}
