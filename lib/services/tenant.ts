import { prisma } from "../db/prisma";
import { headers } from "next/headers";

export async function getTenantFromRequest(): Promise<string | null> {
  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  if (host === rootDomain || host === `www.${rootDomain}`) return null;

  const slug = host.replace(`.${rootDomain}`, "");
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });

  if (!tenant || tenant.status === "CANCELLED") return null;
  return tenant.id;
}
