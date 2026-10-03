import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../config';
import vert from '../shaders/cutout.vert?raw';
import frag from '../shaders/cutout.frag?raw';
import type { CutoutPart } from './cutoutLayout';

/**
 * 紙の切り抜きキャラ（`PLAN.md` 第1節）。
 *
 * **ボーンは使わない。** 板を関節で折るだけ。
 * `InstancedMesh` がスキニングに非対応という Day 1 の制約は、
 * **紙のキャラにとっては制約ですらない**（紙は曲がらず、ヒンジで回るだけだから）。
 *
 * ここは**形と動きだけ**を担当する。**絵は外部の PNG**（アトラス1枚）で、
 * 差し替えはファイルの上書きで済む。
 *
 * ### 半透明ではなくアルファ**テスト**を使う理由
 * 半透明合成にすると描画順を並べ替える必要が出て、数千体が重なった瞬間に破綻する。
 * アルファテストなら深度バッファがそのまま効くので、**並べ替えが要らない**。
 *
 * ### 前後の重なり
 * 同一平面のクアッドはZファイトするので、パーツごとにローカルZを微小にずらす
 * （`cutoutLayout.ts` の `z`）。`polygonOffset` はマテリアル単位なので、
 * アトラス1枚に統合したこの作りでは使えない。
 */

/** 1枚の板を作る。ピボット・パーツID・UVを頂点に焼き込む */
function quad(p: CutoutPart): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(p.w, p.h);
  // 接地影だけは地面に寝かせる。奥行きは h が担う
  if (p.flat) g.rotateX(-Math.PI / 2);
  g.translate(p.x, p.y, p.z);
  const n = g.attributes.position.count;

  // UV をアトラスの矩形へ写す。mirror のときは u を反転する
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const u0 = uv.getX(i);
    const v0 = uv.getY(i);
    const u = p.mirror ? 1 - u0 : u0;
    uv.setXY(i, p.rect.u + u * p.rect.w, p.rect.v + v0 * p.rect.h);
  }

  const aPart = new Float32Array(n).fill(p.part);
  const aPivot = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    aPivot[i * 3] = p.pivot[0];
    aPivot[i * 3 + 1] = p.pivot[1];
    aPivot[i * 3 + 2] = p.pivot[2];
  }
  g.setAttribute('aPart', new THREE.BufferAttribute(aPart, 1));
  g.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
  /*
   * ★**この板だけ色を塗り替えてよいか**（2026-09-14・コインの使い道）。
   * ★**別メッシュに分けなかった理由**: 走りの弾みと腕の振りはシェーダーの中で起きるので、
   * **分けると位相がずれて、スリッパだけ体から遅れる**。
   * **1メッシュのまま、板に印を付けて塗り分ける**のが唯一ずれない
   */
  g.setAttribute('aRecolor', new THREE.BufferAttribute(new Float32Array(n).fill(p.recolor ? 1 : 0), 1));
  return g;
}

/**
 * パーツの一覧から、1体ぶんのジオメトリを作る。
 * @returns 板の枚数ぶんの頂点しか持たない（6枚なら 24頂点）。**箱の棒人間の1/10**
 */
export function buildCutoutGeometry(parts: CutoutPart[]): THREE.BufferGeometry {
  const geos = parts.map(quad);
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('failed to merge cutout geometry');
  for (const g of geos) g.dispose();

  // 単体 Mesh 用の既定値。群衆では InstancedBufferAttribute で上書きする
  const n = merged.attributes.position.count;
  merged.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n), 1));
  merged.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(n), 1));
  merged.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return merged;
}

export interface CutoutMaterialOptions {
  /** 走りの速さ。0 で止まる（立っている敵など） */
  cadence?: number;
  /** 紙の地合い。**世界と同じ1枚**を渡すと質感が揃う */
  grain?: THREE.Texture | null;
  /**
   * 役職の色。同じ絵を別の色で出すためのつまみ（濃紺の職員 → 赤い警備）。
   *
   * ★**1を超える値を入れてよい。** 元の絵の濃紺は明るさが0.2しかないので、
   * 明るさを保ったまま色相だけ変えると**ほぼ黒い赤**にしかならない（実機で確認）。
   * 「黒い物体が恥ずかしい」を直しているのに黒くしたら本末転倒なので、
   * ここで明るさごと持ち上げる。だから `Color` ではなく `Vector3`。
   */
  tint?: readonly [number, number, number] | null;
  /** 色を混ぜる強さ。0で元の絵のまま */
  tintAmount?: number;
}

/**
 * 切り抜き用のマテリアル。
 *
 * **陰影を計算しない。** 紙の切り抜きの陰影は**絵に描いてある**もので、
 * 法線から作るものではない。板ポリの法線は全部同じ方向を向くので、
 * トゥーンシェーディングを掛けても一定値になり、意味がない
 * （**箱向けのシェーダを先に書くと全部無駄になる**、という指摘が正しかった理由がこれ）。
 */
export function createCutoutMaterial(
  atlas: THREE.Texture,
  { cadence = CFG.stickman.cadence, grain = null, tint = null, tintAmount = 0 }: CutoutMaterialOptions = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: false,
    // **アルファテスト。** 半透明にしないので並べ替えが要らない
    // 0.5 だと遠距離でミップにより輪郭が痩せる（ATLAS.md §2）
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    uniforms: {
      uAtlas: { value: atlas },
      uGrain: { value: grain },
      uHasGrain: { value: grain ? 1 : 0 },
      uGrainScale: { value: 0.5 },
      uTime: { value: 0 },
      uCadence: { value: cadence },
      uSwing: { value: CFG.stickman.swing },
      uBob: { value: CFG.stickman.bob },
      uGrey: { value: new THREE.Color(CFG.palette.grey).convertSRGBToLinear() },
      uTintCol: { value: new THREE.Vector3(...(tint ?? [1, 1, 1])) },
      uTintAmt: { value: tint === null ? 0 : tintAmount },
      // **自前シェーダには three の alphaTest が入らない**ので、値を渡して自分で捨てる
      uAlphaCut: { value: 0.45 },
      uRaise: { value: 0 },
      /** ★殴っている度合い（0..1）。2026-09-14 */
      uPunch: { value: 0 },
      /** ★万歳の度合い（0..1）。2026-09-16 */
      uCheer: { value: 0 },
      /** ★塗り替える色（`aRecolor` の板だけ）。既定は白 ＝ 元の絵のまま */
      uReCol: { value: new THREE.Vector3(1, 1, 1) },
      uReAmt: { value: 0 },
      /** ★スリッパの絵（2026-09-16）。`uHasSlip` が 0 のあいだは読まない */
      uSlip: { value: null as THREE.Texture | null },
      uHasSlip: { value: 0 },
      uSlipRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
  });
}
