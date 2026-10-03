import * as THREE from 'three';
import { CFG } from '../config';

const P = CFG.palette;
const Y = CFG.boss.yard;
/** 橋の出口 ＝ 島の手前の縁。**島から出す**（別に数字を持つと、島を動かした日に橋が宙で切れる） */
const BRIDGE_TO = Y.islandAt + Y.islandR;
/** 崖の切り口の色（上端） */
const CLIFF_TOP = 0x6b5138;
const CLIFF_FACE = new THREE.Color(0x9c7b55);
const VOID = new THREE.Color(P.paper);

/** ★崖の面を**上は土、下は霧の色**に塗る（頂点色）。フォグは距離でしか効かないので、近い崖は自分で溶かす */
function fadeDown(geo: THREE.BufferGeometry, depth: number): void {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (depth / 2 - pos.getY(i)) / depth));
    c.copy(CLIFF_FACE).lerp(VOID, Math.pow(t, 0.7));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** `boxes()` に渡す箱1個ぶん（中心と大きさ・m） */
interface BoxItem {
  x: number; y: number; z: number;
  w: number; h: number; d: number;
}

/**
 * ★**城の前庭**（2026-09-06・本人指定）。**堀・橋・広場・城を1つのクラスが持つ。**
 *
 * 本人の言葉:「**一直線の道の上じゃなくて、新しい場所。これは必須です**」
 * 「**橋を渡った先に、広い広場があってそこで戦う。背景に城。ボス戦と言えば城**」。
 *
 * ★**4つを別々のクラスに分けなかった理由。** 橋の出口と前庭の入口、前庭の奥と城の足元は
 * **必ず同じ場所でなければならない**。別々に持つと、片方の数字を直したときに
 * もう片方がズレて**隙間から地面が見える**。`Boss` がリングを自分で持っているのと同じ判断
 * （別々に持つと「後ろに置き去り」が起きる、2026-08-28）。
 *
 * ★**城は「書類の城」**（本人が3案から選択）。キャビネット・紙束・ファイルでできている。
 * 下駄箱の廊下を走ってきて石の城に出ると世界が切れるので、**同じ紙の世界のまま格を上げる**。
 * ボス（人事部）の本拠地が書類でできている、というのは意味としても通る。
 *
 * ★**全部 `place(bossZ)` の1本で動く。** 場面遷移の仕組みは持たない（本人:「ロードして
 * 別のステージへ行くのはちがう」）。子の位置は**ボスからの相対 m** で書いてあり、
 * 前方が -Z なので「ボスの d メートル向こう」は local z = -d になる。
 */
export class BossYard {
  readonly group = new THREE.Group();

  /**
   * ★**城の門の位置（ボスからの相対 z・前方が -Z）**。
   * 達成感の演出（`Game.updateClear`）が「どこまで歩けば門か」をここから読む。
   * ★**外に同じ式を書かない。** 城を動かした日に、歩く先だけ古い場所に残る
   */
  private gateZLocal = 0;
  get gateZ(): number {
    return this.gateZLocal;
  }

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor() {
    this.buildNearEdge();
    this.buildBridge();
    this.buildIsland();
    this.buildCastle();
    this.group.visible = false;
  }

  /**
   * ★**手前の崖の縁**（2026-09-16・堀をやめた）。
   * 地面そのものは `Course.setCliff` が**ここで切り落とす**。ここで置くのは**縁の濃い帯だけ**。
   * ★崖の面は置かない。手前の崖は**向こう（-Z）を向いている**ので、後ろにいるカメラからは一度も見えない
   */
  private buildNearEdge(): void {
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(240, 0.3, 0.7),
      new THREE.MeshLambertMaterial({ color: CLIFF_TOP }),
    );
    lip.position.set(0, -0.1, Y.bridgeFrom - 0.35);
    this.group.add(lip);
  }

  /**
   * ★**丸く切った島**（2026-09-16・本人「だだっ広いステージを丸に切って、崖にして、下が見えなくする」）。
   *
   * ★**崖は上が土の色、下へ行くほど背景（＝霧の色）へ溶ける。** 底を描かずに「底なし」を出すため。
   * フォグは**距離**でしか効かないので、近くの崖は溶けない ―― だから頂点の色で縦に溶かす。
   * ★**下をすぼめる**（下の半径 0.8 倍）。まっすぐな円柱だと「台」に見え、すぼめると「浮いた岩」になる。
   *
   * ★**縁の濃い輪が要**。島の床（0xe8ded0）と背景（紙 0xefe9dc）は**ほぼ同じ明るさ**なので、
   * 輪が無いと上から見て**どこで切れているか分からない**（穴出しで見つけた）
   */
  private buildIsland(): void {
    const R = Y.islandR;
    const z = Y.islandAt;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshLambertMaterial({ color: 0xe8ded0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    // 朱肉のマット(0.02)より下。道と地面は崖の先で切り落としてあるので、下に潜るものは無い
    floor.position.set(0, 0.012, z);
    this.group.add(floor);

    // 敷石の目地を同心円で。無地だと広さが読めない（動いているのが分からない）
    const jointMat = new THREE.MeshLambertMaterial({ color: 0xd2c4b0 });
    for (const r of [R * 0.3, R * 0.55, R * 0.8]) {
      this.flatRing(r - 0.07, r + 0.07, 0.016, z, jointMat);
    }
    // 縁。明るい縁石 → 濃い切り口の2段で「ここで地面が終わる」を切る
    this.flatRing(R - 1.1, R - 0.35, 0.018, z, new THREE.MeshLambertMaterial({ color: 0xbfae95 }));
    this.flatRing(R - 0.35, R, 0.018, z, new THREE.MeshLambertMaterial({ color: CLIFF_TOP }));

    const side = new THREE.CylinderGeometry(R, R * 0.8, Y.cliffDepth, 96, 6, true);
    fadeDown(side, Y.cliffDepth);
    const cliff = new THREE.Mesh(side, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    cliff.position.set(0, -Y.cliffDepth / 2, z);
    this.group.add(cliff);
  }

  private flatRing(inner: number, outer: number, y: number, z: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, z);
    this.group.add(m);
  }

  /**
   * 橋。★**コース幅と同じ幅**にしてある（`bridgeHalf` 5.5 ＝ `courseWidth/2`）。
   * 細くすると、人数で膨らむ群れが橋からはみ出して**宙に浮いて見える**。
   * 「落ちる」判定は作らない（今回は見た目だけの区間）ので、はみ出しは事故にしかならない
   */
  private buildBridge(): void {
    const len = Y.bridgeFrom - BRIDGE_TO + 1.6;   // 両岸に少し乗せる
    const mid = (Y.bridgeFrom + BRIDGE_TO) / 2;

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(Y.bridgeHalf * 2, 0.22, len),
      new THREE.MeshLambertMaterial({ color: 0xe4d7bd }),
    );
    deck.position.set(0, 0.08, mid);
    this.group.add(deck);

    // 板の目地。**渡っている速さが読める**（道のテクスチャと同じ役目）
    const plankMat = new THREE.MeshLambertMaterial({ color: 0xcbb894 });
    const planks = Math.floor(len / 1.8);
    const plankItems: BoxItem[] = [];
    for (let i = 0; i < planks; i++) {
      plankItems.push({
        x: 0, y: 0.20, z: mid - len / 2 + (i + 0.5) * (len / planks),
        w: Y.bridgeHalf * 2 - 0.3, h: 0.05, d: 0.16,
      });
    }
    this.boxes(plankMat, plankItems);

    // 欄干。**「渡っている」を出しているのは実はこれ**（下が水でも、囲いが無いと道のまま）
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8a6b45 });
    for (const sign of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, len), railMat);
      rail.position.set(sign * Y.bridgeHalf, 0.08 + Y.railH, mid);
      this.group.add(rail);
      const posts = Math.floor(len / 2.4);
      const postItems: BoxItem[] = [];
      for (let i = 0; i < posts; i++) {
        postItems.push({
          x: sign * Y.bridgeHalf, y: 0.08 + Y.railH / 2,
          z: mid - len / 2 + (i + 0.5) * (len / posts),
          w: 0.22, h: Y.railH, d: 0.22,
        });
      }
      this.boxes(railMat, postItems);
    }
  }

  /**
   * ★**書類の城**（本人が3案から選択・2026-09-06）。
   *
   * 石の城ではなく、**キャビネットと紙束とファイルでできた城**。
   * 廊下（下駄箱）から地続きで、ボス＝人事部の本拠地として意味が通る。
   *
   * ★**新しい素材を作らない。** 箱と平面だけで組む（`BossFigure` がアトラス満杯を
   * 板で回避したのと同じ判断・2026-08-28）。
   * 読ませたいのは細部ではなく**シルエット**なので、それで足りる
   */
  private buildCastle(): void {
    const z = -Y.castleBeyond;
    const W = Y.castleW;
    const H = Y.castleH;
    const D = Y.castleD;

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd9c9a8 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x7d6444 });
    const roofMat = new THREE.MeshLambertMaterial({ color: P.stamp });
    const drawerMat = new THREE.MeshLambertMaterial({ color: 0xc4b08c });
    /** ★金の縁（2026-09-16・本人「少しだけ豪華に」）。判子の赤と並べて「格上」を出す */
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xe0a93a, emissive: 0x5a3a08, emissiveIntensity: 0.35 });
    const bannerMat = new THREE.MeshLambertMaterial({ color: P.stamp, side: THREE.DoubleSide });

    // 本体 ＝ 巨大なキャビネット
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bodyMat);
    body.position.set(0, H / 2, z);
    this.group.add(body);
    const front = z + D / 2 + 0.06;

    // ★台座と軒の金の帯。**上下を切るだけで「建物」から「城」に上がる**
    this.boxes(goldMat, [
      { x: 0, y: 0.5, z: z, w: W + 1.6, h: 1.0, d: D + 1.6 },
      { x: 0, y: H + 0.4, z: z, w: W + 1.2, h: 0.8, d: D + 1.2 },
    ]);

    /*
     * 引き出しの段。**これが「ただの壁」を「キャビネット」に変える。**
     * ★段の数は高さから出す（2026-09-16）。固定の7段のまま高くすると、引き出し1つが縦長の扉に見える
     */
    const rows = Math.max(7, Math.round((H - 2.0) / 2.4));
    const cols = 6;
    const drawers: BoxItem[] = [];
    const handles: BoxItem[] = [];
    const gateW = 8.4;
    const gateH = 12.5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = (W - 2.4) / cols - 0.5;
        const h = (H - 2.0) / rows - 0.45;
        const x = -(W - 2.4) / 2 + ((W - 2.4) / cols) * (c + 0.5);
        const y = 1.0 + ((H - 2.0) / rows) * (r + 0.5);
        // 門の後ろに引き出しを描かない（門の穴から引き出しが透けて見える）
        if (Math.abs(x) < gateW / 2 + w / 2 && y < gateH + 1) continue;
        drawers.push({ x, y, z: front, w, h, d: 0.12 });
        // 取っ手。横一文字。**引き出しだと分かる最小の記号**
        handles.push({ x, y, z: front + 0.12, w: w * 0.34, h: 0.16, d: 0.14 });
      }
    }
    this.boxes(drawerMat, drawers);
    this.boxes(goldMat, handles);

    // 門。**入口があると建物になる**（無いと壁）。金の枠で囲い、前に階段を置く
    const gate = new THREE.Mesh(new THREE.BoxGeometry(gateW + 1.6, gateH + 1.2, 0.3), goldMat);
    gate.position.set(0, (gateH + 1.2) / 2, front + 0.2);
    this.gateZLocal = front + 0.2;
    this.group.add(gate);
    const gateIn = new THREE.Mesh(new THREE.BoxGeometry(gateW, gateH, 0.2), new THREE.MeshBasicMaterial({ color: 0x3b2f22 }));
    gateIn.position.set(0, gateH / 2, front + 0.35);
    this.group.add(gateIn);
    this.boxes(trimMat, [0, 1, 2].map((i) => ({
      x: 0, y: 0.18 + i * 0.36, z: front + 3.2 - i * 1.0, w: gateW + 5 - i * 1.2, h: 0.36, d: 1.0,
    })));

    // ★垂れ幕。門の両脇に2枚ずつ。**赤＋金の縁**（紙の城に、式典の格を足す）
    const banners: BoxItem[] = [];
    const bannerTrim: BoxItem[] = [];
    for (const x of [-W * 0.36, -W * 0.2, W * 0.2, W * 0.36]) {
      banners.push({ x, y: H - 6.5, z: front + 0.45, w: 3.0, h: 10, d: 0.08 });
      bannerTrim.push({ x, y: H - 11.6, z: front + 0.5, w: 3.2, h: 0.5, d: 0.1 });
      bannerTrim.push({ x, y: H - 1.4, z: front + 0.5, w: 3.4, h: 0.4, d: 0.1 });
    }
    this.boxes(bannerMat, banners);
    this.boxes(goldMat, bannerTrim);

    /*
     * 塔 ＝ **積み上がった紙束**。少しずつずらして積む。
     * ★**まっすぐ積まない**のが要。ずれていると「紙の束」に見え、揃っていると柱に戻る
     * ★**3本 → 5本、真ん中を一番高く**（2026-09-16）。3倍になったボス（19〜23m）より城が低いと、城に見えない
     */
    const towers: { x: number; h: number; s: number }[] = [
      { x: -W / 2 + 1.8, h: H + 12, s: 6.0 },
      { x: W / 2 - 1.8, h: H + 12, s: 6.0 },
      { x: -W * 0.24, h: H + 7, s: 4.6 },
      { x: W * 0.24, h: H + 7, s: 4.6 },
      { x: 0, h: H + 19, s: 7.0 },
    ];
    const slabsA: BoxItem[] = [];
    const slabsB: BoxItem[] = [];
    const poles: BoxItem[] = [];
    const flags: BoxItem[] = [];
    const balls: BoxItem[] = [];
    for (const t of towers) {
      const stacks = Math.floor(t.h / 1.5);
      for (let i = 0; i < stacks; i++) {
        const w = t.s - i * (t.s * 0.012);
        // 決め打ちのずらし。乱数だと毎回ちらつく（`Course.pseudo` と同じ理由）
        const wob = Math.sin(i * 2.1 + t.x) * 0.34;
        const item = {
          x: t.x + wob, y: 0.75 + i * 1.5, z: z - 0.6 + Math.cos(i * 1.7) * 0.3,
          w, h: 1.42, d: w * 0.8,
        };
        (i % 2 === 0 ? slabsA : slabsB).push(item);
      }
      // 屋根 ＝ 朱の四角錐。**判子の赤**を使う（この世界で一番強い色を頂点に置く）
      const roofH = t.s * 0.95;
      const topY = 0.75 + stacks * 1.5;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(t.s * 0.86, roofH, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(t.x, topY + roofH / 2, z - 0.6);
      this.group.add(roof);
      // ★金の玉と旗。**動かさない**（はためかせると背景が主役を食う）
      const tip = topY + roofH;
      balls.push({ x: t.x, y: tip + 0.35, z: z - 0.6, w: 0.8, h: 0.8, d: 0.8 });
      poles.push({ x: t.x, y: tip + 2.2, z: z - 0.6, w: 0.18, h: 3.6, d: 0.18 });
      flags.push({ x: t.x + 1.3, y: tip + 3.3, z: z - 0.6, w: 2.4, h: 1.4, d: 0.06 });
    }
    this.boxes(bodyMat, slabsA);
    this.boxes(drawerMat, slabsB);
    this.boxes(goldMat, balls);
    this.boxes(trimMat, poles);
    this.boxes(bannerMat, flags);
  }

  /**
   * ★**同じ形の繰り返しは必ず InstancedMesh 1枚にまとめる**（2026-09-06）。
   *
   * 引き出し70個・取っ手70個・橋の板・欄干の柱・紙束の層を素直に `Mesh` で置くと、
   * **描画コールが 150 本増える**（前庭を入れる前は 29〜41 本）。
   * このゲームは「**Chromebook 4GB でも動くこと**」が §6 の条件なので、
   * 背景の飾り1つでその予算を食い潰すわけにいかない。
   * `Course` の下駄箱がインスタンスなのと同じ理由
   */
  private boxes(mat: THREE.Material, items: readonly BoxItem[]): void {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, items.length);
    mesh.frustumCulled = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this.v.set(it.x, it.y, it.z);
      this.sc.set(it.w, it.h, it.d);
      this.m.compose(this.v, this.q, this.sc);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** @param bossZ ボスの相対 z（前方が -Z）。子は「ボスからの相対 m」で組んである */
  place(bossZ: number): void {
    this.group.visible = true;
    this.group.position.z = bossZ;
  }

  hide(): void {
    this.group.visible = false;
  }
}
