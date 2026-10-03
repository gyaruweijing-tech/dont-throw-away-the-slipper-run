import * as THREE from 'three';
import { CFG } from '../config';
import type { Crowd } from '../entities/Crowd';

const P = CFG.palette;
const K = CFG.pickup;

/**
 * @param y 高さ（m）。★**通常は 1.0 固定**（腰の高さ）。
 *   星・ハートの「ごほうびの型」だけが**縦に立った絵**として高さを使う
 */
interface Coin { at: number; x: number; y: number; taken: number; face?: boolean }

/**
 * ★**並びの型**（2026-09-06）。**順番に回す**ので、増やすときはここに足すだけでよい。
 * 足すときの条件は1つ:「**中央に立っているだけでは全部拾えない**」——
 * それを満たさない型は、拾い物の役目（横へ動く理由）を消してしまう
 */
type Shape = 'arc' | 'pyramid' | 'zigzag' | 'star' | 'heart';
const SHAPES: readonly Shape[] = ['arc', 'pyramid', 'zigzag'];
/**
 * ★**ごほうびの型**（2026-09-06 夜・本人「**たまには星型とかハート型とか遊んでもいい**」）。
 *
 * ★**「たまには」を実装として守る。** 通常の3種と同じ列に入れて等確率で回すと、
 * 5回に1回は星が出る＝**もう「たまに」ではなくなり、絵として飽きる**。
 * だから**別の列**に置いて `treatChance` でだけ出す。
 * 枚数も通常より多い（14枚）—— **形が読めない枚数で出すと、ただの散らばりに見える**
 */
const TREATS: readonly Shape[] = ['star', 'heart'];
interface Mult { at: number; x: number; taken: boolean; mesh: THREE.Mesh }

/**
 * コース上の拾い物（PROGRESS §14-B-2 / §14-B-5）。
 *
 * **本家のコインの本当の役目は報酬ではなく、ゲートとゲートの間の死んだ走行時間に
 * 「横へ動く理由」を置くこと。** うちはイベントが約4秒に1回しか無く、そこが完全に空いていた。
 *
 * だから配置は「散らす」のではなく **弧（アーク）**で置く。弧は端から端へ目線を運ぶので、
 * 拾おうとすると自然に横移動が起きる。まっすぐ並べると中央を走るだけで全部取れて意味が消える。
 *
 * 2種類あるのは**横へ動く動機を2つにする**ため（§14-B-5）:
 *  - 印紙 ＝ 弧の上を撫でる。取れなくても損はない
 *  - ×2 の札 ＝ **ゲートの列から外れた端に置く**。取りに行くと次のゲートで不利な位置から入る
 *
 * 色は紙と判子の赤だけ。**本家のような虹色・金色にはしない**（§4-I / §14-C-3）。
 */
export class Pickups {
  readonly group = new THREE.Group();

  /** 印紙を拾った。@param n 今フレームで拾った枚数 */
  onCoin?: (x: number, z: number, n: number) => void;
  /** ×2 の札を拾った */
  onMult?: (x: number, z: number) => void;

  private readonly coins: Coin[] = [];
  private readonly mults: Mult[] = [];
  private index = 0;
  /** ★型を回し始める位置。レベルごとにずらして「毎回1本目が弧」を避ける */
  private shapeOffset = 0;
  /** ごほうびの型（星／ハート）を交互に出すための番号 */
  private treatPos = 0;
  private t = 0;

  private readonly mesh: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly multPool: THREE.Mesh[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor() {
    // 印紙。**円盤を立てて置く**（寝かせるとコースに沈んで見えない）
    const geo = new THREE.CylinderGeometry(K.coinR, K.coinR, 0.07, 14);
    geo.rotateX(Math.PI / 2);
    /*
     * 面は紙、縁は藍（得の色）。**朱にすると敵と同じ色になって「拾う物」に見えない**。
     * **材質は Basic（陰影なし）。** Lambert だと円盤の面がカメラを向いていて
     * 上からの光が当たらず、実機では灰色に沈んで「拾う物」に見えなかった（`.shots/art2_a.png`）。
     */
    const mat = new THREE.MeshBasicMaterial({ color: P.gold });
    this.mesh = new THREE.InstancedMesh(geo, mat, K.maxLive);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);

    // 縁だけ判子の赤。中央の朱まで描くとテクスチャが要るので、輪で「印紙」に見せる
    this.rings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(K.coinR * 0.96, K.coinR * 0.16, 6, 18),
      new THREE.MeshBasicMaterial({ color: P.goldDark }),
      K.maxLive,
    );
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.group.add(this.rings);

    const tex = makeMultTexture();
    for (let i = 0; i < K.multPool; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
      );
      mesh.position.y = 1.15;
      mesh.visible = false;
      this.multPool.push(mesh);
      this.group.add(mesh);
    }
  }

  /**
   * ゲートが1行確定するたびに呼ばれる（ObstacleField.offer と同じ形）。
   * **障害物はゲート間の中点に置かれる**ので、拾い物はその手前と奥に寄せて重ならないようにする。
   */
  offer = (prevAt: number, at: number): void => {
    const gap = at - prevAt;
    if (gap < K.minGap) return;
    const i = this.index++;

    for (const ratio of K.at) {
      if (this.coins.length + K.arcMax > K.maxLive) break;
      const n = K.arcMin + Math.floor(Math.random() * (K.arcMax - K.arcMin + 1));
      const base = prevAt + gap * ratio;
      // 左右をランダムに入れ替えないと「いつも同じ側」になって横移動が偏る
      const side = Math.random() < 0.5 ? 1 : -1;
      const edge = CFG.courseWidth / 2 - CFG.playableInset;
      /*
       * ★**型を順番に回す**（2026-09-06・本人「並べ方に遊び心を。ピラミッド型など」）。
       * 毎回ランダムに引くと**同じ型が3回続く**ことが普通に起きて「1種類しかない」に戻るので、
       * **順番に回して、開始位置だけレベルごとにずらす**（`shapeOffset`）
       */
      /*
       * ★**たまに「ごほうびの型」**（星・ハート）に差し替える。
       * 出る確率は `treatChance`。連続で同じ形が出ないよう、星とハートは交互
       */
      if (Math.random() < K.treatChance) {
        this.lay(TREATS[this.treatPos++ % TREATS.length], K.treatCoins, base, side, edge);
      } else {
        this.lay(SHAPES[(this.index + this.shapeOffset) % SHAPES.length], n, base, side, edge);
      }
    }

    // ×2 の札。**端に置く**ので、取りに行くと次のゲートへ不利な位置から入る
    if (i >= K.multFrom && Math.random() < K.multChance) {
      const mesh = this.multPool.find((p) => !p.visible);
      if (mesh) {
        mesh.visible = true;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.mults.push({ at: prevAt + gap * 0.52, x: side * K.multEdge, taken: false, mesh });
      }
    }
  };

  /**
   * 1つぶんの並びを置く。★**枚数 `n` は型を問わず同じ**（`arcMin`〜`arcMax`）。
   * 型で変わるのは**どこを通れば拾えるか**だけで、実入りは変えない
   */
  private lay(shape: Shape, n: number, base: number, side: number, edge: number): void {
    const out = Math.min(K.arcOuter, edge);

    if (shape === 'pyramid') {
      /*
       * ★**ピラミッド**（本人の名指し）。手前が1枚、奥へ行くほど横に広がる。
       * **入口は1点なので必ず正面から入る**ことになり、そこから**外へ開いていく**。
       * 弧が「端まで追う」なら、こちらは「どこまで開くか」を選ばせる形
       */
      /*
       * ★**中央には置かない。** 弧のコメントにあるとおり、
       * 「中央に居るほうが多く拾える」形にすると**横へ動く理由が消える**（実測で一度やらかしている）。
       * だから山は**片側に寄せて建てる**。頂点（1枚）に入るには、まずそちらへ寄る必要がある
       */
      const cx = side * out * 0.45;
      let left = n;
      let row = 1;
      let z = base;
      while (left > 0) {
        const cols = Math.min(row, left);
        for (let c = 0; c < cols; c++) {
          const t = cols === 1 ? 0 : c / (cols - 1) - 0.5;
          this.coins.push({ at: z, x: clampX(cx + t * (cols - 1) * K.pyramidSpread, edge), y: K.coinY, taken: 0 });
        }
        left -= cols;
        z += K.pyramidStep;
        row++;
      }
      return;
    }

    if (shape === 'star' || shape === 'heart') {
      /*
       * ★**形そのものを見せる型。** 拾えるかどうかより「**うわ、星だ**」が主役。
       *
       * ★**縦に立てる**（2026-09-06 夜・実機で作り直した）。最初は他の型と同じく
       * **地面に寝かせて描いた**が、このゲームのカメラは俯角 19〜28°しかないので
       * **床の絵はぺしゃんこに潰れて、ただの散らばりにしか見えなかった**（`.shots/coin_star.png`）。
       * 立てれば正面から見えるので、**形がそのまま絵になる**。
       *
       * 拾う判定は**横位置しか見ていない**ので、立てても「真ん中を通れば半分くらい取れる」
       * ——**ごほうびの型は取らせる側**でよく、横へ動かせる役目は弧・ピラミッド・ジグザグが担う
       */
      const pts = shape === 'star' ? starPath(n) : heartPath(n);
      const half = Math.min(K.treatHalf, edge);
      for (const q of pts) {
        this.coins.push({
          at: base + (1 - q.z) * K.treatLean,      // 上ほど奥（少し寝かせる）＝ 走って抜ける絵になる
          x: clampX(q.x * half, edge),
          y: K.treatBottom + q.z * K.treatHeight,
          taken: 0,
          /*
           * ★**この型だけ回さない**（2026-09-06 夜・実機で直した）。
           * 印紙はふだん回っていて、**真横を向いた瞬間は線にしか見えない**。
           * 散らばって置くぶんには「きらきら」で良いが、
           * **形を読ませる型では、線になった粒が輪郭を欠けさせる**（星の角が消える）
           */
          face: true,
        });
      }
      return;
    }

    if (shape === 'zigzag') {
      /*
       * ★**三角波で振る**（1枚ごとに左右へ飛ばさない）。
       * 交互に置くと**隣どうしが 2×amp 離れる**ので、1.5m 進むあいだに横へ 5m —— 物理的に追えない。
       * 弧の傾き（横 3.7m / 前 6.9m ≒ 0.54）に合わせ、**6枚で1往復**にしてある
       */
      for (let k = 0; k < n; k++) {
        const u = ((k / 6) % 1) * 4;                    // 0..4 の鋸
        const t = u < 1 ? u : u < 3 ? 2 - u : u - 4;    // -1..1 の三角波
        this.coins.push({ at: base + k * K.zigzagStep, x: clampX(t * side * K.zigzagAmp, edge), y: K.coinY, taken: 0 });
      }
      return;
    }

    // 弧（既定）。内側 → 外側へ抜ける掃き出し。**追いかけるには外へ出るしかない形**にする
    const x0 = side * K.arcInner;
    const x1 = side * out;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1);
      this.coins.push({ at: base + k * K.step, x: x0 + (x1 - x0) * u, y: K.coinY, taken: 0 });
    }
  }

  /** @returns 今フレームで拾った印紙の枚数 */
  update(dt: number, distance: number, crowd: Crowd, centerX: number): number {
    this.t += dt;
    // **群衆の実幅をそのまま使うと、大群のとき画面端の印紙まで自動で吸い込む。**
    // 拾うのは「横へ動く理由」を作るためなので、届く幅には上限を置く
    const reach = Math.min(crowd.visualRadiusX, K.maxReach) + K.coinR;
    let got = 0;
    let n = 0;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      const z = distance - c.at;
      if (z > K.despawnZ) { this.coins.splice(i, 1); continue; }
      if (z < -K.showFrom) continue;

      // 取得判定は**群衆の中心Xと横幅**で見る（ゲートと同じ粒度。§4-B の粒度表）
      if (!c.taken && Math.abs(z) < K.reachZ && Math.abs(c.x - centerX) < reach) {
        c.taken = this.t;
        got++;
      }

      // 取った直後だけ跳ねて消える。即座に消すと「取れた」が分からない
      const age = c.taken ? this.t - c.taken : 0;
      if (c.taken && age > K.popTime) { this.coins.splice(i, 1); continue; }
      const k = c.taken ? age / K.popTime : 0;

      // 地面すれすれだと紙色どうしで溶ける。腰の高さまで上げて背景から離す
      // 地面すれすれだと紙色どうしで溶ける。腰の高さまで上げて背景から離す
      // （★ごほうびの型だけは `c.y` に高さが入っていて、縦に立った絵になる）
      this.v.set(c.x, c.y + k * 1.5, z);
      // ごほうびの型だけは正面を向いたまま（上のコメント）。ふだんの印紙は回る
      this.e.set(0, c.face ? 0 : this.t * K.spin + i, 0);
      this.q.setFromEuler(this.e);
      this.sc.setScalar(1 - k);
      this.m.compose(this.v, this.q, this.sc);
      this.mesh.setMatrixAt(n, this.m);
      this.rings.setMatrixAt(n, this.m);
      n++;
      if (n >= K.maxLive) break;
    }
    this.mesh.count = n;
    this.rings.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    if (got > 0) this.onCoin?.(centerX, 0, got);

    for (let i = this.mults.length - 1; i >= 0; i--) {
      const mu = this.mults[i];
      const z = distance - mu.at;
      if (z > K.despawnZ) { mu.mesh.visible = false; this.mults.splice(i, 1); continue; }
      mu.mesh.position.set(mu.x, 1.15 + Math.sin(this.t * 2.2) * 0.08, z);
      if (!mu.taken && Math.abs(z) < K.reachZ && Math.abs(mu.x - centerX) < reach) {
        mu.taken = true;
        mu.mesh.visible = false;
        this.onMult?.(mu.x, z);
        this.mults.splice(i, 1);
      }
    }
    return got;
  }

  reset(): void {
    this.coins.length = 0;
    for (const mu of this.mults) mu.mesh.visible = false;
    this.mults.length = 0;
    for (const p of this.multPool) p.visible = false;
    this.mesh.count = 0;
    this.rings.count = 0;
    this.index = 0;
    this.shapeOffset = Math.floor(Math.random() * SHAPES.length);
  }
}

/** ×2 の札。数字だけなので翻訳不要（§4-I のレッドラインを踏まない） */
function makeMultTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 140;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#efe9dc';
  g.fillRect(0, 0, 192, 140);
  g.strokeStyle = '#c8892a';
  g.lineWidth = 9;
  g.strokeRect(5, 5, 182, 130);
  g.fillStyle = '#c8892a';
  g.font = '900 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('×2', 96, 74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** コースの外に置かない。**拾えない位置の印紙は、ただの飾りになる** */
function clampX(x: number, edge: number): number {
  return Math.max(-edge, Math.min(edge, x));
}

/**
 * ★**星（5つ角）の輪郭**を n 個の点で返す。x は -1..1、z は 0..1（手前 → 奥）。
 * 頂点を1つずつ置くだけだと5個の点になってしまうので、**辺の上も等間隔で刻む**
 */
function starPath(n: number): { x: number; z: number }[] {
  const v: { x: number; z: number }[] = [];
  // 外側5点・内側5点を交互に。上（奥）から時計回り
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : 0.42;
    v.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return walk(v, n);
}

/**
 * ★**ハートの輪郭**。媒介変数の式をそのまま使う（`16sin³t` の形）。
 * 正規化して x -1..1 / z 0..1 に収める
 */
function heartPath(n: number): { x: number; z: number }[] {
  const v: { x: number; z: number }[] = [];
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    v.push({ x: x / 17, z: y / 17 });
  }
  return walk(v, n);
}

/**
 * 閉じた輪郭 `v` の上を**等間隔に n 点**取る。
 * ★**頂点をそのまま使わない**のが要 —— 頂点だけだと角に固まって、辺がスカスカになる。
 * 返す z は 0（手前）〜1（奥）に正規化する
 */
function walk(v: readonly { x: number; z: number }[], n: number): { x: number; z: number }[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    seg.push(d);
    total += d;
  }
  const out: { x: number; z: number }[] = [];
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let k = 0; k < n; k++) {
    let want = (k / n) * total;
    let i = 0;
    while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
    const a = v[i];
    const b = v[(i + 1) % v.length];
    const u = seg[i] > 0 ? want / seg[i] : 0;
    const p = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
    zMin = Math.min(zMin, p.z);
    zMax = Math.max(zMax, p.z);
    out.push(p);
  }
  const h = Math.max(0.001, zMax - zMin);
  for (const p of out) p.z = (p.z - zMin) / h;
  return out;
}
