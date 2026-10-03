import * as THREE from 'three';
import { CFG, type DigitHit } from '../config';
import { bigLog, fromLog, type Big } from './gateOps';
import type { HitWorld } from '../core/Physics';
import { buildCutoutGeometry, createCutoutMaterial } from './Cutout';
import { allyParts } from './cutoutLayout';
import { charAtlas } from '../tex/atlas';
import { paperGrain } from '../tex/paper';

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.507°

export interface Agent {
  /** ヒマワリのスロット番号。生きている限り動かさない（隊列が暴れない理由） */
  slot: number;
  x: number;
  z: number;
  scale: number;
  phase: number;
  tint: number;
  fade: number;
  leaving: boolean;
  /** true = 聞き取りの壇へ送り出した。グレー化させず前方へ歩かせる */
  sent: boolean;
  /**
   * ★**弾き飛ばされた向き**（2026-09-15・本人「**道のはじに飛んで消えていくでいい**」）。
   * 0 = ふつうの離脱（後ろへ歩き去る）。±1 = その向きへ**道の端まで飛ぶ**。
   * ★**当たったことが目に見える**ようにするための唯一の手段 ――
   * ゆっくり歩き去る絵だと、**当たった瞬間と減った瞬間が結びつかない**（本人「視覚的にわからず、数字だけが上下する」）
   */
  blast: number;
  life: number;
}

/**
 * 群衆（PROGRESS §4-B）。Phase 1 の本体。
 *
 * 決定事項:
 *  1. ヒマワリ配置 — slot i は常に同じ相対位置。増減しても既存メンバーが動かない＝ジッターしない
 *  2. バネ追従を外周ほど遅らせる — 曲がったときに群れが「たわむ」。質量が出る
 *  3. 横に潰して奥に伸ばす — 真円のまま太らせるとコース幅を埋め尽くし、横移動できなくなって
 *     ゲートが選べなくなる。楕円にして横を抑え、増えたぶんは後ろへ伸ばす
 *  4. 見た目の横半径に上限 — 超えたぶんは個体を縮め、縮小の下限を割った領域は描画しない
 *     （人数は正しいまま伸びる）
 *
 * 人数の帳尻は reconcile 1箇所に集約する。
 * 論理人数と「実体＋湧き待ち」を別々に足し引きすると必ずズレる（実際にズレて群衆が消えた）。
 */
export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;

  /** 味方が1体湧いた瞬間。SE の粒に使う（Phase 2） */
  onSpawn?: () => void;
  /** 味方が1人グレー化した瞬間の座標。紙片の演出に使う（Phase 3） */
  onLeave?: (x: number, z: number) => void;
  /**
   * 抜けかたを切り替える。
   * `leave` = 説得された／黙った（グレー化して後方へ・紙片が舞う・§4-G）
   * `send`  = 聞き取りの壇へ送り出した（色はそのまま前方へ歩く・§4-E）。**意味が正反対なので混ぜない**
   */
  departMode: 'leave' | 'send' = 'leave';
  /**
   * 障害物・NPC が奪えない最後の1人（§4-E の「0段・扉が閉じたまま」は残す）。
   * **最後の1人まで事故で持っていかれると、負けが自分の選択の結果に見えなくなる。**
   * ゲートは `setCount` を通るのでこの床の対象外 ＝ 自分で選んだ損は 0 まで行ける
   */
  minSurvivors = CFG.minSurvivors;

  private logical = 0;
  /**
   * ★★**10³⁰⁰ を越えてはみ出した桁**（2026-09-26・理系用の人数を無限に）。本当の人数 ＝ `logical × 10^over`。
   * ★**絵・当たり判定・ボス・壇は `logical`（10³⁰⁰ まで）だけを見る**。減るときは比で `over` も減らす（`renorm`）
   */
  over = 0;
  /** ★**桁を奪うダメージ**（理系用だけ。`Game.enter` が入れる）。`null` ならダメージは今までどおり */
  digitHit: DigitHit | null = null;
  /** ★**当たり判定が読む**（2026-09-19）。並びは物理へ書く順＝報告で返る番号 */
  readonly agents: Agent[] = [];
  private pendingSpawn = 0;
  private spawnAcc = 0;
  private centerX = 0;
  private k = 1;
  private nextSlot = 1;
  private freeSlots: number[] = [];

  private readonly maxDrawable: number;
  private readonly radiusMaxX: number;
  private readonly radiusMaxZ: number;
  private kz = 1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly phaseAttr: THREE.InstancedBufferAttribute;
  private readonly fadeAttr: THREE.InstancedBufferAttribute;
  private readonly tintAttr: THREE.InstancedBufferAttribute;

  constructor() {
    const c = CFG.crowd;
    this.radiusMaxX = CFG.courseWidth * c.radiusRatioX;
    this.radiusMaxZ = CFG.courseWidth * c.radiusRatioZ;
    this.maxDrawable = Math.min(
      c.maxInstances,
      Math.floor((this.radiusMaxX / (c.minScale * c.slotC * c.squashX)) ** 2),
    );

    // **紙の切り抜きに置き換えた**（`PLAN.md` 第1節）。板6枚＝24頂点で、箱の1/10
    const geo = buildCutoutGeometry(allyParts());
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(c.maxInstances), 1);
    this.fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(c.maxInstances), 1);
    geo.setAttribute('aPhase', this.phaseAttr);
    geo.setAttribute('aFade', this.fadeAttr);
    this.tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(c.maxInstances).fill(1), 1);
    geo.setAttribute('aTint', this.tintAttr);

    this.material = createCutoutMaterial(charAtlas(), { grain: paperGrain(512) });
    this.mesh = new THREE.InstancedMesh(geo, this.material, c.maxInstances);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** 論理人数（HUD に出すのはこちら） */
  get count(): number {
    return this.logical;
  }

  /** 描画されている実体数。描画上限に当たっているかの確認用 */
  get drawn(): number {
    return this.agents.length;
  }

  /**
   * 横の絞り（1 = 通常 / 小さいほど細い列になる）。**窓口を通ったあとの後遺症**（§14-B-3）。
   * 細い間は印紙を拾える幅も、障害物に当たる幅も狭くなる ＝ 得も損もある状態になる。
   * `k`（人数による全体スケール）とは別に持つ。同じ変数にすると人数まで縮んで見える
   */
  squeeze = 1;

  /** 見た目の横半径。カメラの後退量と、横移動できる範囲の計算に使う */
  get visualRadiusX(): number {
    const c = CFG.crowd;
    return Math.min(c.slotC * Math.sqrt(this.logical + 1) * c.squashX, this.radiusMaxX) * this.squeeze;
  }

  /** 見た目の奥行き半径。カメラがこれを追い越すと群れがカメラの後ろに回り込む */
  get visualRadiusZ(): number {
    const c = CFG.crowd;
    return Math.min(c.slotC * Math.sqrt(this.logical + 1) * c.stretchZ, this.radiusMaxZ);
  }

  /**
   * ★**論理人数の蓋**。ふつう／ハードは `CFG.crowd.maxCount`（99,999）、
   * ★**理系用は `MATH_MAX`**（2026-09-26・本人「上限を撤廃」）。`Game.enter` がモードで差し替える
   */
  cap: number = CFG.crowd.maxCount;

  /** §4-C: 増える。一括生成は禁止なので、キューに積んで1体ずつ湧かせる */
  add(n: number): void {
    if (n <= 0) return;
    /*
     * ★**論理人数の蓋**（2026-09-20・本人「人数に上限は持たせて」）。
     * ★**増える道はここ1本**（`setCount` も増えるときはここを通る）なので、
     * 蓋は1か所で足りる。2か所に書くと、このリポジトリが何度も踏んでいる
     * 「同じことを判断している行が2つ」になる
     */
    this.logical = Math.min(this.logical + n, this.cap);
    this.reconcile();
  }

  /** §4-G: 減る。死なない。グレーになって離れていく */
  remove(n: number): number {
    const actual = Math.min(Math.max(0, n), this.logical);
    const before = this.logical;
    this.logical -= actual;
    this.renorm(before);
    this.reconcile();
    return actual;
  }

  /** ★**上限のない人数を入れる**（理系用のゲート）。`setCount` は `over` を 0 に戻す */
  setBig(b: Big): void {
    this.setCount(b.n);
    this.over = b.over;
  }

  /**
   * ★★**桁を奪う**（2026-09-26・理系用）。持っている桁（log₁₀）の `frac` 割を減らす。
   * 桁が `digitHit.from` 以下では効かず、`to` で満額（人数が少ないうちは今までと同じ手触り）。
   * ★**最低人数（`minSurvivors`）は割らない**（障害物・一団と同じ約束）
   * @returns 実際に減らした桁
   */
  shrinkDigits(frac: number): number {
    const d = this.digitHit;
    if (!d || frac <= 0) return 0;
    const L = bigLog(this.logical, this.over);
    const ramp = Math.min(1, Math.max(0, (L - d.from) / (d.to - d.from)));
    if (ramp <= 0) return 0;
    const floor = Math.log10(Math.max(1, this.minSurvivors));
    const next = Math.max(floor, L - L * Math.min(1, frac) * ramp);
    const b = fromLog(next);
    this.logical = b.n;
    this.over = b.over;
    this.reconcile();
    return L - next;
  }

  /** 本当の人数（`over` 込み） */
  get big(): Big {
    return { n: this.logical, over: this.over };
  }

  /**
   * ★**減ったぶんを、はみ出した桁にも比で効かせる**。10⁵⁰⁰ 人から 30人減っても誤差、
   * 半分に減れば桁も log₁₀2 だけ減る。`logical` が 10³⁰⁰ を割ったら、桁を戻してふつうの数にする
   */
  private renorm(before: number): void {
    if (this.over <= 0 || before <= 0) return;
    const L = bigLog(this.logical, this.over);
    const b = fromLog(L);
    this.logical = b.n;
    this.over = b.over;
  }

  setCount(n: number): void {
    this.over = 0;
    const target = Math.max(0, Math.floor(n));
    if (target > this.logical) this.add(target - this.logical);
    else if (target < this.logical) {
      this.remove(this.logical - target);
      /*
       * ★**引き算の結果ではなく、狙った数をそのまま入れる**（2026-09-26・理系用の上限撤廃で見つけた）。
       * 10³⁰⁰ −（10³⁰⁰ − 8）は浮動小数では **0** になる ＝ **大きい人数の走行のあと「もう一回」すると 0人で始まり即終了**
       */
      this.logical = target;
      this.reconcile();
    }
  }

  /**
   * ★**引き算しても「残すはずの人数」を割らない**（2026-09-26）。
   * 10¹⁵ 人から「最低人数を残して全部」を引くと、浮動小数の丸めで 0 になることがある
   */
  private minus(n: number): number {
    return Math.max(Math.min(this.logical, this.minSurvivors), this.logical - n);
  }

  /*
   * ★★★**2026-09-19: ここにあった `hitBurst` と `overlaps` を消した。**
   *
   * あれは「**群れ全体を包む1本の帯**」と「**障害物の横幅**」の重なり率でダメージを出していた。
   * 個体の座標を一度も見ていないので、**当たっていない人が減り、当たった人が残った**。
   * 本人の実機フィードバック（「当たってもいないのに勝手にダメージが入る」「ハンマーに被ったけど
   * 何も起こらない」）は全部ここが出どころで、`hitLead` や `wide * 0.5` の手当てはその対症療法だった。
   * いまは **Rapier が個体ごとに当てる**（`src/core/Physics.ts`）。
   */

  /**
   * ★★**当たり判定のワールドへ、いまの個体を書き出す**（2026-09-19・Rapier）。
   *
   * 書くのは**離脱していない個体だけ**。弾き飛ばされている最中の人を書くと、
   * **同じ人が2回も3回も当たる**（`docs/notes/` の「片側だけのテスト」と同じ型の穴）。
   * 番号は `this.agents` の添字。**報告はこの番号で返ってくる**
   */
  writeHitBodies(hit: HitWorld): void {
    const n = this.agents.length;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      if (a.leaving) continue;
      hit.putAgent(i, a.x, a.z);
    }
  }

  /**
   * ★★**当たった個体を消し、論理人数を `loss` だけ減らす**（2026-09-19）。
   *
   * ★**「誰が消えるか」と「何人減るか」を分けるための唯一の入口。**
   * 本人の指定:「**当たった範囲＝ダメージにするからダメ。ダメージロジックと描画は別問題**」。
   *  - **誰が消えるか** … 物理が「実際に触れた」と言った個体。ここに嘘が無いので絵が正しくなる
   *  - **何人減るか** … 呼ぶ側が3段階で決めた `loss`。触れた実体数とは切り離す
   *
   * 触れた実体より `loss` が大きいときは、`reconcile` が外周から自動で剥がす
   * （人数の帳尻は reconcile 1箇所、という §13 Phase 1 の原則をここでも守る）。
   *
   * @returns 実際に減った論理人数
   */
  strike(hits: readonly number[], loss: number): number {
    const room = Math.max(0, this.logical - this.minSurvivors);
    if (room <= 0 || loss <= 0) return 0;

    for (const i of hits) {
      const a = this.agents[i];
      if (!a || a.leaving) continue;
      // ★近いほうの端へ弾き飛ばす（道の中心から見て外側）
      this.markLeaving(a, a.x >= this.centerX ? 1 : -1);
      if (this.departMode === 'leave') this.onLeave?.(a.x, a.z);
    }

    const n = Math.min(room, Math.max(1, Math.round(loss)));
    const before = this.logical;
    this.logical = this.minus(n);
    this.renorm(before);
    this.reconcile();
    return n;
  }

  /** 円の中を離脱させる（社員の騒音の輪）。輪は円で描くので判定も円で取る */
  removeInCircle(cx: number, cz: number, r: number, limit = Infinity): number {
    const r2 = r * r;
    return this.removeWhere((a) => {
      const dx = a.x - cx;
      const dz = a.z - cz;
      return dx * dx + dz * dz <= r2;
    }, limit);
  }

  /**
   * 離脱の唯一の入口。
   *
   * **描画上限ぶんの被害スケールがここに入っている。** 論理 5000 人でも実体は 839 体しか
   * 居ないので、当たった実体数をそのまま引くと大群ほど障害物が効かなくなる。
   * 実体1体 = 論理 (logical/実体数) 人ぶんとして換算する。
   * 人数の帳尻は reconcile 1箇所という原則（§13 Phase 1）はここでも守る。
   */
  private removeWhere(hitFn: (a: Agent) => boolean, limit: number): number {
    const hit: Agent[] = [];
    for (const a of this.agents) {
      if (!a.leaving && hitFn(a)) hit.push(a);
    }
    if (hit.length === 0) return 0;

    // 外周（slot が大きい）から削る。ヒマワリ配置なので「外側から欠ける」が自動で出る
    hit.sort((p, q) => q.slot - p.slot);
    const active = this.activeCount();
    const room = Math.max(0, this.logical - this.minSurvivors);
    if (room <= 0) return 0;
    const take = Math.min(hit.length, limit, active);
    const perAgent = active > 0 ? this.logical / active : 1;

    for (let i = 0; i < take; i++) {
      this.markLeaving(hit[i]);
      if (this.departMode === 'leave') this.onLeave?.(hit[i].x, hit[i].z);
    }
    const loss = Math.min(room, Math.max(take, Math.round(take * perAgent)));
    const before = this.logical;
    this.logical = this.minus(loss);
    this.renorm(before);
    this.reconcile();
    return loss;
  }

  update(dt: number, centerX: number): void {
    const c = CFG.crowd;
    this.centerX = centerX;

    // --- 湧き。まとめて出さず1体ずつ。ただし総数によらず一定時間で出し切る ---
    if (this.pendingSpawn > 0) {
      const rate = Math.max(c.spawnMinRate, this.pendingSpawn / c.spawnBurst);
      this.spawnAcc += rate * dt;
      while (this.pendingSpawn > 0 && this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this.spawn();
      }
    } else {
      this.spawnAcc = 0;
    }

    // --- 横半径の上限 → 個体スケール。奥行きは別途詰める（密になるだけで見た目の破綻はない） ---
    const nn = this.agents.length + 1;
    const rx = c.slotC * Math.sqrt(nn) * c.squashX;
    const rz = c.slotC * Math.sqrt(nn) * c.stretchZ;
    this.k = Math.min(1, this.radiusMaxX / Math.max(rx, 1e-6));
    this.kz = Math.min(1, this.radiusMaxZ / Math.max(rz, 1e-6));
    const bias = -Math.min(rz, this.radiusMaxZ) * c.formationBias; // 前方 = -Z

    // --- 追従と離脱 ---
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];

      if (a.leaving) {
        a.life -= dt;
        if (a.sent) {
          // 壇へ向かう。前方 = -Z。色は変えない（信じてくれた人がそのまま登っていく）
          a.z -= c.leaveBack * 1.3 * dt;
          a.x += (centerX - a.x) * dt * 1.2;
        } else if (a.blast !== 0) {
          /*
           * ★★**弾き飛ばす**（2026-09-15）。**道の端へ飛んで消える。**
           * 障害物と反対向きにこだわらない（本人「**反対でなくても道のはじに飛んで消えていくでいい**」）。
           * ★**速いことが本質。** ゆっくり歩き去ると「当たって減った」に見えない
           */
          a.x += a.blast * c.blastSpeed * dt;
          a.z += c.leaveBack * 0.35 * dt;
          a.fade = Math.min(1, a.fade + dt * 4);
        } else {
          a.z += c.leaveBack * dt; // 後方 = +Z
          a.x += (a.x >= centerX ? 1 : -1) * dt * 1.4;
          a.fade = Math.min(1, a.fade + dt * 5);
        }
        a.scale = Math.max(0, a.scale - dt / (a.blast !== 0 ? c.leaveLife * 0.62 : c.leaveLife));
        if (a.life <= 0 || a.scale <= 0.001) this.agents.splice(i, 1);
        continue;
      }

      const sx = slotX(a.slot);
      const sz = slotZ(a.slot);
      const tx = centerX + sx * this.k * this.squeeze;
      const tz = sz * this.kz + bias;

      // 外周ほど追従を遅らせる ＝ 曲がったときに群れがたわむ（§5 のチェック項目）
      const rr = Math.min(1, Math.abs(sx) / this.radiusMaxX);
      const follow = c.follow * (1 - c.followLagOuter * rr);
      const f = 1 - Math.exp(-follow * dt);
      a.x += (tx - a.x) * f;
      a.z += (tz - a.z) * f;
      a.scale += (this.k - a.scale) * Math.min(1, dt * c.scaleRise);
    }

    this.writeInstances();
  }

  /**
   * 人数の帳尻を合わせる唯一の場所。
   * 不変条件: 生きている実体 + 湧き待ち === min(論理人数, 描画上限)
   */
  private reconcile(): void {
    const target = Math.min(this.logical, this.maxDrawable);
    const have = this.activeCount() + this.pendingSpawn;
    if (have < target) {
      this.pendingSpawn += target - have;
      return;
    }
    let excess = have - target;
    if (excess <= 0) return;
    const fromQueue = Math.min(this.pendingSpawn, excess);
    this.pendingSpawn -= fromQueue;
    excess -= fromQueue;
    if (excess > 0) this.detachOutermost(excess);
  }

  private activeCount(): number {
    let n = 0;
    for (const a of this.agents) if (!a.leaving) n++;
    return n;
  }

  private spawn(): void {
    this.pendingSpawn--;
    this.onSpawn?.();
    const slot = this.freeSlots.length > 0 ? (this.freeSlots.pop() as number) : this.nextSlot++;
    // 後方から湧いてスロットへ吸い込まれる（§4-B）
    this.agents.push({
      slot,
      x: this.centerX + (Math.random() - 0.5) * 1.8,
      z: 2.8 + Math.random() * 1.4,
      scale: 0,
      phase: Math.random() * Math.PI * 2,
      tint: CFG.crowd.tintMin + Math.random() * (1 - CFG.crowd.tintMin),
      fade: 0,
      leaving: false,
      sent: false,
      blast: 0,
      life: 0,
    });
  }

  /** まとめて外周から剥がす。1体ずつ最大値を探すと大量削除で O(n^2) になるので一度だけ並べる */
  private detachOutermost(n: number): void {
    const active = this.agents.filter((a) => !a.leaving);
    active.sort((p, q) => q.slot - p.slot);
    const take = Math.min(n, active.length);
    for (let i = 0; i < take; i++) {
      this.markLeaving(active[i]);
      if (this.departMode === 'leave') this.onLeave?.(active[i].x, active[i].z);
    }
  }

  private markLeaving(a: Agent, blast = 0): void {
    a.blast = blast;
    a.leaving = true;
    a.sent = this.departMode === 'send';
    a.life = CFG.crowd.leaveLife;
    this.freeSlots.push(a.slot);
  }

  private writeInstances(): void {
    const n = this.agents.length;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      this.v.set(a.x, 0, a.z);
      this.s.setScalar(a.scale);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.phaseAttr.setX(i, a.phase);
      this.fadeAttr.setX(i, a.fade);
      this.tintAttr.setX(i, a.tint);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }
}

/**
 * スロット番号から決まる 0〜1 の値。**同じ i なら常に同じ値**を返す。
 * ★ここが乱数だと毎フレーム位置が変わって群れが沸騰する。`Math.random()` を使わないこと
 */
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * ★**このスロットの半径倍率（内側だけに振る）**（2026-09-11）。
 * 外側にも振ると `visualRadiusX` を超える個体が出て、見た目と当たり判定がずれる。
 * 戻り値は必ず 1 以下なので、**塊の上限は式を変える前とまったく同じ**。
 *
 * ★★**既定は 0（＝ 常に 1 を返す）**。半径を動かすと**輪郭が消えて「バラバラ」に見える**
 * ことが本人の実機で分かったため（同日夜）。理由は `config.ts` の `jitterR` のコメント。
 * ★**螺旋の腕を壊しているのは `slotT` のほうだけ**で、半径を壊す必要は無かった
 */
function slotR(i: number): number {
  return 1 - CFG.crowd.jitterR * hash(i, 1);
}

/** ★このスロットの角度のずれ（±jitterT/2）。半径を変えないので上限に影響しない */
function slotT(i: number): number {
  return i * GOLDEN + (hash(i, 2) - 0.5) * CFG.crowd.jitterT;
}

/**
 * ヒマワリ配置（黄金角スパイラル / Vogel model）を横に潰して奥に伸ばしたもの。
 * 真円のままだと大群がコース幅を埋め尽くして横移動できなくなる。
 *
 * ★★**2026-09-11: 黄金角そのままだと「斜めの列」が見えて気持ち悪い**（本人指摘）。
 * スロットごとの固定のゆらぎ（`slotR` / `slotT`）を掛けて腕を壊した。
 * **ゆらぎは i から決まるので時間では動かない** ＝ 増減しても既存メンバーは動かない
 * （このクラスの決定事項 1 はそのまま）。詳しくは `config.ts` の `jitterR` のコメント
 */
function slotX(i: number): number {
  const c = CFG.crowd;
  return c.slotC * Math.sqrt(i) * slotR(i) * Math.cos(slotT(i)) * c.squashX;
}

function slotZ(i: number): number {
  const c = CFG.crowd;
  return c.slotC * Math.sqrt(i) * slotR(i) * Math.sin(slotT(i)) * c.stretchZ;
}
