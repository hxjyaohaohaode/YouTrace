import fs from 'fs';
import path from 'path';
import { FastifyPluginAsync } from 'fastify';
import prisma from '../utils/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  processUploadedFile,
  annotateWithMimo,
  getFileType,
  deleteFile,
  validateFileMagicBytes,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_MESSAGE,
  extractDocumentText,
} from '../services/fileService.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown',
};

const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(import('@fastify/multipart'), {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES_PER_MESSAGE,
    },
  });

  fastify.get('/api/files/:type/:filename', async (request, reply) => {
    const { type, filename } = request.params as { type: string; filename: string };
    const safeType = type === 'thumbnails' ? 'thumbnails' : type === 'originals' ? '' : '';
    if (type !== 'thumbnails' && type !== 'originals') {
      return reply.status(400).send({ success: false, message: '无效的文件类型' });
    }
    const safeName = path.basename(filename);
    const filePath = safeType === 'thumbnails'
      ? path.join(UPLOAD_DIR, 'thumbnails', safeName)
      : path.join(UPLOAD_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ success: false, message: '文件不存在' });
    }
    const ext = path.extname(safeName).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', stat.size);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(filePath));
  });

  fastify.get('/api/attachments/:id/download', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { inline?: string; token?: string };
    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: request.userId },
    });
    if (!attachment) {
      return reply.status(404).send({ success: false, message: '附件不存在' });
    }
    if (!fs.existsSync(attachment.filePath)) {
      return reply.status(404).send({ success: false, message: '文件已丢失' });
    }
    const ext = path.extname(attachment.filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const stat = fs.statSync(attachment.filePath);
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', stat.size);
    reply.header('Cache-Control', 'private, max-age=3600');
    if (query.inline === '1') {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
    } else {
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
    }
    return reply.send(fs.createReadStream(attachment.filePath));
  });

  fastify.post('/api/upload', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const parts = request.parts();
    const files: Array<{
      fieldname: string;
      filename: string;
      encoding: string;
      mimetype: string;
      buffer: Buffer;
    }> = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        console.log(`[upload] 收到文件: ${part.filename}, MIME: ${part.mimetype}, 大小: ${buffer.length}`);

        if (!ALLOWED_MIME_TYPES.includes(part.mimetype)) {
          console.log(`[upload] 拒绝: MIME类型不支持 ${part.mimetype}`);
          return reply.status(400).send({
            success: false,
            message: `不支持的文件类型: ${part.mimetype}。支持的类型: 图片、视频、音频、PDF、Word、Excel、文本`,
          });
        }

        if (buffer.length > MAX_FILE_SIZE) {
          console.log(`[upload] 拒绝: 文件过大 ${buffer.length}`);
          return reply.status(400).send({
            success: false,
            message: `文件过大: ${part.filename}，最大50MB`,
          });
        }

        const magicValid = validateFileMagicBytes(buffer, part.mimetype);
        if (!magicValid) {
          const hex = buffer.slice(0, 8).toString('hex');
          console.log(`[upload] 拒绝: magic bytes不匹配 ${part.filename} (${part.mimetype}), 前8字节: ${hex}`);
          return reply.status(400).send({
            success: false,
            message: `文件内容与声明类型不匹配: ${part.filename}。文件头: ${hex}`,
          });
        }

        files.push({
          fieldname: part.fieldname,
          filename: part.filename,
          encoding: part.encoding,
          mimetype: part.mimetype,
          buffer,
        });
      }
    }

    if (files.length === 0) {
      return reply.status(400).send({ success: false, message: '未上传任何文件' });
    }

    if (files.length > MAX_FILES_PER_MESSAGE) {
      return reply.status(400).send({
        success: false,
        message: `最多上传${MAX_FILES_PER_MESSAGE}个文件，当前${files.length}个`,
      });
    }

    const results = [];

    for (const file of files) {
      try {
        const processed = await processUploadedFile(
          file.buffer,
          file.filename,
          file.mimetype,
        );
        console.log(`[upload] 文件已保存: ${processed.filePath}`);

        const fileType = getFileType(file.mimetype);

        const attachment = await prisma.attachment.create({
          data: {
            userId: request.userId!,
            fileName: processed.fileName,
            originalName: processed.originalName,
            mimeType: processed.mimeType,
            fileSize: processed.fileSize,
            fileType,
            filePath: processed.filePath,
            thumbnailPath: processed.thumbnailPath,
            annotationStatus: 'processing',
          },
        });

        results.push({
          id: attachment.id,
          fileName: processed.fileName,
          originalName: processed.originalName,
          mimeType: processed.mimeType,
          fileSize: processed.fileSize,
          fileType,
          filePath: processed.filePath,
          thumbnailPath: processed.thumbnailPath,
          aiAnnotation: '',
          annotationStatus: 'processing',
        });

        annotateWithMimo(
          processed.filePath,
          fileType,
          processed.mimeType,
          processed.extractedText,
        ).then(async (annotation) => {
          console.log(`[upload] 标注完成: ${attachment.id} → ${annotation?.slice(0, 50) || '(空)'}`);
          await prisma.attachment.update({
            where: { id: attachment.id },
            data: {
              aiAnnotation: annotation,
              annotationStatus: 'completed',
            },
          });
        }).catch(async (err) => {
          console.error(`附件标注最终失败 ${attachment.id}:`, (err as Error).message);
          await prisma.attachment.update({
            where: { id: attachment.id },
            data: {
              aiAnnotation: processed.extractedText ? processed.extractedText.slice(0, 2000) : '[标注失败，可点击重试]',
              annotationStatus: 'failed',
            },
          });
        });
      } catch (e) {
        results.push({
          id: null,
          originalName: file.filename,
          error: `处理失败: ${(e as Error).message}`,
          annotationStatus: 'failed',
        });
      }
    }

    return reply.send({ success: true, data: results });
  });

  fastify.get('/api/attachments/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: request.userId },
    });

    if (!attachment) {
      return reply.status(404).send({ success: false, message: '附件不存在' });
    }

    return reply.send({ success: true, data: attachment });
  });

  fastify.post('/api/attachments/batch-status', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ success: false, message: '请提供附件ID列表' });
    }
    const attachments = await prisma.attachment.findMany({
      where: { id: { in: ids }, userId: request.userId },
      select: { id: true, annotationStatus: true, aiAnnotation: true, originalName: true, fileType: true, thumbnailPath: true, filePath: true, mimeType: true },
    });
    return reply.send({ success: true, data: attachments });
  });

  fastify.post('/api/attachments/:id/re-annotate', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: request.userId },
    });

    if (!attachment) {
      return reply.status(404).send({ success: false, message: '附件不存在' });
    }

    if (!fs.existsSync(attachment.filePath)) {
      return reply.status(400).send({ success: false, message: '文件已丢失，无法重新标注' });
    }

    await prisma.attachment.update({
      where: { id },
      data: { annotationStatus: 'processing', aiAnnotation: '' },
    });

    const fileType = getFileType(attachment.mimeType);
    let extractedText = '';
    if (fileType === 'document') {
      try {
        const text = await extractDocumentText(attachment.filePath, attachment.mimeType);
        if (text) extractedText = text;
      } catch {
        // text extraction failed, continue without it
      }
    }

    annotateWithMimo(
      attachment.filePath,
      fileType,
      attachment.mimeType,
      extractedText,
    ).then(async (annotation) => {
      await prisma.attachment.update({
        where: { id },
        data: { aiAnnotation: annotation, annotationStatus: 'completed' },
      });
    }).catch(async (err) => {
      console.error(`重新标注失败 ${id}:`, (err as Error).message);
      await prisma.attachment.update({
        where: { id },
        data: {
          aiAnnotation: extractedText ? extractedText.slice(0, 2000) : '[标注失败，可点击重试]',
          annotationStatus: 'failed',
        },
      });
    });

    return reply.send({ success: true, message: '已开始重新标注' });
  });

  fastify.delete('/api/attachments/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: request.userId },
    });

    if (!attachment) {
      return reply.status(404).send({ success: false, message: '附件不存在' });
    }

    deleteFile(attachment.filePath);
    if (attachment.thumbnailPath) deleteFile(attachment.thumbnailPath);

    await prisma.attachment.delete({ where: { id } });

    return reply.send({ success: true, message: '附件已删除' });
  });
};

export default uploadRoutes;
