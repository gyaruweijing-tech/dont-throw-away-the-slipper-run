import * as THREE from 'three';

/**
 * 紙の地合いを**世界の全部に乗算する**（`PLAN.md` / §15）。
 *
 * ★**スクリーン空間でやってはいけない。**
 * 画面全体のポストエフェクトとして紙を掛けると、カメラが寄っても引いても
 * 繊維の大きさが同じままになり、**「紙の世界」ではなく「レンズに紙が貼ってある」**に見える。
 * だから**マテリアルの中で、ワールド座標を UV にして**サンプルする。
 * こうすると、どの物も「同じ大きさの紙から切り出された」という物理的な一貫性が出る。
 *
 * 面の向きで投影面を切り替えている（2面ブレンド）。
 * 床は xz、立っている物は xy。**xz だけにすると壁で縦に伸びて筋になる。**
 * 3面（triplanar）までやる必要は無い —— この世界には斜めの面がほとんど無い。
 *
 * 実行時コストはテクスチャ参照2回ぶん。**ノイズを毎フレーム計算するわけではない**
 * （テクスチャは起動時に canvas へ1回描いたもの。`paper.ts` 参照）。
 */

const CHUNK_VERT_HEAD = /* glsl */`
varying vec3 vGrainPos;
varying vec3 vGrainNrm;
`;

const CHUNK_FRAG_HEAD = /* glsl */`
varying vec3 vGrainPos;
varying vec3 vGrainNrm;
uniform sampler2D uGrain;
uniform float uGrainScale;
uniform float uGrainAmount;
`;

const CHUNK_FRAG_BODY = /* glsl */`
{
  vec2 uvSide = vGrainPos.xy * uGrainScale;
  vec2 uvTop  = vGrainPos.xz * uGrainScale;
  float w = clamp(abs(normalize(vGrainNrm).y), 0.0, 1.0);
  float g = mix(texture2D(uGrain, uvSide).r, texture2D(uGrain, uvTop).r, w);
  gl_FragColor.rgb *= mix(1.0, g, uGrainAmount);
}
`;

/**
 * 既存のマテリアルに地合いを差し込む。**マテリアルを差し替えないので呼ぶだけでよい。**
 * @param amount 0 = 効果なし / 1 = テクスチャそのまま。既定 0.9（強すぎると画面が汚れる）
 * @param scale  ワールド1メートルあたりの繰り返し数
 */
export function applyGrain(
  material: THREE.Material,
  grain: THREE.Texture,
  { amount = 0.9, scale = 0.55 } = {},
): void {
  const m = material as THREE.Material & { userData: Record<string, unknown> };
  if (m.userData.grained) return;
  m.userData.grained = true;

  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    shader.uniforms.uGrainScale = { value: scale };
    shader.uniforms.uGrainAmount = { value: amount };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CHUNK_VERT_HEAD}`)
      // objectNormal はここで確定している。transformed は project_vertex の直前で確定
      .replace(
        '#include <project_vertex>',
        `vGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vGrainNrm = mat3(modelMatrix) * objectNormal;
         #include <project_vertex>`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CHUNK_FRAG_HEAD}`)
      // dithering は出力のいちばん最後。ここなら色が確定している
      .replace('#include <dithering_fragment>', `${CHUNK_FRAG_BODY}\n#include <dithering_fragment>`);
  };
  m.needsUpdate = true;
}

/** シーンの中の Lambert / Basic 系マテリアルに、まとめて差し込む */
export function grainScene(root: THREE.Object3D, grain: THREE.Texture, opts?: { amount?: number; scale?: number }): void {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      /*
       * ★**陰影を持つマテリアルにしか入れない。**
       *
       * 2026-08-22、これを守らずに `MeshBasicMaterial` にも注入して大事故を起こした。
       * Basic は `objectNormal` を宣言しないので、注入した
       * `vGrainNrm = mat3(modelMatrix) * objectNormal;` が
       * **シェーダのコンパイルエラーになり、そのマテリアルが丸ごと描画されなくなる。**
       *
       * 症状はこうだった:
       *   - **ゲートのパネルが1枚も出なくなった**（GatePanel は MeshBasicMaterial）
       *   - **丸影が1ピクセルも描かれなかった**（同上）。三角形はラスタライズされているのに
       *     画面に出ない、という状態で、原因の切り分けに長時間を溶かした
       *
       * **教訓: 描いたはずの物が出ないときは、まずコンソールのシェーダエラーを見る。**
       * WebGL のシェーダコンパイル失敗は、例外を投げずに「静かに消える」形で現れる。
       *
       * そもそも Basic を使っているのはゲートのパネル・輪・ゲージ等の「記号」で、
       * 紙の地合いを乗せる対象ではない。除外して困る物は無い。
       */
      if (m instanceof THREE.ShaderMaterial) continue;
      const lit = (m as THREE.Material & { isMeshLambertMaterial?: boolean;
        isMeshPhongMaterial?: boolean; isMeshStandardMaterial?: boolean; isMeshToonMaterial?: boolean });
      if (!(lit.isMeshLambertMaterial || lit.isMeshPhongMaterial
        || lit.isMeshStandardMaterial || lit.isMeshToonMaterial)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      applyGrain(m, grain, opts);
    }
  });
}
