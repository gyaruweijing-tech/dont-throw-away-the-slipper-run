import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../config';
import vert from '../shaders/stickman.vert?raw';
import frag from '../shaders/stickman.frag?raw';

/** パーツID。stickman.vert と必ず一致させること */
export const PART = {
  torso: 0,
  head: 1,
  armL: 2,
  armR: 3,
  legL: 4,
  legR: 5,
  slipper: 6,
  /** 接地影。**振らないし、弾まない**（影が跳ねると地面から浮いて見える） */
  shadow: 7,
} as const;

const P = CFG.palette;

/**
 * 棒人間のジオメトリ（PROGRESS §6: 3Dモデルは全部コードで手続き生成・外部アセットゼロ）。
 *
 * **2026-08-22 に `assets/B-1.png` の絵に合わせて作り直した。** デザイン確定事項は:
 *  - **スーツ**: 肩が腰より広い。箱では絞れないので**肩の箱と上着の箱の2段**で段差を作る
 *  - **足元はスリッパ**: 脚より横に広い平たい箱。**脚のパーツIDを与えて脚と一緒に振らせる**
 *  - **手に書類を1枚**: 腕と一緒に振れる。**大群が真っ黒な塊になるのを防ぐ明るい点**でもある
 *  - 主人公だけ書類のかわりに**スリッパを頭上に掲げる**（`withSlipper`）
 *
 * 色の使い分けが1箇所だけ直感と逆になっている:
 *  - **履いているスリッパは明るい**（暗いズボンの上に乗るので明るい方が見える）
 *  - **掲げているスリッパは暗い**（紙色の背景と空の側に出るので暗い方が見える）
 * 同じ物なのに明度が違うのは、背景が違うから。**コントラストは物ではなく組み合わせで決まる。**
 *
 * 箱は味方10個 / 主人公10個。数千体を1ドローで出すので、これ以上は増やさない。
 */
export function buildStickmanGeometry(withSlipper: boolean): THREE.BufferGeometry {
  const inkBody = 0x2b2a28;
  // 頭は明確に明るくする。全部インクだと大群が真っ黒な塊になって人に見えない
  const inkHead = 0xc0b8a6;
  // 履物と書類。紙色そのものだと背景に溶けるので一段落とす
  // figure の中で一番明るい面にする。頭(0xc0b8a6)と同値だと足元と頭が同じに見えて読みが濁る
  const worn = 0xd9d2c2;
  const sheet = 0xe8e2d4;
  /**
   * 掲げているスリッパは**2色**にする。
   * - 真っ黒1色だと腕と一体化して「棒の先の何か」になる（実機で確認）
   * - かといって全部明るくすると、掲げた先は紙色の空なので今度は背景に溶ける
   * → **底は暗く（空に対する輪郭）／甲は明るく（内部に構造があることを示す）。**
   *   甲の色は履いているスリッパと同じにして、「掲げている物 ＝ みんなが履いている物」を繋ぐ
   */
  const heldSole = 0x2b2a28;

  const HIP = 0.72;      // 股関節（脚の回転軸）
  const SHOULDER = 1.33; // 肩（腕の回転軸）

  const parts: THREE.BufferGeometry[] = [
    // --- 脚 ---
    box(0.155, HIP, 0.17, 0.16, HIP / 2, 0, PART.legL, [0.16, HIP, 0], inkBody),
    box(0.155, HIP, 0.17, -0.16, HIP / 2, 0, PART.legR, [-0.16, HIP, 0], inkBody),
    // --- 履いているスリッパ。**脚のIDを与えてあるので脚と一緒に振れる** ---
    // **真後ろからはスリッパの形は原理的に読めない**（靴は横から見ないと分からない物）。
    // だからここで狙うのは形ではなく「**脚より横に広い、figure の中で一番明るい面**」。
    // 全員の足元が明るいこと自体が記号になり、掲げているスリッパと繋がって意味が通る
    box(0.34, 0.10, 0.42, 0.16, 0.05, 0.06, PART.legL, [0.16, HIP, 0], worn),
    box(0.34, 0.10, 0.42, -0.16, 0.05, 0.06, PART.legR, [-0.16, HIP, 0], worn),
    // 甲のベルト。真後ろからは見えないが、横を向いた一瞬と、寄りの画で効く
    box(0.34, 0.11, 0.13, 0.16, 0.15, -0.10, PART.legL, [0.16, HIP, 0], worn),
    box(0.34, 0.11, 0.13, -0.16, 0.15, -0.10, PART.legR, [-0.16, HIP, 0], worn),
    // --- 上着（腰側）と肩。**2段にすることで箱のまま「肩が広い」を作る** ---
    box(0.44, 0.36, 0.24, 0, HIP + 0.18, 0, PART.torso, [0, 0, 0], inkBody),
    box(0.50, 0.25, 0.26, 0, 1.205, 0, PART.torso, [0, 0, 0], inkBody),
    box(0.33, 0.31, 0.31, 0, 1.495, 0, PART.head, [0, 0, 0], inkHead),
    // --- 腕。肩の箱のすぐ内側に垂らす ---
    box(0.12, 0.54, 0.14, 0.31, SHOULDER - 0.27, 0, PART.armL, [0.31, SHOULDER, 0], inkBody),
    box(0.12, 0.54, 0.14, -0.31, SHOULDER - 0.27, 0, PART.armR, [-0.31, SHOULDER, 0], inkBody),
  ];

  if (withSlipper) {
    /*
     * 主人公。**腕を真上に伸ばしてスリッパを掲げる**（`assets/B-4` の想定）。
     * 掲げた腕とスリッパは PART.torso ＝ **振らない**。振ると掲げている物が読めなくなる。
     *
     * **ここは一度作り直している。** 最初は 0.32(X) × 0.11(Y) × 0.46(Z) の箱1個で置いたが、
     * 実機で見たら**ただのT字の棒**にしか見えなかった（`.shots/slip_hero.png`）。
     * 原因は向き: 長辺(0.46)がカメラの奥行き方向を向いていたので、
     * **真後ろからは細い断面しか見えていなかった**。靴は横から見ないと形が分からない物なので、
     * 長辺を画面の横方向(X)に倒し、**底と甲の2箱で「へ」の字の輪郭**を作る。
     */
    parts.push(box(0.12, 0.56, 0.14, 0.31, SHOULDER + 0.28, 0, PART.torso, [0, 0, 0], inkBody));
    // 底。**手の位置（腕の真上）から内側へ片持ちで伸ばす。**
    // 腕が底の真ん中を貫くと、柄と頭の関係になって**ハンマーにしか見えない**（実機で確認）
    parts.push(box(0.70, 0.09, 0.26, -0.02, SHOULDER + 0.60, 0, PART.torso, [0, 0, 0], heldSole));
    // 甲。**底の「遠い方の半分」を大きく盛り上げる。**
    // ここが小さいと突起にしか見えない。半分を占めて初めて履物の輪郭になる
    parts.push(box(0.38, 0.20, 0.26, -0.16, SHOULDER + 0.745, 0, PART.torso, [0, 0, 0], worn));
  } else {
    // 味方は書類を1枚提げている。腕と一緒に振れる
    parts.push(box(0.16, 0.21, 0.03, 0.41, SHOULDER - 0.58, 0.05, PART.armL, [0.31, SHOULDER, 0], sheet));
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('failed to merge stickman geometry');
  for (const g of parts) g.dispose();

  // 単体 Mesh 用の既定値。群衆では InstancedBufferAttribute で上書きする（Crowd.ts）
  const n = merged.attributes.position.count;
  merged.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n), 1));
  merged.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(n), 1));
  merged.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return merged;
}

/** 走りアニメ用マテリアル。Phase 1 で instanced 化しても中身はほぼそのまま使える */
export function createStickmanMaterial(cadence: number = CFG.stickman.cadence): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 },
      uCadence: { value: cadence },
      uSwing: { value: CFG.stickman.swing },
      uBob: { value: CFG.stickman.bob },
      uGrey: { value: new THREE.Color(P.grey).convertSRGBToLinear() },
      uRaise: { value: 0 },
      uLightDir: { value: new THREE.Vector3(0.35, 0.9, 0.28).normalize() },
    },
  });
}

function box(
  w: number, h: number, d: number,
  cx: number, cy: number, cz: number,
  partId: number,
  pivot: [number, number, number],
  colorHex: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  // uv は使わないので落とす（マージ時の属性ズレも防げる）
  g.deleteAttribute('uv');

  const n = g.attributes.position.count;
  const aPart = new Float32Array(n).fill(partId);
  const aPivot = new Float32Array(n * 3);
  const aColor = new Float32Array(n * 3);

  // ShaderMaterial は色管理の自動変換が効かないので、ここでリニアに寄せておく
  const c = new THREE.Color(colorHex).convertSRGBToLinear();

  for (let i = 0; i < n; i++) {
    aPivot[i * 3] = pivot[0];
    aPivot[i * 3 + 1] = pivot[1];
    aPivot[i * 3 + 2] = pivot[2];
    aColor[i * 3] = c.r;
    aColor[i * 3 + 1] = c.g;
    aColor[i * 3 + 2] = c.b;
  }

  g.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
  return g;
}
