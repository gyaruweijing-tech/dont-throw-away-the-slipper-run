import * as THREE from 'three';
import { CFG } from '../config';
import { buildCutoutGeometry, createCutoutMaterial } from './Cutout';
import { allyParts } from './cutoutLayout';
import { charAtlas } from '../tex/atlas';
import { paperGrain } from '../tex/paper';

const P = CFG.palette;
const S = CFG.stairs;
const N = S.cost.length;

interface Climber {
  /** 何段目へ向かうか（0 始まり） */
  step: number;
  /** 段の上の立ち位置 */
  tx: number; ty: number; tz: number;
  /** 出発点 */
  sx: number; sz: number;
  t: number;
  phase: number;
  tint: number;
}

/**
 * フィニッシュ ＝ 聞き取りの場（PROGRESS §4-E）。Phase 4。
 *
 * **この作品でテーマがメカニクスに宿る唯一の場所。** だから本家のピラミッドは捨てて全部自作する。
 *
 * 決定事項:
 *  1. **消費式**。1段上がるごとに味方を払い、払った味方は**消えずに段に残って積み上がる**。
 *     数字が「スコア」ではなく「自分のために口を開いてくれた人の数」になるのは、消費式でないと出ない
 *  2. **支払いは必ず1人ずつ**（一括消費は §5 で禁止）。ただし人数によらず一定時間で払い切る
 *     （1万人を等速で1人ずつ払うと数分かかる。群衆の湧きと同じ解き方）
 *  3. 勝敗は**扉が開くかどうか**＝信じてもらえたか。**言葉ゼロで伝わる**
 *  4. 罪状の板は**文字を使わない**。アイコン＋横線で表し、消し込みは判子の赤（§4-I のレッドライン）
 *
 * **設計からの意図的なずれ**: §4-E は「1人上がるたびに罪状が1行消える」と書いてあるが、
 * 段の必要人数（累積16200）に対して行数がまるで足りない。**1段クリア＝1行**に読み替えている。
 */
export class Stairs {
  readonly group = new THREE.Group();

  /** 到達した段数（0..N） */
  reached = 0;
  /** 払い終わったか */
  done = false;

  /** 段が1つ埋まった（＝罪状が1行消えた）。SE をここで鳴らす */
  onStep?: () => void;
  /** 最上段まで届いて扉が開く。1プレイで最大1回しか呼ばない */
  onDoor?: () => void;

  private paid = 0;
  private budget = 0;
  private acc = 0;
  private settleT = 0;
  private doorOpen = 0;
  private drawnRows = -1;
  private started = false;

  private readonly climbers: Climber[] = [];
  /** 送り出し待ち。**払いの速さと表示を切り離すための行列**（段ごとに枠を配ってここへ積む） */
  private readonly pending: { step: number; slot: number }[] = [];
  /** どの段まで表示枠を配り終えたか */
  private queuedStep = 0;
  /** 段ごとに何枠まで配ったか */
  private readonly queued: number[] = new Array(N).fill(0);
  private readonly standing: { x: number; y: number; z: number; phase: number; tint: number }[] = [];
  private readonly walkMesh: THREE.InstancedMesh;
  private readonly standMesh: THREE.InstancedMesh;
  private readonly walkAttrs: THREE.InstancedBufferAttribute[];
  private readonly standAttrs: THREE.InstancedBufferAttribute[];
  /** ★窓口（2026-09-26）。シャッターと奥の明かり */
  private readonly shutter: THREE.Mesh;
  private readonly windowLight: THREE.Mesh;
  private readonly shutterY: number;
  private readonly shutterH: number;
  /**
   * ★★**この回の段の必要人数**（2026-09-16）。**扉が開く人数をレベルごとに変える**（本人が選択）ので、
   * `CFG.stairs.cost`（合計16200）の**比率を保ったまま、合計を目標人数に縮める**。
   * ★前は全レベル共通の16200で、**ほぼ一度も扉が開かず「失敗」に見えていた**
   */
  private costs: number[] = [...S.cost];
  private readonly badges: THREE.Sprite[] = [];
  private readonly walkMat: THREE.ShaderMaterial;
  private readonly standMat: THREE.ShaderMaterial;
  private readonly stamps: THREE.Sprite[] = [];
  private readonly boardCtx: CanvasRenderingContext2D;
  private readonly boardTex: THREE.CanvasTexture;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);

    /*
     * ★★★**ゴール ＝「巨大な窓口」**（2026-09-26・本人「なんで階段なのか、今は適当すぎる」→ 案A）。
     *
     * 意味は §4-E のまま（1段のぼるごとに味方を1人差し出し、上まで届けば話を聞いてもらえる）。
     * **見た目がそれを言っていなかった**（灰色の箱の段と黒い扉）ので、世界観（`WORLD.md`）の言葉で描き直す:
     *  - **段 ＝ 積み上がった書類の束**（「書類は地層のように積み上がり」）。紐でくくった束を段ごとに積む
     *  - **最上段 ＝ 巨大な役所の窓口**（「すべてが大きすぎる」）。シャッターが下りている
     *  - **扉が開く ＝ シャッターが上がり、奥に明かりが灯る**（判子は本人「いらない」で消した）
     * ★当たり・立ち位置は段の高さ（`S.rise`・`S.depth`）だけで決まるので、**絵を変えても仕組みは1ミリも変わらない**
     */

    // --- 段 ＝ 書類の束（1段の高さを2束で積む。束ごとに少しずれて・色が違う） ---
    const BUNDLE = S.rise / 2;
    let bundles = 0;
    for (let i = 0; i < N; i++) bundles += Math.round(((i + 1) * S.rise) / BUNDLE);
    const bundleMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), bundles);
    // 紐（束の正面に縦1本・上面に横1本）
    const twineMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: P.inkSoft }), bundles * 2);
    const tones = [P.paper, P.paperDark, 0xe8dcc0, 0xd9ceb4, 0xf3ecdc];
    const col = new THREE.Color();
    let k = 0;
    // 乱数は固定（毎回同じ積み方。走るたびに形が変わると別の場所に見える）
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) {
      const layers = Math.round(((i + 1) * S.rise) / BUNDLE);
      for (let j = 0; j < layers; j++) {
        const top = j === layers - 1;
        // ★いちばん上の束はずらさない（段の上面・段鼻は元の位置のまま ＝ 立ち位置が変わらない）
        const dx = top ? 0 : (rnd() - 0.5) * 0.35;
        const dz = top ? 0 : (rnd() - 0.5) * 0.12;
        const w = S.width * (top ? 1 : 0.94 + rnd() * 0.06);
        const d = S.depth * (top ? 1 : 0.9 + rnd() * 0.1);
        const y = j * BUNDLE + BUNDLE / 2;
        this.m.compose(
          this.v.set(dx, y, -i * S.depth + dz),
          this.q.setFromEuler(new THREE.Euler(0, top ? 0 : (rnd() - 0.5) * 0.03, 0)),
          this.sc.set(w, BUNDLE * 0.96, d),
        );
        bundleMesh.setMatrixAt(k, this.m);
        bundleMesh.setColorAt(k, col.set(tones[(i * 3 + j) % tones.length]));
        // 紐: 束の正面を縦に1本（位置は束ごとにずらす）
        const tx = dx + (((i + j) % 3) - 1) * S.width * 0.28;
        this.m.compose(this.v.set(tx, y, -i * S.depth + dz + d / 2 + 0.01),
          this.q.identity(), this.sc.set(0.07, BUNDLE * 0.98, 0.03));
        twineMesh.setMatrixAt(k * 2, this.m);
        // 紐: 束の上面を奥へ1本（いちばん上の束だけ見える）
        this.m.compose(this.v.set(tx, j * BUNDLE + BUNDLE * 0.98, -i * S.depth + dz),
          this.q.identity(), this.sc.set(0.07, 0.02, d));
        twineMesh.setMatrixAt(k * 2 + 1, this.m);
        k++;
      }
    }
    bundleMesh.count = k;
    twineMesh.count = k * 2;
    this.group.add(bundleMesh, twineMesh);
    // 段鼻に細い線を1本。これが無いと段差そのものが読めない
    const edgeMat = new THREE.MeshLambertMaterial({ color: P.inkSoft });
    for (let i = 0; i < N; i++) {
      const h = (i + 1) * S.rise;
      const edge = new THREE.Mesh(box, edgeMat);
      edge.position.set(0, h + 0.012, -i * S.depth + S.depth / 2);
      edge.scale.set(S.width, 0.024, 0.08);
      this.group.add(edge);
    }

    // --- 最上段の奥 ＝ 巨大な窓口 ---
    const topH = N * S.rise;
    // 窓口の壁の面。★受付台（奥行き 0.9）ごと最上段の奥へ出す（台が味方の立ち位置に重ならないように）
    const wz = -(N - 0.5) * S.depth - 0.9;
    const WIN_W = 4.6, WIN_H = 3.4, WALL_W = S.width + 3.2, WALL_H = WIN_H + 3.6;
    const wood = new THREE.MeshLambertMaterial({ color: P.wood });
    // 壁は紙の地（ムラ）を乗せる。のっぺりした灰色の板だと「役所の壁」に見えない
    const wall = new THREE.MeshLambertMaterial({ color: P.wall, map: paperGrain(512) });
    const side = (WALL_W - WIN_W) / 2;
    const addBox = (m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh => {
      const b = new THREE.Mesh(box, m);
      b.position.set(x, y, z);
      b.scale.set(w, h, d);
      this.group.add(b);
      return b;
    };
    // 壁（窓の穴を残して左右と上）
    // ★床から立てる（書類の山の向こうに、役所の壁がそびえている）
    addBox(wall, -(WIN_W + side) / 2, (topH + WALL_H) / 2, wz - 0.3, side, topH + WALL_H, 0.6);
    addBox(wall, (WIN_W + side) / 2, (topH + WALL_H) / 2, wz - 0.3, side, topH + WALL_H, 0.6);
    addBox(wall, 0, topH / 2, wz - 0.3, WIN_W, topH, 0.6);
    addBox(wall, 0, topH + WIN_H + (WALL_H - WIN_H) / 2, wz - 0.3, WIN_W, WALL_H - WIN_H, 0.6);
    // 壁の見切り（木）: 窓の上の長押と、壁のてっぺんの笠木
    addBox(wood, 0, topH + WIN_H + 0.75, wz + 0.02, WALL_W, 0.16, 0.12);
    addBox(wood, 0, topH + WALL_H - 0.1, wz - 0.25, WALL_W + 0.3, 0.3, 0.8);
    // 窓枠（木）
    addBox(wood, 0, topH + WIN_H + 0.15, wz + 0.05, WIN_W + 0.6, 0.3, 0.3);
    addBox(wood, -WIN_W / 2 - 0.15, topH + WIN_H / 2, wz + 0.05, 0.3, WIN_H, 0.3);
    addBox(wood, WIN_W / 2 + 0.15, topH + WIN_H / 2, wz + 0.05, 0.3, WIN_H, 0.3);
    // 受付台（窓の下の張り出し）
    addBox(wood, 0, topH + 0.45, wz + 0.45, WIN_W + 1.2, 0.9, 0.9);
    addBox(wood, 0, topH + 0.93, wz + 0.5, WIN_W + 1.5, 0.08, 1.1);
    // 窓の奥の明かり（シャッターが上がると見える ＝ 話を聞いてもらえる）
    this.windowLight = new THREE.Mesh(
      new THREE.PlaneGeometry(WIN_W, WIN_H),
      new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
    );
    this.windowLight.position.set(0, topH + WIN_H / 2, wz - 0.55);
    this.group.add(this.windowLight);
    // シャッター（横の筋を描いた板）。★開いたら上へ巻き上がる
    this.shutter = new THREE.Mesh(
      new THREE.PlaneGeometry(WIN_W, WIN_H),
      new THREE.MeshLambertMaterial({ map: makeShutterTexture(), side: THREE.DoubleSide }),
    );
    this.shutterY = topH + WIN_H / 2;
    this.shutterH = WIN_H;
    this.shutter.position.set(0, this.shutterY, wz - 0.05);
    this.group.add(this.shutter);
    // 窓口の上の札（文字は使わない §4-I: 吹き出し＝「話を聞く場所」）
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(), transparent: true }),
    );
    sign.position.set(0, topH + WIN_H + 1.5, wz + 0.02);
    this.group.add(sign);

    /*
     * ★★**「届かなかったら上が暗くなる板」は捨てた**（2026-09-16・本人「成功か失敗かみたいなのになっている」）。
     * ゴールは**集めた数のお祝い**。扉が開けば**さらに豪華**になるだけで、開かなくても失敗の絵は出さない
     */

    // --- 段のバッジ（数字だけ・テキストなし）と、払い終わった印の判子 ---
    const stampTex = makeStampTexture();
    for (let i = 0; i < N; i++) {
      const badge = makeSprite(makeBadgeTexture(S.cost[i]), 0.95, 0.62);
      this.badges.push(badge);
      badge.position.set(-S.width / 2 + 0.8, (i + 1) * S.rise + 0.4, -i * S.depth + S.depth / 2 + 0.05);
      const stamp = makeSprite(stampTex, 1.0, 1.0);
      stamp.position.copy(badge.position);
      stamp.visible = false;
      this.stamps.push(stamp);
      this.group.add(badge, stamp);
    }

    // --- 罪状の板（§4-I: 文字ではなくアイコン＋横線） ---
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 384;
    this.boardCtx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.boardTex = new THREE.CanvasTexture(canvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 3.15),
      new THREE.MeshBasicMaterial({ map: this.boardTex, side: THREE.DoubleSide }),
    );
    board.position.set(S.width / 2 + 1.6, 2.2, -1.2);
    board.rotation.y = 0.42;   // カメラ（コース中央の後方）へ向ける
    this.group.add(board);
    const post = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: P.ink }));
    post.position.set(S.width / 2 + 1.6, 0.32, -1.2);
    post.scale.set(0.14, 0.64, 0.14);
    this.group.add(post);

    // --- 登る味方 / 段に留まる味方 ---
    // **ここだけ箱の棒人間のまま残っていた**（本人が実機で発見）。
    // 走行中の群衆と壇の上の味方が別人に見えるので、同じ切り抜きに揃える
    const geoWalk = buildCutoutGeometry(allyParts());
    const geoStand = buildCutoutGeometry(allyParts());
    this.walkAttrs = attach(geoWalk, S.maxWalking);
    this.standAttrs = attach(geoStand, S.maxStanding);
    const grain = paperGrain(512);
    this.walkMat = createCutoutMaterial(charAtlas(), { grain });
    this.standMat = createCutoutMaterial(charAtlas(), { cadence: 0, grain });
    this.walkMesh = new THREE.InstancedMesh(geoWalk, this.walkMat, S.maxWalking);
    // cadence 0 ＝ 走りが止まる。段の上ではこちらを向いて留まる（§4-E）
    this.standMesh = new THREE.InstancedMesh(geoStand, this.standMat, S.maxStanding);
    for (const mesh of [this.walkMesh, this.standMesh]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }

    this.group.visible = false;
    this.paintBoard(0);
  }

  /** 聞き取りの開始。@param count 連れてきた味方の人数 */
  /**
   * @param count 連れてきた味方の人数
   * @param target ★**扉が開く人数**（2026-09-16・レベルごと）。省略すると元の表のまま（sim 用）
   */
  begin(count: number, target = cumulative(S.cost, N)): void {
    this.clear();
    this.setTarget(target);
    this.group.visible = true;
    this.started = true;
    this.budget = count;
  }

  /**
   * 見えている物を全部消す。**`hide()` からも必ず呼ぶこと。**
   * 走行中の階段は `visible` で見せるだけで `update()` は started が false のため animate() まで届かない。
   * ここで消しておかないと、**次のプレイでゴールが視界に入った瞬間に前回の立ち姿と判子がそのまま見える**。
   */
  private clear(): void {
    this.paid = 0;
    this.budget = 0;
    this.reached = 0;
    this.done = false;
    this.acc = 0;
    this.settleT = 0;
    this.doorOpen = 0;
    this.climbers.length = 0;
    this.standing.length = 0;
    this.pending.length = 0;
    this.queuedStep = 0;
    this.queued.fill(0);
    this.walkMesh.count = 0;
    this.standMesh.count = 0;
    this.drawnRows = -1;
    this.paintBoard(0);
    for (let i = 0; i < N; i++) this.stamps[i].visible = false;
    this.shutter.position.y = this.shutterY;
    this.shutter.scale.y = 1;
  }

  /** 走行中でも「ゴールが見えている」状態にできる。支払いが始まるのは begin() から */
  set visible(on: boolean) {
    if (!this.started) this.group.visible = on;
  }

  /** @returns 今フレームで払った人数（HUD の残り人数を減らすのに使う） */
  update(dt: number, z: number): number {
    if (!this.group.visible) return 0;
    this.group.position.z = z;
    if (!this.started) return 0;

    let spent = 0;
    if (!this.done) {
      const total = Math.min(this.budget, cumulative(this.costs, N));
      const rate = Math.max(S.payMin, total / S.payTime);
      this.acc += rate * dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (!this.payOne()) break;
        spent++;
      }
      if (this.paid >= this.budget || this.paid >= cumulative(this.costs, N)) this.finish();
    } else {
      this.settleT += dt;
      const open = this.reached >= N ? Math.min(1, this.settleT / 0.8) : 0;
      this.doorOpen += (open - this.doorOpen) * Math.min(1, dt * 5);
      this.animateWindow();
    }

    this.drain();
    this.animate(dt);
    return spent;
  }

  /**
   * ★**窓口が開く絵**（2026-09-26）。シャッターが巻き上がって、奥の明かりが見える。
   * ★判子は消した（本人「ハンコいらない」）。★お祝いの札（`Celebrate`）が窓口の前に被るので、
   * 札が出る `S.settle`（1.0秒）までに開け終える。`settleT` だけで決める（やり直しで同じ絵になる）
   */
  private animateWindow(): void {
    if (this.reached < N) return;
    // シャッターは上端を支点に縮みながら上がる（巻き上げ）
    const up = smooth(Math.min(1, this.settleT / 0.8));
    const sy = Math.max(0.04, 1 - up);
    this.shutter.scale.y = sy;
    this.shutter.position.y = this.shutterY + (this.shutterH * (1 - sy)) / 2;
  }

  /** ★扉まで届いたか（＝さらに豪華にする回）。2026-09-16 */
  get doorOpened(): boolean {
    return this.done && this.reached >= N;
  }

  /** ★この回の扉の人数 */
  get target(): number {
    return cumulative(this.costs, N);
  }

  /** ★段の上の味方に万歳させる（0..1）。2026-09-16 */
  setCheer(k: number): void {
    this.walkMat.uniforms.uCheer.value = k;
    this.standMat.uniforms.uCheer.value = k;
    if (this.walkMat.uniforms.uTime) {
      this.walkMat.uniforms.uTime.value = performance.now() / 1000;
      this.standMat.uniforms.uTime.value = performance.now() / 1000;
    }
  }

  /**
   * ★**比率を保って合計を target に縮める**。各段は最低1人。端数は最上段で吸収する
   * （途中の段で吸収すると、上の段より安い段ができて「登るほど高い」が崩れる）
   */
  private setTarget(target: number): void {
    const base = cumulative(S.cost, N);
    const t = Math.max(N, Math.round(target));
    const next = S.cost.map((c) => Math.max(1, Math.round((c / base) * t)));
    const head = next.slice(0, N - 1).reduce((a, b) => a + b, 0);
    next[N - 1] = Math.max(next[N - 2] ?? 1, t - head);
    if (next.every((v, i) => v === this.costs[i])) return;
    this.costs = next;
    for (let i = 0; i < N; i++) {
      const old = this.badges[i].material.map;
      this.badges[i].material.map = makeBadgeTexture(next[i]);
      this.badges[i].material.needsUpdate = true;
      old?.dispose();
    }
  }

  /** リザルトへ進んでよいか */
  get settled(): boolean {
    return this.done && this.settleT >= S.settle && this.climbers.length === 0 && this.pending.length === 0;
  }

  hide(): void {
    this.started = false;
    this.group.visible = false;
    this.clear();
  }

  /**
   * 待ち行列から歩き枠の空きぶんだけ送り出す。**払いの速さと切り離すのがこの関数の役目**。
   * 段が一瞬で流れても枠は消えず、少し遅れて必ず登り切る（＝空き段が出ない）
   */
  private drain(): void {
    while (
      this.pending.length > 0 &&
      this.climbers.length < S.maxWalking &&
      this.standing.length + this.climbers.length < S.maxStanding
    ) {
      const p = this.pending.shift()!;
      const at = standPos(p.step, p.slot);
      this.climbers.push({
        step: p.step,
        tx: at.x,
        ty: at.y,
        tz: at.z,
        sx: (Math.random() - 0.5) * 3.2,
        sz: 3.4 + Math.random() * 2.2,
        t: 0,
        phase: Math.random() * Math.PI * 2,
        tint: CFG.crowd.tintMin + Math.random() * (1 - CFG.crowd.tintMin),
      });
    }
    // 表示上限に当たったぶんは出しようがない。捨てないと settled が永久に立たず結果へ進めない
    if (this.standing.length + this.climbers.length >= S.maxStanding) this.pending.length = 0;
  }

  /** @returns まだ払えたか */
  private payOne(): boolean {
    if (this.paid >= this.budget) return false;
    const step = stepOf(this.costs, this.paid);
    if (step >= N) return false;
    this.paid++;

    // **段ごとに表示枠を配る。** 「歩き枠が空いていたら出す」方式は、
    // 払いが定速なのに段のコストが指数的（5→9000）なせいで、安い段に人が固まり
    // 高い段が丸ごと空になる（実機で空き段が出た）。枠は段に属させ、送り出しは drain() に任せる。
    // **通り過ぎた段は満員まで、今登っている段は払った割合ぶんだけ**枠を出す。
    // 一括で満員にすると、届かなかった最上段が満員なのに判子が押されない状態になって嘘になる。
    const cur = stepOf(this.costs, this.paid);
    for (let s = this.queuedStep; s <= Math.min(cur, N - 1); s++) {
      const want =
        s < cur ? quotaOf(s) : Math.ceil(quotaOf(s) * ((this.paid - cumulative(this.costs, s)) / this.costs[s]));
      for (let k = this.queued[s]; k < want; k++) this.pending.push({ step: s, slot: k });
      if (want > this.queued[s]) this.queued[s] = want;
    }
    this.queuedStep = Math.min(cur, N - 1);

    // 段が1つ埋まった ＝ 罪状が1行消える（§4-I）
    const cleared = stepOf(this.costs, this.paid);
    if (cleared > this.reached) {
      this.reached = Math.min(N, cleared);
      this.stamps[this.reached - 1].visible = true;
      this.paintBoard(this.reached);
      this.onStep?.();
    }
    return true;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.reached = Math.min(N, stepOf(this.costs, this.paid));
    this.paintBoard(this.reached);
    // 扉が開くのは最上段まで届いたときだけ。届かなかった側は無音のまま暗くなる
    if (this.reached >= N) this.onDoor?.();
  }

  private animate(dt: number): void {
    for (let i = this.climbers.length - 1; i >= 0; i--) {
      const c = this.climbers[i];
      c.t += dt / S.climbTime;
      if (c.t >= 1) {
        this.standing.push({ x: c.tx, y: c.ty, z: c.tz, phase: c.phase * 0.05, tint: c.tint });
        this.climbers.splice(i, 1);
      }
    }

    let w = 0;
    for (const c of this.climbers) {
      const t = c.t;
      this.v.set(
        c.sx + (c.tx - c.sx) * t,
        // 高さは後半で一気に上げる。等速で上げると「浮いて移動している」ように見える
        c.ty * smooth(t * 1.45 - 0.45),
        c.sz + (c.tz - c.sz) * t,
      );
      this.sc.setScalar(1);
      this.m.compose(this.v, this.q, this.sc);
      this.walkMesh.setMatrixAt(w, this.m);
      this.walkAttrs[0].setX(w, c.phase);
      this.walkAttrs[1].setX(w, 0);
      this.walkAttrs[2].setX(w, c.tint);
      w++;
    }
    this.walkMesh.count = w;
    this.walkMesh.instanceMatrix.needsUpdate = true;
    for (const a of this.walkAttrs) a.needsUpdate = true;

    for (let i = 0; i < this.standing.length; i++) {
      const s = this.standing[i];
      this.v.set(s.x, s.y, s.z);
      this.sc.setScalar(1);
      this.m.compose(this.v, this.q, this.sc);
      this.standMesh.setMatrixAt(i, this.m);
      this.standAttrs[0].setX(i, s.phase);
      this.standAttrs[1].setX(i, 0);
      this.standAttrs[2].setX(i, s.tint);
    }
    this.standMesh.count = this.standing.length;
    this.standMesh.instanceMatrix.needsUpdate = true;
    for (const a of this.standAttrs) a.needsUpdate = true;
  }

  /**
   * 罪状の板。**文字は1文字も描かない。** アイコン（四角）＋横線の行が並び、
   * 消し込まれた行には判子の赤で線と丸が入る（§4-I: 翻訳不要・特定性ゼロ・審査に強い）。
   */
  private paintBoard(cleared: number): void {
    if (cleared === this.drawnRows) return;
    this.drawnRows = cleared;
    const g = this.boardCtx;
    const W = 256;
    const H = 384;

    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2b2a28';
    g.lineWidth = 7;
    g.strokeRect(4, 4, W - 8, H - 8);

    // 綴じ穴。**架空の様式**として作る（実在の書式・紋章は模さない）
    g.fillStyle = '#cdc4b2';
    for (const y of [40, H - 40]) {
      g.beginPath();
      g.arc(22, y, 6, 0, Math.PI * 2);
      g.fill();
    }

    const top = 42;
    const rowH = (H - top - 26) / N;
    for (let i = 0; i < N; i++) {
      const y = top + rowH * (i + 0.5);
      g.fillStyle = '#2b2a28';
      g.fillRect(44, y - 7, 14, 14);   // 項目のアイコン
      g.fillRect(68, y - 3, 150, 6);   // 内容を表す横線
      if (i < cleared) {
        g.strokeStyle = '#c8352b';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(40, y + 5);
        g.lineTo(224, y - 5);
        g.stroke();
        g.lineWidth = 4;
        g.beginPath();
        g.arc(205, y, 13, 0, Math.PI * 2);
        g.stroke();
      }
    }
    this.boardTex.needsUpdate = true;
  }
}

const PER_ROW = 9;

/**
 * その段に見せる人数。**上の段ほど厚くする**＝必要人数が増えるのを画で伝える。
 * 合計は 9*5 + 18*4 + 27 = 144 で `maxStanding` (260) に収まる
 */
function quotaOf(step: number): number {
  return PER_ROW * (1 + Math.floor((step * 2) / (N - 1)));
}

/** 段の上の立ち位置。中央から横へ並べ、溢れたぶんは奥に列を足して半コマずらす */
function standPos(step: number, slot: number): { x: number; y: number; z: number } {
  const row = Math.floor(slot / PER_ROW);
  const i = slot % PER_ROW;
  const col = S.width / PER_ROW;
  return {
    x: (i - (PER_ROW - 1) / 2) * col + (row % 2) * col * 0.5 + (Math.random() - 0.5) * 0.12,
    y: (step + 1) * S.rise,
    z: -step * S.depth + 0.28 - row * 0.34,
  };
}

/** paid 人払い終えた時点で「何段目を登り中か」 */
function stepOf(costs: readonly number[], paid: number): number {
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += costs[i];
    if (paid < acc) return i;
  }
  return N;
}

function cumulative(costs: readonly number[], n: number): number {
  let acc = 0;
  for (let i = 0; i < n; i++) acc += costs[i];
  return acc;
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function attach(geo: THREE.BufferGeometry, n: number): THREE.InstancedBufferAttribute[] {
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
  geo.setAttribute('aPhase', phase);
  geo.setAttribute('aFade', fade);
  geo.setAttribute('aTint', tint);
  return [phase, fade, tint];
}

function makeSprite(tex: THREE.Texture, w: number, h: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(w, h, 1);
  s.renderOrder = 4;
  return s;
}

/** 段の必要人数。**数字だけ。テキストなし**（§4-E） */
function makeBadgeTexture(cost: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 104;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#efe9dc';
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 8;
  g.beginPath();
  g.roundRect(5, 5, 150, 94, 12);
  g.fill();
  g.stroke();
  g.fillStyle = '#2b2a28';
  g.font = 'bold 62px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(cost), 80, 54, 126);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 押印。払い終わった段に出る */
function makeStampTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.strokeStyle = '#c8352b';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(40, 66);
  g.lineTo(58, 84);
  g.lineTo(90, 44);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ★シャッターの板。横の筋（金属の蛇腹）を描く。電気のものは出さない（§3: すべてが古い） */
function makeShutterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#8f8a80';
  g.fillRect(0, 0, 256, 192);
  for (let y = 0; y < 192; y += 12) {
    g.fillStyle = '#a7a196';
    g.fillRect(0, y, 256, 7);
    g.fillStyle = '#6f6a61';
    g.fillRect(0, y + 10, 256, 2);
  }
  // 下端の取っ手
  g.fillStyle = '#2b2a28';
  g.fillRect(100, 178, 56, 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** ★窓口の上の札。**文字を使わない**（§4-I）—— 吹き出しの中に「…」＝「話を聞く場所」 */
function makeSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#efe9dc';
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 8;
  g.beginPath();
  g.roundRect(8, 8, 240, 112, 14);
  g.fill();
  g.stroke();
  // 吹き出し
  g.fillStyle = '#3f7fc4';
  g.beginPath();
  g.ellipse(128, 58, 62, 36, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(100, 84);
  g.lineTo(88, 108);
  g.lineTo(118, 90);
  g.fill();
  g.fillStyle = '#efe9dc';
  for (const x of [104, 128, 152]) {
    g.beginPath();
    g.arc(x, 58, 8, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
