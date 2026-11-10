import { describe, expect, it, vi } from 'vitest';
import { CloudinaryStorage, cloudinarySignature, imageSize, parseCloudinaryUrl, sniffImage } from './storage';

describe('Cloudinary', () => {
  it('signs requests exactly like the documented example', () => {
    // Example from Cloudinary's "Generating authentication signatures" documentation.
    expect(
      cloudinarySignature({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('parses CLOUDINARY_URL', () => {
    expect(parseCloudinaryUrl('cloudinary://123456:s3cr%2Ft@mudassir')).toEqual({ apiKey: '123456', apiSecret: 's3cr/t', cloudName: 'mudassir' });
  });

  it('uploads with a signed request into the configured folder and never sends the secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/mb/image/upload/v1/mudassir/products/x.jpg', public_id: 'mudassir/products/x', width: 800, height: 600 }), { status: 200 }),
    );
    const store = new CloudinaryStorage('cloudinary://key123:topsecret@mb', 'mudassir', fetchMock);
    const out = await store.upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { folder: 'products', mime: 'image/jpeg' });

    expect(out).toEqual({ url: 'https://res.cloudinary.com/mb/image/upload/v1/mudassir/products/x.jpg', publicId: 'mudassir/products/x', width: 800, height: 600 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.cloudinary.com/v1_1/mb/image/upload');
    const form = init.body as FormData;
    expect(form.get('folder')).toBe('mudassir/products');
    expect(form.get('api_key')).toBe('key123');
    const ts = Number(form.get('timestamp'));
    expect(form.get('signature')).toBe(cloudinarySignature({ folder: 'mudassir/products', timestamp: ts }, 'topsecret'));
    expect([...form.values()].some((v) => v === 'topsecret')).toBe(false);
  });

  it('turns a Cloudinary failure into a clear 502', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid Signature' } }), { status: 401 }));
    const store = new CloudinaryStorage('cloudinary://k:s@mb', 'mudassir', fetchMock);
    await expect(store.upload(Buffer.from([0xff, 0xd8, 0xff]), { folder: 'products', mime: 'image/jpeg' })).rejects.toMatchObject({ status: 502, code: 'UPLOAD_FAILED' });
  });

  it('deletes by public id with a signed request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"result":"ok"}', { status: 200 }));
    await new CloudinaryStorage('cloudinary://k:s@mb', 'mudassir', fetchMock).remove('mudassir/products/x');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.cloudinary.com/v1_1/mb/image/destroy');
    expect((init.body as FormData).get('public_id')).toBe('mudassir/products/x');
  });
});

describe('image validation', () => {
  it('identifies real JPEG, PNG and WebP files by their bytes', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF1234WEBPVP8 ', 'ascii'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });

  it('reads PNG dimensions', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageSize(png, 'image/png')).toEqual({ width: 640, height: 480 });
  });
});
