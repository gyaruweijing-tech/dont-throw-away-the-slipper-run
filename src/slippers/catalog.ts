import * as THREE from 'three';

/**
 * ★★**スリッパの図鑑**（2026-09-16・本人指定「最低10種類 × 1種類につき3色。後からアプデで何とでもなる」）。
 *
 * ★**絵はここでキャンバスに描く**（アトラス 4×4 は満杯で足せないため）。
 * 3D の手元・負けて飛んでいくスリッパ・下駄箱のカード・ルーレットの針は、**全部この1か所の絵**を使う
 * ＝ どこかだけ古い色のまま、が起きない。
 * ★**足すときはこの表に1行足すだけ**（描く関数・3色・値段）。
 *
 * 絵の座標: 幅 W × 高さ H。**つま先が上、かかとが下**（主人公が縦に掲げる向き）。
 * 線は濃い茶の太線・塗りは平ら（アトラスの切り絵に合わせる。紙の地合いはシェーダーが掛ける）
 */
export const W = 160;
export const H = 348;
const INK = '#3a2a20';

export type Glow = 'gold' | 'rainbow' | 'dark' | 'white';

interface Color {
  id: string;
  name: string;
  /** 描く関数に渡す色。意味はデザインごと */
  c: readonly string[];
}

interface Design {
  id: string;
  name: string;
  /** 1色目の値段。2色目・3色目は ×1.3・×1.7 */
  base: number;
  colors: readonly Color[];
  draw: (g: CanvasRenderingContext2D, c: readonly string[]) => void;
  glow?: Glow;
  /** 1色だけのデザイン（ホワイトアウト・言い値） */
  single?: boolean;
  /** ★言い値。**下駄箱を開くたびに値段が変わる**（本人「言い値スリッパwww」） */
  iine?: boolean;
  blurb: string;
}

export interface SlipperItem {
  /** `デザイン-色` */
  id: string;
  design: string;
  name: string;
  colorName: string;
  price: number;
  glow?: Glow;
  iine?: boolean;
  blurb: string;
}

/* ============================ 描くための道具 ============================ */

function outlinePath(g: CanvasRenderingContext2D, k = 0): void {
  g.beginPath();
  g.moveTo(W / 2, 12 + k);
  g.bezierCurveTo(W - 6 - k, 12 + k, W - 4 - k, H * 0.42, W * 0.84 - k, H * 0.64);
  g.bezierCurveTo(W * 0.8 - k, H - 10 - k, W * 0.2 + k, H - 10 - k, W * 0.16 + k, H * 0.64);
  g.bezierCurveTo(4 + k, H * 0.42, 6 + k, 12 + k, W / 2, 12 + k);
  g.closePath();
}

function line(g: CanvasRenderingContext2D, w = 7): void {
  g.lineWidth = w;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = INK;
  g.stroke();
}

/** 底（ふち） → 中敷きの2枚 */
function sole(g: CanvasRenderingContext2D, rim: string, top: string): void {
  outlinePath(g);
  g.fillStyle = rim;
  g.fill();
  line(g);
  outlinePath(g, 10);
  g.fillStyle = top;
  g.fill();
}

/** 形の内側だけに描く */
function inside(g: CanvasRenderingContext2D, k: number, fn: () => void): void {
  g.save();
  outlinePath(g, k);
  g.clip();
  fn();
  g.restore();
}

/** 甲（足を入れる帯）。上端 y0・下端 y1（H に対する割合） */
function strap(g: CanvasRenderingContext2D, fill: string, y0 = 0.14, y1 = 0.46, pattern?: () => void): void {
  inside(g, 0, () => {
    g.beginPath();
    g.moveTo(-10, H * y0);
    g.lineTo(W + 10, H * y0);
    g.lineTo(W + 10, H * y1);
    g.quadraticCurveTo(W / 2, H * (y1 + 0.09), -10, H * y1);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (pattern) {
      g.save();
      g.clip();
      pattern();
      g.restore();
    }
    g.beginPath();
    g.moveTo(-10, H * y1);
    g.quadraticCurveTo(W / 2, H * (y1 + 0.09), W + 10, H * y1);
    line(g, 6);
  });
  outlinePath(g);
  line(g);
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = true): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) line(g, 5);
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke = true, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) line(g, 5);
}

function shine(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.globalAlpha = 0.45;
  ellipse(g, x, y, w, h, '#ffffff', false, -0.35);
  g.restore();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, fill: string): void {
  g.font = `900 ${size}px "Segoe UI","Hiragino Sans","Yu Gothic",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.strokeText(s, x, y);
  g.fillStyle = fill;
  g.fillText(s, x, y);
}

/* ============================ デザイン ============================ */

const DESIGNS: readonly Design[] = [
  {
    id: 'usual', name: 'いつもの', base: 500, blurb: '来客用のビニールスリッパ。すべてはここから',
    colors: [
      { id: 'red', name: '赤', c: ['#d9473a', '#b8372d'] },
      { id: 'blue', name: '青', c: ['#3f7fc9', '#2f629e'] },
      { id: 'green', name: '緑', c: ['#4fa65a', '#3a8045'] },
    ],
    draw: (g, c) => {
      sole(g, '#efe6d6', c[1]);
      strap(g, c[0]);
      shine(g, W * 0.36, H * 0.24, 22, 9);
    },
  },
  {
    id: 'benjo', name: '便所サンダル', base: 700, blurb: '学校のトイレの主。つま先に男女のマーク',
    /*
     * ★2026-09-16 描き直し（本人の参考画像: 上から見た来客用スリッパ・甲にトイレのマーク）。
     * 中敷き → 口の奥の影 → 甲（つま先側のドーム）→ 明るい縁取り → マーク、の順に重ねる
     */
    colors: [
      { id: 'green', name: '緑', c: ['#16a37f', '#0e8a68', '#6cc1a2', '#12976f'] },
      { id: 'pink', name: 'ピンク', c: ['#ea7fa6', '#cf5f88', '#f5b3cb', '#dd7098'] },
      { id: 'aqua', name: '水色', c: ['#4fb3d9', '#3593ba', '#9fd6ea', '#44a5cc'] },
    ],
    draw: (g, c) => {
      // 中敷き（かかとまで伸びる舌の形）
      g.beginPath();
      g.moveTo(W * 0.22, H * 0.4);
      g.bezierCurveTo(W * 0.18, H * 0.7, W * 0.16, H * 0.96, W * 0.5, H * 0.97);
      g.bezierCurveTo(W * 0.84, H * 0.96, W * 0.82, H * 0.7, W * 0.78, H * 0.4);
      g.closePath();
      g.fillStyle = c[3];
      g.fill();
      line(g);
      g.beginPath();
      g.moveTo(W * 0.3, H * 0.46);
      g.bezierCurveTo(W * 0.27, H * 0.72, W * 0.26, H * 0.92, W * 0.5, H * 0.925);
      g.bezierCurveTo(W * 0.74, H * 0.92, W * 0.73, H * 0.72, W * 0.7, H * 0.46);
      g.strokeStyle = c[1];
      g.lineWidth = 4;
      g.stroke();
      // 口の奥の影
      ellipse(g, W * 0.5, H * 0.5, W * 0.44, H * 0.1, c[1], false);
      // 甲（つま先側のドーム）
      g.beginPath();
      g.moveTo(W * 0.06, H * 0.5);
      g.bezierCurveTo(W * 0.04, H * 0.14, W * 0.26, H * 0.02, W * 0.5, H * 0.02);
      g.bezierCurveTo(W * 0.74, H * 0.02, W * 0.96, H * 0.14, W * 0.94, H * 0.5);
      g.quadraticCurveTo(W * 0.5, H * 0.4, W * 0.06, H * 0.5);
      g.closePath();
      g.fillStyle = c[0];
      g.fill();
      line(g);
      // 口の明るい縁取り（手前側の弧）
      g.beginPath();
      g.ellipse(W * 0.5, H * 0.5, W * 0.44, H * 0.1, 0, 0.02 * Math.PI, 0.98 * Math.PI);
      g.strokeStyle = INK;
      g.lineWidth = 14;
      g.stroke();
      g.strokeStyle = c[2];
      g.lineWidth = 8;
      g.stroke();
      // 男女のマーク（丸＋逆三角／丸＋三角）
      const y = H * 0.26;
      for (const [x, down] of [[W * 0.36, true], [W * 0.64, false]] as const) {
        circle(g, x, y - 18, 9, '#ffffff', false);
        g.beginPath();
        if (down) { g.moveTo(x - 13, y - 4); g.lineTo(x + 13, y - 4); g.lineTo(x, y + 22); }
        else { g.moveTo(x, y - 4); g.lineTo(x + 13, y + 22); g.lineTo(x - 13, y + 22); }
        g.closePath();
        g.fillStyle = '#ffffff';
        g.fill();
      }
    },
  },
  {
    id: 'pan', name: '食パン', base: 1000, blurb: '焼けば焼くほど値が上がる',
    colors: [
      { id: 'white', name: '白パン', c: ['#fbf3dc', '#d9a45a'] },
      { id: 'toast', name: 'トースト', c: ['#e6b567', '#9c6128'] },
      { id: 'burnt', name: '焦げ', c: ['#4a3322', '#1f150e'] },
    ],
    draw: (g, c) => {
      sole(g, c[1], c[0]);
      inside(g, 10, () => {
        g.globalAlpha = 0.35;
        for (let i = 0; i < 40; i++) circle(g, (i * 53) % W, (i * 97) % H, 2.5, c[1], false);
        g.globalAlpha = 1;
      });
      strap(g, c[1], 0.1, 0.36);
      ellipse(g, W * 0.5, H * 0.62, 26, 16, '#f7d65c');
    },
  },
  {
    id: 'tori', name: '鶏つき', base: 2000, blurb: '頭の鶏とおそろい。つま先で鳴く',
    colors: [
      { id: 'white', name: '白', c: ['#fbf7ee', '#dfd6c5'] },
      { id: 'brown', name: '茶', c: ['#b9824f', '#936239'] },
      { id: 'gold', name: '金', c: ['#f2c14e', '#c9962b'] },
    ],
    draw: (g, c) => {
      sole(g, '#efe6d6', c[1]);
      strap(g, c[0], 0.2, 0.5);
      // とさか → 顔 → くちばし
      circle(g, W * 0.4, H * 0.1, 14, '#e0453a');
      circle(g, W * 0.55, H * 0.08, 16, '#e0453a');
      circle(g, W * 0.5, H * 0.2, 40, c[0]);
      circle(g, W * 0.38, H * 0.19, 5, INK, false);
      circle(g, W * 0.62, H * 0.19, 5, INK, false);
      g.beginPath();
      g.moveTo(W * 0.42, H * 0.25);
      g.lineTo(W * 0.58, H * 0.25);
      g.lineTo(W * 0.5, H * 0.32);
      g.closePath();
      g.fillStyle = '#f2a33a';
      g.fill();
      line(g, 4);
    },
  },
  {
    id: 'sushi', name: '寿司', base: 3000, blurb: 'シャリの上にネタ。回らない',
    colors: [
      { id: 'maguro', name: 'マグロ', c: ['#d83a47', '#b52a37'] },
      { id: 'salmon', name: 'サーモン', c: ['#f59a62', '#ffe2cf'] },
      { id: 'tamago', name: 'たまご', c: ['#f6d45a', '#1f2a24'] },
    ],
    draw: (g, c) => {
      sole(g, '#e8e2d4', '#fbf8f1');
      inside(g, 10, () => {
        for (let i = 0; i < 60; i++) ellipse(g, (i * 37) % W, H * 0.5 + ((i * 71) % (H * 0.5)), 5, 3, '#e3dccb', false, i);
      });
      inside(g, 0, () => {
        g.beginPath();
        g.moveTo(-10, H * 0.06);
        g.bezierCurveTo(W * 0.3, 0, W * 0.7, H * 0.12, W + 10, H * 0.06);
        g.lineTo(W + 10, H * 0.58);
        g.bezierCurveTo(W * 0.6, H * 0.64, W * 0.3, H * 0.54, -10, H * 0.6);
        g.closePath();
        g.fillStyle = c[0];
        g.fill();
        line(g, 6);
        if (c[1] === '#ffe2cf') {
          g.strokeStyle = c[1];
          g.lineWidth = 6;
          for (let y = H * 0.1; y < H * 0.58; y += 28) {
            g.beginPath();
            g.moveTo(-10, y + 20);
            g.quadraticCurveTo(W / 2, y, W + 10, y + 26);
            g.stroke();
          }
        }
        if (c[1] === '#1f2a24') {
          g.fillStyle = c[1];
          g.fillRect(W * 0.34, 0, W * 0.32, H);
        }
      });
      outlinePath(g);
      line(g);
    },
  },
  {
    id: 'necktie', name: 'ネクタイ柄', base: 4000, blurb: '人事部の支給品。締めると走れる',
    colors: [
      { id: 'navy', name: '紺', c: ['#2f3f63', '#c8352b'] },
      { id: 'grey', name: '灰', c: ['#7b7f86', '#2f3f63'] },
      { id: 'stripe', name: 'ストライプ', c: ['#2f3f63', '#f2b632'] },
    ],
    draw: (g, c) => {
      sole(g, '#efe6d6', c[0]);
      strap(g, '#fbf8f1', 0.08, 0.5, () => {
        g.beginPath();
        g.moveTo(W * 0.5, H * 0.14);
        g.lineTo(W * 0.62, H * 0.2);
        g.lineTo(W * 0.56, H * 0.24);
        g.lineTo(W * 0.64, H * 0.56);
        g.lineTo(W * 0.5, H * 0.66);
        g.lineTo(W * 0.36, H * 0.56);
        g.lineTo(W * 0.44, H * 0.24);
        g.lineTo(W * 0.38, H * 0.2);
        g.closePath();
        g.fillStyle = c[1];
        g.fill();
        line(g, 5);
        if (c[0] === '#2f3f63' && c[1] === '#f2b632') {
          g.strokeStyle = '#2f3f63';
          g.lineWidth = 6;
          for (let y = H * 0.26; y < H * 0.6; y += 18) {
            g.beginPath();
            g.moveTo(W * 0.3, y);
            g.lineTo(W * 0.7, y + 14);
            g.stroke();
          }
        }
      });
      // 襟
      g.beginPath();
      g.moveTo(W * 0.2, H * 0.08);
      g.lineTo(W * 0.5, H * 0.16);
      g.lineTo(W * 0.8, H * 0.08);
      line(g, 6);
    },
  },
  {
    id: 'zori', name: '草履', base: 5000, blurb: '鼻緒をきゅっと。わびさび',
    colors: [
      { id: 'wara', name: '藁', c: ['#d9c07a', '#e0453a'] },
      { id: 'beni', name: '紅', c: ['#d9c07a', '#b3223b'] },
      { id: 'kuro', name: '黒', c: ['#3b3530', '#e9e1cf'] },
    ],
    draw: (g, c) => {
      sole(g, '#8a6b45', c[0]);
      inside(g, 10, () => {
        g.strokeStyle = 'rgba(58,42,32,.35)';
        g.lineWidth = 3;
        for (let y = 20; y < H; y += 12) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(W, y + 4);
          g.stroke();
        }
      });
      // 鼻緒（V字）
      for (const x of [W * 0.14, W * 0.86]) {
        g.beginPath();
        g.moveTo(W * 0.5, H * 0.16);
        g.quadraticCurveTo((x + W * 0.5) / 2, H * 0.2, x, H * 0.5);
        g.strokeStyle = INK;
        g.lineWidth = 22;
        g.stroke();
        g.strokeStyle = c[1];
        g.lineWidth = 12;
        g.stroke();
      }
      circle(g, W * 0.5, H * 0.16, 9, c[1]);
    },
  },
  {
    id: 'ryokan', name: '旅館の和風', base: 7000, blurb: '廊下の奥の、いい部屋の',
    colors: [
      { id: 'ai', name: '藍', c: ['#2c4a7a', '#e6dcc3'] },
      { id: 'shu', name: '朱', c: ['#c8352b', '#e6dcc3'] },
      { id: 'sumi', name: '墨', c: ['#2b2a28', '#d8cdb3'] },
    ],
    draw: (g, c) => {
      sole(g, '#9b7b4b', c[1]);
      inside(g, 10, () => {
        g.strokeStyle = 'rgba(120,98,60,.45)';
        g.lineWidth = 2;
        for (let x = 0; x < W; x += 8) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, H);
          g.stroke();
        }
      });
      strap(g, c[0], 0.12, 0.46, () => {
        g.strokeStyle = 'rgba(255,255,255,.75)';
        g.lineWidth = 3;
        for (let y = H * 0.14; y < H * 0.52; y += 20) {
          for (let x = -10; x < W + 20; x += 32) {
            g.beginPath();
            g.arc(x + ((y / 20) % 2) * 16, y, 14, Math.PI, 0);
            g.stroke();
          }
        }
      });
    },
  },
  {
    id: 'geta', name: '下駄', base: 9000, blurb: '下駄箱に、ついに本物の下駄',
    colors: [
      { id: 'shiraki', name: '白木', c: ['#e2c79a', '#e0453a'] },
      { id: 'kuro', name: '黒塗り', c: ['#2e2a27', '#e0453a'] },
      { id: 'shu', name: '朱塗り', c: ['#c8352b', '#2e2a27'] },
    ],
    draw: (g, c) => {
      g.beginPath();
      g.roundRect(14, 14, W - 28, H - 28, 26);
      g.fillStyle = c[0];
      g.fill();
      line(g);
      // 歯（2本）
      for (const y of [H * 0.3, H * 0.74]) {
        g.fillStyle = 'rgba(58,42,32,.35)';
        g.fillRect(22, y - 10, W - 44, 20);
      }
      g.strokeStyle = 'rgba(58,42,32,.2)';
      g.lineWidth = 2;
      for (let y = 30; y < H - 30; y += 16) {
        g.beginPath();
        g.moveTo(24, y);
        g.lineTo(W - 24, y + 3);
        g.stroke();
      }
      for (const x of [W * 0.16, W * 0.84]) {
        g.beginPath();
        g.moveTo(W * 0.5, H * 0.18);
        g.quadraticCurveTo((x + W * 0.5) / 2, H * 0.24, x, H * 0.54);
        g.strokeStyle = INK;
        g.lineWidth = 20;
        g.stroke();
        g.strokeStyle = c[1];
        g.lineWidth = 11;
        g.stroke();
      }
      circle(g, W * 0.5, H * 0.18, 9, c[1]);
    },
  },
  {
    id: 'kuma', name: 'くまのもこもこ', base: 12000, blurb: 'ふかふか。走ると少し暑い',
    colors: [
      { id: 'cha', name: '茶', c: ['#a8784a', '#e9d2b2'] },
      { id: 'shiro', name: '白', c: ['#f4efe6', '#e8c9b0'] },
      { id: 'pink', name: 'ピンク', c: ['#f0a8bf', '#fbe3ea'] },
    ],
    draw: (g, c) => {
      // もこもこの縁
      for (let i = 0; i < 26; i++) {
        const t = (i / 26) * Math.PI * 2;
        circle(g, W / 2 + Math.cos(t) * (W * 0.42), H * 0.5 + Math.sin(t) * (H * 0.44), 16, c[0], true);
      }
      ellipse(g, W / 2, H * 0.5, W * 0.42, H * 0.44, c[0], false);
      // 耳 → 顔
      circle(g, W * 0.22, H * 0.1, 20, c[0]);
      circle(g, W * 0.78, H * 0.1, 20, c[0]);
      circle(g, W * 0.22, H * 0.1, 9, c[1], false);
      circle(g, W * 0.78, H * 0.1, 9, c[1], false);
      circle(g, W * 0.36, H * 0.24, 6, INK, false);
      circle(g, W * 0.64, H * 0.24, 6, INK, false);
      ellipse(g, W * 0.5, H * 0.31, 22, 16, c[1]);
      ellipse(g, W * 0.5, H * 0.29, 8, 6, INK, false);
    },
  },
  {
    id: 'kingyo', name: '金魚', base: 15000, blurb: 'ひれがひらひら。水は要らない',
    colors: [
      { id: 'aka', name: '赤', c: ['#e0453a', '#f7c9a8', '#e0453a'] },
      { id: 'demekin', name: '出目金', c: ['#2b2a28', '#5b5a58', '#2b2a28'] },
      { id: 'sarasa', name: '更紗', c: ['#fbf4ea', '#e0453a', '#e0453a'] },
    ],
    draw: (g, c) => {
      // 尾びれ（かかと側）
      g.beginPath();
      g.moveTo(W * 0.5, H * 0.66);
      g.bezierCurveTo(W * 1.05, H * 0.8, W * 0.9, H * 1.02, W * 0.5, H * 0.9);
      g.bezierCurveTo(W * 0.1, H * 1.02, -W * 0.05, H * 0.8, W * 0.5, H * 0.66);
      g.fillStyle = c[2];
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
      line(g, 5);
      ellipse(g, W / 2, H * 0.42, W * 0.42, H * 0.34, c[0]);
      if (c[0] === '#fbf4ea') {
        ellipse(g, W * 0.4, H * 0.36, 30, 44, c[1], false, 0.4);
        ellipse(g, W * 0.64, H * 0.56, 24, 30, c[1], false, -0.3);
      }
      g.strokeStyle = 'rgba(58,42,32,.3)';
      g.lineWidth = 3;
      for (let y = H * 0.36; y < H * 0.68; y += 18) {
        for (let x = W * 0.24; x < W * 0.8; x += 22) {
          g.beginPath();
          g.arc(x, y, 10, 0.2, Math.PI - 0.2);
          g.stroke();
        }
      }
      const big = c[0] === '#2b2a28';
      for (const x of [W * 0.3, W * 0.7]) {
        circle(g, x, H * 0.18, big ? 22 : 13, '#ffffff');
        circle(g, x, H * 0.18, big ? 10 : 6, INK, false);
      }
    },
  },
  {
    id: 'tp', name: 'トイレットペーパー', base: 18000, blurb: '便所サンダルの、さらに上。もはや紙',
    /* ★2026-09-16 描き直し（本人「完全に円柱型でいい。スリッパに寄せると気持ち悪い」）。縦に立てたロール */
    colors: [
      { id: 'white', name: '白', c: ['#fbfaf6', '#d9d3c6', 'plain'] },
      { id: 'pink', name: 'ピンク', c: ['#f7cfdc', '#e3a6ba', 'plain'] },
      { id: 'hana', name: '花柄', c: ['#fbfaf6', '#d9d3c6', 'hana'] },
    ],
    draw: (g, c) => {
      const x0 = W * 0.1;
      const x1 = W * 0.9;
      const rx = (x1 - x0) / 2;
      const ry = 22;
      const top = 30;
      const bot = H - 30;
      // 胴（上は直線、下は楕円の手前半分）
      g.beginPath();
      g.moveTo(x0, top);
      g.lineTo(x0, bot);
      g.ellipse(W / 2, bot, rx, ry, 0, Math.PI, 0, true);
      g.lineTo(x1, top);
      g.closePath();
      g.fillStyle = c[0];
      g.fill();
      line(g);
      g.save();
      g.clip();
      // 右側の影で丸みを出す
      const sh = g.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(0.6, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(58,42,32,.2)');
      g.fillStyle = sh;
      g.fillRect(0, 0, W, H);
      if (c[2] === 'hana') {
        for (let i = 0; i < 12; i++) {
          const x = x0 + 14 + ((i * 47) % (x1 - x0 - 28));
          const y = top + 40 + ((i * 97) % (bot - top - 60));
          for (let p = 0; p < 5; p++) circle(g, x + Math.cos(p * 1.26) * 7, y + Math.sin(p * 1.26) * 7, 5, '#f08aa6', false);
          circle(g, x, y, 4, '#f2b632', false);
        }
      }
      // ミシン目
      g.strokeStyle = c[1];
      g.setLineDash([8, 7]);
      g.lineWidth = 3;
      for (let y = top + 70; y < bot; y += 70) {
        g.beginPath();
        g.ellipse(W / 2, y, rx, ry, 0, 0, Math.PI);
        g.stroke();
      }
      g.setLineDash([]);
      g.restore();
      // 上の面 → 芯 → 芯の穴
      ellipse(g, W / 2, top, rx, ry, c[0]);
      ellipse(g, W / 2, top, 26, 10, '#c9a77a');
      ellipse(g, W / 2, top + 1, 16, 5.5, '#6b5138', false);
      // たれた紙の端
      g.beginPath();
      g.moveTo(x1 - 3, top + 50);
      g.lineTo(x1 + 9, top + 56);
      g.lineTo(x1 + 9, top + 150);
      g.lineTo(x1 + 3, top + 142);
      g.lineTo(x1 - 3, top + 152);
      g.closePath();
      g.fillStyle = c[0];
      g.fill();
      line(g, 4);
    },
  },
  {
    id: 'penguin', name: 'ペンギン', base: 22000, blurb: 'よちよち走る。速さは変わらない',
    colors: [
      { id: 'kotei', name: 'コウテイ', c: ['#2c3440', '#f2b632'] },
      { id: 'adelie', name: 'アデリー', c: ['#1f2328', '#ffffff'] },
      { id: 'iwatobi', name: 'イワトビ', c: ['#2c3440', '#f7d23a'] },
    ],
    draw: (g, c) => {
      sole(g, '#f2a33a', c[0]);
      ellipse(g, W / 2, H * 0.6, W * 0.3, H * 0.28, '#fbf8f1', false);
      if (c[0] === '#2c3440' && c[1] === '#f2b632') ellipse(g, W / 2, H * 0.34, W * 0.26, H * 0.06, '#f5c860', false);
      circle(g, W * 0.36, H * 0.17, 8, '#ffffff', c[1] === '#ffffff');
      circle(g, W * 0.64, H * 0.17, 8, '#ffffff', c[1] === '#ffffff');
      circle(g, W * 0.36, H * 0.17, 4, INK, false);
      circle(g, W * 0.64, H * 0.17, 4, INK, false);
      g.beginPath();
      g.moveTo(W * 0.42, H * 0.22);
      g.lineTo(W * 0.58, H * 0.22);
      g.lineTo(W * 0.5, H * 0.29);
      g.closePath();
      g.fillStyle = '#f2a33a';
      g.fill();
      line(g, 4);
      if (c[1] === '#f7d23a') {
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(W * (0.5 + s * 0.14), H * 0.14);
          g.quadraticCurveTo(W * (0.5 + s * 0.4), H * 0.06, W * (0.5 + s * 0.46), H * 0.12);
          g.strokeStyle = c[1];
          g.lineWidth = 8;
          g.stroke();
        }
      }
      outlinePath(g);
      line(g);
    },
  },
  {
    id: 'loafer', name: 'おしゃれローファー', base: 28000, blurb: 'つま先が光る。スリッパのふりをしている',
    colors: [
      { id: 'brown', name: 'ブラウン', c: ['#7a4a2a', '#5a3420'] },
      { id: 'black', name: 'ブラック', c: ['#2a2624', '#141210'] },
      { id: 'wine', name: 'ワイン', c: ['#7d2433', '#591824'] },
    ],
    draw: (g, c) => {
      sole(g, '#3b2a1e', c[0]);
      strap(g, c[1], 0.3, 0.56, () => {
        g.beginPath();
        g.moveTo(W * 0.5, H * 0.36);
        g.lineTo(W * 0.62, H * 0.43);
        g.lineTo(W * 0.5, H * 0.5);
        g.lineTo(W * 0.38, H * 0.43);
        g.closePath();
        g.fillStyle = '#e9dcc5';
        g.fill();
        line(g, 4);
      });
      // ステッチ
      outlinePath(g, 18);
      g.setLineDash([6, 6]);
      g.strokeStyle = 'rgba(233,220,197,.7)';
      g.lineWidth = 2.5;
      g.stroke();
      g.setLineDash([]);
      shine(g, W * 0.38, H * 0.14, 26, 10);
      shine(g, W * 0.3, H * 0.72, 10, 30);
    },
  },
  {
    id: 'umi', name: '海のなかま', base: 36000, blurb: 'つま先で潮を吹く・かみつく・跳ねる',
    colors: [
      { id: 'same', name: 'サメ', c: ['#7d8c99', '#e9eef2'] },
      { id: 'kujira', name: 'クジラ', c: ['#3e6e9e', '#dfe9f2'] },
      { id: 'iruka', name: 'イルカ', c: ['#6fb3d9', '#eaf6fb'] },
    ],
    draw: (g, c) => {
      // 尾びれ
      g.beginPath();
      g.moveTo(W * 0.5, H * 0.78);
      g.lineTo(W * 0.12, H * 0.98);
      g.quadraticCurveTo(W * 0.5, H * 0.88, W * 0.88, H * 0.98);
      g.closePath();
      g.fillStyle = c[0];
      g.fill();
      line(g, 5);
      ellipse(g, W / 2, H * 0.44, W * 0.44, H * 0.38, c[0]);
      g.save();
      g.beginPath();
      g.ellipse(W / 2, H * 0.44, W * 0.44, H * 0.38, 0, 0, Math.PI * 2);
      g.clip();
      ellipse(g, W / 2, H * 0.62, W * 0.3, H * 0.3, c[1], false);
      g.restore();
      g.beginPath();
      g.ellipse(W / 2, H * 0.44, W * 0.44, H * 0.38, 0, 0, Math.PI * 2);
      line(g);
      circle(g, W * 0.3, H * 0.2, 6, INK, false);
      circle(g, W * 0.7, H * 0.2, 6, INK, false);
      if (c[0] === '#7d8c99') {
        // 歯 → 背びれ
        g.beginPath();
        g.moveTo(W * 0.28, H * 0.28);
        g.quadraticCurveTo(W * 0.5, H * 0.34, W * 0.72, H * 0.28);
        line(g, 5);
        for (let i = 0; i < 5; i++) {
          const x = W * (0.32 + i * 0.09);
          g.beginPath();
          g.moveTo(x - 6, H * 0.29);
          g.lineTo(x, H * 0.33);
          g.lineTo(x + 6, H * 0.29);
          g.fillStyle = '#ffffff';
          g.fill();
        }
        g.beginPath();
        g.moveTo(W * 0.4, H * 0.5);
        g.lineTo(W * 0.5, H * 0.34);
        g.lineTo(W * 0.62, H * 0.52);
        g.closePath();
        g.fillStyle = c[0];
        g.fill();
        line(g, 5);
      } else if (c[0] === '#3e6e9e') {
        for (const s of [-1, 0, 1]) {
          g.beginPath();
          g.moveTo(W * 0.5, H * 0.08);
          g.quadraticCurveTo(W * (0.5 + s * 0.1), -4, W * (0.5 + s * 0.3), 6);
          g.strokeStyle = '#8fd0f0';
          g.lineWidth = 7;
          g.stroke();
        }
      } else {
        g.beginPath();
        g.arc(W * 0.5, H * 0.24, 22, 0.2, Math.PI - 0.2);
        line(g, 5);
      }
    },
  },
  {
    id: 'rocket', name: 'ロケット', base: 45000, blurb: 'かかとから火が出る。出ているだけ',
    colors: [
      { id: 'white', name: '白', c: ['#f4f1ea', '#e0453a'] },
      { id: 'red', name: '赤', c: ['#d9473a', '#f4f1ea'] },
      { id: 'silver', name: '銀', c: ['#b9c0c8', '#3f7fc9'] },
    ],
    draw: (g, c) => {
      // 炎
      g.beginPath();
      g.moveTo(W * 0.3, H * 0.84);
      g.quadraticCurveTo(W * 0.5, H * 1.1, W * 0.7, H * 0.84);
      g.fillStyle = '#f2a33a';
      g.fill();
      line(g, 5);
      ellipse(g, W * 0.5, H * 0.9, 14, 18, '#f7d65c', false);
      // 羽
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(W * (0.5 + s * 0.26), H * 0.58);
        g.lineTo(W * (0.5 + s * 0.48), H * 0.86);
        g.lineTo(W * (0.5 + s * 0.24), H * 0.82);
        g.closePath();
        g.fillStyle = c[1];
        g.fill();
        line(g, 5);
      }
      // 胴
      g.beginPath();
      g.moveTo(W * 0.5, 8);
      g.bezierCurveTo(W * 0.86, H * 0.2, W * 0.8, H * 0.6, W * 0.72, H * 0.84);
      g.lineTo(W * 0.28, H * 0.84);
      g.bezierCurveTo(W * 0.2, H * 0.6, W * 0.14, H * 0.2, W * 0.5, 8);
      g.fillStyle = c[0];
      g.fill();
      line(g);
      g.save();
      g.clip();
      g.fillStyle = c[1];
      g.fillRect(0, 0, W, H * 0.16);
      g.restore();
      g.beginPath();
      g.moveTo(W * 0.24, H * 0.16);
      g.lineTo(W * 0.76, H * 0.16);
      line(g, 5);
      circle(g, W * 0.5, H * 0.38, 20, '#9fd3ef');
      shine(g, W * 0.45, H * 0.36, 7, 4);
    },
  },
  {
    id: 'sake', name: '割れた酒瓶', base: 55000, blurb: 'スリッパ判定。履けなくはない',
    colors: [
      { id: 'cha', name: '茶瓶', c: ['#8a4a1c', '#c47a3a'] },
      { id: 'midori', name: '緑瓶', c: ['#2f7a45', '#5fb07a'] },
      { id: 'issho', name: '一升瓶', c: ['#b8d6d8', '#e9f5f5'] },
    ],
    draw: (g, c) => {
      g.beginPath();
      g.moveTo(W * 0.38, H * 0.12);
      g.lineTo(W * 0.46, H * 0.04);
      g.lineTo(W * 0.52, H * 0.1);
      g.lineTo(W * 0.58, H * 0.02);
      g.lineTo(W * 0.62, H * 0.12);
      g.lineTo(W * 0.62, H * 0.3);
      g.bezierCurveTo(W * 0.9, H * 0.36, W * 0.9, H * 0.44, W * 0.9, H * 0.5);
      g.lineTo(W * 0.9, H - 12);
      g.lineTo(W * 0.1, H - 12);
      g.lineTo(W * 0.1, H * 0.5);
      g.bezierCurveTo(W * 0.1, H * 0.44, W * 0.1, H * 0.36, W * 0.38, H * 0.3);
      g.closePath();
      g.fillStyle = c[0];
      g.fill();
      line(g);
      g.beginPath();
      g.roundRect(W * 0.18, H * 0.52, W * 0.64, H * 0.28, 6);
      g.fillStyle = '#f4ecd8';
      g.fill();
      line(g, 5);
      text(g, '酒', W * 0.5, H * 0.66, 50, '#c8352b');
      shine(g, W * 0.24, H * 0.42, 6, 26);
      g.strokeStyle = c[1];
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W * 0.5, H * 0.12);
      g.lineTo(W * 0.42, H * 0.2);
      g.lineTo(W * 0.52, H * 0.26);
      g.stroke();
    },
  },
  {
    id: 'bh', name: 'ブラックホール', base: 80000, blurb: 'もはやスリッパではない。履けなくはない',
    /*
     * ★2026-09-16 描き直し（本人「スリッパとか度外視で、楕円形のブラックホールにしてほしい」）。
     * 暗い楕円の宇宙 → 重力で曲がって上下に回り込む光の輪 → 手前を横切る円盤 → 真ん中の黒い穴
     */
    colors: [
      { id: 'kuro', name: '漆黒', c: ['#07060a', '#fff1d6', '#ffb347'] },
      { id: 'murasaki', name: '紫', c: ['#0c0616', '#f4dcff', '#b06ae0'] },
      { id: 'enban', name: '降着円盤', c: ['#07060a', '#fff4c2', '#ff6a2a'] },
    ],
    draw: (g, c) => {
      const cx = W / 2;
      const cy = H / 2;
      const rx = W * 0.46;
      const ry = H * 0.47;
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = c[0];
      g.fill();
      g.save();
      g.clip();
      for (let i = 0; i < 70; i++) circle(g, (i * 67) % W, (i * 131) % H, i % 9 === 0 ? 2.2 : 1, '#ffffff', false);
      g.globalCompositeOperation = 'lighter';
      const R = W * 0.3;
      g.shadowColor = c[2];
      // 重力で曲がった光の輪（穴の上下に回り込む）
      for (const [w, a] of [[14, 0.25], [7, 0.55], [3, 1]] as const) {
        g.beginPath();
        g.ellipse(cx, cy, R * 1.05, R * 1.5, 0, 0, Math.PI * 2);
        g.strokeStyle = c[2];
        g.globalAlpha = a;
        g.lineWidth = w;
        g.shadowBlur = 18;
        g.stroke();
      }
      // 手前を横切る円盤
      for (const [w, col, a] of [[30, c[2], 0.35], [16, c[2], 0.7], [6, c[1], 1]] as const) {
        g.beginPath();
        g.ellipse(cx, cy + 4, W * 0.46, 16, 0, 0, Math.PI * 2);
        g.strokeStyle = col;
        g.globalAlpha = a;
        g.lineWidth = w;
        g.shadowBlur = 24;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'source-over';
      // 穴。**上半分は円盤より奥**（円盤の帯より上だけ覆う）、下半分は帯の下から覗く
      g.beginPath();
      g.arc(cx, cy - 6, R * 0.7, Math.PI, 0);
      g.closePath();
      g.fillStyle = '#000000';
      g.fill();
      g.beginPath();
      g.arc(cx, cy + 16, R * 0.62, 0.25, Math.PI - 0.25);
      g.closePath();
      g.fill();
      g.restore();
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      line(g);
    },
  },
  {
    id: 'legend', name: '伝説の光るスリッパ', base: 150000, glow: 'gold', blurb: '履いた者は、光る',
    colors: [
      { id: 'kin', name: '金', c: ['#f2c14e', '#fff3b0'] },
      { id: 'niji', name: '虹', c: ['rainbow', '#ffffff'] },
      { id: 'shikkoku', name: '漆黒', c: ['#1a1622', '#c9a0ff'] },
    ],
    draw: (g, c) => {
      const grad = g.createLinearGradient(0, 0, W, H);
      if (c[0] === 'rainbow') {
        ['#ff5a5a', '#ffb13b', '#ffe44d', '#5fd36a', '#4fb3ff', '#9a6cff'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
      } else {
        grad.addColorStop(0, c[1]);
        grad.addColorStop(0.5, c[0]);
        grad.addColorStop(1, c[1]);
      }
      outlinePath(g);
      g.fillStyle = grad;
      g.fill();
      line(g);
      strap(g, c[0] === 'rainbow' ? 'rgba(255,255,255,.55)' : c[0]);
      for (const [x, y, s] of [[0.3, 0.2, 16], [0.7, 0.62, 12], [0.4, 0.8, 9], [0.72, 0.28, 8]] as const) {
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const r = k % 2 === 0 ? s : s * 0.3;
          const t = (k / 8) * Math.PI * 2;
          g.lineTo(W * x + Math.cos(t) * r, H * y + Math.sin(t) * r);
        }
        g.closePath();
        g.fillStyle = '#ffffff';
        g.fill();
      }
    },
  },
  {
    id: 'whiteout', name: 'ホワイトアウト', base: 1000000, glow: 'white', single: true,
    blurb: '光りすぎて、もう見えない',
    colors: [{ id: 'mabushii', name: '見えない', c: ['#ffffff'] }],
    draw: (g) => {
      const grad = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.6);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#fff8dc');
      outlinePath(g);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(58,42,32,.15)';
      g.stroke();
    },
  },
  {
    id: 'iine', name: '言い値スリッパ', base: 0, single: true, iine: true,
    blurb: '値段は店主の気分。開くたびに変わる',
    colors: [{ id: 'kibun', name: '気分', c: ['#c9b79a', '#fbf8f1'] }],
    draw: (g, c) => {
      sole(g, '#efe6d6', c[0]);
      strap(g, '#8a7a62');
      // 値札
      g.beginPath();
      g.moveTo(W * 0.5, H * 0.46);
      g.lineTo(W * 0.62, H * 0.56);
      line(g, 3);
      g.save();
      g.translate(W * 0.6, H * 0.66);
      g.rotate(0.18);
      g.beginPath();
      g.roundRect(-44, -34, 88, 68, 8);
      g.fillStyle = c[1];
      g.fill();
      line(g, 5);
      text(g, '言い値', 0, -8, 24, '#e0453a');
      text(g, '¥ ?', 0, 18, 22, '#ffffff');
      g.restore();
    },
  },
];

/* ============================ 図鑑・値段 ============================ */

const MULT = [1, 1.3, 1.7];

/** ★覚えやすい値段に丸める（980・1,980・12,800 …） */
function charm(n: number): number {
  if (n <= 0) return 0;
  if (n < 10000) return Math.ceil(n / 100) * 100 - 20;
  if (n < 100000) return Math.ceil(n / 1000) * 1000 - 200;
  return Math.ceil(n / 10000) * 10000;
}

export const SLIPPERS: readonly SlipperItem[] = DESIGNS.flatMap((d) =>
  d.colors.map((col, i) => ({
    id: `${d.id}-${col.id}`,
    design: d.id,
    name: d.single ? d.name : `${d.name}（${col.name}）`,
    colorName: col.name,
    // ★いつもの赤だけは最初から持っている
    price: d.id === 'usual' && i === 0 ? 0 : charm(d.base * MULT[i]),
    glow: d.glow === 'gold' && col.id === 'niji' ? 'rainbow' : d.glow === 'gold' && col.id === 'shikkoku' ? 'dark' : d.glow,
    iine: d.iine,
    blurb: d.blurb,
  })),
);

export const DESIGN_LIST = DESIGNS.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb }));

export const FIRST_SLIPPER = 'usual-red';

/**
 * ★言い値の値段。**下駄箱を開くたびに振り直す**。
 * 1 コインのときもあれば 99,999 のときもある ＝ 開く理由になる（本人「言い値スリッパwww」）
 */
export function rollIine(): number {
  const r = Math.random();
  if (r < 0.06) return 1;
  if (r < 0.3) return Math.floor(100 + Math.random() * 900);
  if (r < 0.75) return Math.floor(1000 + Math.random() * 19000);
  return Math.floor(20000 + Math.random() * 79999);
}

/* ============================ 絵 ============================ */

const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
const textures = new Map<string, THREE.CanvasTexture>();

function canvasOf(id: string): HTMLCanvasElement {
  const hit = canvases.get(id);
  if (hit) return hit;
  const [did, cid] = id.split('-');
  const d = DESIGNS.find((x) => x.id === did) ?? DESIGNS[0];
  const col = d.colors.find((x) => x.id === cid) ?? d.colors[0];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  d.draw(g, col.c);
  canvases.set(id, c);
  return c;
}

/** 下駄箱・ルーレットの針に使う画像 URL */
export function slipperUrl(id: string): string {
  const hit = urls.get(id);
  if (hit) return hit;
  const u = canvasOf(id).toDataURL('image/png');
  urls.set(id, u);
  return u;
}

/** 3D に貼る絵 */
export function slipperTexture(id: string): THREE.CanvasTexture {
  const hit = textures.get(id);
  if (hit) return hit;
  const t = new THREE.CanvasTexture(canvasOf(id));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(id, t);
  return t;
}

export function slipperById(id: string): SlipperItem {
  return SLIPPERS.find((s) => s.id === id) ?? SLIPPERS[0];
}
