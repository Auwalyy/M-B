import type { ImageMime, StorageProvider, StoredImage } from '../src/core/storage/storage';

/** In-memory image storage for tests: records uploads and deletions, writes nothing. */
export class FakeStorage implements StorageProvider {
  readonly name = 'cloudinary' as const;
  uploads: { publicId: string; folder: string; mime: ImageMime; bytes: number }[] = [];
  removed: string[] = [];
  private seq = 0;

  async upload(file: Buffer, opts: { folder: string; mime: ImageMime }): Promise<StoredImage> {
    const publicId = `test/${opts.folder}/img${++this.seq}`;
    this.uploads.push({ publicId, folder: opts.folder, mime: opts.mime, bytes: file.length });
    return { url: `https://res.cloudinary.com/demo/image/upload/${publicId}.png`, publicId, width: 10, height: 10 };
  }

  async remove(publicId: string): Promise<void> {
    this.removed.push(publicId);
  }
}

/** A tiny but valid PNG header (enough for type sniffing and size reading). */
export function pngBytes(width = 4, height = 3): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
