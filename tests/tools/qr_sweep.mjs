// Verifies the QR encoder for every version 1-20 and ECC level by decoding with OpenCV (python3 + cv2 required).
import { encodeQR } from '../../public/js/lib/qr.js';
import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(import.meta.url)(process.env.SHARP_PATH || '/home/claude/.npm-global/lib/node_modules/sharp');
let bad = 0, n = 0; const seen = new Set();
for (const ecl of ['L', 'M', 'Q', 'H']) for (let len = 1; len <= 900; len += 7) {
  let qr; const txt = crypto.randomBytes(len).toString('base64url').slice(0, len);
  try { qr = encodeQR(txt, ecl); } catch { break; }
  const key = ecl + qr.version; if (seen.has(key)) continue; seen.add(key);
  // use the largest text that still fits this version to hit the capacity edge
  let L = len; for (;;) { try { if (encodeQR('a'.repeat(L + 1), ecl).version !== qr.version) break; L++; } catch { break; } }
  const t2 = crypto.randomBytes(L).toString('base64url').slice(0, L); qr = encodeQR(t2, ecl);
  const s = 8, N = qr.size + 8; const buf = Buffer.alloc(N * s * N * s, 255);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) buf[((y + 4) * s + dy) * N * s + (x + 4) * s + dx] = 0;
  await sharp(buf, { raw: { width: N * s, height: N * s, channels: 1 } }).png().toFile('/tmp/qrs.png');
  const out = execFileSync('python3', [path.join(here, 'qr_decode.py'), '/tmp/qrs.png']).toString();
  n++; if (out !== t2) { bad++; console.log('MISMATCH', ecl, 'v' + qr.version, 'len', L); }
}
console.log(bad ? `${bad}/${n} FAILED` : `QR encoder OK: ${n} version/ECC combinations decode correctly`);
process.exit(bad ? 1 : 0);
