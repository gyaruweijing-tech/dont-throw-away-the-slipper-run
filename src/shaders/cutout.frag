// 紙の切り抜きキャラの色。
//
// **陰影を計算しない。** 板ポリの法線は全部同じ方向を向くので、
// 法線から作る陰影は一定値にしかならず意味がない。
// 紙の切り抜きの陰影は**絵に描いてある**ものであって、光源から作るものではない。
//
// ここでやるのは3つだけ:
//   1. アトラスから色を取る（アルファテストで切り抜く）
//   2. 個体差（`aTint`）でわずかに明暗を散らす。**大群が一枚岩に見えるのを防ぐ**
//   3. 離脱した味方をグレーに寄せる（§4-G: 味方は死なない）
// そのうえで、**世界と同じ紙の地合い**を乗算して質感を揃える。

uniform sampler2D uAtlas;
uniform sampler2D uGrain;
uniform float uHasGrain;
uniform float uGrainScale;
uniform vec3  uGrey;
/**
 * 色味のつまみ。**同じ絵を別の役職として出すため**（2026-08-23）。
 * アトラスは4×4で満杯なので、障害物用の絵を増やせない。
 * 明るさを保ったまま色相だけ置き換えるので、濃紺の職員をそのまま赤い警備にできる。
 * 単純な掛け算だと濃紺×赤＝濁った暗色になるので、**一度グレーに落としてから色を乗せる**。
 */
uniform vec3  uTintCol;
uniform float uTintAmt;
/** 切り抜きの閾値。**材質側の alphaTest は自前シェーダには効かない**ので、ここで持つ */
uniform float uAlphaCut;

varying vec2  vUv;
varying float vFade;
varying float vTint;
varying float vRecolor;
uniform vec3  uReCol;    // ★塗り替える色（2026-09-14）
uniform float uReAmt;
/*
 * ★★**スリッパの絵を差し替える**（2026-09-16・スリッパ60種）。
 * アトラスは満杯なので、`aRecolor` の板（掲げたスリッパ）だけ**別の絵**から取る。
 * `uSlipRect` はその板がアトラスで指していた矩形（u, v, w, h）。板の中の位置 0..1 に直してから引く
 */
uniform sampler2D uSlip;
uniform float uHasSlip;
uniform vec4  uSlipRect;
varying vec3  vWorld;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (uHasSlip > 0.5 && vRecolor > 0.5) {
    tex = texture2D(uSlip, (vUv - uSlipRect.xy) / uSlipRect.zw);
  }
  // three の alphaTest は #include で入るが、自前シェーダなのでここで捨てる
  // ★ 自前シェーダなので three の alphaTest は入ってこない。**ここが唯一の閾値。**
  // 材質側に alphaTest を書いても効かない（0.45 に下げたつもりで効いていなかった）
  if (tex.a < uAlphaCut) discard;

  vec3 col = tex.rgb * mix(0.86, 1.0, vTint);
  col = mix(col, uGrey, vFade);

  // 役職の色。明るさを保ったまま色相だけ差し替える
  /*
   * ★**スリッパだけ塗り替える**（2026-09-14・コインの使い道）。
   * ★**明るさ（`lum`）は元の絵から取る。** 単色で塗り潰すと、
   * 9/13 に描いた**陰影と縁が全部消えて、ただの赤い長方形**になる
   */
  if (uReAmt > 0.001 && vRecolor > 0.5) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * uReCol, uReAmt);
  }
  if (uTintAmt > 0.001) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * uTintCol, uTintAmt);
  }

  // 世界と同じ地合い。**キャラだけ地合いが無いと、そこだけ浮いて見える**
  if (uHasGrain > 0.5) {
    float g = texture2D(uGrain, vWorld.xy * uGrainScale).r;
    col *= mix(1.0, g, 0.85);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
