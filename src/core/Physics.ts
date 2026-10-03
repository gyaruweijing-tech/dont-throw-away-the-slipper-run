import RAPIER from '@dimforge/rapier3d-compat';
import { CFG } from '../config';

/**
 * ★★**当たり判定のワールド**（2026-09-19）。物理エンジン **Rapier** をそのまま使う。
 *
 * 出どころは自分の実験リポジトリ `Collision-Sim`（`docs/collision-basics.md`）。
 * そこで確かめた作法をこの1枚に移してある:
 *
 *  - **押し返し（ソルバ）は一切使わない。** 使うのは
 *    「**当たったことを検出する**」側だけ（同ドキュメント §5「当たっても止めない判定」）。
 *    群れを押し返すと隊列が崩壊して、このゲームが別物になる
 *  - 障害物のコライダーは **センサー**。個体と主人公のコライダーは**位置で動かす物体**
 *    （kinematic）。どちらも押し返されないので、Rapier は**検出専用**として回る
 *  - ★**`ActiveCollisionTypes.ALL` が要る。** Rapier の既定値は
 *    「**動く物体（dynamic）が絡む組み合わせだけ検出する**」なので、
 *    位置で動かす物体どうしは**既定のままだと1件も当たらない**。ここが唯一の落とし穴
 *  - 刻みは **1/60 固定**（同 §7）。画面の更新回数に判定を合わせない
 *
 * ★**Y は「判子」以外では見ない**（2.5D）。理由は実測で分かったことで、
 * 回転ハンマーの頭は**絵の上では y=1.42 より上**にある ―― 律儀に3Dで判定すると
 * **ハンマーが誰にも当たらなくなる**。走って避けるゲームなので、
 * 高さは `CFG.hit.wallTop` まで伸ばした箱で見る。**判子だけは本当に落ちてくるので Y を使う**。
 */

let ready = false;

/** WebAssembly を読む。**ホーム画面を出している間に呼ぶ**（1.2MB ほどある） */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

export function physicsReady(): boolean {
  return ready;
}

/** 当たり判定の箱1つ。**ワールド座標**（前方は -Z、`distance` は含めない相対系） */
export interface HitBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

/** 誰が当たったか。`AGENT` は群れの個体、`HERO` は主人公 */
export const HERO_ID = -1;

interface Slot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  live: boolean;
}

/** 障害物側の当たり（1つの障害物が複数の箱を持つ。ハンマーの頭は2つ） */
interface PartRef {
  /** 呼んだ側が付けた番号。ふつうは障害物の通し番号 */
  owner: number;
  /** 押し返しに使う箱（主人公だけ押し返す） */
  box: HitBox;
}

/**
 * 1フレーム分の当たりの結果。
 * `agents` は「その障害物に触れた個体の番号」、`hero` は主人公が触れたか。
 */
export interface HitReport {
  owner: number;
  agents: number[];
  /** 主人公が触れた箱。**押し返しは呼んだ側が解く**（ソルバは使っていない） */
  heroBoxes: HitBox[];
}

export class HitWorld {
  private readonly world: RAPIER.World;
  private readonly eq: RAPIER.EventQueue;

  /** 個体用のプール。**毎フレーム作り直さない**（Rapier の body 生成は安くない） */
  private readonly agentPool: Slot[] = [];
  /** 障害物の箱用のプール */
  private readonly partPool: Slot[] = [];
  private heroSlot: Slot | null = null;

  /** collider の handle → 個体番号 */
  private readonly agentOf = new Map<number, number>();
  /** collider の handle → 障害物の箱 */
  private readonly partOf = new Map<number, PartRef>();
  private readonly reports = new Map<number, HitReport>();

  private agentUsed = 0;
  private partUsed = 0;
  private heroUsed = false;

  constructor() {
    if (!ready) throw new Error('initPhysics() を先に呼んでください');
    // ★**重力ゼロ。** 落とすためではなく、当てるためだけのワールド
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.timestep = CFG.hit.dt;
    this.eq = new RAPIER.EventQueue(true);
  }

  // ---------------------------------------------------------------------
  // 書き込み
  // ---------------------------------------------------------------------

  /** そのフレームの書き込みを始める。**必ず最初に呼ぶ** */
  begin(): void {
    this.agentUsed = 0;
    this.partUsed = 0;
    this.heroUsed = false;
    this.agentOf.clear();
    this.partOf.clear();
    this.reports.clear();
  }

  /*
   * ★**位置は `setTranslation` で直接置く**（`setNextKinematicTranslation` は使わない）。
   * あれは「次のフレームでそこへ行け」という命令で、Rapier は**その移動ぶん囲み箱を膨らませる**
   * （`collision-basics.md` §6 の、すり抜けに強い仕組みそのもの）。
   * ★**プールを使い回すとスロットは毎フレーム別の障害物に化ける**ので、
   * その膨らみが**通り道にいた全員を巻き込む**。ここでは掃引は要らない
   */

  /** 群れの個体を1つ置く。`id` は呼んだ側の配列の添字 */
  putAgent(id: number, x: number, z: number): void {
    const s = this.take(this.agentPool, this.agentUsed++, () => this.makeBall(CFG.hit.agentR, false));
    s.body.setTranslation({ x, y: CFG.hit.agentY, z }, false);
    this.agentOf.set(s.collider.handle, id);
  }

  /** 主人公を置く。**主人公だけは押し返される**（本人指定） */
  putHero(x: number): void {
    if (!this.heroSlot) this.heroSlot = this.makeBall(CFG.crowd.heroHalf, false);
    // ★`live` も戻す（`take()` と同じ）。戻さないと一度切られたあと `disable()` が早期 return して二度と切れない
    this.heroSlot.collider.setEnabled(true);
    this.heroSlot.live = true;
    this.heroSlot.body.setTranslation({ x, y: CFG.hit.agentY, z: 0 }, false);
    this.agentOf.set(this.heroSlot.collider.handle, HERO_ID);
    this.heroUsed = true;
  }

  /** 障害物の箱を1つ置く。ハンマーのように頭が2つある障害物は2回呼ぶ */
  putPart(owner: number, box: HitBox): void {
    const s = this.take(this.partPool, this.partUsed++, () => this.makeBox());
    s.collider.setHalfExtents({ x: Math.max(0.01, box.hx), y: Math.max(0.01, box.hy), z: Math.max(0.01, box.hz) });
    s.body.setTranslation({ x: box.x, y: box.y, z: box.z }, false);
    this.partOf.set(s.collider.handle, { owner, box });
  }

  // ---------------------------------------------------------------------
  // 判定
  // ---------------------------------------------------------------------

  /**
   * 1ステップ進めて、始まった重なりを集める。
   * `Collision-Sim` の `simulation.ts` の `drainCollisionEvents` と同じ形。
   */
  step(): Map<number, HitReport> {
    // 使わなかったスロットは**切る**。位置を遠くへ飛ばすだけだと、
    // 群れが縮んだ回に「居ないはずの個体」が当たり続ける
    for (let i = this.agentUsed; i < this.agentPool.length; i++) this.disable(this.agentPool[i]);
    for (let i = this.partUsed; i < this.partPool.length; i++) this.disable(this.partPool[i]);
    if (!this.heroUsed && this.heroSlot) this.disable(this.heroSlot);

    this.world.step(this.eq);

    this.eq.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const p = this.partOf.get(h1) ?? this.partOf.get(h2);
      if (!p) return;
      const who = this.agentOf.get(h1) ?? this.agentOf.get(h2);
      if (who === undefined) return;
      let r = this.reports.get(p.owner);
      if (!r) {
        r = { owner: p.owner, agents: [], heroBoxes: [] };
        this.reports.set(p.owner, r);
      }
      if (who === HERO_ID) r.heroBoxes.push(p.box);
      else r.agents.push(who);
    });

    return this.reports;
  }

  // ---------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------

  private take(pool: Slot[], i: number, make: () => Slot): Slot {
    let s = pool[i];
    if (!s) {
      s = make();
      pool[i] = s;
    }
    /*
     * ★**`live` を戻すのを忘れない**（2026-09-19 に実際に踏んだ）。
     * `disable()` は `live` を見て早く帰るので、ここで戻さないと
     * **一度切ったスロットが二度と切られなくなる** ＝ 前のフレームの障害物が
     * その場に残って当たり続ける。実機で「32m 先のとげで人が減る」として出た
     */
    if (!s.live) {
      s.collider.setEnabled(true);
      s.live = true;
    }
    return s;
  }

  private disable(s: Slot): void {
    if (!s.live) return;
    s.collider.setEnabled(false);
    s.live = false;
  }

  private makeBall(r: number, sensor: boolean): Slot {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const desc = RAPIER.ColliderDesc.ball(r)
      .setSensor(sensor)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    const collider = this.world.createCollider(desc, body);
    return { body, collider, live: true };
  }

  private makeBox(): Slot {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    const collider = this.world.createCollider(desc, body);
    return { body, collider, live: true };
  }
}

let shared: HitWorld | null = null;

/** 共有の当たり判定ワールド。`initPhysics()` のあとに呼ぶ */
export function hitWorld(): HitWorld {
  if (!shared) shared = new HitWorld();
  return shared;
}
