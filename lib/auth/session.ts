import { cookies } from "next/headers";
import { verifyToken, type JwtPayload } from "./jwt";

const ACCESS_COOKIE = "edu_access";
const REFRESH_COOKIE = "edu_refresh";

export async function getSession(): Promise<JwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<JwtPayload> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
