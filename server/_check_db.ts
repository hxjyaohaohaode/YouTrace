import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const r = await p.attachment.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
console.log(JSON.stringify(r.map(a => ({
  id: a.id, name: a.originalName, mime: a.mimeType,
  type: a.fileType, status: a.annotationStatus, fp: a.filePath?.slice(-40)
})), null, 2));
await p.$disconnect();
