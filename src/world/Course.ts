import * as THREE from 'three';
import { CFG } from '../config';
import { groundSheet } from '../tex/paper';
import { addOutline } from '../fx/outline';

/**
 * 直線コース（§4-A: 壁があり落下なし＝ストレスを作らない）。
 *
 * 主人公は z=0 に固定して、世界のほうを手前へ流す。
 * こうすると走行距離が伸びても座標が大きくならず、リサイクルも剰余だけで済む。
 *
 * ---------------------------------------------------------------
 * ★**実験B（2026-08-23）: 廊下の壁をやめて、開けた地面に点在させる。**
 * ---------------------------------------------------------------
 * それまでは下駄箱を道の両脇にびっしり並べて**廊下の壁**にしていた。
 * 本人の指摘は一貫していた:
 *
 * > 今回イメージしていたのは、あのビル群がそのまま下駄箱になるイメージ
 * > 下駄箱は一番terribleだと思う
 *
 * 本人提供の実プレイ画面（`assets/背景参考用.png`）を見ると、参考の背景は**壁ではない**。
 * **開けた地面に、巨大な物体がまばらに立っている**だけ。道はその間を通る細い暗い帯。
 * 壁にすると次の3つが同時に壊れる:
 *   1. 道が狭く見える（両脇が塞がる）
 *   2. 奥行きが死ぬ（同じ距離に同じ物が並ぶ）
 *   3. 背景の面積が大きすぎて、主役より目立つ
 *
 * だからここでは:
 *   - 地面を**道の外までうんと広げる**（今までは道幅ぶんしか無かった）
 *   - 下駄箱を**大きく・数を減らし・道からの距離をばらけさせる**
 */

/** 道の縁。暗い道と明るい地面の境目をはっきりさせる細い帯 */
const CURB_W = 0.55;

/** 下駄箱1台の段数（横の棚板） */
const BANDS = 5;
/** 下駄箱1台の列数（縦の仕切り）。**段だけだと本棚に戻る** */
const COLS = 8;

/**
 * マスに入っているスリッパの色。
 *
 * 背景は**下駄箱だけ**にする（本人決定 2026-08-23）。
 * このゲームの核はスリッパなので、背景そのものをスリッパ置き場にする。
 *
 * ★ 彩度は**中くらいまで**。実験2で淡くしすぎて彩度13まで落ち、
 * 参考（36）より色が抜けて「洗いざらし」に見えた。戻しつつ、明度は高いまま保つ。
 */
const SLIPPER_COLORS = [
  0x7fcfe8, // 水色
  0xf2b25c, // 橙
  0xe8887c, // 朱
  0x8ecf8e, // 緑
  0xc4a2e0, // 藤
  0xf2dd7a, // 黄
  0xf0a8c4, // 桃
] as const;

/**
 * ★**実験5（2026-08-23）: 下駄箱の箱そのものに色を付ける。**
 *
 * 実験4で中身の彩度を30%上げたが、背景全体の彩度は**13のまま動かなかった**。
 * 色が付いているのが**面積の小さい中身だけ**で、箱はクリーム色だったから。
 *
 * 参考の背景の物体（巨大なキノコ）は**全体が色**。
 * こちらは「白い箱に小さい色の点」だった。**色は面積で決まる。**
 *
 * 明るいまま彩度だけ持つ色にする（明度70台を保ちたいので、濃い色は使わない）。
 * 実物の下駄箱も組ごとに色分けされているので、世界観からも外れない。
 */
const LOCKER_COLORS = [
  0x8fd9e8, // 空色
  0xf5c07a, // 杏
  0xf59a92, // 珊瑚
  0x9ed99e, // 若葉
  0xd0b4ea, // 藤
  0xf5e08a, // 卵
] as const;

const BEHIND = 22;      // カメラ後方にも少し残す長さ
/** 地面の広さ。**道幅(11)しか無かったので、道の外が空だった** */
const GROUND_W = 240;
const GROUND_L = 420;

/**
 * 下駄箱の間隔。
 * 壁だったときは 7（びっしり）。**点在させるので広げる。**
 * 台の幅は 4〜11 なので、隙間が必ず空く。
 */
const STACK_GAP = 15;
const STACK_COUNT = 16;

/** 縁石1区間の長さ（m）と本数。掛けて `GROUND_L` を覆う */
const CURB_SEG = 7;
const CURB_COUNT = 60;


export class Course {
  readonly group = new THREE.Group();

  private readonly sheet: THREE.CanvasTexture;
  /** 下駄箱の枠 */
  private readonly stacks: THREE.InstancedMesh;
  /** マスの奥（暗い凹み）。**これが無いと下駄箱が「駐車場のビル」に見える** */
  private readonly recess: THREE.InstancedMesh;
  /** 棚板（横） */
  private readonly bands: THREE.InstancedMesh;
  /** 仕切り（縦）。**これが「棚」を「下駄箱」に変える** */
  private readonly posts: THREE.InstancedMesh;
  /** マスに入っているスリッパ。**立てて入っている**（昇降口の実物どおり） */
  private readonly slippers: THREE.InstancedMesh;
  /** 道の縁。**区間ごとに置く**ので、広場では外へ逃がせる */
  private readonly curbs: THREE.InstancedMesh;
  /** 台ごとの形。毎フレーム乱数を引くと形がちらつく */
  private readonly shape: { h: number; w: number; d: number; x: number; z: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  /**
   * ★★**崖で地面を切り落とす面**（2026-09-16・ボス広場を丸い島にした）。
   * 橋の手前（`yard.bridgeFrom`）より向こうの**地面・道・縁石・下駄箱を描かない**。切った先は背景＝霧の色なので底なしに見える。
   * ★**板を上に敷いて隠す方式にしなかった理由**: 敷いた板は地面と同じ高さにしか置けず、**崖の面が板に潜って見えなくなる**。
   * ボス回でなければ遠く（1e6）へ置いて、何も切らない
   */
  private readonly cliff = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6);
  private clipReady = false;

  constructor() {
    /*
     * **地面。** 道の外まで広い一枚。
     * 明るくしておく（明度80前後）。参考の地面も明るい。
     * ここが暗いと、暗い道が地面に埋もれて「帯」に見えなくなる。
     */
    const plain = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_W, GROUND_L),
      new THREE.MeshLambertMaterial({ color: 0xf0e6d2 }),
    );
    plain.rotation.x = -Math.PI / 2;
    plain.position.set(0, -0.02, BEHIND - GROUND_L / 2);
    this.group.add(plain);

    // 道。**暗い帯。** テクスチャが目地を持つので、UVを流すだけで速度感が出る
    const sheet = groundSheet(1024);
    sheet.repeat.set(2, 46);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.courseWidth, GROUND_L),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: sheet }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, BEHIND - GROUND_L / 2);
    this.group.add(road);
    this.sheet = sheet;

    /*
     * 道の縁。**明るい細い帯。**
     * 参考の道にも薄い縁が付いている。暗い道と明るい地面の境目を
     * ぼかさずに切ると、道が「走る場所」としてはっきりする。
     */
    /*
     * ★**縁石は「1本の長い箱」から「短い区間の並び」に変えた**（2026-09-06）。
     *
     * 広場（`CFG.boss.open`）で道の縁を外へ逃がすため。1本の箱のままだと
     * **道の一部分だけ広げることが原理的にできない**（動かすと全長が動く）。
     * 下駄箱と同じ「並べて `wrap` で回す」作法に揃えた。
     * ★ただし**視差は掛けない**。縁石は路面に置かれているので、下駄箱の 0.86 倍で流すと
     * 道だけが滑って見える
     */
    const curbMat = new THREE.MeshLambertMaterial({ color: 0xfbf5e8 });
    this.curbs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), curbMat, CURB_COUNT * 2);
    this.curbs.frustumCulled = false;
    this.group.add(this.curbs);

    const N = STACK_COUNT * 2;

    /*
     * **下駄箱の材質。**
     *
     * ★ 自己発光を**弱めた**（0.34 → 0.16）。外部レビュー5番を採用。
     * 壁だったときは箱が道と平行に並び、こちらを向く面がほぼ影側だったので、
     * 陰影で明度が落ちて自己発光で持ち上げるしかなかった。
     * **点在させると正面を向く面が増えるので、そもそも影側が減る。**
     * 自己発光を強くしたままだと立体感が消えて板に見えるので、必要な分だけにする。
     * （このプロジェクトは bloom もトーンマッピングも使っていないので、
     *   自己発光が他の物へにじむ副作用は起きない。環境光1.15＋平行光1.5のみ）
     */
    /*
     * 枠。**1台ずつ色を変える。**
     * `setColorAt` は材質の色に掛け算されるので、材質は白にしておく。
     * 自己発光はインスタンスの色に**乗らない**（全部同じ色で足される）ので、
     * 色を濁らせないように弱めにする。
     */
    this.stacks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.bgMat(0xffffff, 0.10), N,
    );
    this.stacks.frustumCulled = false;
    {
      const lc = new THREE.Color();
      for (let i = 0; i < N; i++) {
        lc.setHex(LOCKER_COLORS[Math.floor(pseudo(i + 211) * LOCKER_COLORS.length) % LOCKER_COLORS.length]);
        lc.multiplyScalar(0.94 + pseudo(i + 307) * 0.12);
        this.stacks.setColorAt(i, lc);
      }
    }
    this.group.add(this.stacks);

    // マスの奥。枠より暗くして凹みに見せる。暗くしすぎると背景全体が落ちて群衆と混ざる
    this.recess = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.bgMat(0xb9a184), N,
    );
    this.recess.frustumCulled = false;
    this.group.add(this.recess);

    this.bands = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.bgMat(0xfdf8ee), N * BANDS,
    );
    this.bands.frustumCulled = false;
    this.group.add(this.bands);

    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.bgMat(0xfdf8ee), N * (COLS - 1),
    );
    this.posts.frustumCulled = false;
    this.group.add(this.posts);

    this.slippers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.bgMat(0xffffff), N * BANDS * COLS * 2,
    );
    this.slippers.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < N * BANDS * COLS * 2; i++) {
      // **2本で1組なので、隣り合う2本は同じ色**にする。バラバラだと片方ずつに見える
      const pair = Math.floor(i / 2);
      col.setHex(SLIPPER_COLORS[Math.floor(pseudo(pair + 501) * SLIPPER_COLORS.length) % SLIPPER_COLORS.length]);
      /*
       * ★**実験4（2026-08-23）: 背景の彩度だけ上げる。**
       *
       * 実験2で背景を明るくするとき淡色にしすぎて、彩度が 21 → 13 まで落ちた。
       * 参考（本家の実プレイ画面）の背景は彩度36。**色は残っている。**
       * 分けているのは彩度ではなく明度だったので、色は戻してよい。
       *
       * `offsetHSL(0, +s, 0)` は**色相と明るさを動かさずに彩度だけ**動かす。
       * ただし入力を固定しても**描画後の明るさが動かない保証は無い**（外部レビュー9番）。
       * なので `tools/look.js` で明度が動いていないことを毎回確認する。
       */
      col.offsetHSL(0, 0.18, 0);
      // 同じ色でも少し明暗を散らす。均一だと印刷物に見える
      col.multiplyScalar(0.92 + pseudo(pair + 733) * 0.16);
      this.slippers.setColorAt(i, col);
    }
    this.group.add(this.slippers);

    // **立体にだけ輪郭線。** 箱には正しく効く（キャラは板なので掛けない）
    addOutline(this.stacks, 0.07);
    addOutline(this.slippers, 0.02);

    for (let i = 0; i < N; i++) {
      /*
       * ★**大きく・まばらに。**
       * 壁だったときは 高さ2.5〜4.0・奥行き1.1・道からの距離0.7〜1.6 だった。
       * 「家具に見せる」ために縮めた結果、**構図を支えていた質量を壊した**。
       *
       * 参考の背景の物体は**画面から突き抜けるほど大きい物**と
       * **小さくて遠い物**が混ざっている。距離も高さもばらけさせる。
       */
      const r = pseudo(i);
      const near = pseudo(i + 37);
      this.shape.push({
        // 手前に立つ物ほど高く。遠くの物は低く。**近くて低い物は視界を塞ぐだけ**
        /*
         * ★**実験6: 横に広く、低く。**
         * 高さ3.6〜12.6・幅4〜11 にしたら、遠くの台が**ビル群に見えた**（実機）。
         * **縦に高いものは建物、横に広いものは家具**として読まれる。
         * 実物の下駄箱は横長なので、幅を高さの2〜4倍にする。
         */
        h: 3.0 + Math.pow(r, 1.4) * 4.2,
        w: 9.0 + pseudo(i + 91) * 13.0,
        d: 1.6 + pseudo(i + 53) * 1.2,
        // 道の縁からの距離。**0付近を作らない**（道に張り付くと壁に戻る）
        x: 2.6 + Math.pow(near, 1.4) * 17.0,
        // 前後にもずらす。等間隔だと並木に見える
        z: (pseudo(i + 17) - 0.5) * STACK_GAP * 0.7,
      });
    }

    this.update(0);
  }

  /**
   * 背景の材質。**自己発光を少しだけ混ぜる。**
   *
   * 箱は光の当たらない側面が Lambert の陰影で落ちる。
   * 実験2で、材質の色を上げるだけでは明度が 55→59 しか動かず、
   * 自己発光を足して 59→73 まで上がった。
   * **色ではなく影側の面が上限を作っていた**という理解でよさそうだが、
   * 影の強さ・法線・環境光など他の要因も絡むので、断定はしない。
   * 効果と副作用（立体感が消える）を見ながら最小限にする。
   */
  private bgMat(color: number, glow = 0.16): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: glow });
  }

  /** @param scroll 走った総距離 */
  /**
   * @param scroll いままでに走った距離（m）
   * @param bossZ ★**広場のボスの相対 z**（前方が -Z）。ボス回でなければ `null`。
   *   この値の周りだけ壁と縁石が外へ逃げて、**道が広がったように見える**。
   *   ★**視差（0.86倍）を無視して相対 z で測っている**のは、下駄箱がボスと**同じ速さで
   *   流れていないから**。世界の距離で計算すると、広がる場所がボスと数m ずれて見える
   */
  update(scroll: number, bossZ: number | null = null): void {
    const halfW = CFG.courseWidth / 2;
    const o = CFG.boss.open;

    if (!this.clipReady) {
      this.clipReady = true;
      this.group.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) mat.clippingPlanes = [this.cliff];
      });
    }
    // 平面より手前（+Z）だけ残す。距離 = z − 崖の z
    this.cliff.constant = bossZ === null ? 1e6 : -(bossZ + CFG.boss.yard.bridgeFrom);

    /** その z における逃がし量（m）。ボスの手前 `from` から `till` にかけて開く */
    const spreadAt = (z: number): number => {
      if (bossZ === null) return 0;
      // ボスより何m手前か。負なら通り過ぎた側（＝広いまま）
      const ahead = z - bossZ;
      /*
       * 2段で開く。
       *  1段目（`from` 56m → `till` 46m）: 廊下が広がる。壁はまだ見えている
       *  2段目（`till` 46m → `gone` 40m）: ★**堀の手前で完全に飛ばす。**
       *
       * ★2段目が要る理由（2026-09-06・本人指摘）。ここから先は橋と前庭＝**新しい場所**なので、
       * 廊下の壁が残っていると「一直線の道の上にマークがあるだけ」に戻る。
       * 消さずに遠くへ飛ばすのは、**引いていく動きを途切れさせない**ため（フォグに溶けて消える）
       */
      const t1 = clamp01((o.from - ahead) / (o.from - o.till));
      const t2 = clamp01((o.till - ahead) / (o.till - o.gone));
      // 直線で開くと壁が折れて見える。両端をなめらかにする
      return smooth(t1) * o.spread + smooth(t2) * o.away;
    };

    // 道のタイル。**UV を流すだけ**で棒を並べるより軽い
    this.sheet.offset.y = -wrap(scroll, 1e6) / (GROUND_L / 46);

    // 道の縁。**下駄箱と違って視差なし**（路面に置かれているものなので）
    for (let i = 0; i < CURB_COUNT; i++) {
      const z = BEHIND - wrap(i * CURB_SEG - scroll, CURB_COUNT * CURB_SEG);
      const sp = spreadAt(z);
      for (let k = 0; k < 2; k++) {
        const sign = k === 0 ? -1 : 1;
        this.v.set(sign * (halfW + sp + CURB_W / 2), 0.08, z);
        // 区間の継ぎ目に隙間ができないよう、わずかに長くして重ねる
        this.sc.set(CURB_W, 0.16, CURB_SEG + 0.06);
        this.m.compose(this.v, this.q, this.sc);
        this.curbs.setMatrixAt(i * 2 + k, this.m);
      }
    }
    this.curbs.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < STACK_COUNT; i++) {
      const z = BEHIND - wrap(i * STACK_GAP - scroll * 0.86, STACK_COUNT * STACK_GAP);
      for (let k = 0; k < 2; k++) {
        const idx = i * 2 + k;
        const sh = this.shape[idx];
        const sign = k === 0 ? -1 : 1;
        const zz = z + (k === 0 ? 0 : STACK_GAP * 0.5) + sh.z;
        // 広場では壁が外へ逃げる。**縁石と同じ `spreadAt` を見る**（別々に書くと必ず食い違う）
        const cx = sign * (halfW + spreadAt(zz) + sh.x + sh.d / 2);

        // 枠
        this.v.set(cx, sh.h / 2, zz);
        this.sc.set(sh.d, sh.h, sh.w);
        this.m.compose(this.v, this.q, this.sc);
        this.stacks.setMatrixAt(idx, this.m);

        /*
         * **見えるのはコース側の1面だけ。** 面の手前に薄い層を重ねる。
         * 奥から順に: 枠の面 → 暗い凹み → スリッパ → 格子（棚板と仕切り）
         */
        const front = cx - sign * (sh.d / 2);
        const at = (t: number) => front - sign * t;
        const rowH = sh.h / BANDS;
        const cellD = sh.w / COLS;

        this.v.set(at(0.03), sh.h / 2, zz);
        this.sc.set(0.06, sh.h * 0.92, sh.w * 0.95);
        this.m.compose(this.v, this.q, this.sc);
        this.recess.setMatrixAt(idx, this.m);

        for (let b = 0; b < BANDS; b++) {
          for (let c = 0; c < COLS; c++) {
            const zc = zz - sh.w / 2 + cellD * (c + 0.5);
            for (let t = 0; t < 2; t++) {
              const n = ((idx * BANDS + b) * COLS + c) * 2 + t;
              // **縦長にする。** 横長の色板が並ぶと本の背表紙に見える
              const hh = rowH * (0.60 + pseudo(n + 11) * 0.16);
              this.v.set(
                at(0.10),
                rowH * b + hh / 2 + rowH * 0.08,
                zc + (t === 0 ? -1 : 1) * cellD * 0.13,
              );
              this.sc.set(0.10, hh, cellD * 0.17);
              this.m.compose(this.v, this.q, this.sc);
              this.slippers.setMatrixAt(n, this.m);
            }
          }
        }

        for (let b = 0; b < BANDS; b++) {
          this.v.set(at(0.18), rowH * (b + 1), zz);
          this.sc.set(0.14, sh.h * 0.028, sh.w * 1.0);
          this.m.compose(this.v, this.q, this.sc);
          this.bands.setMatrixAt(idx * BANDS + b, this.m);
        }

        for (let c = 0; c < COLS - 1; c++) {
          this.v.set(at(0.18), sh.h / 2, zz - sh.w / 2 + cellD * (c + 1));
          this.sc.set(0.14, sh.h * 0.92, sh.w * 0.02);
          this.m.compose(this.v, this.q, this.sc);
          this.posts.setMatrixAt(idx * (COLS - 1) + c, this.m);
        }
      }
    }
    this.stacks.instanceMatrix.needsUpdate = true;
    this.recess.instanceMatrix.needsUpdate = true;
    this.bands.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;
    this.slippers.instanceMatrix.needsUpdate = true;
  }
}

/**
 * 位置ごとに固定の疑似乱数。**Math.random() を毎フレーム引くと形がちらつく**
 */
function pseudo(i: number): number {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function wrap(v: number, span: number): number {
  return ((v % span) + span) % span;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..1 を両端なめらかに。壁が折れて見えるのを防ぐ */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
