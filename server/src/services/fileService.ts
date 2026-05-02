import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getFileType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown',
];

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 9;

const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'video/mp4': [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]],
  'video/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
  'video/quicktime': [
    [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70],
    [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70],
  ],
  'audio/mpeg': [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]],
  'audio/wav': [[0x52, 0x49, 0x46, 0x46]],
  'audio/ogg': [[0x4F, 0x67, 0x67, 0x53]],
  'audio/aac': [[0xFF, 0xF1], [0xFF, 0xF9]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

export function validateFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const patterns = MAGIC_BYTES[mimeType];
  if (!patterns) return true;
  return patterns.some((p) => p.every((b, i) => buffer[i] === b));
}

export function deleteFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (filePath.endsWith('.jpg')) {
      const base = filePath.replace(/\.jpg$/, '');
      const imgExts = ['.png', '.gif', '.webp', '.mp4', '.webm', '.mov', '.pdf', '.docx', '.xlsx', '.pptx'];
      for (const ext of imgExts) {
        const altPath = base + ext;
        if (fs.existsSync(altPath)) fs.unlinkSync(altPath);
      }
    }
  } catch {
    // ignore
  }
}

function generateThumbnail(filePath: string, thumbPath: string, fileType: string): string | null {
  try {
    if (fileType === 'image') {
      const sharp = require('sharp');
      sharp(filePath).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 80 }).toFile(thumbPath);
      return fs.existsSync(thumbPath) ? thumbPath : null;
    }
    if (fileType === 'video') {
      execSync(
        `ffmpeg -i "${filePath}" -ss 00:00:01 -vframes 1 -vf "scale=400:-1" -q:v 3 "${thumbPath}" -y`,
        { timeout: 15000, stdio: 'pipe' }
      );
      return fs.existsSync(thumbPath) ? thumbPath : null;
    }
    return null;
  } catch {
    return null;
  }
}

function getMediaMetadata(filePath: string): string | null {
  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 8000, stdio: 'pipe' }
    ).toString();
    const info = JSON.parse(output);
    const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
    const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
    const duration = info.format?.duration
      ? `${Math.floor(parseFloat(info.format.duration) / 60)}分${Math.round(parseFloat(info.format.duration) % 60)}秒`
      : '未知时长';
    const lines: string[] = [`时长: ${duration}`];
    if (videoStream) {
      lines.push(`分辨率: ${videoStream.width || '?'}x${videoStream.height || '?'}`);
      lines.push(`编码: ${videoStream.codec_name || '未知'}`);
    }
    if (audioStream && !videoStream) {
      lines.push(`编码: ${audioStream.codec_name || '未知'}`);
      lines.push(`采样率: ${audioStream.sample_rate || '未知'}Hz`);
    }
    return lines.join('; ');
  } catch {
    return null;
  }
}

async function extractDocumentText(filePath: string, mimeType: string): Promise<string | null> {
  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text?.slice(0, 5000) || null;
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value?.slice(0, 5000) || null;
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mimeType === 'application/vnd.ms-excel') {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      let text = '';
      for (const sheetName of workbook.SheetNames.slice(0, 3)) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        text += `[工作表: ${sheetName}]\n${csv}\n\n`;
      }
      return text.slice(0, 5000);
    }
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown') {
      return fs.readFileSync(filePath, 'utf-8').slice(0, 5000);
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return '演示文稿文件';
    }
    return null;
  } catch {
    return null;
  }
}

async function callAIModel(
  prompt: string, filePath: string | null, fileType: string, mimeType: string
): Promise<string | null> {
  const aiApiKey = process.env.MIMO_API_KEY || '';
  const aiBaseUrl = process.env.MIMO_BASE_URL || 'https://api.mimo.run/v1';

  try {
    const messages: { role: string; content: unknown }[] = [
      { role: 'system', content: '你是一个专业的文件分析助手，请用中文回复，简洁专业。' },
    ];

    if (fileType === 'image' && filePath && fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiApiKey}` },
      body: JSON.stringify({ model: 'mimo-v2', messages, max_tokens: 500, temperature: 0.5 }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[fileService] AI API error:', response.status, errText.slice(0, 200));
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[fileService] callAIModel error:', err);
    return null;
  }
}

export async function annotateWithMimo(
  filePath: string, fileType: string, mimeType: string, extractedText: string
): Promise<string> {
  let prompt = '';

  if (fileType === 'document') {
    prompt = `请用中文简要分析这份文档的内容和用途。`;
    if (extractedText) {
      prompt += `\n\n文档内容摘录:\n${extractedText.slice(0, 3000)}`;
    }
    prompt += '\n\n请用3-5句话总结核心内容，然后另起一行给出"标签: 关键词1, 关键词2, 关键词3"。';
  } else if (fileType === 'video') {
    const metadata = getMediaMetadata(filePath);
    prompt = `请分析这个视频文件（MIME: ${mimeType}）。\n文件名: ${path.basename(filePath)}`;
    if (metadata) prompt += `\n元数据: ${metadata}`;
    prompt += '\n\n请根据文件名和元数据推断视频可能的内容类型和用途（3-4句话），然后给出"标签: 关键词1, 关键词2"。';
  } else if (fileType === 'audio') {
    const metadata = getMediaMetadata(filePath);
    prompt = `请分析这个音频文件（MIME: ${mimeType}）。\n文件名: ${path.basename(filePath)}`;
    if (metadata) prompt += `\n元数据: ${metadata}`;
    prompt += '\n\n请根据文件名和元数据推断音频可能的内容类型和用途（3-4句话），然后给出"标签: 关键词1, 关键词2"。';
  } else if (fileType === 'image') {
    prompt = `请用中文简要描述这张图片的内容，包括主要对象、场景、氛围等（3-5句话），然后给出"标签: 关键词1, 关键词2"。`;
  }

  const annotation = await callAIModel(prompt, filePath, fileType, mimeType);

  if (annotation) return annotation;

  if (fileType === 'document' && extractedText) {
    return `文档内容: ${extractedText.slice(0, 200).replace(/\n/g, ' ')}...`;
  }
  if (fileType === 'video') {
    const meta = getMediaMetadata(filePath);
    return `视频文件` + (meta ? `（${meta}）` : '');
  }
  if (fileType === 'audio') {
    const meta = getMediaMetadata(filePath);
    return `音频文件` + (meta ? `（${meta}）` : '');
  }
  return `文件 ${path.basename(filePath)}`;
}

function getFileExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
    'audio/aac': '.aac', 'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
  };
  return map[mimeType] || '.bin';
}

export async function processUploadedFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
) {
  ensureDir(UPLOAD_DIR);
  ensureDir(path.join(UPLOAD_DIR, 'thumbnails'));

  const fileType = getFileType(mimeType);
  const ext = getFileExtension(mimeType);
  const timestamp = Date.now();
  const safeName = `${timestamp}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(UPLOAD_DIR, safeName);
  const fileSize = buffer.length;

  fs.writeFileSync(filePath, buffer);

  let thumbnailPath: string | null = null;
  if (fileType === 'image' || fileType === 'video') {
    const thumbName = `thumb_${safeName.replace(ext, '.jpg')}`;
    const thumbFilePath = path.join(UPLOAD_DIR, 'thumbnails', thumbName);
    thumbnailPath = generateThumbnail(filePath, thumbFilePath, fileType);
  }

  let extractedText = '';
  if (fileType === 'document') {
    const text = await extractDocumentText(filePath, mimeType);
    if (text) extractedText = text;
  }

  return {
    fileName: safeName,
    originalName,
    mimeType,
    fileSize,
    filePath,
    thumbnailPath,
    extractedText,
  };
}
