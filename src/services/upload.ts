import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { BadRequestError } from '../core/errors.js';

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_BYTES = 10 * 1024 * 1024;

export function sanitizeFilename(name: string): string {
  // Take basename, replace spaces with _, strip everything except [A-Za-z0-9._-]
  let base = path.basename(name);
  base = base.replace(/\s+/g, '_');
  base = base.replace(/[^A-Za-z0-9._-]/g, '');
  if (base.length > 120) base = base.slice(0, 120);
  if (!base || base === '.' || base === '..') {
    throw new BadRequestError('Invalid filename');
  }
  return base;
}

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(config.UPLOADS_DIR, { recursive: true });
}

function uploadsRoot(): string {
  return path.resolve(config.UPLOADS_DIR);
}

function urlForPath(absPath: string): string {
  const root = uploadsRoot();
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  return `/uploads/${rel}`;
}

function pathForUrl(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null;
  const rel = url.slice('/uploads/'.length);
  return path.join(uploadsRoot(), rel);
}

export async function saveProfileImage(
  userId: number,
  filename: string,
  mime: string,
  data: Buffer
): Promise<string> {
  return saveImage(['profile-images', String(userId)], filename, mime, data);
}

export async function saveOrderImage(
  orderId: number,
  filename: string,
  mime: string,
  data: Buffer
): Promise<string> {
  return saveImage(['order-images', String(orderId)], filename, mime, data);
}

async function saveImage(
  segments: string[],
  filename: string,
  mime: string,
  data: Buffer
): Promise<string> {
  if (!ALLOWED_MIME.has(mime)) throw new BadRequestError('Unsupported image type');
  if (!data || data.length === 0) throw new BadRequestError('Empty file');
  if (data.length > MAX_BYTES) throw new BadRequestError('File too large (max 10 MB)');
  const safe = sanitizeFilename(filename);
  const dir = path.join(uploadsRoot(), ...segments);
  await fs.mkdir(dir, { recursive: true });
  const finalName = `${randomUUID()}_${safe}`;
  const abs = path.join(dir, finalName);
  await fs.writeFile(abs, data);
  return urlForPath(abs);
}

export async function deleteFileForUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const abs = pathForUrl(url);
  if (!abs) return;
  try {
    await fs.unlink(abs);
  } catch {
    /* ignore */
  }
}
