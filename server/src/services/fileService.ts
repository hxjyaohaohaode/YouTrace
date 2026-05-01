import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfParseNs from 'pdf-parse';

interface PdfParseResult {
  text: string;
  numpages?: number;
  info?: Record<string, unknown>;
}

type PdfParseFn = (buffer: Buffer) => Promise<PdfParseResult>;

interface PdfParseModule extends PdfParseFn {
  default?: PdfParseModule;
}

const pdfParseNsUnknown = pdfParseNs as unknown;
const pdfParseLib: PdfParseFn = (pdfParseNsUnknown as PdfParseModule).default
  ? (pdfParseNsUnknown as PdfParseModule).default!
  : (pdfParseNsUnknown as PdfParseFn);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(THUMBNAIL_DIR)) fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

type FileType = 'image' | 'video' | 'audio' | 'document';

interface ProcessedFile {
  fileName: string;
  originalName: string;
  filePath: string;
  thumbnailPath: string | null;
  mimeType: string;
  fileSize: number;
  fileType: FileType;
  extractedText: string;
}

export function getFileType(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function generateFileName(originalName: string): string {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  return `${hash}${ext}`;
}

async function saveFile(buffer: Buffer, fileName: string): Promise<string> {
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function extractTextFromDocument(
  filePath: string,
  mimeType: string,
  originalName: string,
): Promise<string> {
  try {
    const ext = path.extname(originalName).toLowerCase();

    if (ext === '.docx' || ext === '.doc' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }

    if (ext === '.xlsx' || ext === '.xls' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const workbook = XLSX.readFile(filePath);
      const texts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        texts.push(`[Sheet: ${sheetName}]\n${csv}`);
      }
      return texts.join('\n\n');
    }

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParseLib(dataBuffer);
      return data.text || '';
    }

    if (ext === '.txt' || ext === '.md' || ext === '.csv' || mimeType.startsWith('text/')) {
      return fs.readFileSync(filePath, 'utf-8');
    }

    if (ext === '.pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return '[PowerPoint文件 - 内容需通过多模态模型识别]';
    }

    return `[不支持的文档格式: ${ext}]`;
  } catch (e) {
    return `[文档解析失败: ${(e as Error).message}]`;
  }
}

export async function processUploadedFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<ProcessedFile> {
  const fileType = getFileType(mimeType);
  const fileName = generateFileName(originalName);
  const filePath = await saveFile(buffer, fileName);

  let extractedText = '';
  let thumbnailPath: string | null = null;

  if (fileType === 'document') {
    extractedText = await extractTextFromDocument(filePath, mimeType, originalName);
  }

  if (fileType === 'image') {
    try {
      const sharp = (await import('sharp')).default;
      const thumbName = `thumb_${fileName}.webp`;
      const thumbPath = path.join(THUMBNAIL_DIR, thumbName);
      await sharp(buffer)
        .resize(200, 200, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(thumbPath);
      thumbnailPath = thumbPath;
    } catch {
      // sharp not available, skip thumbnail
    }
  }

  return {
    fileName,
    originalName,
    filePath,
    thumbnailPath,
    mimeType,
    fileSize: buffer.length,
    fileType,
    extractedText,
  };
}

export async function annotateWithMimo(
  filePath: string,
  fileType: FileType,
  mimeType: string,
  extractedText: string,
  retries = 4,
): Promise<string> {
  const apiKey = process.env.MIMO_API_KEY;
  const baseUrl = process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';

  if (!apiKey) {
    if (extractedText) return extractedText.slice(0, 2000);
    return '[无API密钥，无法标注]';
  }

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (fileType === 'document' && extractedText) {
        const prompt = `请对以下文档内容进行详细摘要和关键信息提取。要求：
1. 提取文档的核心主题和要点
2. 列出所有关键数据、数字、日期
3. 如果是表格数据，保留关键行列信息
4. 如果是课表/日程，提取所有时间安排
5. 保留重要细节，不要过度压缩

用中文回复，详细且结构化：

${extractedText.slice(0, 8000)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'mimo-v2.5',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 1024,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (response.ok) {
            const data = await response.json() as { choices: { message: { content: string } }[] };
            return data.choices?.[0]?.message?.content || extractedText.slice(0, 2000);
          }
          if (attempt < retries) {
            console.warn(`文档标注第${attempt}次失败 (${response.status}), ${retries - attempt}次重试剩余`);
            await delay(2000 * attempt);
            continue;
          }
          return extractedText.slice(0, 2000);
        } catch (fetchErr) {
          clearTimeout(timeout);
          if ((fetchErr as Error).name === 'AbortError' && attempt < retries) {
            console.warn(`文档标注第${attempt}次超时, ${retries - attempt}次重试剩余`);
            await delay(2000 * attempt);
            continue;
          }
          throw fetchErr;
        }
      }

      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

      const contentParts: ChatContentPart[] = [];

      if (fileType === 'image') {
        let finalBase64 = base64Data;
        let finalMime = mimeType;
        try {
          const sharp = (await import('sharp')).default;
          const stats = fs.statSync(filePath);
          if (stats.size > 1024 * 1024) {
            const resized = await sharp(fileBuffer)
              .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();
            finalBase64 = resized.toString('base64');
            finalMime = 'image/jpeg';
          }
        } catch {
          // sharp not available, use original
        }

        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${finalMime};base64,${finalBase64}` },
        });
        contentParts.push({
          type: 'text',
          text: '请非常详细地描述这张图片的所有内容，包括：1.场景和环境 2.人物及其动作/表情 3.所有可见文字（逐字抄录） 4.数据/图表/表格的具体数值 5.颜色和布局 6.如果是课表/日程表，请提取所有课程信息（课程名、时间、地点、教师） 7.如果是文档截图，请完整抄录文字内容。用中文回复，尽可能详尽。',
        });
      } else if (fileType === 'video') {
        contentParts.push({
          type: 'text',
          text: `[视频文件 - 大小${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB] 请描述这个视频可能包含的内容。注意：当前API可能不支持直接视频输入。`,
        });
      } else if (fileType === 'audio') {
        contentParts.push({
          type: 'text',
          text: `[音频文件 - 大小${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB] 请描述这个音频可能包含的内容。注意：当前API可能不支持直接音频输入。`,
        });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'mimo-v2.5',
            messages: [{ role: 'user', content: contentParts }],
            max_tokens: 1024,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json() as { choices: { message: { content: string } }[] };
          const result = data.choices?.[0]?.message?.content;
          if (result) return result;
          if (attempt < retries) {
            await delay(2000 * attempt);
            continue;
          }
          return '[标注失败]';
        }

        if (attempt < retries) {
          const errorBody = await response.text().catch(() => '');
          console.warn(`图片标注第${attempt}次失败 (${response.status}), ${retries - attempt}次重试剩余: ${errorBody.slice(0, 200)}`);
          await delay(2000 * attempt);
          continue;
        }

        const errorBody = await response.text().catch(() => '');
        return `[标注请求失败: ${response.status} ${errorBody.slice(0, 200)}]`;
      } catch (fetchErr) {
        clearTimeout(timeout);
        if ((fetchErr as Error).name === 'AbortError' && attempt < retries) {
          console.warn(`图片标注第${attempt}次超时, ${retries - attempt}次重试剩余`);
          await delay(2000 * attempt);
          continue;
        }
        throw fetchErr;
      }
    } catch (e) {
      if (attempt < retries) {
        console.warn(`标注第${attempt}次异常: ${(e as Error).message}, ${retries - attempt}次重试剩余`);
        await delay(2000 * attempt);
        continue;
      }
      if (extractedText) return extractedText.slice(0, 2000);
      return `[标注异常: ${(e as Error).message}]`;
    }
  }

  if (extractedText) return extractedText.slice(0, 2000);
  return '[标注失败]';
}

export function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'text/plain', 'text/csv', 'text/markdown',
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 9;

const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }[]> = {
  'image/jpeg': [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png': [{ bytes: [0x89, 0x50, 0x4E, 0x47] }],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46] }],
  'image/webp': [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
  'image/bmp': [{ bytes: [0x42, 0x4D] }],
  'video/mp4': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  'video/webm': [{ bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  'video/quicktime': [{ bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }],
  'audio/mpeg': [{ bytes: [0xFF, 0xFB] }, { bytes: [0x49, 0x44, 0x33] }],
  'audio/wav': [{ bytes: [0x52, 0x49, 0x46, 0x46] }],
  'audio/ogg': [{ bytes: [0x4F, 0x67, 0x67, 0x53] }],
  'audio/aac': [{ bytes: [0xFF, 0xF1] }, { bytes: [0xFF, 0xF9] }],
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }],
  'application/zip': [{ bytes: [0x50, 0x4B, 0x03, 0x04] }],
};

export function validateFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return true;

  for (const sig of signatures) {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    const slice = buffer.slice(offset, offset + sig.bytes.length);
    if (sig.bytes.every((byte, i) => slice[i] === byte)) return true;
  }

  const officeMimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
  ];
  if (officeMimeTypes.includes(mimeType)) {
    const zipSig = MAGIC_BYTES['application/zip'][0];
    if (buffer.length >= 4 && zipSig.bytes.every((byte, i) => buffer[i] === byte)) return true;
  }

  return false;
}
