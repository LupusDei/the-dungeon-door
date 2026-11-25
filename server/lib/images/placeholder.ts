import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

/**
 * A deterministic placeholder PNG for DD_FAKE_AI: a two-colour gradient derived from the prompt, with a
 * darker frame and a "door" arch in the middle, so different scenes and characters look different.
 */
export function placeholderPng(seed: string, width: number, height: number): Uint8Array {
  const h = createHash('sha256').update(seed).digest();
  const top = [h[0], h[1], h[2]];
  const bottom = [h[3] >> 1, h[4] >> 1, h[5] >> 1];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const doorW = width * 0.22;
  const doorTop = height * 0.35;
  const cx = width / 2;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    const t = y / (height - 1);
    for (let x = 0; x < width; x++) {
      let rgb = top.map((c, i) => Math.round(c * (1 - t) + bottom[i] * t));
      const frame = Math.min(x, y, width - 1 - x, height - 1 - y) < Math.max(4, width / 64);
      const dx = (x - cx) / doorW;
      const inArch = y > doorTop ? Math.abs(dx) < 1 : dx * dx + ((y - doorTop) / doorW) ** 2 < 1;
      const inDoor = inArch && y < height * 0.9;
      if (frame) rgb = rgb.map((c) => c >> 2);
      else if (inDoor) rgb = rgb.map((c) => 255 - (c >> 1));
      raw.set(rgb, row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
