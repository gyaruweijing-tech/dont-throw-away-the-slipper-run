import * as THREE from 'three';
import { CFG } from '../config';

const P = CFG.palette;
/** ★48 → 120（2026-09-16）。巨大なボスが倒れた砂煙で一度に 60 個ほど使う */
const MAX = 120;
/** 濃い茶の輪郭。**この作品で「線」を引く唯一の方法**（BossFigure と同じ手） */
const INK = 0x4a3524;

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  rot: number;
  t: number;
  life: number;
  r0: number;
}

/**
 * ★**殴り合いの煙**（2026-09-06・本人指定）。
 *
 * 本人の言葉:「**「ぽかぽかぽか」みたいな、煙とか出る闘っている感じのエフェクトがほしい。
 * 実質何もできなくて見てるだけだけど「戦っているな」っていう感じを感じさせることだけが大事**」。
 *
 * ★**これは「情報」ではなく「気分」を出すための部品。**
 * 数字（HP バー・人数）は別に出ているので、煙は読ませなくてよい。
 * だから**当たり判定にも計算にも一切関与しない**——消しても遊びは変わらない、が正しい状態。
 *
 * ─────────────────────────────────────────────
 * ★★**2026-09-06 夜。本人の実プレイで「煙のエフェクトがないな」——バグだった。**
 *
 * ★**真犯人は色でも大きさでもなく、`Game.update()` の早期 return。**
 * `burst()` は殴り合いのたびに呼ばれていたのに、`puffs.update()` は共通部にしか無く、
 * **ボス戦中は共通部の手前で return していた**（社員を止めるために置いた return）。
 * ＝ 生きている煙が1フレームも進まず `mesh.count` が 0 のまま。
 * ★**いちばん要る場面だけ、煙が止まっていた。** 詳しくは `Game.ts` の該当箇所のコメント。
 *
 * 見つける前に「色が薄いのでは」と当たりを付けて**作りも変えてある**（こちらは無駄ではない）:
 *  - 前庭の床は `0xe8ded0`（明るい）。**明るい床の上の薄い灰**は、動いていても読めない
 *  - この世界の物は**全部が濃い茶の輪郭を持つ**（`BossFigure`）。輪郭の無い面は浮かない
 * → 本人の言う「**アニメの喧嘩の煙**」（もくもくした雲・白黒のポン）に寄せ、
 *   **輪郭付きの白い雲**にして、消えるのは色ではなく**大きさ**でやる。
 * ★大きさは実機で2回直している（大きすぎるとボスも群衆も隠れる。`burst` のコメント）
 * ─────────────────────────────────────────────
 *
 * 作りは `Scraps`（紙片）と同じ「1つの InstancedMesh を使い回す」形。
 * ★**新しい素材は作らない。** 輪郭は「一回り大きい濃い茶を後ろに敷く」だけ（`BossFigure` と同じ）
 */
export class Puffs {
  /** 白い本体 */
  readonly mesh: THREE.InstancedMesh;
  /** 輪郭（一回り大きい濃い茶）。**本体より先に描く** */
  readonly outline: THREE.InstancedMesh;
  private readonly live: Puff[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1, 1, 1);

  constructor() {
    const geo = cloudGeometry();
    // **陰影を付けない。** 光の当たり方で灰色に沈むと、また「見えない」に戻る（印紙で一度やらかしている）
    const mat = new THREE.MeshBasicMaterial({ color: P.paper });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;   // 輪郭より手前
    this.mesh.count = 0;

    this.outline = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: INK }), MAX);
    this.outline.frustumCulled = false;
    this.outline.renderOrder = 6;   // 群衆より手前・本体より奥
    this.outline.count = 0;
  }

  /**
   * ぶつかっている場所に煙を散らす。
   * @param n 出す数。**多すぎると画面が白くなって群衆が読めない**ので呼ぶ側で絞る
   */
  burst(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.live.length >= MAX) break;
      const a = Math.random() * Math.PI * 2;
      this.live.push({
        x: x + Math.cos(a) * (0.7 + Math.random() * 2.6),
        y: y + Math.random() * 1.9,
        z: z + (Math.random() - 0.5) * 2.2,
        vx: Math.cos(a) * (0.8 + Math.random() * 1.2),
        vy: 1.0 + Math.random() * 1.4,
        // 1つずつ違う向きに傾ける。**揃っていると印刷物に見える**
        rot: Math.random() * Math.PI * 2,
        t: 0,
        life: 0.42 + Math.random() * 0.3,
        /*
         * ★**大きさは実機で決めた**（2026-09-06 夜）。0.85〜1.6 にしたら
         * **ボスも群衆も雲で隠れて何が起きているか読めなくなった**（`.shots` で確認）。
         * 煙は「気分」の担当で、**読ませたいものを隠してはいけない**
         */
        r0: 0.45 + Math.random() * 0.42,
      });
    }
  }

  /**
   * ★★**砂煙**（2026-09-16・本人「床まで倒れたら砂煙みたいなのが立つはず。もくもく」）。
   * 殴り合いの煙（`burst`）と同じ形・同じ色で、**大きく・ゆっくり・長く**するだけ（新しい語彙は足さない）。
   * 倒れた体の長さに沿って並べる
   * @param z0 足元の z / @param z1 頭の z（倒れた先）
   */
  dust(x: number, width: number, z0: number, z1: number, n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.live.length >= MAX) break;
      const u = Math.random();
      const a = (Math.random() - 0.5) * Math.PI;
      this.live.push({
        x: x + (Math.random() - 0.5) * width,
        y: 0.4 + Math.random() * 1.6,
        z: z0 + (z1 - z0) * u,
        vx: Math.sin(a) * (1.5 + Math.random() * 3.5),
        vy: 1.6 + Math.random() * 2.4,
        rot: Math.random() * Math.PI * 2,
        t: -Math.random() * 0.25,
        life: 1.5 + Math.random() * 1.1,
        r0: 1.6 + Math.random() * 2.2,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      if (p.t >= p.life) { this.live.splice(i, 1); continue; }
      if (p.t < 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 1.6 * dt;   // 上がって、止まる
    }

    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      const u = Math.max(0, p.t) / p.life;
      /*
       * ★**大きさだけで生き死にを出す**（色では出さない）。
       * 出た瞬間に一番大きく（ポン）、最後は 0 に落ちて消える。
       * 透過で薄れさせると、明るい床の上では**薄れる前から見えていない**のと同じになる
       */
      const r = p.r0 * pop(u);
      this.v.set(p.x, p.y, p.z);
      this.e.set(0, 0, p.rot + u * 0.5);
      this.q.setFromEuler(this.e);
      this.sc.set(r, r, 1);
      this.m.compose(this.v, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      // 輪郭は一回り大きく、ほんの少し奥
      this.v.z -= 0.05;
      this.sc.set(r + 0.12, r + 0.12, 1);
      this.m.compose(this.v, this.q, this.sc);
      this.outline.setMatrixAt(i, this.m);
    }
    this.mesh.count = this.live.length;
    this.outline.count = this.live.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.outline.instanceMatrix.needsUpdate = true;
  }

  /** レベルをまたぐときに消す。**残すと次の走行の頭で前の煙が出る** */
  clear(): void {
    this.live.length = 0;
    this.mesh.count = 0;
    this.outline.count = 0;
  }
}

/**
 * 出るときは速く、消えるときも速い。**真ん中で一番大きい**。
 * 線形に膨らませると「湧いて出て、居座って、消えた」に見える
 */
function pop(u: number): number {
  if (u < 0.22) return u / 0.22;              // ポン、と出る
  const k = (u - 0.22) / 0.78;
  return 1 + k * 0.35 - k * k * 1.35;         // ふくらんで、しぼんで 0
}

/**
 * ★**雲の形**。半径を波打たせた多角形1枚。
 * 円だと「玉」に見えて、アニメの喧嘩の煙にならない（本人の言う画は白黒のポン）。
 * 8角形すら作らずに済むよう、**ここで作った1枚を本体と輪郭で共有する**
 */
function cloudGeometry(): THREE.BufferGeometry {
  const lobes = 7;
  const seg = 56;
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    // 波打ちの深さ。0.18 くらいが「もくもく」に見える下限（浅いとただの円）
    const r = 1 + Math.sin(a * lobes) * 0.2 + Math.sin(a * (lobes * 2) + 1.1) * 0.05;
    pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  const idx: number[] = [];
  for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
