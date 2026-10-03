import { CFG } from '../config';

/**
 * 横移動入力（§4-A）。
 * PC: A/D・←/→・マウスドラッグ ／ モバイル: ドラッグ。
 * レーン制ではなく連続値を返す。Poki 推奨の「マウスのみで遊べる」を満たす。
 */
export class Input {
  /** 目標X（コース座標） */
  targetX = 0;

  /**
   * 動く床に押される（§14-B・動く床）。**playerX だけ動かしても意味がない** —
   * バネが targetX へ引き戻すので、押しとバネが釣り合った位置で止まって「押された」に見えない。
   * 狙いそのものをずらして、**自分で操作し直させる**のが動く床の役目。
   */
  nudge(dx: number): void {
    this.targetX = clamp(this.targetX + dx, -this.halfWidth, this.halfWidth);
  }
  /** 一度でも操作されたか。チュートリアルの指アイコンを消す判定に使う（§3） */
  touched = false;

  private keyLeft = false;
  private keyRight = false;
  private dragging = false;
  private lastPointerX = 0;
  private halfWidth: number;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement, halfWidth: number) {
    this.el = el;
    this.halfWidth = halfWidth;

    addEventListener('keydown', this.onKey, { passive: true });
    addEventListener('keyup', this.onKey, { passive: true });
    el.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
  }

  setHalfWidth(w: number): void {
    this.halfWidth = w;
    this.targetX = clamp(this.targetX, -w, w);
  }

  update(dt: number): void {
    let dir = 0;
    if (this.keyLeft) dir -= 1;
    if (this.keyRight) dir += 1;
    if (dir !== 0) {
      this.touched = true;
      this.targetX += dir * CFG.lateral.keySpeed * dt;
      this.targetX = clamp(this.targetX, -this.halfWidth, this.halfWidth);
    }
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    this.el.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
  }

  private onKey = (e: KeyboardEvent): void => {
    const down = e.type === 'keydown';
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA': this.keyLeft = down; break;
      case 'ArrowRight':
      case 'KeyD': this.keyRight = down; break;
    }
  };

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastPointerX = e.clientX;
    this.touched = true;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;
    // 画面が狭いほど1pxの重みを上げる（狭い画面で端まで届かない事故を防ぐ）。
    // 900px 幅の画面でちょうど `dragScale` m/px になる ＝ config の但し書きどおりの意味。
    //
    // ★ここに `* 24` が掛かっていた（2026-09-20 に実機で判明）。
    // 倍率を掛けると `dragScale` が「1pxあたりの移動量」でなくなるうえ、
    // **指 7.6px で壁から壁まで** 飛ぶ（iPhone 縦・画面幅の 1.9%）。
    // タッチのブレがそのまま最大移動になるので、スマホでは操作ではなく暴れになる。
    // 9/14 の `dragScale .028→.022` が効かなかったのはこの 24 が支配していたため。
    const scale = CFG.lateral.dragScale * (900 / Math.max(360, innerWidth));
    this.targetX = clamp(this.targetX + dx * scale, -this.halfWidth, this.halfWidth);
  };

  private onUp = (): void => {
    this.dragging = false;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
