import * as THREE from 'three';
import { CFG } from '../config';

/**
 * ゲート（PROGRESS §4-C）。Phase 2 の本体。
 *
 * 決定事項:
 *  1. **判定は群衆の中心X のみ**（§4-B の粒度表）。個体で判定すると群れが分裂して
 *     「どっちを選んだか」が曖昧になり、暗算の緊張が消える
 *  2. **記号だけで表す**（`+30` `×2` `−10` `÷2`）。文字を一切出さないので翻訳不要。
 *     §4-D の罪状アイコンと同じ思想
 *  3. **色は書類の語彙**（§4-I）。増える枠＝紙の白に黒インク、減る枠＝判子の赤。
 *     本家の蛍光グリーン／レッドはなぞらない（訂正1: 完コピは審査に落ちる）
 *  4. ラベルは CanvasTexture で実行時に描く。**外部フォント・画像を1バイトも積まない**
 */

export { applyOp, isGain, gateLabel, pickIndex, pickBounds } from './gateOps';
export type { GateOp, GateChoice } from './gateOps';

import { isGain, gateLabel, type GateChoice } from './gateOps';

export interface GateRowSpec {
  /** 走行距離がこの値に達した瞬間が通過タイミング */
  at: number;
  choices: GateChoice[];
}

const TEX_W = 320;
const TEX_H = 176;
const PAPER = '#efe9dc';
const INK = '#2b2a28';
const STAMP = '#c8352b';
/** 得の色（§ASSETS.md）。増える枠はこちらで塗る */
const GAIN = '#2f4b7c';

/** 1枚の枠。プールして使い回す（生成と破棄を繰り返すと GC でカクつく） */
export class GatePanel {
  readonly mesh: THREE.Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(geo: THREE.PlaneGeometry) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      opacity: CFG.gate.opacity,
      // 上下に並ぶ半透明の板なので、深度を書くと後ろの枠が欠ける
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * 枠の中身を描き直す。テクスチャは作り直さない。
   *
   * @param count ★**いまの人数**（2026-09-21）。**色をこれで決める。**
   *
   * ★★**前は「増える札の一覧」を手で持っていた**（`MATH_ALWAYS_GAIN`）が、
   * **`Γ(n)` と `Fₙ` は人数しだいで向きが変わる**ので、**一覧にどう書いても必ず嘘になった**
   * （本人の実機「赤色なのに、通ったら数が増えた」）。★**一覧をやめて、その場で計算に聞く。**
   */
  paint(c: GateChoice, count = 0, over = 0): void {
    // **増える枠は藍、減る枠は朱。** どちらも同じ濃さで塗ることで、
    // 「どちらが得か」ではなく「どちらが増える枠か」が色だけで即座に読める。
    // 大小の比較（＝このゲームの本体）は数字が引き受けたままなので、判断は簡単になっていない
    const gain = isGain(c, count, over);
    const bg = gain ? GAIN : STAMP;
    const fg = PAPER;
    const g = this.ctx;

    g.clearRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = bg;
    g.fillRect(0, 0, TEX_W, TEX_H);

    // 二重罫の枠 ＝ 書類の見た目（§4-I）。単なる縁取りより「様式」に見える
    g.strokeStyle = fg;
    g.lineWidth = 12;
    g.strokeRect(6, 6, TEX_W - 12, TEX_H - 12);
    g.lineWidth = 3;
    g.strokeRect(24, 24, TEX_W - 48, TEX_H - 48);

    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 96px "Segoe UI", system-ui, -apple-system, sans-serif';
    // maxWidth を必ず渡す。×ゲートで桁が伸びると枠から溢れて読めなくなる
    g.fillText(gateLabel(c), TEX_W / 2, TEX_H / 2 + 4, TEX_W - 64);

    this.tex.needsUpdate = true;
  }

  /**
   * ★**伏せ札**（2026-08-26）。中身を「？」で隠す。
   *
   * ★**背景色を藍にも朱にもしない。** `paint` は増える枠を藍・減る枠を朱で塗るので、
   * そのまま隠すと**色で答えが漏れる**。紙色の無地にして、色でも中身を出さない
   */
  paintHidden(): void {
    const g = this.ctx;
    g.clearRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.strokeStyle = STAMP;
    g.lineWidth = 12;
    g.strokeRect(6, 6, TEX_W - 12, TEX_H - 12);
    g.lineWidth = 3;
    g.strokeRect(24, 24, TEX_W - 48, TEX_H - 48);
    g.fillStyle = STAMP;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 120px "Segoe UI", system-ui, -apple-system, sans-serif';
    g.fillText('?', TEX_W / 2, TEX_H / 2 + 4, TEX_W - 64);
    this.tex.needsUpdate = true;
  }

  place(x: number, z: number, width: number, scaleY: number, alpha: number): void {
    this.mesh.visible = alpha > 0.01;
    this.mesh.position.set(x, CFG.gate.y * scaleY, z);
    this.mesh.scale.set(width, CFG.gate.height * scaleY, 1);
    this.mat.opacity = CFG.gate.opacity * alpha;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.tex.dispose();
    this.mat.dispose();
  }
}

/**
 * ゲートの門柱。枠の境界（左端・選択肢の間・右端）に立てる縦棒。
 * これがないと枠は「宙に浮いた看板」にしか見えず、「くぐる物」に見えない。
 * プールして使い回す（GatePanel と同じ理由）
 */
export class GatePost {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(geo: THREE.BoxGeometry) {
    this.mat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, fog: true });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // 枠(renderOrder=2)より先に描く。奥行きのある柱として見えてほしいので depthWrite は既定のまま
    this.mesh.renderOrder = 1;
  }

  place(x: number, z: number, height: number, alpha: number): void {
    this.mesh.visible = alpha > 0.01;
    this.mesh.position.set(x, height / 2, z);
    this.mesh.scale.set(CFG.gate.postWidth, height, CFG.gate.postWidth);
    this.mat.opacity = alpha;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mat.dispose();
  }
}
