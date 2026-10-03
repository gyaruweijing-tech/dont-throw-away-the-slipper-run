import * as THREE from 'three';
import { CFG } from '../config';

const P = CFG.palette;
const A = CFG.boss.arena;

/**
 * ★**バトルリング**（2026-08-28・参考画像 `assets/ref/01-arena-inkpad.jpg`）。
 *
 * 本人の言葉:「**ボス戦になると床も少し変わります。バトルリングのような場所に出て、
 * そこに HP を持った一匹の大きいボスがいる**」。
 *
 * ★**絵は「朱肉のマット」を真上から見た形。** 同心円だけで作れるので、新しい素材は要らない。
 * 朱＝減るものの色なので、**床が朱に変わるだけで「ここは危ない」が言葉なしで伝わる**（§4-D）。
 *
 * ★**群れに隠れることは織り込み済み。** 読ませたいのは中心ではなく
 * **「床が変わったこと」**なので、**半径をコース幅より大きく**して端をはみ出させる。
 * 社員の輪（半径 3.2m・群れに完全に埋もれて「何をされているか分からない」と言われた）と
 * 同じ失敗を繰り返さないための設計。
 */
export class Arena {
  readonly group = new THREE.Group();
  private readonly parts: THREE.Mesh[] = [];

  constructor() {
    const R = A.radius;
    /*
     * 外から内へ。参考画像の層の順:
     *   濃い茶の縁 → 明るいタンの縁 → 白いちぎれ縁 → 朱の面 → 中心の濃いにじみ
     * ★**白いちぎれ縁が「紙をちぎった」感の要**なので、細くても必ず入れる
     */
    this.ring(R * A.rimInnerR, R, 0x6b5138);      // 濃い茶の縁
    this.ring(R * A.edgeR, R * A.rimInnerR, 0xa9855c); // 明るいタンの縁
    this.ring(R * A.discR, R * A.edgeR, P.paper);      // 白いちぎれ縁
    this.ring(0, R * A.discR, P.stamp);                // 朱の面
    this.ring(0, R * A.blotR, 0x9e2a21);               // 中心のにじみ

    for (const m of this.parts) this.group.add(m);
    this.group.visible = false;
  }

  private ring(inner: number, outer: number, color: number): void {
    const geo = new THREE.RingGeometry(inner, outer, A.seg);
    /*
     * ★**路面の上に確実に乗せる。** `depthWrite: false` ＋ `renderOrder` は
     * 社員の輪（`Syain.ts`）と同じ作法。z ファイティングで路面の格子が透けるのを防ぐ
     */
    const mat = new THREE.MeshBasicMaterial({ color, depthWrite: false, fog: true });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = A.y;
    m.renderOrder = this.parts.length;   // 内側の層ほど後に描く
    m.frustumCulled = false;
    this.parts.push(m);
  }

  /** @param z ボスからの相対距離（ゲート・障害物と同じ座標の作り方） */
  place(z: number): void {
    this.group.visible = true;
    this.group.position.z = z;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    for (const m of this.parts) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
