// Bounded structural validation, NOT full pixel, entropy or video codec decoding.
// Unknown ancillary chunks/boxes remain opaque; do not treat this as sanitization.
const MAX_ELEMENTS = 100_000;
const fail = message => { throw new Error(`Invalid media: ${message}`); };
function asBytes(value) {
  if (!(value instanceof Uint8Array)) fail('expected Buffer or Uint8Array bytes');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function budget() {
  let count = 0;
  return () => { if (++count > MAX_ELEMENTS) fail('more than 100000 structural elements'); };
}
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function png(bytes) {
  let pos = 8, width, height, color, palette = false, data = false, dataEnded = false, dataBytes = 0;
  const tick = budget();
  while (pos < bytes.length) {
    tick();
    if (bytes.length - pos < 12) fail('truncated PNG chunk');
    const size = bytes.readUInt32BE(pos);
    if (size > 0x7fffffff || size > bytes.length - pos - 12) fail('PNG chunk bounds');
    const type = bytes.toString('latin1', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) fail('PNG chunk type');
    const start = pos + 8, end = start + size;
    if (crc32(bytes.subarray(pos + 4, end)) !== bytes.readUInt32BE(end)) fail('PNG chunk CRC');
    if (pos === 8 && type !== 'IHDR') fail('PNG must start with IHDR');
    if (type === 'IHDR') {
      if (pos !== 8 || size !== 13) fail('PNG IHDR length/order');
      width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4);
      const depth = bytes[start + 8]; color = bytes[start + 9];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || !depths[color]?.includes(depth) ||
          bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) fail('PNG IHDR fields');
    } else if (type === 'PLTE') {
      if (palette || data || !size || size > 768 || size % 3 || color === 0 || color === 4) fail('PNG palette');
      if (color === 3 && size / 3 > 2 ** bytes[24]) fail('PNG palette exceeds bit depth');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) fail('PNG IDAT order/palette');
      data = true; dataBytes += size;
    } else if (type === 'IEND') {
      if (size !== 0 || !data || !dataBytes || end + 4 !== bytes.length) fail('PNG IEND/data');
      return;
    } else {
      if (type[0] === type[0].toUpperCase()) fail('unknown critical PNG chunk');
    }
    if (data && type !== 'IDAT') dataEnded = true;
    pos = end + 4;
  }
  fail('PNG missing IEND');
}

function jpeg(bytes) {
  let pos = 2, frame = null, scans = 0, entropy = false, scanBytes = 0;
  const tick = budget();
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (pos < bytes.length) {
    if (entropy && bytes[pos] !== 0xff) { scanBytes++; pos++; continue; }
    if (bytes[pos++] !== 0xff) fail('JPEG marker framing');
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) fail('truncated JPEG marker');
    const marker = bytes[pos++]; tick();
    if (entropy && marker === 0) { scanBytes++; continue; }
    if (entropy && marker >= 0xd0 && marker <= 0xd7) continue;
    if (entropy && !scanBytes) fail('empty JPEG scan');
    entropy = false;
    if (marker === 0xd9) {
      if (!frame || !scans || pos !== bytes.length) fail('JPEG EOI/frame/scan');
      return;
    }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) fail('unexpected JPEG marker');
    if (marker === 1) continue; // TEM is standalone.
    if (pos + 2 > bytes.length) fail('truncated JPEG segment length');
    const length = bytes.readUInt16BE(pos), start = pos + 2, end = pos + length;
    if (length < 2 || end > bytes.length) fail('JPEG segment bounds');
    if (sof.has(marker)) {
      if (frame || length < 11) fail('JPEG SOF length/order');
      const components = bytes[start + 5];
      if (!bytes[start] || !bytes.readUInt16BE(start + 1) || !bytes.readUInt16BE(start + 3) ||
          !components || length !== 8 + 3 * components) fail('JPEG SOF fields');
      frame = new Set();
      for (let i = 0; i < components; i++) {
        const at = start + 6 + i * 3, id = bytes[at], sampling = bytes[at + 1];
        if (frame.has(id) || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[at + 2] > 3) fail('JPEG frame component');
        frame.add(id);
      }
    } else if (marker === 0xda) {
      if (!frame || length < 8) fail('JPEG SOS before frame/invalid length');
      const components = bytes[start];
      if (!components || components > frame.size || length !== 6 + 2 * components) fail('JPEG SOS fields');
      const seen = new Set();
      for (let i = 0; i < components; i++) {
        const id = bytes[start + 1 + i * 2], tables = bytes[start + 2 + i * 2];
        if (!frame.has(id) || seen.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) fail('JPEG scan component');
        seen.add(id);
      }
      scans++; entropy = true; scanBytes = 0;
    }
    pos = end;
  }
  fail('JPEG missing EOI');
}

function webpFrame(bytes, type) {
  if (type === 'VP8 ') {
    if (bytes.length <= 10 || (bytes[0] & 1) || ((bytes[0] >> 1) & 7) > 3 ||
        bytes.toString('hex', 3, 6) !== '9d012a' || !(bytes.readUInt16LE(6) & 0x3fff) ||
        !(bytes.readUInt16LE(8) & 0x3fff)) fail('WebP VP8 frame header');
    const partition = bytes.readUIntLE(0, 3) >>> 5;
    if (!partition || partition > bytes.length - 3) fail('WebP VP8 partition bounds');
    return [bytes.readUInt16LE(6) & 0x3fff, bytes.readUInt16LE(8) & 0x3fff];
  }
  if (bytes.length <= 5 || bytes[0] !== 0x2f || bytes[4] >> 5) fail('WebP VP8L frame header');
  const bits = bytes.readUInt32LE(1);
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
}
function webp(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(4) !== bytes.length - 8) fail('WebP RIFF size');
  const tick = budget();
  let extended = null, animation = false, frames = 0, image = null;
  function chunks(start, end, visit) {
    for (let p = start; p < end;) {
      tick();
      if (end - p < 8) fail('truncated WebP chunk');
      const type = bytes.toString('latin1', p, p + 4), size = bytes.readUInt32LE(p + 4);
      const next = p + 8 + size + (size & 1);
      if (next > end || ((size & 1) && bytes[next - 1] !== 0)) fail('WebP chunk bounds/padding');
      visit(type, p + 8, size); p = next;
    }
  }
  chunks(12, bytes.length, (type, start, size) => {
    if (type === 'VP8X') {
      if (start !== 20 || extended || size !== 10 || (bytes[start] & 0xc1) || bytes.readUIntLE(start + 1, 3)) fail('WebP VP8X header/order');
      extended = { flags: bytes[start], width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    } else if (type === 'ANIM') {
      if (!extended || !(extended.flags & 2) || animation || frames || size !== 6) fail('WebP ANIM header/order');
      animation = true;
    } else if (type === 'ANMF') {
      if (!animation || image || size < 16 || (bytes[start + 15] & 0xfc)) fail('WebP animation frame');
      const x = bytes.readUIntLE(start, 3) * 2, y = bytes.readUIntLE(start + 3, 3) * 2;
      const w = bytes.readUIntLE(start + 6, 3) + 1, h = bytes.readUIntLE(start + 9, 3) + 1;
      if (x + w > extended.width || y + h > extended.height) fail('WebP animation canvas bounds');
      let found = false;
      chunks(start + 16, start + size, (inner, at, length) => {
        if (inner === 'VP8 ' || inner === 'VP8L') {
          if (found) fail('duplicate WebP frame data');
          const dims = webpFrame(bytes.subarray(at, at + length), inner);
          if (dims[0] !== w || dims[1] !== h) fail('WebP animation dimensions');
          found = true;
        } else if (inner !== 'ALPH') fail('unexpected WebP frame chunk');
      });
      if (!found) fail('WebP animation missing VP8/VP8L');
      frames++;
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (image || animation || (extended && (extended.flags & 2))) fail('WebP duplicate/mixed image data');
      image = webpFrame(bytes.subarray(start, start + size), type);
    }
  });
  if (!image && !frames) fail('WebP missing VP8/VP8L image data');
  if (extended && image && (image[0] !== extended.width || image[1] !== extended.height)) fail('WebP canvas dimensions');
}

/** Return MIME only after bounded container/marker validation; no codec decode. */
export function detectImage(value) {
  const bytes = asBytes(value);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature)) { png(bytes); return 'image/png'; }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) { jpeg(bytes); return 'image/jpeg'; }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') { webp(bytes); return 'image/webp'; }
  fail('expected structurally valid PNG, JPEG or WebP');
}

const videoBrands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
  'mp41', 'mp42', 'avc1', 'hvc1', 'hev1', 'M4V ', 'M4VH', 'M4VP', 'qt  ', 'dash', 'msdh', 'msix', 'cmfc', 'cmfs']);
const imageBrands = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
/** Validate MP4 box framing and video-track presence; does not decode samples. */
export function validateMp4(value) {
  const bytes = asBytes(value), tick = budget();
  function boxes(start, end, visit) {
    for (let pos = start; pos < end;) {
      tick();
      if (end - pos < 8) fail('truncated MP4 box header');
      let size = bytes.readUInt32BE(pos), header = 8;
      const type = bytes.toString('latin1', pos + 4, pos + 8);
      if (size === 1) {
        if (end - pos < 16) fail('truncated MP4 extended box');
        const wide = bytes.readBigUInt64BE(pos + 8);
        if (wide > BigInt(end - pos)) fail('MP4 extended box bounds');
        size = Number(wide); header = 16;
      } else if (size === 0) size = end - pos;
      if (type === 'uuid') header += 16;
      if (size < header || size > end - pos) fail('MP4 box bounds');
      visit(type, pos + header, pos + size); pos += size;
    }
  }
  let ftyp = false, moov = false, video = false, mediaBytes = 0;
  boxes(0, bytes.length, (type, start, end) => {
    if (type === 'ftyp') {
      if (ftyp || end - start < 8 || (end - start) % 4) fail('MP4 ftyp fields');
      let compatible = false;
      for (let at = start; at < end; at += 4) {
        if (at === start + 4) continue; // Minor version is not a brand.
        tick();
        const brand = bytes.toString('latin1', at, at + 4);
        if (imageBrands.has(brand)) fail('MP4 requires video-compatible ftyp brand, not AVIF/HEIC');
        if (videoBrands.has(brand)) compatible = true;
      }
      if (!compatible) fail('MP4 requires video-compatible ftyp brand, not AVIF/HEIC');
      ftyp = true;
    } else if (type === 'mdat') {
      mediaBytes += end - start;
    } else if (type === 'moov') {
      if (moov) fail('duplicate MP4 moov');
      moov = true;
      boxes(start, end, (child, a, b) => {
        if (child !== 'trak') return;
        boxes(a, b, (trackChild, c, d) => {
          if (trackChild !== 'mdia') return;
          boxes(c, d, (mediaChild, e, f) => {
            if (mediaChild !== 'hdlr') return;
            if (f - e < 24 || bytes[e] !== 0) fail('MP4 hdlr fields');
            if (bytes.toString('latin1', e + 8, e + 12) === 'vide') video = true;
          });
        });
      });
    }
  });
  if (!ftyp || !moov || !video || !mediaBytes) fail('MP4 requires ftyp, moov/trak/mdia/hdlr vide and nonempty mdat');
}
