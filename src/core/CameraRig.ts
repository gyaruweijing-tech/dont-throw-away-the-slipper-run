import * as THREE from 'three';
import { CFG } from '../config';

/**
 * カメラ（§4-A / §6）。
 *
 * 2つの役割がある:
 *  1. 群衆が増えるほど後退する ＝「大きくなった」実感の8割はこれ。
 *     ★**2026-09-11 夜、本人の判断で既定では切ってある**（`CFG.camera.crowdFraming: 0`）。
 *     人数で画が動くこと自体が違和感だという指摘。`1` に戻せばこの項は生き返る
 *  2. アスペクト連動 ＝ 縦長画面でもコース幅が必ず画面に収まる。
 *     Poki は 16:9 レスポンシブ必須。後付けは地獄なので Phase 0 から入れる。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private aspect = 16 / 9;
  private curX = 0;
  /** 画面の微振動（§4-D 社員。近いほど強い）。毎フレーム上書きされる連続値 */
  shake = 0;
  private shakeT = 0;
  /** ゲート通過などの一発シェイク（§4-C）。連続値の `shake` とは別に減衰させ、上書きされないようにする */
  private gateShake = 0;
  /**
   * 0 = 走行 / 1 = 聞き取りの場（§4-E: カメラが群衆の後ろへ回り込み、壇を正面に据える）。
   * 切り替えではなく**必ず補間する**。ここで画が飛ぶと「到達した」という実感が消える
   */
  private finish = 0;
  private finishZ = 0;
  /** ★ボスを画面に収める度合い（0..1）と、そのボスの身長（2026-09-16） */
  private bossK = 0;
  private bossOn = false;
  private bossH = 0;
  private readonly look = new THREE.Vector3();

  constructor() {
    const c = CFG.camera;
    this.camera = new THREE.PerspectiveCamera(c.fovDeg, this.aspect, c.near, c.far);
  }

  resize(w: number, h: number): void {
    this.aspect = w / Math.max(1, h);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param focusX  群衆の中心X
   * @param radiusX 群衆の見た目の横半径（画角の収まりに効く）
   * @param radiusZ 群衆の見た目の奥行き半径（後退量に効く）
   */
  /** @param z 壇の足元のワールドZ */
  /**
   * ★★**ボスを画面に収める**（2026-09-16・ボスの絵を3倍にした）。
   * いつものカメラ（高さ約4m・6m後ろ）のままだと、**身長19〜23mのボスは脚しか映らない**（実機の絵で確認）。
   * 橋に乗ったところから、**身長に比例して引いて・上げて・少し見上げる**。走行中のカメラは一切変えない
   */
  setBoss(on: boolean, height: number): void {
    this.bossOn = on;
    if (on) this.bossH = height;
  }

  setFinish(z: number): void {
    this.finishZ = z;
  }

  /** ゲート通過の瞬間などに呼ぶ一発シェイク。連続してもピークだけ残す */
  pulse(amount: number): void {
    this.gateShake = Math.min(CFG.camera.gateShakeMax, Math.max(this.gateShake, amount));
  }

  update(dt: number, focusX: number, radiusX: number, radiusZ = 0, finishOn = false): void {
    this.finish += ((finishOn ? 1 : 0) - this.finish) * Math.min(1, dt * 1.9);
    const c = CFG.camera;
    /*
     * ★★**人数でカメラの画を変えるかどうか**（2026-09-11 夜・本人指定）。
     *
     * `crowdFraming: 0` のとき、ここで**実際の群れの半径ではなく「上限の半径」に差し替える**。
     * 距離・俯角・注視点・画角の4つは全部この2つの値から出ているので、
     * **1か所で差し替えれば4つとも人数から切り離せる**（同じ判断を4か所に書かない）。
     *
     * ★**冒頭の「1. 群衆が増えるほど後退する」は、本人の判断で既定では効かなくなった。**
     * 理由と、戻し方は `config.ts` の `crowdFraming` のコメント
     */
    const maxRX = CFG.courseWidth * CFG.crowd.radiusRatioX;
    const maxRZ = CFG.courseWidth * CFG.crowd.radiusRatioZ;
    const rX = maxRX + (radiusX - maxRX) * c.crowdFraming;
    const rZ = maxRZ + (radiusZ - maxRZ) * c.crowdFraming;

    // 群れの大きさ 0..1。俯角と注視点をこれで補間する
    const tCrowd = Math.min(1, rZ / maxRZ);
    const heightRatio = c.heightRatio + (c.heightRatioBig - c.heightRatio) * tCrowd;
    const lookAhead = c.lookAhead + (c.lookAheadBig - c.lookAhead) * tCrowd;

    // --- アスペクト連動 ---
    // 保証するのは「コース全幅」ではなく **操作できる帯**。壁が多少切れても遊べるが、
    // 全幅を収めようとすると縦画面でカメラが3倍引いて別ゲームになる。
    // 順番も大事: まず画角を広げ、足りない分だけ後退する（後退は上限つき）。
    const need = (CFG.courseWidth * 0.5 - CFG.playableInset) * c.coverMargin + rX * 0.35;

    let dist = c.baseDistance + rZ * c.distancePerRadiusZ + rX * c.distancePerRadiusX;
    let fov: number = c.fovDeg;
    let halfV = Math.tan((fov * Math.PI) / 360);

    if (halfV * dist * this.aspect < need) {
      const wantHalfV = need / (dist * this.aspect);
      fov = Math.min(c.fovMaxDeg, (Math.atan(wantHalfV) * 360) / Math.PI);
      halfV = Math.tan((fov * Math.PI) / 360);
    }
    if (halfV * dist * this.aspect < need) {
      dist = Math.min(dist * c.maxDistanceScale, need / (halfV * this.aspect));
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // --- 横追従を遅らせる（群れのたわみと同じ思想。ここが「走ってる感」に効く） ---
    const k = 1 - Math.exp(-c.lagX * dt);
    this.curX += (focusX - this.curX) * k;

    // 微振動。カメラ位置だけ揺らして注視点は揺らさない（両方揺らすと酔う）
    this.gateShake *= Math.exp(-c.gateShakeDecay * dt);
    const totalShake = this.shake + this.gateShake + c.idleShake;
    this.shakeT += dt * 47;
    const sx = totalShake * 0.06 * Math.sin(this.shakeT);
    const sy = totalShake * 0.045 * Math.sin(this.shakeT * 1.63);

    const runX = this.curX * 0.55 + sx;
    const runY = dist * heightRatio + sy;
    const runZ = dist * c.zRatio;

    // 壇を正面に据える画。横位置は 0 に寄せ、段の中ほどを見る
    const kf = this.finish;
    const fh = CFG.stairs.cost.length * CFG.stairs.rise;
    this.camera.position.set(
      lerp(runX, 0, kf),
      lerp(runY, fh * 0.62 + 3.4, kf),
      lerp(runZ, this.finishZ + 12.5, kf),
    );
    this.look.set(
      lerp(this.curX * 0.75, 0, kf),
      lerp(c.lookHeight, fh * 0.5 + 0.6, kf),
      lerp(-lookAhead, this.finishZ - CFG.stairs.cost.length * CFG.stairs.depth * 0.5, kf),
    );
    // ★ボスの枠。上の位置を上書きせず、そこから混ぜる（凱旋・壇の枠と喧嘩しないように）
    this.bossK += ((this.bossOn ? 1 : 0) - this.bossK) * Math.min(1, dt * 1.4);
    if (this.bossK > 0.001) {
      const H = this.bossH;
      const t = this.bossK * this.bossK * (3 - 2 * this.bossK);
      const p = this.camera.position;
      p.set(lerp(p.x, this.curX * 0.3, t), lerp(p.y, H * c.bossCamY, t), lerp(p.z, Math.max(p.z, H * c.bossCamZ), t));
      this.look.y = lerp(this.look.y, H * c.bossLookY, t);
    }
    this.camera.lookAt(this.look);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
