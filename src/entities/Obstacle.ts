import * as THREE from 'three';
import { CFG, type ObstacleKnobs } from '../config';
import type { HitBox } from '../core/Physics';
import { buildCutoutGeometry, createCutoutMaterial } from './Cutout';
import { rivalParts } from './cutoutLayout';
import { charAtlas } from '../tex/atlas';
import { paperGrain } from '../tex/paper';

/**
 * 障害物と NPC の見た目（PROGRESS §4-D）。Phase 3。
 *
 * 決定事項:
 *  1. **人事部は倒せない**。HP を持たせない。避けるしかない、という体験そのものがギミック
 *     （正論も資料も効かない相手はいる、という再現）
 *  2. **役職・機能として置く**。特定の個人が識別できる造形にしない（§4-D のレッドライン）
 *  3. フキダシは**記号のみ**。文字を出さないので翻訳不要
 *  4. 形は箱の組み合わせだけ。外部アセットゼロ（§6）
 */

/**
 * `window`   窓口。細い隙間＋**通ったあと群衆が細くなる**（§14-B-3）
 * `shredder` 隙間が横へ滑っていく。pinch の一段上（§14-B-4）
 * `gap`      床の穴。**落ちた味方は死なず、足場を失って離脱する**（§4-G を守る）
 * `belt`     動く床。減らさない代わりに**横へ押される**（§14-C-2 を本人判断で採用）
 */
export type ObstacleKind =
  | 'spike' | 'hammer' | 'pinch' | 'hr' | 'window' | 'shredder' | 'gap' | 'belt'
  // 2026-08-26 追加（`GAMEPLAY.md` §14 の採用10個）
  | 'whiteout' | 'stamp'
  // ★2026-09-12 追加。**横へ流す役目は床から扇風機へ移した**（本人指定・`PROGRESS.md` §27）
  | 'fan'
  // 2026-08-28 追加（`IDEAS.md` #40。**唯一「数を払う」障害物**）
  | 'fence';

const P = CFG.palette;

/*
 * ★**障害物は「人」で作る**（本人決定 2026-08-23）。
 *
 * それまでは黒い箱を並べていた。本人の言葉:
 *   > 敵キャラだけ謎の、黒い物体のままだけど、、、、これは直す予定はあるの？
 *
 * しかも**噛み合っていなかった**。人事部は「一団」としては紙の人なのに、
 * 「障害物」としては黒い箱で、同じ相手が場面によって別の姿をしていた。
 *
 * ### 絵を増やさない
 * アトラスは4×4で満杯。**増やすと `ATLAS.md` の座標を全部引き直すことになる。**
 * だから絵は人事部の1組だけを使い回し、**色味のつまみ**で役職を分ける。
 *
 * ### 人数で強さを表す
 * 幅 `wide*2` に人を並べる。**広い障害物ほど人が多い**が自動的に成立し、
 * かつ**見た目の端と当たり判定の端が必ず一致する**（DESIGN.md §11 条件2）。
 * 箱のときは幅を別々に指定していたので、ずれる余地があった。
 */
/*
 * ★**`CREW_PITCH`（1人ぶんの横幅の目安・0.72）は 2026-09-14 に消した。**
 * 「幅をこれで割って人数を決める」ための固定値だったが、**大きさ（`scale`）を掛けていなかった**ので、
 * 9/13 に人事部を 1.5 倍にしたとき**人数だけ据え置きになって重なった**。
 * いまは `lineUp` が **体の幅（`CREW_HALF * scale`）から間隔を出して人数を決める**ので、
 * ★**大きさを変えても二度と破綻しない**。固定のピッチはもう要らない。
 */
/** 並べられる人数の上限。これを超える幅でも増やさない（描画が重くなるだけ） */
const CREW_MAX = 8;
/**
 * 1人の絵の半幅。**組んだ腕がいちばん外に出る**（`cutoutLayout` の arm は w 0.90）。
 * 端をここに合わせないと、見た目と当たり判定がずれる。
 */
/*
 * ★**2026-09-13: 0.45 → 0.59。** 本番の絵にしたとき `cutoutLayout` の人事部が
 * 「組んだ腕 w 0.90（中央に1枚）」から「**左右の腕 w 0.41 を x ±0.38 に置く**」に変わったので、
 * いちばん外は **0.38 + 0.41/2 = 0.585**。
 * ★**絵を変えたらここも直す**（同じ形の数字を2か所に持っている数少ない場所）
 */
const CREW_HALF = 0.59;
/**
 * ★**隣の人とどれだけ肩が重なってよいか**（2026-09-14）。
 * 1.0 ＝ まったく重ならない（間隔が体の幅ちょうど）。0.72 ＝ 28% まで肩が重なる。
 * **完全に離すと列が「壁」に見えて人に見えない**ので、少しは重ねる。
 * ★これを下げるほど**人数が減る**（枠の幅は当たり判定なので動かせない）
 */
const CREW_OVERLAP = 0.72;

let sharedGeo: THREE.BufferGeometry | null = null;
let matHr: THREE.ShaderMaterial | null = null;
let matGuard: THREE.ShaderMaterial | null = null;

function crewGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) sharedGeo = buildCutoutGeometry(rivalParts('hr'));
  return sharedGeo;
}
/**
 * 人事部。**倒せない。** 紫にする。
 *
 * 障害物はどれも「減らすもの」なので朱の仲間だが、
 * 警備と同じ色にすると2種類が同じ相手に見える。
 * **倒せない相手だけは別格**にしたいので、他で使っていない紫を当てる
 * （味方＝水色 / 増える＝藍 / 減る＝朱 / コイン＝金 の、どれとも被らない）。
 */
function crewMatHr(): THREE.ShaderMaterial {
  if (!matHr) {
    matHr = createCutoutMaterial(charAtlas(), {
      cadence: 0, grain: paperGrain(512), tint: [2.05, 0.95, 3.10], tintAmount: 0.96,
    });
  }
  return matHr;
}
/** 警備。**避けるだけ**。同じ絵を赤へ寄せて別の役職に見せる */
function crewMatGuard(): THREE.ShaderMaterial {
  if (!matGuard) {
    matGuard = createCutoutMaterial(charAtlas(), {
      // 緑と青を落として朱に寄せる。[3.3, 1.15, 0.9] だと**サーモンピンク**になった
      cadence: 0, grain: paperGrain(512), tint: [3.05, 0.72, 0.55], tintAmount: 0.96,
    });
  }
  return matGuard;
}

/** フキダシ。記号1つだけを描く（§4-D: 台詞なし） */
/*
 * ★**2026-09-12 に export した。** 社員（`Boss`）も同じフキダシを使うので、
 * 同じ絵を 2 か所に描かない。中身を差し替えられる形にしてあるので、
 * ★**文字ではなく絵（スリッパ）を入れられる** —— 言語不要要件を守るために必須。
 * @param draw 中身を描く。省くと `symbol` を文字として中央に置く
 */
/**
 * ★★**台詞はここに全部まとめる**（2026-09-12）。
 *
 * > **本人:「日本語入れる案あったよね、あれはいれちゃっていい。
 * > 日本語いれたほうがおもろいだろ」**
 *
 * ★**§4-D の「言語不要」を意図的に覚している**（[[feedback-feel-over-spec]]）。
 * その代わり**文字列をこの1か所に集めた**ので、海外に出すときは
 * ここを差し替えるだけで済む。**絵の中に文字を描き込まないこと**。
 */
export const LINES = {
  /** 社員。自分の足元がさみしくて、人のスリッパを欲しがる人（2026-10-03 本人が台詞を差し替え） */
  syain: ['スリッパをよこせ…', '足元寂しい…'],
  /** 人事部。★**ここは文字にしない**（何も言わないのが §4-D の核） */
  hr: ['…'],
} as const;

/**
 * 複数行のフキダシ。★行数に合わせて札の高さと字の大きさを変える
 */
export function bubbleLines(lines: readonly string[]): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const boxH = 30 + lines.length * 34;
  g.fillStyle = '#efe9dc';
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(8, 8, 240, boxH, 16);
  g.fill();
  g.stroke();
  // しっぽ
  g.beginPath();
  g.moveTo(104, boxH + 6);
  g.lineTo(114, boxH + 34);
  g.lineTo(140, boxH + 6);
  g.closePath();
  g.fillStyle = '#efe9dc';
  g.fill();

  g.fillStyle = '#2b2a28';
  g.font = 'bold 30px "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((t, i) => g.fillText(t, 128, 34 + i * 34, 216));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.0, 1.25, 1);
  sprite.renderOrder = 5;
  return sprite;
}

export function bubble(symbol: string, draw?: (g: CanvasRenderingContext2D) => void): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#efe9dc';
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(6, 6, 116, 62, 14);
  g.fill();
  g.stroke();
  // しっぽ
  g.beginPath();
  g.moveTo(52, 64);
  g.lineTo(60, 88);
  g.lineTo(74, 64);
  g.closePath();
  g.fillStyle = '#efe9dc';
  g.fill();
  g.fillStyle = '#2b2a28';
  if (draw) {
    draw(g);
  } else {
    g.font = 'bold 44px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(symbol, 64, 38);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.15, 0.86, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/*
 * ========================================================================
 * ★★**とげと回転ハンマーの専用の絵**（2026-09-12・本人の参考画像）
 *
 * ★**なぜ作ったか。** この日まで、`spike`（とげ）も `hammer`（回転ハンマー）も
 * `place()` の最後の行に落ちて **`lineUp(..., crewMatGuard())` ＝ 赤い警備の人の列**
 * として描かれていた。人事部（`hr`）も同じ人の列なので、
 * ★**番人・とげ・ハンマー・穴・柵の5つが全部同じ絵**だった。
 * 本人が「Lv1〜5 に一回もとげが出てこない」「Lv16 に回転ハンマーが確認できない」
 * と言ったのは当然で、**区画ごとの特色が絵として存在していなかった**。
 *
 * ★**人事部とは完全に別物にする**（本人指定）。人事部は人の列のまま。
 * とげとハンマーは**人を一切使わない物体**にする。
 *
 * ★**当たり判定と絵を必ず一致させる**（`lineUp` のコメントと同じ原則）。
 * とげのシルエットは `x ± wide` に収める。ハンマーの頭の中心は
 * 当たり判定の `x` と**同じ式から出す**（`baseX + sin(θ) * arm`）。
 * ===================================================================== */

/** 共有のジオメトリ。view は最大 8 個なので、ここで1回だけ作る */
let geoCache: {
  dome: THREE.SphereGeometry;
  cone: THREE.ConeGeometry;
  disc: THREE.CylinderGeometry;
  drum: THREE.CylinderGeometry;
  box: THREE.BoxGeometry;
} | null = null;

function geos() {
  if (!geoCache) {
    geoCache = {
      // 半球（上半分だけ）。土から顔を出している赤い体
      dome: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      cone: new THREE.ConeGeometry(1, 1, 6),
      disc: new THREE.CylinderGeometry(1, 1, 1, 8),
      drum: new THREE.CylinderGeometry(1, 1, 1, 10),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
  }
  return geoCache;
}

const flat = (color: number) => new THREE.MeshLambertMaterial({ color });

/**
 * 床に並べる山形の最大数。★**縦横の格子**に並べるので 7 では足りない（2026-09-12）。
 * 横の床は「進む向き 4m × 道に沿って 17m」の細長い帯なので、
 * ★**進む向きにしか並べないと、17m の帯に山形が2つしか乗らない**（実機の絵で確認した）
 */
const ARROW_MAX = 12;

/**
 * ★**動く床の歯車**（2026-09-12・参考画像 `assets/ref/moving-floor.jpg`）。
 *
 * 帯の**進む向きの両端**に段ボールの歯車を4つ置く。役目は飾りではなく**2つめの手がかり**:
 *   ① **回る向き ＝ 押す向き。** 矢印が群れの体に隠れても、回転は目に入る
 *   ② **歯車が付いている辺 ＝ 帯の走る向き。** 横の床・前の床・斜めの床が**形で見分けられる**
 *      （本人が Lv13 で「前に進む床はちゃんと進んだ」と混乱したのは、3種が同じ絵だったから）
 *
 * ★**`InstancedMesh` 1枚にまとめる**（`BossYard.boxes()` と同じ作法・2026-09-06）。
 * 4つを別々の `Mesh` にすると**床1枚につきドローコールが4本増える**
 */
/** ★歯車の半径。**帯の端に置く大きな歯車**（本人「小さすぎる」・2026-09-12 夜に 0.42 → 0.95） */
const GEAR_R = 0.95;
/** 歯車の最大数（進む向きの両端 × 帯に沿った列）。★同じ形なので `InstancedMesh` 1枚に収める */
const GEAR_MAX = 8;
/** 帯の継ぎ目の線の最大本数 */
const SEAM_MAX = 8;
/** 歯車が転がる軸（group の local X）。毎フレーム作らないようにここで1つだけ持つ */
const GEAR_AXIS = new THREE.Vector3(1, 0, 0);
/** 羽根が回る軸（head の local Z ＝ 送る向き） */
const BLADE_AXIS = new THREE.Vector3(0, 0, 1);
/** 風の筋を少しひねる軸 */
const WIND_AXIS = new THREE.Vector3(0, 1, 0);

/** 扇風機のグリル（放射状の棒）の本数。同じ形なので `InstancedMesh` 1枚 */
const SPOKE_N = 10;
/** 羽根の枚数 */
const BLADE_N = 5;
/** 風の筋。1本を3節で作って弧に見せる */
const WIND_N = 6;
const WIND_SEG = 3;
const WIND_MAX = WIND_N * WIND_SEG;

/**
 * ★★**扇風機**（2026-09-12・本人指定。参考画像 `assets/ref/moving-floor.jpg` と同じ紙工作の質感）。
 *
 * > **本人:「扇風機を置けば、直感的に風が横からきて、流されるっていうのが分かりやすい」**
 *
 * ★**道の外（歩道）に立てる。** 当たるものではないので、群れとは絶対に触れない。
 * 首は振らない（本人が却下）。代わりに**風がランダムに ON / OFF する**ので、
 * ★**羽根が回っているかどうかが、そのまま「いま吹いているか」の表示**になる。
 *
 * 部品は 朱の枠 ／ 紙色の羽根 ／ 放射状のグリル ／ 首 ／ 台座。
 * ★**同じ形の繰り返し（グリルの棒・羽根）は `InstancedMesh` 1枚にまとめる**
 * （`BossYard.boxes()` と同じ作法・2026-09-06）
 */
function buildFan(box: THREE.BoxGeometry): {
  rig: THREE.Group; head: THREE.Group; blades: THREE.InstancedMesh; hub: THREE.Mesh;
} {
  const rig = new THREE.Group();
  const stampMat = new THREE.MeshLambertMaterial({ color: P.stamp });

  // 台座（紙を折った八角形に見せる低い箱）と、コードの代わりの小さな突起
  const base = new THREE.Mesh(box, stampMat);
  base.scale.set(2.6, 0.34, 2.0);
  base.position.y = 0.17;
  // 支柱
  const neck = new THREE.Mesh(box, stampMat);
  neck.scale.set(0.55, 1.9, 0.55);
  neck.position.y = 1.25;
  rig.add(base, neck);

  /** 首から上。**風を送る向き（local -Z）を向く** */
  const head = new THREE.Group();
  head.position.y = 2.7;
  // モーターの箱（羽根の後ろ）
  const motor = new THREE.Mesh(box, stampMat);
  motor.scale.set(0.75, 0.75, 0.7);
  motor.position.z = 0.62;
  head.add(motor);
  // グリルの輪（外周）
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.10, 6, 20), stampMat);
  head.add(ring);
  // グリルの棒。放射状に並べる
  const spokes = new THREE.InstancedMesh(box, stampMat, SPOKE_N);
  spokes.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < SPOKE_N; i++) {
    const a = (i / SPOKE_N) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    v.set(Math.cos(a) * 0.94, Math.sin(a) * 0.94, 0);
    sc.set(0.07, 1.80, 0.07);
    m.compose(v, q, sc);
    spokes.setMatrixAt(i, m);
  }
  head.add(spokes);
  // 羽根。紙色。回るのはこれだけ
  const blades = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: P.paperDark }), BLADE_N);
  blades.frustumCulled = false;
  blades.position.z = 0.0;
  head.add(blades);
  // 中心の丸（参考画像の M の位置。**この作品の判子を置く場所**）
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.14, 12), new THREE.MeshLambertMaterial({ color: P.paper }));
  hub.rotation.x = Math.PI / 2;
  hub.position.z = -0.42;
  head.add(hub);

  rig.add(head);
  rig.visible = false;
  return { rig, head, blades, hub };
}

/**
 * ★**風の筋**（2026-09-12・本人の参考画像＝青い渦の線）。
 * 1本を3節でつないで弧に見せる。★**青**にするのは、**この風が1人も減らさない**ことを示すため
 * （朱＝減るもの／金＝減らないもの／青＝増えるもの、の並びに「風」を足す形になる）。
 * 本人指定の色なので、**拾い物の藍より薄い水色**にして通貨と見間違えないようにした
 */
function buildWind(box: THREE.BoxGeometry): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: P.wind }), WIND_MAX);
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

function buildGears(): THREE.InstancedMesh {
  // 8角柱。歯は作らない（丸より「歯車」に見えて、面が光を拾うので回転が読める）
  const g = new THREE.CylinderGeometry(GEAR_R, GEAR_R, 0.42, 8);
  // 既定の軸は Y。**転がる軸（local X）へ寝かせた形を焼き込む**ので、あとは角度だけ入れればよい
  g.rotateZ(Math.PI / 2);
  const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: P.beltGear }), GEAR_MAX);
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

/**
 * ★**動く床の矢印**（2026-09-12・本人「ある程度予測できることが重要だ」）。
 * 平たい三角を床に寝かせただけ。**群れの下でも読めるように朱で塗る**
 */
function buildArrows(): THREE.Group {
  const g = new THREE.Group();
  /*
   * ★**平たい矢羽（シェブロン）にして、色を金にした**（2026-09-12）。
   *
   * > **本人:「矢印がちょっととげっぽくて、これ乗ったらダメージか？？と思った」**
   *
   * ★本作では**朱（`stamp`）＝危険**という文法ができている（判子・とげ・ハンマー）。
   * 動く床は**1人も減らない**ので、朱で描くのは嘘だった。
   * 金（`gold`）は拾い物と同じ色 ＝ **減らないもの**の色。
   */
  const shaft = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < ARROW_MAX; i++) {
    const a = new THREE.Group();
    /*
     * ★**太い山形を2枚入れ子にする**（本人の参考画像＝マリオカートの加速床）。
     * 向こう側（先に踏む側）を濃い金、手前を明るい金にして、
     * ★**色の並びでも進む向きが分かる**ようにする。
     * 世界観に合わせてグラデーションは使わず、**金 2 色の平塗り**（§4-I）
     */
    /*
     * ★**朱の縁取り＋金の中身**（参考画像 `assets/ref/moving-floor.jpg`）。
     * ★**中身のほうが太い**のが肝 —— 0.72 だと朱が勝って「危険な物体」に戻る（実機の絵で確認）。
     * 本作の文法では朱＝減るものだが、**縁だけなら標識に読める**かは実機で本人が見て決める
     */
    const rows: [number, number, number][] = [[P.stamp, 0.0, 1.0], [P.gold, 0.05, 0.84]];
    for (const [col, back, scale] of rows) {
      for (const sgn of [1, -1]) {
        const w = new THREE.Mesh(shaft, flat(col));
        w.scale.set(0.30 * scale, 0.10, 1.5 * scale);
        // ★**原点を山形の真ん中に置く**（2026-09-12）。前は `+0.42` ぶん前に寄っていて、
        // **並べたとき帯の外へはみ出していた**（実機の絵で確認。左端が歩道まで出ていた）
        w.position.set(sgn * 0.42 * scale, 0, back);
        w.rotation.y = sgn * 0.72;
        a.add(w);
      }
    }
    /*
     * ★★**寝かせ直した**（2026-09-12・本人の実プレイで差し戻し）。
     *
     * > **本人:「なんか棒切れみたいなのが流れていて危険そうだな～～って思った」**
     *
     * 同じ日の朝に「カメラが水平に近いから床の標識は見づらい」という理由で **35°起こした**が、
     * ★**起こした瞬間に「床の模様」ではなく「立っている物体」になり、
     * しかもそれが流れるので「飛んでくる危険物」に見えた**（本人の言葉がそのまま証拠）。
     * ★**潰れ対策は「起こす」ではなく「大きく・本数を帯に合わせる」で取る**
     * （`place()` で帯の幅に比例させ、帯の端からはみ出さない本数だけ並べる）。
     * 参考画像 `assets/ref/moving-floor.jpg` も**完全に寝た山形**
     */
    a.rotation.x = 0;
    a.position.y = 0.10;
    g.add(a);
  }
  g.visible = false;
  return g;
}
/** 紙の切り抜きの黒い縁。少し大きくした同じ形を裏向きに重ねるだけ */
const outline = () => new THREE.MeshBasicMaterial({ color: P.ink, side: THREE.BackSide });

/**
 * ★**とげ**。本人の参考画像のとおりに、
 * **茶色い土の盛り上がりに、赤いドームが埋まっていて、生成りのトゲが放射状に生えている**。
 * ★トゲは紙色（`paper`）。畫材は§4-I の紙×インク×判子の朱から出ない
 */
function buildSpike(): THREE.Group {
  const g = geos();
  const rig = new THREE.Group();

  // 土の盛り上がり（八角の平たい円柱）
  const earth = new THREE.Mesh(g.disc, flat(P.goldDark));
  earth.scale.set(1, 0.26, 0.62);
  earth.position.y = 0.13;
  const earthLine = new THREE.Mesh(g.disc, outline());
  earthLine.scale.set(1.1, 0.30, 0.72);
  earthLine.position.y = 0.12;

  // 赤いドーム
  const dome = new THREE.Mesh(g.dome, flat(P.stamp));
  dome.scale.set(0.78, 0.86, 0.7);
  dome.position.y = 0.20;
  const domeLine = new THREE.Mesh(g.dome, outline());
  domeLine.scale.set(0.9, 0.97, 0.82);
  domeLine.position.y = 0.19;

  rig.add(earthLine, earth, domeLine, dome);

  /*
   * トゲ。参考画像に合わせて**5本を放射状**に。
   * 真上が1本・斜め上が左右・横が左右。
   * ★**先端が x ± 1 に収まる**ように並べる（rig 全体を wide 倍するので、ここでは単位円）
   */
  for (const deg of [90, 141, 39, 178, 2]) {
    const a = (deg * Math.PI) / 180;
    // 真上の1本を一番長くする（参考画像もそうなっている）
    const len = deg === 90 ? 0.95 : deg === 141 || deg === 39 ? 0.8 : 0.66;
    const r = 0.5;
    for (const [mat, k] of [[outline(), 1.3], [flat(P.paper), 1.0]] as const) {
      const c = new THREE.Mesh(g.cone, mat);
      c.scale.set(0.3 * k, len * k, 0.3 * k);
      c.position.set(Math.cos(a) * r, 0.2 + Math.sin(a) * (r + len * 0.45), 0);
      c.rotation.z = a - Math.PI / 2;
      rig.add(c);
    }
  }
  return rig;
}

/**
 * ★**回転ハンマー**。本人の参考画像のとおりに、
 * **台座に立った柱から横に腕が伸び、両端に赤×黄の縞模様の頭が付いていて、それが回る**。
 *
 * ★**今までも数式は回転だった**―― `x = baseX + sin(θ) * sweep` は
 * **まさに回る腕の先の横位置**。絵だけが人の列だったので、式はそのまま使える。
 * 回転する部分だけを `pivot` に入れて返す（呼ぶ側が `pivot.rotation.y` に θ を入れる）。
 */
function buildHammer(): { rig: THREE.Group; pivot: THREE.Group; arm: THREE.Mesh; heads: THREE.Group[] } {
  const g = geos();
  const rig = new THREE.Group();

  const plate = new THREE.Mesh(g.disc, flat(P.inkSoft));
  plate.scale.set(0.95, 0.16, 0.95);
  plate.position.y = 0.08;
  const plateLine = new THREE.Mesh(g.disc, outline());
  plateLine.scale.set(1.06, 0.2, 1.06);
  plateLine.position.y = 0.07;

  const post = new THREE.Mesh(g.box, flat(P.goldDark));
  post.scale.set(0.36, 1.5, 0.36);
  post.position.y = 0.75;
  const postLine = new THREE.Mesh(g.box, outline());
  postLine.scale.set(0.48, 1.56, 0.48);
  postLine.position.y = 0.75;

  rig.add(plateLine, plate, postLine, post);

  const pivot = new THREE.Group();
  pivot.position.y = 1.42;
  rig.add(pivot);

  // 腕（横棒）。長さは呼ぶ側が scale.x で入れる
  const armLine = new THREE.Mesh(g.box, outline());
  armLine.scale.set(1, 0.38, 0.38);
  const arm = new THREE.Mesh(g.box, flat(P.goldDark));
  arm.scale.set(1, 0.26, 0.26);
  pivot.add(armLine, arm);

  /*
   * 頭は**赤→黄→赤 の3枚重ね**で縞模様にする（テクスチャを作らない）。
   * 円柱は Y 軸なので、Z に 90° 倒して**軸を腕に沿わせる**
   */
  const heads: THREE.Group[] = [];
  for (let side = 0; side < 2; side++) {
    const head = new THREE.Group();
    // ★**検査が絵の頭を見つけるための名前**（`tools/hit-check.ts`）。
    // 「絵と判定が一致しているか」を機械で確かめるには、絵の側にも掴み手が要る
    head.name = 'hammerHead';
    const line = new THREE.Mesh(g.drum, outline());
    line.rotation.z = Math.PI / 2;
    line.scale.set(1.16, 1.1, 1.16);
    head.add(line);
    const bands: [number, number, number][] = [[P.stamp, -0.33, 0.34], [P.gold, 0, 0.32], [P.stamp, 0.33, 0.34]];
    for (const [col, off, w] of bands) {
      const band = new THREE.Mesh(g.drum, flat(col));
      band.rotation.z = Math.PI / 2;
      band.scale.set(1, w, 1);
      band.position.x = off;
      head.add(band);
    }
    pivot.add(head);
    heads.push(head);
  }
  return { rig, pivot, arm, heads };
}

/**
 * 1体ぶんの見た目。種類ごとに使うパーツを出し分けて使い回す
 * （種類ごとにクラスを分けると、プールが種類の数だけ要る）
 */
export class ObstacleView {
  readonly group = new THREE.Group();
  private readonly barA: THREE.Mesh;
  private readonly barB: THREE.Mesh;
  /** 窓口のカウンター天板／動く床の矢印など、3つめのパーツが要る種類のため */
  private readonly barC: THREE.Mesh;
  private readonly bubble: THREE.Sprite;
  /** ★とげの絵（2026-09-12）。**人を使わない** */
  private readonly spikeRig: THREE.Group;
  /** ★動く床の矢印（2026-09-12） */
  private readonly arrows: THREE.Group;
  /** ★動く床の歯車（2026-09-12）。矢印と同じ向きに回るので、押す向きの2つめの手がかり */
  private readonly gears: THREE.InstancedMesh;
  private readonly gearRig = new THREE.Group();
  /** ★動く床の継ぎ目の線（2026-09-12・本人「道の線がない、之がベルトコンベア風でいい」） */
  private readonly seams: THREE.InstancedMesh;
  /** ★扇風機（2026-09-12） */
  private readonly fan: { rig: THREE.Group; head: THREE.Group; blades: THREE.InstancedMesh; hub: THREE.Mesh };
  /** ★風の筋（2026-09-12） */
  private readonly wind: THREE.InstancedMesh;
  /** ★回転ハンマーの絵（2026-09-12）。`pivot` を回し、`arm` の長さで振り幅を出す */
  private readonly hammer: { rig: THREE.Group; pivot: THREE.Group; arm: THREE.Mesh; heads: THREE.Group[] };
  /** 立ちはだかる人たち。幅に応じて人数が変わるので `InstancedMesh` */
  private readonly crew: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(box: THREE.BoxGeometry) {
    const inkMat = new THREE.MeshLambertMaterial({ color: P.ink });
    const stampMat = new THREE.MeshLambertMaterial({ color: P.stamp });
    this.barA = new THREE.Mesh(box, inkMat);
    this.barB = new THREE.Mesh(box, stampMat);
    this.barC = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: P.wall }));
    this.bubble = bubble('\u2026');
    this.bubble.visible = false;
    this.crew = new THREE.InstancedMesh(crewGeometry(), crewMatHr(), CREW_MAX);
    this.crew.frustumCulled = false;
    this.crew.count = 0;
    this.crew.visible = false;
    this.spikeRig = buildSpike();
    this.spikeRig.visible = false;
    this.arrows = buildArrows();
    this.gears = buildGears();
    this.seams = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: P.inkSoft }), SEAM_MAX);
    this.seams.frustumCulled = false;
    this.seams.visible = false;
    this.gearRig.add(this.gears, this.seams);
    this.fan = buildFan(box);
    this.wind = buildWind(box);
    this.hammer = buildHammer();
    this.hammer.rig.visible = false;
    this.group.add(this.barA, this.barB, this.barC, this.bubble, this.crew, this.spikeRig, this.hammer.rig, this.arrows, this.gearRig, this.fan.rig, this.wind);
    this.group.visible = false;
  }

  /**
   * 幅いっぱいに人を並べる。
   *
   * ★**端は必ず `x ± wide`。** ここがずれると、見た目と当たり判定が食い違う。
   * 人は板なので、端の人の中心を端から半歩内側へ置いて、絵の端が `wide` に合うようにする。
   *
   * @param x     中心X（当たり判定と同じ値）
   * @param wide  半幅（当たり判定と同じ値）
   * @param scale 背の高さの倍率。人事部は少し大きくして「別格」を出す
   */
  private lineUp(x: number, wide: number, scale: number, mat: THREE.ShaderMaterial): void {
    /*
     * ★**端の人の「絵の端」を x±wide にきっちり合わせる。**
     * 等間隔に置いて中心を端から半歩内側にすると、体の半分ぶんはみ出す。
     * 実測で人事部（wide 1.5・背1.18倍）は 0.16 はみ出していた。
     * 見た目より当たり判定が狭いと「当たっていないのに減った」に見える。
     * だから**内側へ体の半幅だけ寄せた範囲**に、n人を等間隔で置く。
     */
    const halfVis = CREW_HALF * scale;
    const span = Math.max(0, wide * 2 - halfVis * 2);
    /*
     * ★★**2026-09-14: 人数は「体の幅」から決める**（本人の実機指摘「人事部が重なりすぎ」）。
     *
     * ★**原因**: 人数は `wide * 2 / CREW_PITCH` で、**`scale` をまったく見ていなかった**。
     * 9/13 に人事部を **1.18 → 1.5 倍**にしたので、**同じ4人が 1.27倍の体で同じ枠に入った**。
     * 実測（wide 1.5・scale 1.5）: 体の幅 `CREW_HALF*2*scale` = **1.77** に対して
     * 置く間隔は `span / (n-1)` = **0.41** ―― ★**4倍以上重なっていた**。
     *
     * ★**直し方**: 先に「**これ以上詰めない間隔**」を体の幅から出し、**入る人数のほうを減らす**。
     * `CREW_PITCH`（固定のピッチ）はもう人数決めには使わない ―― **大きさを変えるたびに破綻するため**。
     * 肩が少し重なるのは**わざと許す**（完全に離すと「壁」に見えて人に見えない。
     * 上の `dz` の散らしと同じ理由）。
     */
    const n = Math.max(2, Math.min(CREW_MAX, Math.floor(span / (halfVis * 2 * CREW_OVERLAP)) + 1));
    const step = n > 1 ? span / (n - 1) : 0;
    this.crew.material = mat;
    this.crew.visible = true;
    this.crew.count = n;
    for (let i = 0; i < n; i++) {
      const px = x - wide + halfVis + step * i;
      // 前後に少しだけ散らす。一列に揃うと「壁」に見えて人に見えない
      // ★2026-09-14: 散らし幅も大きさに比例させる。大きい人ほど前後に逃がさないと団子に見える
      const dz = (((i * 37) % 7) / 7 - 0.5) * 0.34 * scale;
      this.v.set(px, 0, dz);
      this.s.set(scale, scale, scale);
      /*
       * ★★**2026-09-13: `this.q` を必ず戻す**（本人「人事部がなぜか横倒しになっている場面があった」）。
       * `this.q` は**このクラスの使い回しの作業用**で、歯車（`GEAR_AXIS`）と扇風機の羽根（`BLADE_AXIS`）が
       * 回転を入れる。ここが初期化せずに `compose` に渡していたので、
       * **直前に動く床か扇風機を描いた view を人事部が使い回すと、その回転ごと人が傾いた**。
       * ★view の使い回しで起きる事故としては、9/13 の朝に直した「前の絵が残る」と同じ型
       */
      this.q.identity();
      this.m.compose(this.v, this.q, this.s);
      this.crew.setMatrixAt(i, this.m);
    }
    this.crew.instanceMatrix.needsUpdate = true;
    this.barA.visible = false;
    this.barB.visible = false;
  }

  /**
   * @param x    中心X（pinch のときは隙間の中心）
   * @param z    ワールドZ
   * @param wide 半幅（pinch 以外）
   */
  /** 判子の高さ。`ObstacleField` が落下の進み具合から入れる（0 = 着地） */
  stampY = 0;

  /*
   * ★**区画のつまみ。`ObstacleField.reset` が全 view に配る**（2026-08-27 修正）。
   *
   * ここが `CFG.obstacle`（全レベル共通の既定値）を直接読んでいたせいで、
   * **絵と当たり判定が別のつまみを見ていた**。修正テープは絵が常に 12m なのに
   * 判定は Lv15 で 26m ＝ **白い帯を抜けて 7m 走っても操作が効かない**。
   * `gateOps.pickBounds` のコメントが「見えている枠と当たる枠がずれるのは最悪のバグ」
   * と書いているのと同じ型で、こちらは障害物側で起きていた。
   *
   * 既定値を持たせてあるのは生成時（`reset` より前）に一度も描かないため。
   * **`reset` が必ず上書きする**ので、実際に既定値で描かれる道は無い。
   */
  /**
   * ★★**この障害物の当たり判定の箱**（2026-09-19）。**`place()` が絵と同時に詰める。**
   *
   * `collision-basics.md` §9 の「**見た目と判定を1か所で定義する**」をこの形で守っている。
   * 判定を別の場所で書き直すと、**絵を直したときに必ず片方だけ古くなる**
   * （回転ハンマーで実際に起きていた。判定が `sin`・絵が `cos` で 90° ずれていた）。
   * ★**中身はワールド座標**。`group.position.z` を足した値が入る
   */
  readonly hits: HitBox[] = [];

  /**
   * 当たり判定の箱を1つ足す。**高さは既定で全高**（2.5D。理由は `Physics.ts` の冒頭）。
   * @param z 障害物の中心からの奥行きのずれ。`place` が受け取った `z` はここで足す
   */
  private hit(x: number, hx: number, z: number, hz: number, y = CFG.hit.wallTop / 2, hy = CFG.hit.wallTop / 2): void {
    this.hits.push({ x, y, z: this.group.position.z + z, hx, hy, hz });
  }

  private c: ObstacleKnobs = CFG.obstacle;

  /** このレベルのつまみを配る。`ObstacleField.reset` からのみ呼ぶ */
  setKnobs(knobs: ObstacleKnobs): void {
    this.c = knobs;
  }

  /**
   * @param spin  ★回転ハンマーの腕の角度（rad）。`ObstacleField` が当たり判定と**同じ式**から渡す
   * @param baseX ★回転の中心（柱の位置）。`x` はすでに振られた先の位置なので別に要る
   * @param arm   ★腕の長さ（＝`hammerSweep`）
   */
  /** @param axis ★動く床の向き。0 横 ／ 1 前 ／ 2 斜め。**矢印の向きにそのまま使う** */
  place(kind: ObstacleKind, x: number, z: number, wide: number, spin = 0, baseX = 0, arm = 0, blowing = false): void {
    const c = this.c;
    const half = CFG.courseWidth / 2;
    this.group.visible = true;
    this.group.position.set(0, 0, z);
    // ★**判定は毎回まっさらから。** 使い回しの view なので、消し忘れると前の障害物の判定が残る
    this.hits.length = 0;
    this.bubble.visible = false;
    this.barC.visible = false;
    this.crew.visible = false;
    this.crew.count = 0;
    // ★消す処理は必ずここに集める（REVIEW.md の急所⑤）。view は使い回しなので
    // 消し忘れると**前の種類の絵が残ったまま別の障害物になる**
    this.spikeRig.visible = false;
    this.hammer.rig.visible = false;
    this.arrows.visible = false;
    this.gears.visible = false;
    this.seams.visible = false;
    this.fan.rig.visible = false;
    this.wind.visible = false;
    /*
     * ★★**2026-09-13: `barA` と `barB` をここに足した。** この2枚だけ**この行の外**にいて、
     * 消すのは各枝の仕事になっていた（`spike` と `hammer` は自分で消していた）。
     * ★**9/12 に新設した扇風機の枝が、それを引き継がなかった。** 結果、本人の実機で2つ出た:
     *   ・前に**動く床**を描いた view を扇風機が使う → 道幅いっぱいの帯が残り、
     *     さらに下の既定色 `P.ink` を浴びて**真っ黒な床**になる
     *     （本人「Lv14 で変な黒い床」「毎回出るわけではない」「乗っても何も起こらない」）
     *   ・前に**判子**を描いた view を扇風機が使う → **赤い箱が道の真ん中に残る**
     *     （本人「扇風機と同時に置かれる道の真ん中の赤いもの」）
     * ★**当たり判定は扇風機のまま**なので踏んでも何も起きない ＝ **絵だけが嘘をついていた**。
     * 「毎回ではない」のは、**前にその view が何を描いたか**で決まるから。
     * ★使う枝は必ず `shape()` を通り、`shape()` が `visible = true` を立てる。
     * だから**既定を「消す」にしておけば、枝が増えても同じ事故は起きない**
     */
    this.barA.visible = false;
    this.barB.visible = false;

    /*
     * ★**ホッチキス芯の柵**（2026-08-28・`IDEAS.md` #40）。
     * **黒い箱にしない**（本人の「敵キャラだけ謎の黒い物体」を1つ増やさないため）。
     * 紙色の低い柵に、朱の芯が1本渡っている絵。
     * ★**低いのが要点** —— 越えられない壁に見えると「払って踏み倒す」という選択肢が読めない
     */
    if (kind === 'fence') {
      shape(this.barA, x, 0.30, wide * 2, 0.60, c.depth * 0.55);
      (this.barA.material as THREE.MeshLambertMaterial).color.setHex(P.wall);
      shape(this.barB, x, 0.66, wide * 2, 0.12, c.depth * 0.75);
      (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.stamp);
      this.hit(x, wide, 0, c.depth * 0.375);
      return;
    }

    // 床の穴。**壁を作らない**ので、避けそこねると「落ちる」ように見える
    if (kind === 'gap') {
      shape(this.barA, x, -0.16, wide * 2, 0.3, c.depth * 2.2);
      (this.barA.material as THREE.MeshLambertMaterial).color.setHex(0x1a1917);
      /*
       * ★**手前の縁を1本入れた**（2026-09-07・本人「穴が見えなかった」）。
       * 道そのものが**暗い帯**なので、黒い穴は路面に溶けて消える（8/19 から一度も見えていなかった）。
       * 手前の縁だけを紙色で出すと、暗い面が「その向こう側」に見えて穴として読める。
       * ★縁を四方に付けない —— 囲うと「箱」に見えて、跨げそうな穴に見えなくなる
       */
      shape(this.barB, x, 0.04, wide * 2, 0.08, 0.55);
      this.barB.position.z = -c.depth * 1.05;
      (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.paper);
      // 穴は「触れる」のではなく「中に入ると落ちる」。箱は穴そのものの大きさ
      this.hit(x, wide, 0, c.depth * 1.1);
      return;
    }
    /*
     * ★**坂**。地面は動かせないので、**紙の折り目**として描く。
     * 登り＝濃い帯、下り＝薄い帯。**色の濃さがそのまま「重い/軽い」**になるので、
     * 文字を使わずに向きが伝わる（§4-D の言語不要の原則）
     */
    if (kind === 'whiteout') {
      shape(this.barA, x, 0.025, wide * 2, 0.05, c.whiteoutRun);
      (this.barA.material as THREE.MeshLambertMaterial).color.setHex(P.paper);
      this.barB.visible = false;
      return;
    }

    /*
     * ★**巨大赤判子**。角印（四角い判子）。
     * `wide` に落下の進み具合を潜ませず、`place` は素直に描くだけにして、
     * 高さは `ObstacleField` が `stampY` で渡す（絵と判定を1つの数字から作る）
     */
    if (kind === 'stamp') {
      /*
       * ★**落ちる場所の印。これが予告の本体。**
       * 最初は黒い影にしたが、**路面が暗いので何も見えなかった**（8/26 実機で確認）。
       * 判子と同じ赤にする —— 赤い枠が地面に出る＝この四角の中に判子が来る、が一目で分かる。
       * 赤は「減るもの」の色なので意味も合っている
       */
      shape(this.barA, x, 0.02, wide * 2, 0.04, wide * 2);
      (this.barA.material as THREE.MeshLambertMaterial).color.setHex(P.stamp);
      /*
       * 判子そのもの。**平たくする。**
       * 高さを幅と同じにしたら立方体になり、落ちてくる途中が**赤い壁**に見えた。
       * 角印は薄い —— 平たいほうが「上から押される」に見える
       */
      shape(this.barB, x, this.stampY + wide * 0.28, wide * 1.9, wide * 0.55, wide * 1.9);
      (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.stamp);
      /*
       * ★★**判子だけは本当に Y を見る**（2026-09-19）。
       * **落ちきる前は誰にも当たらない。** 前の実装は高さを一切見ていなかったので、
       * **影が出た瞬間に、まだ空の上にある判子で人が減っていた**
       */
      this.hit(x, wide * 0.95, 0, wide * 0.95, this.stampY + wide * 0.28, wide * 0.28);
      return;
    }

    (this.barA.material as THREE.MeshLambertMaterial).color.setHex(P.ink);

    // 動く床。減らさない代わりに横へ押す。**押す向きを矢羽根1本で示す**（文字は使わない）
    /*
     * ★★**動く床**（2026-09-12 に描き直し・本人指定）。
     *
     * > **本人の言葉:「床に動く方向の矢印を書くっていうのは可能？？
     * > または、動いている方向でこの床がどんな効果かある程度予測できるとか。
     * > **ある程度予測できることが重要だ**」**
     *
     * 帯の上に**矢印を並べる**。向きは `axis` と `phase` から出すので、
     * ★**絵と実際に押される向きは必ず一致する**（別々に書かない）。
     *   横 → 左右を向いた矢印 ／ 前 → 奴を向いた矢印 ／ 斜め → 斜めの矢印
     */
    if (kind === 'belt') {
      /*
       * ★★**ベルトコンベア**（参考画像 `assets/ref/moving-floor.jpg`）。
       * 灰色の帯／白いシールの縁／**端の大きな歯車**／**継ぎ目の線**／朱の縁取りの金の山形。
       *
       * ★**2026-09-12 夜に「前へ進むだけ」の1種になった。** 横も斜めも廃止したので、
       * **常に道幅いっぱい・中央・奴の方へ**。向きの分岐はもう無い
       */
      const run = c.beltRun;
      const W = wide * 2;
      // 白いシールの縁。帯より一回り大きいものを下に敷くだけで縁になる
      this.barB.visible = true;
      (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.paper);
      shape(this.barB, x, 0.02, W + 0.55, 0.04, run + 0.55);
      // 帯そのもの。★奥行きは `beltRun` と同じ＝当たり判定と同じ数字
      shape(this.barA, x, 0.05, W, 0.06, run);
      (this.barA.material as THREE.MeshLambertMaterial).color.setHex(P.beltFloor);

      /** 送り。★**時間ではなく `z`（距離）で動かす**ので、速度が変わっても見え方が変わらない */
      const feed = -z * 0.55;
      this.gearRig.position.set(x, 0, 0);
      this.gearRig.rotation.y = 0;
      this.s.set(1, 1, 1);

      /*
       * --- 歯車。**帯の端（手前と奥）に大きく4つ** ---
       * > **本人:「歯車が小さすぎる、歯車はふつう、その動く床の端っこに設置されるものだろう」**
       * ★前は半径 0.42m で、11m の帯に対して**点にしか見えなかった**。
       * 参考画像は**帯の端から軸がはみ出している**ので、`GEAR_R` を上げて端に置く
       */
      this.gears.visible = true;
      this.q.setFromAxisAngle(GEAR_AXIS, feed / GEAR_R);
      for (let i = 0; i < 4; i++) {
        this.v.set((i & 1 ? 1 : -1) * (W / 2 - GEAR_R * 0.4), GEAR_R * 0.35, (i & 2 ? 1 : -1) * (run / 2));
        this.m.compose(this.v, this.q, this.s);
        this.gears.setMatrixAt(i, this.m);
      }
      this.gears.count = 4;
      this.gears.instanceMatrix.needsUpdate = true;

      /*
       * --- 継ぎ目の線 ---
       * > **本人:「参考画像にあるような、道の線がない。之がなんかベルトコンベア風でいいんだよな」**
       * ★**板を横切る線が流れる**のが、ベルトコンベアの一番の手がかり。
       * 山形と**同じ送り**で動かすので、絵の中で速さが食い違わない
       */
      this.seams.visible = true;
      const sN = THREE.MathUtils.clamp(Math.round(run / 3.2), 2, SEAM_MAX);
      const sStep = run / sN;
      const sFlow = (((-feed) % sStep) + sStep) % sStep;
      this.q.identity();
      for (let i = 0; i < sN; i++) {
        const t = ((i * sStep + sFlow) % run) - run / 2;
        this.v.set(0, 0.07, -t);
        this.s.set(W, 0.03, 0.12);
        this.m.compose(this.v, this.q, this.s);
        this.seams.setMatrixAt(i, this.m);
      }
      this.seams.count = sN;
      this.seams.instanceMatrix.needsUpdate = true;
      this.s.set(1, 1, 1);

      /*
       * --- 山形 ---
       * > **本人:「逆に矢印大きすぎるし」**
       * ★**継ぎ目の線が入ったので、山形は「向き」だけ言えばよくなった。**
       * 3つ横並びにして、1つあたりは小さくする（前は最大 2.6 倍まで膨らんでいた）
       */
      this.arrows.visible = true;
      this.arrows.rotation.y = 0;
      this.arrows.position.set(x, 0.1, 0);
      const nW = 3;
      const nL = THREE.MathUtils.clamp(Math.round(run / 6), 1, Math.floor(ARROW_MAX / nW));
      const step = run / nL;
      /*
       * ★★**送りの符号**（2026-09-12・本人「矢印は前を向いているのに後ろに流れている」）。
       * 山形の位置は `-t` で置くので、**歯車と同じ `feed` を使うと絵だけ逆に流れる**。
       * ＝ **向いている先と流れる先が反対**という、いちばん直感に反する組み合わせだった
       */
      const flow = (((-feed) % step) + step) % step;
      const sc = THREE.MathUtils.clamp(Math.min((W / nW) * 0.4, step * 0.45), 0.9, 1.8);
      const n = nL * nW;
      this.arrows.children.forEach((a, i) => { a.visible = i < n; });
      for (let i = 0; i < n; i++) {
        const a = this.arrows.children[i];
        const t = (((i % nL) * step + flow) % run) - run / 2;
        const u = -W / 2 + (W * (Math.floor(i / nL) + 0.5)) / nW;
        a.position.set(u, 0.1, -t);
        a.scale.setScalar(sc);
      }
      return;
    }

    if (kind === 'fan') {
      /*
       * ★★**扇風機**（2026-09-12・本人指定）。道の外に立てて、横から風を吹かせる。
       * `spin` に**風の向き**（±1）が入る。`blowing` が false のときは
       * **羽根が止まり、風の筋が消える** ＝ それがそのまま「いま吹いていない」の表示になる
       */
      const dir = Math.sign(spin) || 1;
      this.fan.rig.visible = true;
      this.fan.rig.position.set(x, 0, 0);
      // 送る向き（head の local -Z）を道の中心へ向ける。dir=+1 なら +X へ吹く
      this.fan.head.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;

      // 羽根。吹いているときだけ回る。★距離で回すので、止まっている間は本当に止まる
      const spinA = blowing ? -z * 1.9 * dir : 0;
      // ★羽根の先はグリルの輪（半径 1.85）の内側に収める。はみ出すと「風車」に見える
      this.s.set(1.15, 1.9, 0.10);
      for (let i = 0; i < BLADE_N; i++) {
        const a = spinA + (i / BLADE_N) * Math.PI * 2;
        this.q.setFromAxisAngle(BLADE_AXIS, a);
        this.v.set(Math.cos(a + Math.PI / 2) * 0.80, Math.sin(a + Math.PI / 2) * 0.80, -0.18);
        this.m.compose(this.v, this.q, this.s);
        this.fan.blades.setMatrixAt(i, this.m);
      }
      this.fan.blades.instanceMatrix.needsUpdate = true;
      this.s.set(1, 1, 1);

      /*
       * --- 風の筋（参考画像の青い渦）---
       * ★**扇風機から出て道を横切る。** 1本を3節でつないで弧に見せる。
       * ★**流れる向き＝押される向き**（今度は向きと流れが一致する）。
       * 道の外から反対側の壁まで届かせるので、**風が全幅に効く**ことが絵でも分かる
       */
      this.wind.visible = blowing;
      if (blowing) {
        /*
         * ★**1本を3節でつないで「弧」にする**（2026-09-12 夜に作り直し）。
         * 最初は節をまっすぐ並べたら、**青い板が道を横切る**絵になって風に見えなかった。
         * 参考画像の渦は**曲がっている**のが本体なので、
         * ★**節ごとに向きを少しずつ変えて、進みながら曲げる**（折れ線で弧を描く）
         */
        const span = CFG.courseWidth + 3.0;
        const LEN = 1.15;
        for (let i = 0; i < WIND_N; i++) {
          // 1本ごとに高さ・奥行き・位相をずらす（そろうと機械に見える）
          const lane = (i / (WIND_N - 1)) * 2 - 1;
          /*
           * ★★**2026-09-13: 0.85 → 0.25。**（本人「早すぎてマシンガンみたいに見える」）
           *
           * 実測してみたら、感想ではなく数字のほうが先に壊れていた ——
           * 0.85 は **1.18m 走るごとに1周**。`runSpeed 9` なので **毎秒 7.6周**で、
           * 筋1本が道（`span` 14m）を横切るのに **0.13秒**＝見かけ **100m/s 超**。
           * ★**0.25 なら1周 4m ＝ 約0.44秒で横切る**（3.4倍ゆっくり）。
           * ★**本数は減らさない。** 遅くすると1本の滞在が伸びるので、
           * 画面の中の密度はむしろ上がる（減らすと隙間が空いて「風が途切れる」）
           *
           * ★**時間ではなく距離（`z`）で回しているのは元のまま。**
           * 走る速さが変わっても見え方が変わらないため。ただしこの作りだと
           * **殴り合いで止まった間は風も止まる**（風は床の模様ではないのでおかしい）。
           * ★**そこは直していない** —— 時間で回すと「動く床の上で風だけ速い」が消える代わりに、
           * 速度と絵の関係が変わる。**本人の判断が要るので `TASKS.md` に積んである**
           */
          const t = ((-z * 0.25 + i * 0.37) % 1 + 1) % 1;
          let px = x - dir * 1.2 + dir * t * span;
          let pz = lane * 3.0;
          // ★群れの頭より上を通す。胸の高さだと体に隠れて一本も見えない
          const py = 2.3 + lane * 0.55 + Math.sin(t * 5.5 + i) * 0.3;
          // 曲がる向きは1本ごとに変える（全部同じだと櫛に見える）
          const curl = (i % 2 === 0 ? 1 : -1) * 0.55;
          let ang = Math.sin(t * 3.0 + i) * 0.5 - curl;
          for (let k = 0; k < WIND_SEG; k++) {
            const cx = Math.cos(ang) * LEN, cz = Math.sin(ang) * LEN;
            this.v.set(px + dir * cx * 0.5, py, pz + cz * 0.5);
            this.q.setFromAxisAngle(WIND_AXIS, -ang * dir);
            this.s.set(LEN * (1 - k * 0.16), 0.11, 0.11);
            this.m.compose(this.v, this.q, this.s);
            this.wind.setMatrixAt(i * WIND_SEG + k, this.m);
            px += dir * cx; pz += cz; ang += curl;
          }
        }
        this.wind.count = WIND_MAX;
        this.wind.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    if (kind === 'pinch' || kind === 'window' || kind === 'shredder') {
      // 隙間の外を左右から塞ぐ。壁2枚で1つの障害物
      const leftW = Math.max(0.01, x - wide + half);
      const rightW = Math.max(0.01, half - (x + wide));
      // 窓口はカウンターなので低く分厚い。シュレッダーは床すれすれで薄い
      const h = kind === 'window' ? c.height * 0.72 : kind === 'shredder' ? c.height * 0.34 : c.height;
      const d = kind === 'window' ? c.depth * 1.6 : c.depth;
      shape(this.barA, -half + leftW / 2, h / 2, leftW, h, d);
      shape(this.barB, half - rightW / 2, h / 2, rightW, h, d);
      // 隙間の外を塞ぐ壁2枚。**隙間そのものには判定を置かない**（通れるのが正しい）
      this.hit(-half + leftW / 2, leftW / 2, 0, d / 2);
      this.hit(half - rightW / 2, rightW / 2, 0, d / 2);
      (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.ink);
      if (kind === 'window') {
        // 天板。**「窓口」だと一目で分かるのはこの1枚**
        this.barC.visible = true;
        this.barC.position.set(0, h + 0.07, 0);
        this.barC.scale.set(CFG.courseWidth, 0.14, d * 1.15);
      }
      if (kind === 'shredder') {
        // 刃。赤い薄板を隙間の縁に置いて「削られる」を示す
        this.barC.visible = true;
        (this.barC.material as THREE.MeshLambertMaterial).color.setHex(P.stamp);
        this.barC.position.set(0, h + 0.05, 0);
        this.barC.scale.set(CFG.courseWidth, 0.1, d * 0.5);
      }
      return;
    }

    (this.barB.material as THREE.MeshLambertMaterial).color.setHex(P.stamp);

    if (kind === 'hr') {
      // 人事部。**倒せない。** 背を少し高くして「別格」を出す
      // ★2026-09-13: 1.18 → 1.5（本人「人事部ちっさくない？ 敵が見えないよ」）。
      // 立ちはだかる相手は**味方より明らかに大きい**必要がある（§4-D の「別格」）
      this.lineUp(x, wide, 1.5, crewMatHr());
      this.bubble.visible = true;
      this.bubble.position.set(x, 2.35, 0);
      this.hit(x, wide, 0, c.depth * 0.5);
      return;
    }

    /*
     * ★★**とげ**（2026-09-12・本人の参考画像）。
     * 前はこの下の `lineUp` に落ちて**人事部と同じ赤い人の列**だった。
     * ★シルエットは `x ± wide` に収める（rig は単位円で作ってあるので wide を掛けるだけ）
     */
    if (kind === 'spike') {
      this.spikeRig.visible = true;
      this.spikeRig.position.set(x, 0, 0);
      this.spikeRig.scale.setScalar(wide);
      this.barA.visible = false;
      this.barB.visible = false;
      /*
       * ★**rig は単位円で作ってあって `wide` 倍される**ので、シルエットは `x ± wide`。
       * ★**奥行きは薄い**（土の盛り上がりが z 方向 0.62、トゲの円錐は 0.3）。
       * 前の判定は奥行きを `depth*0.5+0.35 = 0.9` で見ていた ＝ **実物のおよそ3倍**
       */
      this.hit(x, wide, 0, wide * 0.4);
      return;
    }

    /*
     * ★★**回転ハンマー**（2026-09-12・本人の参考画像）。
     *
     * ★**柱は `baseX` に立っていて、腕が θ で回る。**
     * 頭の横位置は `baseX + sin(θ) * arm` で、これは
     * `ObstacleField` が当たり判定に使っている `x` と**完全に同じ式**。
     * （回転を 3D で描くので、奇抜に見えるのはこの射影だけ）
     */
    if (kind === 'hammer') {
      const h = this.hammer;
      h.rig.visible = true;
      h.rig.position.set(baseX, 0, 0);
      h.pivot.rotation.y = spin;
      const len = Math.max(0.6, arm);
      h.arm.scale.x = len * 2;
      (h.arm.parent!.children[0] as THREE.Mesh).scale.x = len * 2 + 0.1;
      const headR = Math.max(0.45, wide) * 0.5;
      for (let i = 0; i < h.heads.length; i++) {
        const dir = i === 0 ? 1 : -1;
        h.heads[i].position.x = dir * len;
        h.heads[i].scale.setScalar(Math.max(0.45, wide));
        /*
         * ★★★**2026-09-19: ここが「当たってないのに当たる」の本体だった。**
         *
         * 頭は `pivot.rotation.y = spin` で回る。Y 軸まわりの回転なので、
         * ローカルの `(±len, y, 0)` はワールドで **`x = ±len·cos(spin)` / `z = ∓len·sin(spin)`**
         * に来る。ところが `ObstacleField` の判定は **`x = baseX + sin(spin)·sweep`** だった。
         * ★**絵は cos、判定は sin ―― 90°ずれていた。**
         * 判定が「頭は中央にいる」と言っているとき、絵の頭は左右どちらかの端にいる。
         *
         * ★**だから判定をここで作る。** 絵を置いたその行の隣で、同じ `spin` と `len` から出す。
         * ★**頭は Z にも振れる**（前後に動く）。これも前の1次元判定では表現できなかった
         */
        this.hit(baseX + dir * len * Math.cos(spin), headR, -dir * len * Math.sin(spin), headR);
      }
      this.barA.visible = false;
      this.barB.visible = false;
      return;
    }

    // ここに来るのは柵・穴の取りこぼしなど。**人の列で描く**
    this.lineUp(x, wide, 1.0, crewMatGuard());
    this.hit(x, wide, 0, this.c.depth * 0.5);
  }

  hide(): void {
    this.group.visible = false;
    /*
     * ★**このコメントは 2026-09-06 に書き直した。前の説明は事実と逆だった。**
     *
     * 旧コメントは「落ちきった view（`stampY≈0`）を使い回すと次の判子の1コマ目が
     * 落ちきった姿で描かれる」と書いたうえで **`stampY = 0` を代入**していた。
     * ★**0 を入れることは「落ちきった姿」そのもの**なので、書いてある現象は何も変わらない。
     * しかも view がプールに戻るのは `z > gone`（通過して十分後）＝判子は必ず着地済みなので、
     * **残っている値はもともと常に ≈0**。
     *
     * ★**実際に効いた修正は、同じコミットのもう一方**——`stampY` の計算を `place()` の
     * **呼び出しより前へ移した**こと（1コマ遅れて前の判子の高さが出ていた）。
     * この代入は**保険**として残してよいが、直した本体ではない。
     * このリポジトリはコメントが設計の記録なので、**次に読む人が誤解する**ほうが害が大きい
     */
    this.stampY = 0;
  }
}

function shape(m: THREE.Mesh, x: number, y: number, w: number, h: number, d: number): void {
  m.visible = true;
  m.position.set(x, y, 0);
  m.scale.set(w, h, d);
}
