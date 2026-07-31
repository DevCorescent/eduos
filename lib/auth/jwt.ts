import jwt from "jsonwebtoken";

/**
 * Signing secret.
 *
 * Read through a function rather than captured at module scope with a `!`
 * assertion. With the assertion, an unset JWT_SECRET produced `undefined`, and
 * jwt.sign() then threw "secretOrPrivateKey must have a value" from inside the
 * login handler — surfacing to the caller as a generic 500 with no indication
 * that the environment was misconfigured. Failing here names the cause.
 */
function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Add it to .env before starting the server.");
  }
  return secret;
}

const EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: EXPIRES_IN } as jwt.SignOptions);
}

export function signRefreshToken(payload: Pick<JwtPayload, "sub">): string {
  return jwt.sign(payload, getSecret(), { expiresIn: REFRESH_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}
