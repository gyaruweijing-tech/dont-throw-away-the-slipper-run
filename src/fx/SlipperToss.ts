import * as THREE from 'three';
import { CFG } from '../config';
import { charAtlas } from '../tex/atlas';
import { SLOT } from '../entities/cutoutLayout';

/* =====================================================================
 * ★**ゲームオーバーの演出**（2026-09-14・本人指定）
 *
 * 本人の言葉:
 * 「**スーパーマリオとかって、そのままの画面で、マリオがこっちを向いて、
 *   うわあ～っていう音とか、ゲームオーバーの音が鳴って下に落ちていくじゃん？
 *   あんな感じにしたい。スリッパだけがこう、ゴミ箱に向かっていく、
 *   その他背景はあまり変わらないみたいな**」
 * 「**ちゃんとペーパーマリオっぽく。ここてきとうにやると、つまんなくなるからこだわっていこう**」
 *
 * ★**だからカメラは1ミリも動かさない。** 背景も止めない。**動くのはスリッパとゴミ箱だけ。**
 * カメラを動かすと「映画」になってしまい、マリオの「画面はそのまま」が消える。
 *
 * ★**ゴミ箱をどう出すか**（本人「そうするとゴミ箱はどうやって出現させるかっていう問題が起きる」）。
 * ―― **地面からパタンと起き上がらせる。** 飛び出す絵本の作法で、
 * これはペーパーマリオそのものの語彙なので、**突然現れても嘘にならない**。
 * ★**しかも「紙の世界」だと明示できる**ので、この演出だけ得をする。
 *
 * ★**落ちる瞬間は見せない**（本人と決めた C 案）。**口の真上で切る。**
 * 落ち切ると「捨てられた」で話が終わるが、切ると「**まだ間に合ったのに**」が残る。
 * タイトル `DON'T THROW AWAY THE SLIPPER` はそのあとに出す。
 *
 * ★**誰も捨てない。** スリッパは**自分で**飛んでいく。
 * 捨てる人を画面に出すと、それが誰なのかという話になる。出さなければ、その話は起きない。
 * ===================================================================== */

/*
 * ゴミ箱の立つ場所。道の端（`halfW` 4.3）のすぐ外。
 * ★**2026-09-14 の実機で 5.15 → 4.55 に寄せた。** 5.15 だと画面のいちばん端で、
 * 「そこにある」と気づく前に演出が終わる。**端の外だが画面の中**が要る。
 */
const BIN_X = 4.55;
/** ★主人公より前。実機で -3.2 は遠くて小さかったので -2.2 に寄せた */
const BIN_DZ = -2.2;

/** ゴミ箱が起き上がり終わる時刻（秒） */
const POP_END = 0.5;
/** スリッパが手から離れる時刻。★立ち上がりの途中から飛ぶ ＝ 間が空かない */
const FLY_FROM = 0.34;
/** 口の真上に着く時刻 ＝ ★**ここで切る** */
const FLY_TO = 1.5;
/** 暗転にかける時間 */
const FADE = 0.36;

/** 行き過ぎて戻るイージング。★**紙が起き上がる「バネ」はこれが全部** */
function backOut(t: number): number {
  const c = 1.70158 * 1.35;
  const u = t - 1;
  return 1 + u * u * ((c + 1) * u + c);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 台形の板（下が狭く上が広い ＝ オフィスのくずかご） */
function trapezoid(halfBottom: number, halfTop: number, h: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-halfBottom, 0);
  s.lineTo(halfBottom, 0);
  s.lineTo(halfTop, h);
  s.lineTo(-halfTop, h);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** 楕円の板。口の縁と中の暗がりに使う */
function ellipse(rx: number, ry: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  return new THREE.ShapeGeometry(s);
}

function flat(geo: THREE.BufferGeometry, color: number, z: number, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    }),
  );
  m.position.z = z;
  return m;
}

export class SlipperToss {
  readonly group = new THREE.Group();
  private readonly bin = new THREE.Group();
  private readonly binShadow: THREE.Mesh;
  private readonly slipper: THREE.Mesh;
  private readonly veil: HTMLElement;
  private readonly title: HTMLElement;

  private t = 0;
  private running = false;
  /** ★true = 戻す向きの再生（`rewind`）。飛ばす側と同じ板を逆に動かすだけ */
  private back = false;
  private readonly from = new THREE.Vector3();
  private readonly binPos = new THREE.Vector3();
  private after: (() => void) | null = null;

  constructor(host: HTMLElement) {
    const P = CFG.palette;

    /* ── ゴミ箱 ──
     * ★**板を重ねるだけ。** ボス（`BossFigure`）と同じ作法なので、**新しい絵は1枚も要らない**。
     * 重なりの順は z で決める（奥 → 手前）。 */
    // 輪郭（ひと回り大きい濃い板を後ろに敷く。★これが無いと「切り抜き」に見えない）
    /*
     * ★**2026-09-14 の実機で、ひと回り大きくした**（高さ 1.15 → 1.58）。
     * 主人公（全高 1.75 × `heroScale` 1.3）の**胸くらいの高さ**が、
     * 「オフィスのくずかご」として自然でいて、画面の中で埋もれない。
     * ★**輪郭も 0.05 → 0.085 に太くした** ―― ペーパーマリオらしさは
     * **太い輪郭と、そのフラットさ**から出る。細いと 3D の物体に見えてしまう。
     */
    this.bin.add(flat(trapezoid(0.645, 0.82, 1.665), P.ink, -0.02));
    // 胴
    this.bin.add(flat(trapezoid(0.56, 0.73, 1.58), P.inkSoft, 0));
    // ★**紙の厚み。** 右の縁だけ濃くする。フラットな板が「立っている」ように見える
    const edge = flat(trapezoid(0.06, 0.075, 1.58), P.ink, 0.005, 0.35);
    edge.position.x = 0.662;
    this.bin.add(edge);
    // くずかごの縦のスリット3本
    for (const x of [-0.32, 0, 0.32]) {
      const slit = flat(trapezoid(0.042, 0.055, 1.34), P.wall, 0.01);
      slit.position.set(x, 0.11, 0.01);
      this.bin.add(slit);
    }
    // 口（外の縁 → 中の暗がり）。★**楕円でないと「上から見た口」に見えない**
    const rim = flat(ellipse(0.77, 0.21), P.ink, 0.02);
    rim.position.y = 1.58;
    this.bin.add(rim);
    const hole = flat(ellipse(0.67, 0.145), 0x35312c, 0.03);
    hole.position.y = 1.58;
    this.bin.add(hole);

    // 地面に落ちる影。★起き上がるほど濃くなる（立ち上がりの実感は半分がこれ）
    this.binShadow = flat(ellipse(0.76, 0.3), 0x000000, 0, 0);
    this.binShadow.rotation.x = -Math.PI / 2;
    this.binShadow.position.y = 0.012;

    /* ── スリッパ ──
     * ★アトラスの `heroSlipper`（主人公が掲げている赤いスリッパ）を**そのまま**使う。
     * 絵の追加は要らない ―― 9/13 に専用の絵へ差し替えたものが、ここで効く。 */
    const geo = new THREE.PlaneGeometry(0.44, 0.96);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const r = SLOT.heroSlipper;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, r.u + uv.getX(i) * r.w, r.v + uv.getY(i) * r.h);
    }
    uv.needsUpdate = true;
    this.slipper = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: charAtlas(),
        transparent: true,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    this.slipper.frustumCulled = false;

    this.group.add(this.bin, this.binShadow, this.slipper);
    this.group.visible = false;

    /* ── 暗転とタイトル（DOM） ──
     * ★3D で暗くすると背景まで作り直しになる。**幕は HTML で被せるのがいちばん安い。** */
    const style = document.createElement('style');
    style.textContent = [
      '.st-veil { position:fixed; inset:0; background:#14120f; opacity:0; pointer-events:none; z-index:60; }',
      '.st-title { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;',
      '  z-index:61; opacity:0; pointer-events:none; padding:24px; text-align:center; }',
      '.st-title b { color:#efe9dc; font-weight:900; letter-spacing:.06em; line-height:1.35;',
      '  font-size:clamp(19px, 5.2vw, 40px); text-transform:uppercase; }',
      '.st-title i { display:block; font-style:normal; color:#c8352b; font-size:.62em;',
      '  margin-top:.7em; letter-spacing:.24em; }',
    ].join('\n');
    this.veil = document.createElement('div');
    this.veil.className = 'st-veil';
    this.title = document.createElement('div');
    this.title.className = 'st-title';
    this.title.innerHTML = '<b>Don&rsquo;t throw away<br>the slipper<i>あっ</i></b>';
    host.appendChild(style);
    host.appendChild(this.veil);
    host.appendChild(this.title);
  }

  get active(): boolean {
    return this.running;
  }

  /**
   * ★**買ったスリッパの色を、飛んでいくものにも反映する**（2026-09-14）。
   * ★**本体と同じ計算にはできない** ―― 本体は明るさを残して色を掛けるシェーダーだが、
   * こちらは板1枚の `MeshBasicMaterial` なので、**乗算の色**で近づける。
   * 買った色で走っていたのに、**最後に飛んでいくのが赤**では台無しになる
   */
  setTexture(tex: THREE.Texture): void {
    const m = this.slipper.material as THREE.MeshBasicMaterial;
    // ★2026-09-16: 色を掛けるのをやめ、**履いているスリッパの絵そのもの**を貼る（スリッパ60種）
    if (m.map !== tex) {
      const uv = this.slipper.geometry.attributes.uv as THREE.BufferAttribute;
      const base = [0, 1, 1, 1, 0, 0, 1, 0];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, base[i * 2], base[i * 2 + 1]);
      uv.needsUpdate = true;
      m.map = tex;
      m.needsUpdate = true;
    }
  }

  /**
   * 負けた瞬間に呼ぶ。`after` は**幕が下りきってから**呼ばれる（＝ リザルトを出す）。
   * @param x 主人公の横位置
   * @param z 主人公の奥行き
   */
  start(x: number, z: number, after: () => void): void {
    if (this.running) return;
    this.running = true;
    this.t = 0;
    this.after = after;

    // 掲げている手の位置から離す（`cutoutLayout` の heroSlipper: x -0.28 / y SHOULDER+1.00）
    this.from.set(x - 0.28 * CFG.heroScale, (0.88 + 1.0) * CFG.heroScale, z);
    this.binPos.set(BIN_X, 0, z + BIN_DZ);

    this.bin.position.copy(this.binPos);
    this.binShadow.position.set(this.binPos.x, 0.012, this.binPos.z);
    // ★**寝た状態から始める**（手前へ倒れている ＝ これから起き上がる）
    this.bin.rotation.x = -Math.PI / 2;
    this.slipper.position.copy(this.from);
    this.slipper.rotation.set(0, 0, 0);
    this.slipper.scale.set(1, 1, 1);
    this.group.visible = true;
    this.veil.style.transition = 'none';
    this.veil.style.opacity = '0';
    this.title.style.opacity = '0';
  }

  update(dt: number): void {
    if (!this.running) return;
    this.t += dt;
    const t = this.t;

    // ★戻す向き。**0.55秒でゴミ箱の口から手へ**。着いたら何も残さない
    if (this.back) {
      const BACK = 0.55;
      const u = clamp01(t / BACK);
      const s = this.slipper;
      s.position.x = lerp(this.binPos.x, this.from.x, u);
      s.position.z = lerp(this.binPos.z, this.from.z, u);
      s.position.y = lerp(1.4, this.from.y, u) + Math.sin(u * Math.PI) * 0.8;
      const spin = (1 - u) * Math.PI * 2.4;
      s.rotation.z = spin;
      s.scale.x = 0.3 + 0.7 * Math.abs(Math.cos(spin));
      if (u >= 1) this.reset();
      return;
    }

    // ① ゴミ箱が起き上がる（行き過ぎて、少し戻る）
    const pop = clamp01(t / POP_END);
    const k = pop >= 1 ? 1 : backOut(pop);
    this.bin.rotation.x = -(Math.PI / 2) * (1 - k);
    (this.binShadow.material as THREE.MeshBasicMaterial).opacity = 0.22 * clamp01(pop * 1.4);

    // ② スリッパが飛ぶ
    if (t >= FLY_FROM) {
      const u = clamp01((t - FLY_FROM) / (FLY_TO - FLY_FROM));
      const s = this.slipper;
      s.position.x = lerp(this.from.x, this.binPos.x, u);
      s.position.z = lerp(this.from.z, this.binPos.z, u);
      // 山なりに。★**放物線でないと「放り出された」に見えない**
      /*
       * ★**2026-09-14: 山を 1.35 → 0.95 に下げた。** 実機で看板より高く上がってしまい、
       * **画面の上へ外れて「どこへ行ったか分からない」**になっていた。
       * 終点は口の高さ（1.58）の少し上。
       */
      s.position.y = lerp(this.from.y, 1.78, u) + Math.sin(u * Math.PI) * 0.95;
      const spin = u * Math.PI * 3.2;
      s.rotation.z = spin;
      /*
       * ★**紙がヒラヒラ裏返る。** 横だけ縮める ＝ 板が回って見える。
       * ペーパーマリオらしさは**厚みの無さを隠さないこと**から出るので、
       * 3D で回さず、**わざと横幅だけ潰す**のが正しい。
       */
      s.scale.x = 0.3 + 0.7 * Math.abs(Math.cos(spin));
      // 遠ざかるぶんだけ小さく（奥行きの手掛かり）
      s.scale.y = 1 - 0.22 * u;
    }

    // ③ 口の真上で切る → 暗転 → タイトル
    if (t >= FLY_TO) {
      const f = clamp01((t - FLY_TO) / FADE);
      this.veil.style.opacity = String(f);
      this.title.style.opacity = String(clamp01((t - FLY_TO - FADE * 0.6) / 0.3));
      // ★**3D は幕の裏で消す。** 切り替わりが見えない
      if (t >= FLY_TO + FADE) this.group.visible = false;
    }

    // ④ タイトルを読ませてから、リザルトへ
    if (t >= FLY_TO + FADE + 1.25) {
      this.running = false;
      const after = this.after;
      this.after = null;
      /*
       * ★★**2026-09-15: 幕を抜かなくなった**（本人「**背景が黒い GameOver 画面そのままで、
       * リザルト画面を出してほしい**」）。
       * ★**タイトルだけ引いて、幕は敷いたままリザルトを重ねる。**
       * ★**ゴミ箱は出さない** ―― 3D は幕の裏で `visible = false` にしてあるので、もともと見えない。
       * 出しっぱなしにすると「**捨てた状態**」が確定して画面に残り、9/14 に本人と決めた
       * 「**誰も捨てない／落ちる瞬間は見せない**」と食い違う（本人の言う「名誉毀損との兼ね合い」はここ）。
       * ★**幕を消すのは `rewind()`**（もう一度を押した瞬間）。
       */
      this.title.style.opacity = '0';
      this.veiled = true;
      after?.();
    }
  }

  /** ★幕が敷かれたままか（`Game.enter` が「戻す演出をするか」を決めるのに使う） */
  veiled = false;

  /**
   * ★★**スリッパが戻ってくる**（2026-09-15・本人と決めた形）。
   *
   * 幕が敷かれた状態（＝負けてリザルトを見た直後）で「もう一度」を押したときだけ走る。
   * **ゴミ箱の口から、主人公の手へ、スリッパが飛んで戻る。** 同時に幕が抜ける。
   *
   * ★**なぜ入れたか**: 作品名が `DON'T THROW AWAY THE SLIPPER` なので、
   * **捨てられかけた → 拾い直す**が毎回まわるほうが、タイトルの回収として強い。
   * ★**新しい絵は1枚も要らない**（飛ばすのと同じ板を、逆向きに動かすだけ）。
   */
  rewind(x: number, z: number): void {
    if (!this.veiled) { this.reset(); return; }
    this.veiled = false;
    this.running = true;
    this.back = true;
    this.t = 0;
    this.after = null;
    this.from.set(x - 0.28 * CFG.heroScale, (0.88 + 1.0) * CFG.heroScale, z);
    this.binPos.set(BIN_X, 0, z + BIN_DZ);
    // ★ゴミ箱は出さない。戻ってくるスリッパだけ見せる
    this.bin.visible = false;
    this.binShadow.visible = false;
    this.slipper.visible = true;
    this.slipper.position.set(this.binPos.x, 1.4, this.binPos.z);
    this.slipper.rotation.set(0, 0, 0);
    this.slipper.scale.set(1, 1, 1);
    this.group.visible = true;
    this.title.style.opacity = '0';
    this.veil.style.transition = 'opacity .45s ease';
    this.veil.style.opacity = '0';
  }

  /** リトライやレベル切り替えで、演出の途中でも必ず消す */
  reset(): void {
    this.running = false;
    this.after = null;
    this.back = false;
    this.veiled = false;
    // ★戻す演出で隠したゴミ箱を戻す（次の敗北で出ないと、飛んでいく先が無くなる）
    this.bin.visible = true;
    this.binShadow.visible = true;
    this.group.visible = false;
    this.veil.style.transition = 'none';
    this.veil.style.opacity = '0';
    this.title.style.opacity = '0';
  }
}
