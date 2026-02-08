import { SignJWT, importPKCS8 } from "jose";

export interface AppleCredentials {
  teamId: string;
  keyId: string;
  privateKey: string;
}

let storedCredentials: AppleCredentials | null = null;

export function setCredentials(credentials: AppleCredentials): void {
  storedCredentials = credentials;
}

export function hasCredentials(): boolean {
  return storedCredentials !== null;
}

export function getCredentials(): AppleCredentials | null {
  return storedCredentials;
}

export async function generateToken(
  credentials: AppleCredentials,
  expiresIn: number
): Promise<{ token: string; expiresAt: Date }> {
  const { teamId, keyId, privateKey } = credentials;
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
