import { prisma } from "./lib/db/prisma";
import { verifyPassword } from "./lib/auth/password";

const pw: Record<string, string> = {
  "coe@demo.edu": "Coe@12345",
  "hod@demo.edu": "Hod@12345",
  "faculty@demo.edu": "Faculty@123",
};

for (const email of Object.keys(pw)) {
  const u = await prisma.user.findFirst({
    where: { email },
    include: { userRoles: { include: { role: true } } },
  });
  if (!u) {
    console.log(email, "ABSENT");
    continue;
  }
  const ok = await verifyPassword(pw[email], u.passwordHash);
  console.log(
    email,
    "active=" + u.isActive,
    "verified=" + u.isVerified,
    "pwMatch=" + ok,
    "roles=" + u.userRoles.map((r) => r.role.name).join(",")
  );
}
await prisma.$disconnect();
