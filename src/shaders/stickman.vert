// 棒人間の走りアニメ（PROGRESS 訂正2）
//
// InstancedMesh はスキニング（ボーン）に非対応。InstancedSkinnedMesh は20体で
// 60fps が崩れる。だから **ボーンを一切使わず、頂点シェーダで手続き的に振る**。
// これは Day 1 のアーキテクチャ決定で、後から変えると全書き直しになる。
//
// 各頂点は自分が「どのパーツか(aPart)」と「どの関節を軸に回るか(aPivot)」を持つ。
//   0 = 胴 / 1 = 頭 / 2 = 左腕 / 3 = 右腕 / 4 = 左脚 / 5 = 右脚 / 6 = スリッパ(右手に追従)
//
// aPhase / aFade は主人公（単体 Mesh）では per-vertex、群衆では per-instance。
// GLSL からは同じ attribute に見えるので、シェーダは1本で両方を賄える。

attribute float aPart;
attribute vec3  aPivot;
attribute vec3  aColor;
attribute float aPhase;   // 走りの位相。インスタンスごとにばらすと全員バラバラに走る
attribute float aFade;    // 0 = 味方 / 1 = 説得されて離脱（グレー）
attribute float aTint;    // 個体差。明るいパーツ（頭）にだけ実質効いて、群れが塊に見えなくなる

uniform float uTime;
uniform float uCadence;
uniform float uSwing;
uniform float uBob;
uniform vec3  uGrey;
uniform float uRaise;   // 0..1。1 で走りが止まり、右腕とスリッパが真上を向く（§4-E）

varying vec3 vColor;
varying vec3 vNormal;

// GLSL の mat3 は列優先。X軸まわりの回転。
mat3 rotX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0,
              0.0,   c,   s,
              0.0,  -s,   c);
}

void main() {
  // 掲げている間は走りを止める。sw を殺すと弾み(bob)も一緒に止まる
  float sw = sin(uTime * uCadence + aPhase) * (1.0 - uRaise);

  vec3 pos = position;
  vec3 nrm = normal;

  if (aPart > 1.5) {
    // 同じ側の腕と脚は逆位相にする（そうしないと人間の走りに見えない）
    float sgn;
    if      (aPart < 2.5) sgn =  1.0;  // 左腕
    else if (aPart < 3.5) sgn = -1.0;  // 右腕
    else if (aPart < 4.5) sgn = -1.0;  // 左脚
    else if (aPart < 5.5) sgn =  1.0;  // 右脚
    else                  sgn = -1.0;  // スリッパ（右腕と一緒に動く）

    bool isLeg = (aPart > 3.5 && aPart < 5.5);
    float amp  = isLeg ? uSwing : uSwing * 0.8;

    mat3 R = rotX(sgn * sw * amp);
    pos = aPivot + R * (position - aPivot);
    nrm = R * normal;
  }

  // 上下の弾み。これが無いと滑って見える
  pos.y += abs(sw) * uBob;

  // §4-G: 味方は死なない。グレーになって離れていく
  vColor = mix(aColor * aTint, uGrey, aFade);

  vec4 mv = vec4(pos, 1.0);
  #ifdef USE_INSTANCING
    mv  = instanceMatrix * mv;
    nrm = mat3(instanceMatrix) * nrm;   // 均一スケールなので normalize で足りる
  #endif

  vNormal = normalize(normalMatrix * nrm);
  gl_Position = projectionMatrix * modelViewMatrix * mv;
}
