import client from './client';
import type { ApiResponse } from '../types';
import { useAuthStore } from '../stores/authStore';

export interface AttachmentResult {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  fileType: 'image' | 'video' | 'audio' | 'document';
  thumbnailPath: string | null;
  aiAnnotation: string;
  annotationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

export function getThumbnailUrl(thumbnailPath: string | null): string | null {
  if (!thumbnailPath) return null;
  const parts = thumbnailPath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1];
  return `/api/files/thumbnails/${filename}`;
}

export function getOriginalFileUrl(filePath: string | null): string | null {
  if (!filePath) return null;
  const parts = filePath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1];
  return `/api/files/originals/${filename}`;
}

export function getAttachmentDownloadUrl(id: string, inline = false): string {
  const token = useAuthStore.getState().token || '';
  const base = `/api/attachments/${id}/download`;
  const params = new URLSearchParams();
  if (inline) params.set('inline', '1');
  if (token) params.set('token', token);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export const uploadApi = {
  uploadFiles: async (files: File[], onProgress?: (progress: number) => void): Promise<ApiResponse<AttachmentResult[]>> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    const response = await client.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress: (event) => {
        if (event.total && onProgress) {
          onProgress(event.loaded / event.total);
        }
      },
    });
    return response.data;
  },

  deleteAttachment: async (id: string): Promise<ApiResponse<null>> => {
    const response = await client.delete(`/api/attachments/${id}`);
    return response.data;
  },

  batchStatus: async (ids: string[]): Promise<ApiResponse<Array<{ id: string; annotationStatus: string; aiAnnotation: string; originalName: string; fileType: string; thumbnailPath: string | null }>>> => {
    const response = await client.post('/api/attachments/batch-status', { ids });
    return response.data;
  },
};
