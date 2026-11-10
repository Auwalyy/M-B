import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../errors/AppError';

export interface StoredImage {
  url: string;
  publicId: string;
  width: number | null;
  height: number | null;
}

export interface StorageProvider {
  readonly name: 'cloudinary' | 'local';
  upload(file: Buffer, opts: { folder: string; mime: ImageMime }): Promise<StoredImage>;
  remove(publicId: string): Promise<void>;
}

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Detects the real image type from the file's first bytes (never trust the declared type or extension). */
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Reads width and height from PNG and JPEG headers (other types return nulls). */
export function imageSize(buf: Buffer, mime: ImageMime): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1]!;
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    // fall through
  }
  return { width: null, height: null };
}

// ------------------------------------------------------------------ Cloudinary

/** Cloudinary request signature: SHA-1 of the alphabetically sorted params joined with &, followed by the API secret. */
export function cloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}

export function parseCloudinaryUrl(url: string): { apiKey: string; apiSecret: string; cloudName: string } {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m) throw new Error('Invalid CLOUDINARY_URL');
  return { apiKey: decodeURIComponent(m[1]!), apiSecret: decodeURIComponent(m[2]!), cloudName: m[3]! };
}

export class CloudinaryStorage implements StorageProvider {
  readonly name = 'cloudinary' as const;
  private readonly cfg: ReturnType<typeof parseCloudinaryUrl>;

  constructor(url: string, private readonly rootFolder: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.cfg = parseCloudinaryUrl(url);
  }

  private endpoint(action: 'upload' | 'destroy') {
    return `https://api.cloudinary.com/v1_1/${this.cfg.cloudName}/image/${action}`;
  }

  async upload(file: Buffer, opts: { folder: string; mime: ImageMime }): Promise<StoredImage> {
    const params = { folder: `${this.rootFolder}/${opts.folder}`, timestamp: Math.floor(Date.now() / 1000) };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: opts.mime }), 'upload');
    form.append('api_key', this.cfg.apiKey);
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('signature', cloudinarySignature(params, this.cfg.apiSecret));

    const res = await this.fetchImpl(this.endpoint('upload'), { method: 'POST', body: form });
    const body = (await res.json().catch(() => ({}))) as {
      secure_url?: string; public_id?: string; width?: number; height?: number; error?: { message?: string };
    };
    if (!res.ok || !body.secure_url || !body.public_id) {
      logger.error({ status: res.status, error: body.error }, 'Cloudinary upload failed');
      throw new AppError(502, 'UPLOAD_FAILED', 'The image could not be uploaded. Please try again.');
    }
    return { url: body.secure_url, publicId: body.public_id, width: body.width ?? null, height: body.height ?? null };
  }

  async remove(publicId: string): Promise<void> {
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
    const form = new FormData();
    form.append('api_key', this.cfg.apiKey);
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append('signature', cloudinarySignature(params, this.cfg.apiSecret));
    const res = await this.fetchImpl(this.endpoint('destroy'), { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Cloudinary destroy failed with ${res.status}`);
  }
}

// ------------------------------------------------------------------ Local disk (development and tests)

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;
  constructor(readonly dir: string) {}

  async upload(file: Buffer, opts: { folder: string; mime: ImageMime }): Promise<StoredImage> {
    const folder = opts.folder.replace(/[^a-z0-9-]/gi, '');
    const name = `${randomBytes(12).toString('hex')}.${EXT[opts.mime]}`;
    await mkdir(path.join(this.dir, folder), { recursive: true });
    await writeFile(path.join(this.dir, folder, name), file);
    return { url: `/uploads/${folder}/${name}`, publicId: `local:${folder}/${name}`, ...imageSize(file, opts.mime) };
  }

  async remove(publicId: string): Promise<void> {
    const rel = publicId.replace(/^local:/, '');
    if (!/^[a-z0-9-]+\/[a-f0-9]+\.(jpg|png|webp)$/i.test(rel)) return;
    await unlink(path.join(this.dir, rel)).catch(() => undefined);
  }
}

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (!provider) {
    if (env.CLOUDINARY_URL) provider = new CloudinaryStorage(env.CLOUDINARY_URL, env.CLOUDINARY_FOLDER);
    else provider = new LocalStorage(path.resolve(process.cwd(), env.UPLOAD_DIR));
  }
  return provider;
}

/** Tests can swap in a fake provider. */
export function setStorage(p: StorageProvider | undefined): void {
  provider = p;
}

export function assertStorageConfigured(): void {
  if (env.isProd && !env.CLOUDINARY_URL) {
    throw new Error('CLOUDINARY_URL must be set in production (images are not stored on the API server).');
  }
}

/** Validates an uploaded file and stores it. */
export async function storeImage(file: { buffer: Buffer; size: number }, folder: string): Promise<StoredImage> {
  const mime = sniffImage(file.buffer);
  if (!mime) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Upload a JPG, PNG or WebP image.');
  return getStorage().upload(file.buffer, { folder, mime });
}

/** Deletes stored images after the database change has committed. Failures are logged, never thrown. */
export function removeImagesLater(publicIds: (string | undefined | null)[]): void {
  for (const id of publicIds) {
    if (!id) continue;
    getStorage()
      .remove(id)
      .catch((err) => logger.warn({ err, publicId: id }, 'Failed to delete image from storage'));
  }
}
