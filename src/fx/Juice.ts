import * as THREE from 'three';
import { CFG } from '../config';
import { fmtCount } from '../entities/gateOps';

interface Pop {
  el: HTMLElement;
  pos: THREE.Vector3;
  life: number;
  max: number;
}

/**
 * 数字ポップ（PROGRESS §7 fx/Juice.ts）。Phase 2 はこれだけ。
 * カメラシェイク・紙吹雪は Phase 6。
 *
 * 3D スプライトではなく **DOM をワールド座標に貼る**。数字はどの距離でも同じ大きさで
 * くっきり読める必要があり、遠近で小さくなると「増えた」実感がむしろ減る。
 */
export class Juice {
  private readonly layer: HTMLElement;
  private readonly pops: Pop[] = [];
  private readonly v = new THREE.Vector3();
  /** 減った瞬間の赤ビネット（§5 #5）。0..1。毎フレーム減衰させるだけの単純な状態 */
  private readonly flashEl: HTMLElement;
  private flashT = 0;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = `
      .pop-layer { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
      .pop { position:absolute; transform:translate(-50%,-50%); font-weight:900;
             font-size:38px; letter-spacing:.02em; font-variant-numeric:tabular-nums;
             white-space:nowrap; will-change:transform,opacity; }
      .pop-gain { color:#2b2a28; }
      .pop-loss { color:#c8352b; }
      /* 判子と同じ朱（#c8352b）。虹色にはしない（§4-I の語彙） */
      .pop-flash { position:absolute; inset:-8%; opacity:0; pointer-events:none;
                   background:radial-gradient(ellipse at center,
                     rgba(200,53,43,0) 52%, rgba(200,53,43,.5) 100%); }
    `;
    parent.appendChild(style);
    this.layer = document.createElement('div');
    this.layer.className = 'pop-layer';
    parent.appendChild(this.layer);
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'pop-flash';
    parent.appendChild(this.flashEl);
  }

  /** @param delta 差分。符号で色と記号が決まる */
  /**
   * 減った瞬間に呼ぶ（§5 #5）。連続して呼ばれてもピークだけ残す（`CameraRig.pulse` と同じ思想）。
   * **「増えてるのか減ってるのか分からん」への画面側の答えがこれ**（本人指摘 2026-08-22）
   */
  flash(amount: number): void {
    this.flashT = Math.max(this.flashT, amount);
  }

  /** @param text ★上限のない人数のときの差の書き方（`fmtDiff`）。省略すると `delta` から書く */
  popCount(x: number, delta: number, text?: string): void {
    const gain = delta >= 0;
    const el = document.createElement('div');
    el.className = `pop ${gain ? 'pop-gain' : 'pop-loss'}`;
    el.textContent = (gain ? '+' : '\u2212') + (text ?? fmtCount(Math.abs(delta)));
    this.layer.appendChild(el);
    this.pops.push({
      el,
      pos: new THREE.Vector3(x, CFG.gate.y + 0.6, 0),
      life: 0.85,
      max: 0.85,
    });
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    // 減衰しきった後は毎フレーム書き続けない（§6 性能予算）
    if (this.flashT > 0) {
      this.flashT *= Math.exp(-8 * dt);
      if (this.flashT < 0.01) this.flashT = 0;
      this.flashEl.style.opacity = this.flashT.toFixed(2);
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.max;
      this.v.copy(p.pos).project(camera);
      const px = (this.v.x * 0.5 + 0.5) * w;
      const py = (-this.v.y * 0.5 + 0.5) * h - t * 70;
      // 出た瞬間だけ大きく。0.15秒で等倍に落として読ませる
      const scale = 1 + Math.max(0, 0.5 - t * 3.4);
      p.el.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(3)})`;
      p.el.style.left = `${px.toFixed(1)}px`;
      p.el.style.top = `${py.toFixed(1)}px`;
      p.el.style.opacity = t > 0.65 ? ((1 - t) / 0.35).toFixed(2) : '1';
    }
  }
}
