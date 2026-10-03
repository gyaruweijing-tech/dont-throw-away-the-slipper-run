// 紙の切り抜きキャラ（PLAN.md 第1節）。
//
// 板を関節で折るだけ。**ボーンは使わない。**
// 箱の棒人間で使っていた振り方をそのまま流用できる —— というより、
// この振り方は最初から「紙のヒンジ」そのものだった。
//
// パーツID: 0=胴 / 1=頭 / 2=左腕 / 3=右腕 / 4=左脚 / 5=右脚 / 6=掲げる物
// 0 と 1 は振らない（掲げた腕と敵の腕組みもここに入れてある）。

attribute float aPart;
attribute float aRecolor;   // ★1 で「塗り替えてよい板」（2026-09-14）
attribute vec3  aPivot;
attribute float aPhase;   // 走りの位相。インスタンスごとにばらすと全員バラバラに走る
attribute float aFade;    // 0 = 味方 / 1 = 説得されて離脱（グレー）
attribute float aTint;    // 個体差

uniform float uTime;
uniform float uCadence;
uniform float uSwing;
uniform float uBob;
uniform float uRaise;   // 1 で走りが止まる（§4-E の「掲げる」）
/*
 * ★**1 で「殴っている」**（2026-09-14・本人「**闘っているしぐさがまったくなく、戦っている感じがない**」）。
 * ★**絵は1枚も足していない。** 腕は独立した板で、ここが関節を回しているので、
 * **回し方を変えるだけで殴れる**（アトラスは 4×4 で満杯なので、足せないという事情もある）
 */
uniform float uPunch;
/* ★**1 で「みんなで万歳」**（2026-09-16・本人「キャラがみんなで万歳している感じ」）。腕を頭の上へ上げて小さく跳ねる */
uniform float uCheer;

varying vec2  vUv;
varying float vFade;
varying float vTint;
varying float vRecolor;
varying vec3  vWorld;

mat3 rotZ(float a) {
  float s = sin(a), c = cos(a);
  return mat3(  c,   s, 0.0,
               -s,   c, 0.0,
              0.0, 0.0, 1.0);
}

mat3 rotX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0,
              0.0,   c,   s,
              0.0,  -s,   c);
}

void main() {
  float sw = sin(uTime * uCadence + aPhase) * (1.0 - uRaise);

  vec3 pos = position;

  // **接地影は特別扱い。** 振らないし弾まない。
  // 影が体と一緒に上下すると、地面から浮いて「足元の丸」ではなくなる
  if (aPart > 6.5) {
    vUv = uv;
    vFade = aFade;
    vTint = aTint;
    vRecolor = aRecolor;
    vec4 sv = vec4(pos, 1.0);
    #ifdef USE_INSTANCING
      sv = instanceMatrix * sv;
    #endif
    vWorld = (modelMatrix * sv).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * sv;
    return;
  }

  if (aPart > 1.5) {
    // 同じ側の腕と脚は逆位相にする（そうしないと人間の走りに見えない）
    float sgn;
    if      (aPart < 2.5) sgn =  1.0;  // 左腕
    else if (aPart < 3.5) sgn = -1.0;  // 右腕
    else if (aPart < 4.5) sgn = -1.0;  // 左脚
    else if (aPart < 5.5) sgn =  1.0;  // 右脚
    else                  sgn = -1.0;

    bool isLeg = (aPart > 3.5 && aPart < 5.5);
    float amp  = isLeg ? uSwing : uSwing * 0.8;

    // **ピボットのZは板のZに合わせない。** 板ごとにZがずれているので、
    // ピボットのZを0固定にすると回転面がずれて、関節が前後に泳ぐ
    vec3 piv = vec3(aPivot.x, aPivot.y, position.z);
    float ang = sgn * sw * amp;

    /*
     * ★**殴る**（2026-09-14）。走りの振りと**混ぜる**（`mix`）ので、
     * 殴り合いに入る瞬間・出る瞬間がつながる（切り替えるとカクつく）。
     *
     * ★**腕**: 速く・深く・**前へ突き出す**。左右で半周期ずらして**交互**に出す。
     *   `max(p, 0.0)` で**出すときだけ深く、戻りは浅く** ―― これが無いと
     *   ただの往復運動になって「打っている」に見えない。
     * ★**脚**: 振りを浅くする。**止まって殴り合っている**ので、走りの脚のままだと滑って見える
     */
    if (uPunch > 0.0) {
      if (aPart < 3.5) {
        float ph = (aPart < 2.5) ? 0.0 : 3.14159;
        float p = sin(uTime * 13.0 + aPhase * 0.7 + ph);
        ang = mix(ang, max(p, 0.0) * 1.55 - 0.18, uPunch);
      } else {
        ang = mix(ang, ang * 0.35, uPunch);
      }
    }
    // ★万歳。腕は頭の上で揺らし、脚は止める（2026-09-16）
    if (uCheer > 0.0) {
      if (aPart < 3.5) {
        ang = mix(ang, 2.75 + 0.28 * sin(uTime * 9.0 + aPhase * 3.0), uCheer);
      } else {
        ang = mix(ang, 0.0, uCheer);
      }
    }
    pos = piv + rotX(ang) * (position - piv);
    // ★万歳は**V字に開く**。真上に上げるだけだと、上から見たとき大きな鶏の頭に隠れて読めない（実機の絵で確認）
    if (uCheer > 0.0 && aPart < 3.5) {
      float side = (aPart < 2.5) ? 1.0 : -1.0;
      pos = piv + rotZ(side * 0.65 * uCheer) * (pos - piv);
    }
  }

  // 上下の弾み。これが無いと滑って見える。★殴っているあいだは抑える（走っていないので）
  pos.y += abs(sw) * uBob * (1.0 - uPunch * 0.7);
  // ★万歳しながら跳ねる。位相をばらして、全員が同時に跳ばないようにする
  pos.y += max(0.0, sin(uTime * 9.0 + aPhase * 3.0)) * 0.2 * uCheer;

  vUv = uv;
  vFade = aFade;
  vTint = aTint;
  vRecolor = aRecolor;

  vec4 mv = vec4(pos, 1.0);
  #ifdef USE_INSTANCING
    mv = instanceMatrix * mv;
  #endif
  vWorld = (modelMatrix * mv).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * mv;
}
