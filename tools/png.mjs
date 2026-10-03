/*
 * 最小の PNG 読み書き（2026-09-13）。
 *
 * ★**外部ライブラリを1つも足さない。** Node の `zlib` だけで足りる。
 * このリポジトリは「初回DL 8MB」を目標にしていて、道具側も依存を増やさない方針
 * （`gen-atlas.js` がブラウザのコンソールで動くだけの道具なのと同じ考え方）。
 *
 * 対応するのは **8bit / RGBA(color type 6) / 非インタレース** だけ。
 * いま扱う素材（AI が書き出した PNG）は全部これ。それ以外は落として知らせる。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';

/** @returns {{w:number,h:number,data:Buffer}} data は RGBA が w*h*4 並んだもの */
export function readPNG(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: PNG ではない`);

  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  /** @type {Buffer[]} */
  const idat = [];
  let palette = null, trns = null;

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`${path}: bitDepth ${bitDepth} は非対応（8 のみ）`);
  if (interlace !== 0) throw new Error(`${path}: インタレースは非対応`);

  /** 1画素あたりのバイト数（フィルタの巻き戻しに要る） */
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 1;
  if (colorType === 3 && !palette) throw new Error(`${path}: パレットが無い`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const lines = Buffer.alloc(h * stride);

  /*
   * ★**フィルタの巻き戻し。** PNG は行ごとに5種類の予測から1つ選んで差分を格納している。
   * ここを間違えると「斜めに流れた絵」になるので、仕様どおりに素直に書く
   */
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    raw.copy(cur, 0, q, q + stride);
    q += stride;
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }

  // RGBA へ揃える
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, d = i * 4;
    if (colorType === 6) { data[d] = lines[s]; data[d + 1] = lines[s + 1]; data[d + 2] = lines[s + 2]; data[d + 3] = lines[s + 3]; }
    else if (colorType === 2) { data[d] = lines[s]; data[d + 1] = lines[s + 1]; data[d + 2] = lines[s + 2]; data[d + 3] = 255; }
    else if (colorType === 4) { data[d] = data[d + 1] = data[d + 2] = lines[s]; data[d + 3] = lines[s + 1]; }
    else if (colorType === 0) { data[d] = data[d + 1] = data[d + 2] = lines[s]; data[d + 3] = 255; }
    else { const idx = lines[s]; data[d] = palette[idx * 3]; data[d + 1] = palette[idx * 3 + 1]; data[d + 2] = palette[idx * 3 + 2]; data[d + 3] = trns && idx < trns.length ? trns[idx] : 255; }
  }
  return { w, h, data };
}

/**
 * RGBA を PNG で書き出す。
 *
 * ★★**フィルタは行ごとに選ぶ**（2026-09-13）。最初はフィルタ無し（0）で書いていたら、
 * 本番の絵のアトラスが **4.7MB** になった（仮の絵のときは 317KB）。
 * 紙のざらつきが全面に入っていて、**差分を取らないと zlib がほとんど縮められない**。
 * PNG 仕様どおりの定石（各行で5種類試し、絶対値の合計が最小のものを選ぶ）を入れる。
 */
export function writePNG(path, { w, h, data }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      const out = cand[f];
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? cur[x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        let v;
        if (f === 0) v = cur[x];
        else if (f === 1) v = cur[x] - a;
        else if (f === 2) v = cur[x] - b;
        else if (f === 3) v = cur[x] - ((a + b) >> 1);
        else {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = cur[x] - ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c));
        }
        out[x] = v & 0xff;
        // 符号付きとして見た絶対値の合計が小さいほど、あとの zlib がよく縮む
        score += out[x] < 128 ? out[x] : 256 - out[x];
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeInt32BE(crc(out.subarray(4, 8 + body.length)) | 0, 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
