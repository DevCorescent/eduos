import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail } from "@/types";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(fail("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      tenantId: true,
      userRoles: { include: { role: true } },
    },
  });

  if (!user) {
    return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
  }

  return NextResponse.json(
    ok({
      ...user,
      roles: user.userRoles.map((ur) => ur.role.name),
      userRoles: undefined,
    })
  );
}
