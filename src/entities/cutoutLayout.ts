/**
 * 紙の切り抜きキャラの「設計データ」（`PLAN.md` 第1節）。
 *
 * **ここには絵を描くコードを一切置かない。** 置くのは
 *  - アトラスの中のどこにどのパーツがあるか（`uv`）
 *  - そのパーツをローカル空間のどこに、どの大きさで置くか（`x/y/w/h`）
 *  - どの関節で折れるか（`part` / `pivot`）
 * だけ。**絵そのものは外部の PNG**（`assets/v2/char/*.png`）で、差し替えはファイルの上書きで済む。
 *
 * この分離を守る理由: 絵をコードで描くと「腕を少し太くしたい」が**コードの修正**になり、
 * アセットとロジックが密結合して調整コストが跳ね上がる（外部レビューの指摘・採用）。
 */

import { PART } from './Stickman';

/** アトラスの1マス。0..1 の UV 矩形 */
export interface AtlasRect {
  u: number;
  v: number;
  w: number;
  h: number;
}

export interface CutoutPart {
  /** アトラスのどこを使うか */
  rect: AtlasRect;
  /**
   * ★**この板だけ色を塗り替えてよいか**（2026-09-14・コインの使い道）。
   * いまは**主人公が掲げるスリッパ**だけが使う
   */
  recolor?: boolean;
  /** ローカル空間での中心と大きさ（全高 1.75 を基準） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 頂点シェーダのパーツID（`stickman.vert` と一致させること） */
  part: number;
  /** 折れ目。ここを軸に回る */
  pivot: [number, number, number];
  /**
   * 前後の重なり順。**わずかな値でよい。**
   *
   * 同一平面のクアッドはアルファテストだと必ず Z ファイトする。
   * かといって大きくずらすと透視投影で視差が出て関節が千切れて見える、という指摘があった。
   * → 実測: カメラ距離 5〜30m でこの程度のずれが生む画面上の視差は**サブピクセル未満**。
   *   `polygonOffset` はマテリアル単位なので、1つのアトラスに統合した今の作りでは使えない。
   *   **ローカル Z の微小オフセットが、この構成では唯一かつ十分な解。**
   */
  z: number;
  /** 左右反転して使うか（腕と脚は片方の絵を反転して使う） */
  mirror?: boolean;
  /** 地面に寝かせるか（接地影だけ true） */
  flat?: boolean;
}

/**
 * アトラスは 4×4 のマス目。1マス = 512px（2048×2048 のとき）。
 *
 * ★**セルの端ぴったりを参照してはいけない。**
 *
 * ミップマップ＋線形フィルタでは、縮小時に**隣のマスの色が混ざる**（にじみ）。
 * うちのキャラは画面上で 16〜32px まで縮むので、深いミップ段が確実に使われる。
 * 例えば「頭（肌色）」の隣が「胴（紺）」なので、遠くの群衆の頭に紺が混ざる。
 *
 * 対策は2段構え:
 *  1. **UV を内側へ寄せる**（ここ。`INSET`）
 *  2. **絵の側にも余白を持たせる**（`tools/gen-atlas.js` の `PAD`）
 * 片方だけでは足りない。UVだけ寄せても、絵がセルの端まで描かれていれば
 * ミップ段で混ざる色が「隣の絵」のままだから。
 */
const G = 1 / 4;
/**
 * ★**セルの端ぴったりを参照しない**ための内寄せ。**UV の値**（テクセル数ではない）。
 *
 * ★★**2026-09-15 に調べ直した。** コメントは「**2048px のアトラスで 8テクセル**」と書いてあったが、
 * **いまのアトラスは 1024px**（`public/assets/atlas.png`）なので、この文は古い。
 * ★**ただし数字のほうは正しい。**
 *   `8 / 2048` ＝ 0.0039 ＝ **セル幅（`G` ＝ 0.25）の 1.56%**。
 *   2048 のとき: 512px セルの 1.56% ＝ **8 テクセル**
 *   1024 のいま: 256px セルの 1.56% ＝ **4 テクセル**
 * ★**「セルの何%内側へ寄せるか」は変わっていない**ので、アトラスを半分にしても釣り合っている。
 * ★**`pack-atlas.mjs` の `PAD` は 5px** なので、4テクセルの内寄せは**余白の内側に収まる**（はみ出さない）。
 * ★**だから今回は数字を動かさなかった** ―― 動かすと**輪郭のにじみ方が変わる**うえに、
 * 本人が「絵は今で確定」と言ったのは**この状態**だから。
 */
const INSET = 8 / 2048;
const cell = (col: number, row: number): AtlasRect => ({
  u: col * G + INSET,
  v: 1 - (row + 1) * G + INSET,
  w: G - INSET * 2,
  h: G - INSET * 2,
});

/** アトラスのマス割り。**PNG を作る側もこの表に従う**（`tools/gen-atlas.md`） */
export const SLOT = {
  allyHead: cell(0, 0),
  allyBody: cell(1, 0),
  allyArm: cell(2, 0),
  allyLeg: cell(3, 0),
  allyPaper: cell(0, 1),
  heroArmUp: cell(1, 1),
  heroSlipper: cell(2, 1),
  hrHead: cell(0, 2),
  hrBody: cell(1, 2),
  hrArm: cell(2, 2),
  hrLeg: cell(3, 2),
  syainHead: cell(0, 3),
  syainBody: cell(1, 3),
  syainArm: cell(2, 3),
  syainLeg: cell(3, 3),
  /** 接地影。**空いていたマスをそのまま使う** */
  shadow: cell(3, 1),
} as const;

/*
 * ★★**2026-09-13: 本番の絵に差し替えたので、骨格の数字を全部引き直した。**
 *
 * 仮の絵（`gen-atlas.js` がコードで描いていたもの）は**8頭身に近い棒人間**だったが、
 * 本番の絵は**頭が大きい**（しかも主人公は**頭の上に鶏が乗る**ので、頭の板は身長の半分近い）。
 * 古い `HIP 0.74 / SHOULDER 1.30` のままだと、**関節が体の外で折れる**。
 *
 * ★**数字は当てずっぽうではなく `node tools/pack-atlas.mjs` が出したもの**。
 * 元絵の画素の位置を「身長1.75・足元 y=0・体の中心 x=0」に換算して印字する。
 * **絵を描き直したら、道具をもう一度走らせてここへ書き写す**のが決まった手順。
 */
const HIP = 0.41;
const SHOULDER = 0.88;

/**
 * 味方1体ぶんの構成。**6枚**（頭・胴・腕2・脚2）＋ 手に持つ書類。
 *
 * 板は「絵の外接矩形」なので、実際の輪郭より少し大きい。
 * **のりしろ（関節で重なる余白）は絵の側に持たせる**ので、ここでは
 * 板を関節側へ少し伸ばしておくだけでよい。
 */
/**
 * 接地影。**キャラのジオメトリに1枚含める。**
 *
 * 最初は独立した InstancedMesh として実装したが、実機で**1ピクセルも描かれなかった**
 * （シーンにあり・可視・行列も正常・三角形もラスタライズされているのに出ない）。
 * 原因の切り分けに時間を使うより、**すでに確実に動いている経路（キャラのアトラス）に
 * 相乗りするほうが速くて壊れない**と判断した。
 * 副産物として、影がキャラと必ず同じ数・同じ位置に出るのでズレようがない。
 */
function shadowPart(w = 0.86): CutoutPart {
  return {
    rect: SLOT.shadow, x: 0, y: 0.03, w, h: w * 0.62,
    part: PART.shadow, pivot: [0, 0, 0], z: 0, flat: true,
  };
}

export function allyParts(): CutoutPart[] {
  return [
    shadowPart(),
    /*
     * ★★**2026-09-13 夜: 左右が逆だった**（本人「太ももから先が空白で、その左右に足がついているみたい」）。
     *
     * 切り出したのは**左脚**（元絵で x がマイナス側）なのに、
     * **反転していない絵を右側（プラス）に置いて**いた。
     * ★**板の中身は左右対称ではない** —— 太ももは内側、スリッパの広がりは外側にある。
     * 逆に置くと**太ももが外へ・広がりが内へ**来るので、**真ん中が空いて、脚が左右に離れて見える**。
     *
     * ★**`pack-atlas.mjs` のプレビューが正しく見えていたのは、切った側にそのまま置いていたから。**
     * プレビューと実機で見え方が違ったら、**まず置き方（この符号）を疑う**こと。
     * 原則: **反転しない板は、切り出した側に置く。**
     */
    { rect: SLOT.allyLeg, x: -0.16, y: 0.20, w: 0.34, h: 0.42,
      part: PART.legL, pivot: [-0.16, HIP, 0], z: 0.012 },
    { rect: SLOT.allyLeg, x: 0.16, y: 0.20, w: 0.34, h: 0.42,
      part: PART.legR, pivot: [0.16, HIP, 0], z: 0.012, mirror: true },

    { rect: SLOT.allyBody, x: 0, y: 0.68, w: 0.40, h: 0.61,
      part: PART.torso, pivot: [0, 0, 0], z: 0 },

    // ★頭は**鶏ごと**。だから板が身長の半分近い（`w 0.56 / h 0.86`）
    { rect: SLOT.allyHead, x: 0, y: 1.34, w: 0.56, h: 0.86,
      part: PART.head, pivot: [0, 0, 0], z: 0.024 },

    // ★腕も同じ（切り出したのは左腕）。逆に置くと袖の内と外が入れ替わって「棒」に見える
    { rect: SLOT.allyArm, x: -0.26, y: 0.65, w: 0.14, h: 0.52,
      part: PART.armL, pivot: [-0.26, SHOULDER, 0], z: 0.036 },
    { rect: SLOT.allyArm, x: 0.26, y: 0.65, w: 0.14, h: 0.52,
      part: PART.armR, pivot: [0.26, SHOULDER, 0], z: 0.036, mirror: true },

    // 書類は `armL` と一緒に振れる。★だから armL と同じ側（マイナス）に置く
    { rect: SLOT.allyPaper, x: -0.40, y: 0.44, w: 0.22, h: 0.26,
      part: PART.armL, pivot: [-0.26, SHOULDER, 0], z: 0.048 },
  ];
}

/** 主人公。書類のかわりに**腕を上げてスリッパを掲げる**（掲げた腕は振らない＝PART.torso） */
/**
 * 接地影だけを取り出したもの。
 *
 * **主人公は横移動で体を傾ける**（`player.rotation.z`）。
 * 影を体と同じメッシュに入れておくと**影まで一緒に傾いて地面から浮く**。
 * 群衆は回転しないので無害だが、主人公だけは分ける必要がある（外部レビューの指摘）。
 */
export function shadowOnly(): CutoutPart[] {
  return [shadowPart(0.95)];
}

export function heroParts(): CutoutPart[] {
  const base = allyParts()
    .filter((p) => p.rect !== SLOT.allyPaper && p.part !== PART.armL)
    // 影は別メッシュにするので、体からは外す
    .filter((p) => p.part !== PART.shadow);
  return [
    ...base,
    /*
     * ★掲げた腕。**下ろした腕を上下反転したもの**（`pack-atlas.mjs` が作る）なので、
     * 幅と高さは下ろした腕と同じ。肩から上へ伸ばす
     */
    { rect: SLOT.heroArmUp, x: -0.26, y: SHOULDER + 0.47, w: 0.14, h: 0.52,
      part: PART.torso, pivot: [0, 0, 0], z: 0.036 },
    /*
     * ★**縦持ちに戻した**（2026-09-13・本人「以前は盾持ちになっていた、今は盾持ちだね」）。
     * 元絵のスリッパは横向きなので、**アトラスに詰めるときに90度まわしてある**（`pack-atlas.mjs`）。
     * 頭の板は鶏ごとで上端が 1.77 まであるので、
     * 肩からの高さを足して**スリッパが 1.65〜1.95** に来るようにした。
     * ここが目印なので、**群れに埋もれた時点で役目を果たしていない**
     */
    { rect: SLOT.heroSlipper, recolor: true, x: -0.28, y: SHOULDER + 1.00, w: 0.34, h: 0.74,
      part: PART.torso, pivot: [0, 0, 0], z: 0.030 },
  ];
}

/**
 * 敵。**役職として描き分ける**ので、絵は別スロット。
 *
 * ★★**2026-09-13: 骨格を共通にするのをやめた。**
 * 仮の絵のときは2人とも同じ棒人間だったので1つの骨格で足りたが、
 * 本番の絵は**人事部（スカート・縦長）と社員（ずんぐり・裸足）で体型がまるで違う**。
 * 共通にすると、どちらかが必ず伸びる。★数字は `node tools/pack-atlas.mjs` の出力。
 *
 * ★**腕はどちらも振らない**（`PART.torso`）。
 * 社員はセーターの袖が胴と1枚に描かれていて分離できないため、**同じ場所に重ねて元の絵に戻す**。
 * 人事部は腕を分離できているので、殴る動きを付ける日に `armL/armR` へ移せる
 */
export function rivalParts(kind: 'hr' | 'syain'): CutoutPart[] {
  const s = kind === 'hr'
    ? { head: SLOT.hrHead, body: SLOT.hrBody, arm: SLOT.hrArm, leg: SLOT.hrLeg }
    : { head: SLOT.syainHead, body: SLOT.syainBody, arm: SLOT.syainArm, leg: SLOT.syainLeg };
  const m = kind === 'hr'
    ? { legSign: -1, armSign: 1, legX: 0.22, legY: 0.14, legW: 0.30, legH: 0.29, bodyY: 0.70, bodyW: 0.65, bodyH: 0.92,
        headY: 1.42, headW: 0.66, headH: 0.68, armX: 0.38, armY: 0.62, armW: 0.41, armH: 0.61 }
    : { legSign: -1, armSign: -1, legX: 0.18, legY: 0.15, legW: 0.39, legH: 0.31, bodyY: 0.59, bodyW: 0.81, bodyH: 0.67,
        headY: 1.31, headW: 0.78, headH: 0.91, armX: 0.29, armY: 0.41, armW: 0.20, armH: 0.30 };
  return [
    // ★**反転しない板は、切り出した側に置く**（`legSign` / `armSign`）。逆にすると内と外が入れ替わる
    { rect: s.leg, x: m.legX * m.legSign, y: m.legY, w: m.legW, h: m.legH, part: PART.torso, pivot: [0, 0, 0], z: 0.012 },
    { rect: s.leg, x: -m.legX * m.legSign, y: m.legY, w: m.legW, h: m.legH, part: PART.torso, pivot: [0, 0, 0], z: 0.012, mirror: true },
    { rect: s.body, x: 0, y: m.bodyY, w: m.bodyW, h: m.bodyH, part: PART.torso, pivot: [0, 0, 0], z: 0 },
    { rect: s.head, x: 0, y: m.headY, w: m.headW, h: m.headH, part: PART.torso, pivot: [0, 0, 0], z: 0.024 },
    { rect: s.arm, x: m.armX * m.armSign, y: m.armY, w: m.armW, h: m.armH, part: PART.torso, pivot: [0, 0, 0], z: 0.036 },
    { rect: s.arm, x: -m.armX * m.armSign, y: m.armY, w: m.armW, h: m.armH, part: PART.torso, pivot: [0, 0, 0], z: 0.036, mirror: true },
  ];
}
