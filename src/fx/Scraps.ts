import * as THREE from 'three';
import { CFG } from '../config';

interface Scrap {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  spin: number; rot: number;
  life: number;
}

const MAX = 96;

/**
 * 紙片（PROGRESS §8 Phase 3「グレー化→紙片離脱演出」）。
 *
 * 味方が離脱した位置から紙切れが1枚舞う。**書類の語彙（§4-I）が、減った瞬間にだけ出る**。
 * 上限つきの使い回しなので、大群が一度に削れても枚数は増えない
 * （増やすと「たくさん減った」ではなく「画面が汚い」になる）。
 */
export class Scraps {
  readonly mesh: THREE.InstancedMesh;
  private readonly items: Scrap[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.22, 0.3),
      new THREE.MeshBasicMaterial({ color: CFG.palette.paper, side: THREE.DoubleSide }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  spawn(x: number, z: number): void {
    if (this.items.length >= MAX) return;
    this.items.push({
      x, y: 0.9 + Math.random() * 0.5, z,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.1 + Math.random() * 1.2,
      // 後方 = +Z。離脱の向きと揃える
      vz: 2.2 + Math.random() * 2.4,
      spin: (Math.random() - 0.5) * 9,
      rot: Math.random() * Math.PI,
      life: 0.75 + Math.random() * 0.35,
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      p.vy -= 5.2 * dt;      // 落ちる
      p.vx *= 1 - 2.4 * dt;  // 空気抵抗。紙なので減速が早い
      p.vz *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
    }

    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      this.v.set(p.x, Math.max(0.02, p.y), p.z);
      this.e.set(p.rot * 0.6, p.rot, p.rot * 0.35);
      this.q.setFromEuler(this.e);
      this.s.setScalar(Math.min(1, p.life * 3));
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
