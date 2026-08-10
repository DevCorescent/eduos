import { prisma } from "./lib/db/prisma";
console.log("w3b tenants:", (await prisma.tenant.findMany({ where: { slug: { startsWith: "w3b-" } }, select: { slug: true } })).map(t => t.slug).join(", ") || "(none)");
console.log("stray w3b users:", await prisma.user.count({ where: { email: { endsWith: "@w3b.test" } } }));
console.log("applications:", await prisma.application.count());
console.log("tenants:", (await prisma.tenant.findMany({ select: { slug: true }, orderBy: { slug: "asc" } })).map(t => t.slug).join(", "));
