import * as THREE from 'three';
import { CFG, lateralHalfWidth, resolveKnobs, resolveLevel, toMode, MODES, type GameMode, type LevelSpec } from '../config';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { Course } from '../world/Course';
import { buildCutoutGeometry, createCutoutMaterial } from '../entities/Cutout';
import { heroParts, shadowOnly, SLOT } from '../entities/cutoutLayout';
import { charAtlas } from '../tex/atlas';
import { Crowd } from '../entities/Crowd';
import { Gates, type GateResult } from '../entities/Gates';
import { MATH_MAX, MAX_CROWD, bigLog, cmpBig, fmtDiff, type Big } from '../entities/gateOps';
import { ObstacleField } from '../world/ObstacleField';
import { Pickups } from '../world/Pickups';
import { Boss } from '../entities/Boss';
import { BossYard } from '../entities/BossYard';
import { Scraps } from '../fx/Scraps';
import { SlipperToss } from '../fx/SlipperToss';
import { Stairs } from '../entities/Stairs';
import { Result, type ResultData } from '../ui/Result';
import { Home } from '../ui/Home';
import { Shop, type ShopItem } from '../ui/Shop';
import { Celebrate } from '../ui/Celebrate';
import { Clear } from '../ui/Clear';
import { Hud } from '../ui/Hud';
import { Juice } from '../fx/Juice';
import { Puffs } from '../fx/Puffs';
import { Audio } from '../fx/Audio';
import { Intro } from '../ui/Intro';
import { platform } from '../platform';
import { paperGrain } from '../tex/paper';
import { watchShaderErrors, precompile, statsOverlay, guardContextLoss } from './diagnostics';
import { grainScene } from '../tex/grain';
import { SLIPPERS, FIRST_SLIPPER, slipperById, slipperTexture, slipperUrl, rollIine, type Glow } from '../slippers/catalog';

/** §9 の難易度カーブ Lv1 の開始人数 */
/** 起動時のレベル（CFG.levels の添字）。実際の開始人数は spec.start */
const FIRST_LEVEL = 0;

/** §7: ステートマシン。Phase 0 は RUN だけ動かす */
export type State = 'TITLE' | 'RUN' | 'BOSS' | 'CLEAR' | 'FINISH' | 'RESULT';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly course = new Course();
  private readonly crowd = new Crowd();
  private readonly gates = new Gates(CFG.levels[FIRST_LEVEL].start, CFG.levels[FIRST_LEVEL].gateTier, CFG.levels[FIRST_LEVEL].gateGap, resolveKnobs(FIRST_LEVEL + 1).gate);
  private readonly obstacles = new ObstacleField();
  private readonly boss = new Boss();
  /** ★城の前庭（堀・橋・広場・城）。ボス回だけ出る（2026-09-06） */
  private readonly yard = new BossYard();
  /** ★殴り合いの煙。**遊びには一切関与しない**、気分だけの部品（2026-09-06） */
  private readonly puffs = new Puffs();
  private readonly pickups = new Pickups();
  /** このレベルで拾った印紙。リザルトのコインに乗る */
  private picked = 0;
  private readonly scraps = new Scraps();
  /** ★負けたときの演出（スリッパがゴミ箱へ飛んでいく・2026-09-14） */
  private readonly toss: SlipperToss;
  /** ★演出中に差し替える「スリッパを持っていない主人公」 */
  private readonly heroGeoEmpty: THREE.BufferGeometry;
  /** 元に戻すための、持っている側 */
  private heroGeoFull!: THREE.BufferGeometry;
  private readonly stairs = new Stairs();
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly juice: Juice;
  private readonly result: Result;
  /** ★勝ったときの判子（2026-09-06。達成感の演出） */
  private readonly clearUi: Clear;
  private readonly audio = new Audio();
  /** ★ホーム（＝タイトル）・下駄箱・ゴールのお祝い（2026-09-16） */
  private readonly home: Home;
  private readonly shop: Shop;
  private readonly celebrate: Celebrate;
  /** 下駄箱をどこから開いたか。**戻る先** */
  private shopFrom: 'home' | 'result' = 'home';
  /** ★選べる最後のステージ（0 始まり）。前の保存（'level' だけ）からも引き継ぐ */
  private maxLevel = Math.max(platform.load('maxLevel', 0), platform.load('level', 0));
  /** 直前のリザルトで勝ったか。ホームの「つづきから」を次のステージにするため */
  private lastWon = false;
  /** リザルトの基本コイン。ルーレットの上乗せはこれに掛ける */
  private lastBase = 0;
  /** ★お祝いの経過秒（-1 ＝ お祝い中でない） */
  private celebrateT = -1;
  private celebrateDoor = false;
  private cheer = 0;

  private readonly player: THREE.Mesh;
  /** 主人公の接地影。**位置だけ追従し、傾きは受け取らない** */
  private readonly playerShadow: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  private state: State = 'RUN';
  /** 今どのレベルか（CFG.levels の添字）。HUD の綴じ札と保存キー 'level' もこれ */
  private level = FIRST_LEVEL;
  /** 開発用の計器。本番では何もしない関数が入る */
  private stats: (extra: string) => void = () => {};

  private distance = 0;
  private time = 0;
  private playerX = 0;
  /** 固定タイムステップの貯金（`tick` が貯めて `update` が 1/60 ずつ食う） */
  private acc = 0;
  /** いま横に動ける半幅（m）。`Input` とゲートが**同じ値**を見るための1か所 */
  private lateralHalf = CFG.courseWidth / 2 - CFG.playableInset;
  private prevPlayerX = 0;
  private lastFrame = 0;
  private running = false;
  private viewW = 0;
  private viewH = 0;
  private resizeObserver?: ResizeObserver;
  /** ゴール手前の減速（§4-E: 走行停止）。急に止めると首が飛ぶので必ず補間する */
  private brake = 0;
  /**
   * ★**殴り合いの演出を間引く**（2026-08-28）。
   * ボスの相殺は**毎フレーム**人数を削るので、そのまま `popCount`／`flash`／音を出すと
   * **1秒に60回**光って鳴る＝ストロボ。社員の騒音ポップ（0.5秒に1回）と同じ作法で溜める
   */
  private bossPopT = 0;
  private bossPopN = 0;
  /** ★理系用: 溜め始めたときの人数（桁を奪われたぶんを数字ポップに出すため） */
  private bossPopFrom: Big | null = null;
  /** ★煙を出す側（0=相手側 / 1=こちら側）。**交互に切り替えるためだけの旗**（2026-09-11） */
  private brawlSide = 0;
  /** ★殴っている度合い（0..1）。切り替えを滑らかにするために持つ（2026-09-14） */
  private punch = 0;
  /*
   * ★★**スリッパ（2026-09-16 に60種へ）**。所持は **id の集合**、履いているのは **id**。
   * 前はビット（32種まで）と添字で持っていたが、**種類を足すたびに並びがずれる**ので id にした
   */
  private owned = new Set<string>([FIRST_SLIPPER]);
  private wearId = FIRST_SLIPPER;
  /** ★言い値。下駄箱を開くたびに振り直す */
  private iinePrice = rollIine();
  /** ★伝説のスリッパの光（主人公の手元）。2026-09-16 */
  private glow!: THREE.Sprite;
  private glowKind: Glow | undefined;
  /**
   * ★**広場に入るときの後片付けを一度だけやったか**（2026-09-06）。
   * 打ち止め（`stopAt`）は「これより先を**作らない**」だけなので、
   * **すでに作られて宙に浮いているゲート**は残る。`FINISH` で呼んでいる
   * `clearUnresolved()` を、広場の入口でも1回だけ呼ぶ
   */
  private openCleared = false;
  /**
   * ★**達成感の演出**（2026-09-06 夜・本人「これがゲームの本質」）。
   * 0 = 間（ま） / 1 = 城の門まで歩く / 2 = くぐって判子 / 3 = 済み。
   * **`clearT` はその段の中での経過秒**（段が変わるたびに 0 に戻る）
   */
  private clearPhase = 0;
  private clearT = 0;
  /** 凱旋の速さ。**止まった状態から立ち上げる**（いきなり全速だと勝った実感が飛ぶ） */
  private marchV = 0;
  /** この段で鳴らした音の数。**同じ音を毎フレーム鳴らさない**ための番号 */
  private clearBeat = 0;
  /** 紙吹雪の間隔用。`clearT` は段が変わるとリセットされるので別に持つ */
  private clearT2 = 0;
  private raise = 0;
  private climb = 0;
  /** 持ち越しのコイン。**HUD に出すので起動時に読む**（結果画面まで 0 だと「貯まっている」が伝わらない） */
  private totalCoins = platform.load('coins', 0);
  /**
   * ★**いまのモード**（2026-09-20）。`spec` と `resolveKnobs` の両方がこれを見る。
   * ★**知らない値は必ずノーマルに落ちる**（`toMode`）ので、古いセーブでも壊れない
   */
  private mode: GameMode = toMode(platform.load<string>('mode', 'normal'));
  /** 聞き取りに連れてきた人数。支払いで減る前の値を控えておく */
  private witnesses = 0;
  /** ★ゴールに連れてきた人数の、10³⁰⁰ を越えた桁（理系用）。`witnesses` と対 */
  private witnessesOver = 0;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Chromebook 4GB でも動くこと（§6）。DPR は 2 で頭打ちにする
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // ★ボス広場の崖で地面を切り落とす（`Course.cliff`・2026-09-16）
    this.renderer.localClippingEnabled = true;
    this.host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(CFG.palette.paper);
    // 遠景を背景色に溶かす。地平線まで見通せると平坦に見えて速度感が死ぬ
    this.scene.fog = new THREE.Fog(CFG.palette.paper, 26, 82);

    // §6: ライトは平行光1＋環境光1。シェーダ側の uLightDir と向きを揃えてある
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.35, 0.9, 0.28).multiplyScalar(30);
    this.scene.add(sun);

    this.scene.add(this.course.group);

    this.scene.add(this.crowd.mesh);

    this.material = createCutoutMaterial(charAtlas(), { grain: paperGrain(512) });
    this.player = new THREE.Mesh(buildCutoutGeometry(heroParts()), this.material);
    /*
     * ★**掲げたスリッパを抜いた主人公**（2026-09-14）。
     * 負けてスリッパが飛んでいくのに**手元にも残っていたら、2つあることになる**。
     * ★**腕は上げたまま残す** ―― 手を伸ばしたまま届かない形になって、演出がむしろ強くなる。
     * ジオメトリを**差し替えるだけ**なので、材質もシェーダーもそのまま使える
     */
    this.heroGeoEmpty = buildCutoutGeometry(heroParts().filter((p) => p.rect !== SLOT.heroSlipper));
    // **影は傾かない。** 体と同じメッシュに入れると、横移動で傾いたとき
    // 地面の影まで一緒に起き上がって浮いて見える（外部レビューの指摘・採用）
    this.playerShadow = new THREE.Mesh(buildCutoutGeometry(shadowOnly()), this.material);
    /*
     * ★★**2026-09-13: 主人公を味方より大きくする**（本人指定）。
     *
     * > **本人:「以前は主人公は味方よりもっと大きくて、これを操作しているんだな
     * > っていう感じが分かりやすかった。この感じ出せる？」**
     *
     * 前はこれを**偶然**で出していた —— 味方は人数が増えるほど縮む（`Crowd` の `k`）のに、
     * 主人公は等倍のままだったので、群れが増えるほど相対的に大きく見えていた。
     * ★**偶然に頼らず、明示的に大きくする。** 影も同じ倍率で拡げないと足元が浮く
     */
    this.player.scale.setScalar(CFG.heroScale);
    this.playerShadow.scale.setScalar(CFG.heroScale);
    this.player.frustumCulled = false;
    this.scene.add(this.playerShadow);
    this.scene.add(this.player);

    this.scene.add(this.gates.group);
    this.scene.add(this.obstacles.group);
    // 前庭は**ボスより先に足す**（描画順ではなく、読む順を絵の奥→手前に揃えるため）
    this.scene.add(this.yard.group);
    this.scene.add(this.boss.group);
    // バトルリングは Boss が持つ（出る／消えるを完全に連動させるため）
    this.scene.add(this.boss.arena.group);
    this.scene.add(this.boss.figure.group);
    this.scene.add(this.pickups.group);
    this.scene.add(this.scraps.mesh);
    // 輪郭を先に足す（後から足したほうが手前に来るわけではないが、読む順を絵の奥→手前に揃える）
    this.scene.add(this.puffs.outline);
    this.scene.add(this.puffs.mesh);
    this.scene.add(this.stairs.group);
    this.gates.onResolve = this.onGate;
    // 伏せ札の中身が出た音。**判子の音を使い回す**（新しい音を増やさない）
    this.gates.onReveal = () => this.audio.stamp();
    this.obstacles.onHit = this.onObstacle;
    // 障害物はゲートの間にしか置かない。だからゲート側の確定を購読する（§4-D）
    // **障害物はゲート間の中点、拾い物はその手前と奥**。同じ通知から両方を配る
    this.gates.onSchedule = (prevAt, at, clear) => {
      // 一団の帯には障害物を置かない（相殺と回避を同時に要求しない）。拾い物は置いてよい
      if (clear) this.obstacles.offer(prevAt, at);
      this.pickups.offer(prevAt, at);
    };
    this.pickups.onCoin = (x, _z, n) => {
      this.picked += n;
      this.audio.tick();
      this.juice.popCount(x, n);
      this.hud.setCoins(this.totalCoins + this.picked);
    };
    // ×2 の札は「ただのゲート」にしないため、端に置いてある（取りに行く判断が要る）
    this.pickups.onMult = (x) => {
      this.crowd.setCount(this.crowd.count * 2);
      this.audio.gain();
      this.juice.popCount(x, this.crowd.count);
    };

    this.input = new Input(this.renderer.domElement, CFG.courseWidth / 2 - CFG.playableInset);
    this.lateralHalf = CFG.courseWidth / 2 - CFG.playableInset;
    this.crowd.add(CFG.levels[FIRST_LEVEL].start);
    this.crowd.onSpawn = () => this.audio.tick();
    // 紙片は「減った瞬間」にだけ出す（§4-I の書類の語彙がここで顔を出す）
    this.crowd.onLeave = (x, z) => {
      this.scraps.spawn(x, z);
      this.audio.leave();
    };
    // 壇（§4-E）: 1段ごとに判子、最上段で扉。払う粒は Stairs.update の戻り値側で鳴らす
    // 相殺の音は「離脱」を流用する（味方が黙って離れるのと同じ出来事なので §4-G 的にも合う）
    // 音は Game 側で間引く（毎フレーム鳴らすと連射になる）。ここでは何もしない
    this.boss.onClash = () => {};
    this.boss.onBreak = (joined, isBoss) => {
      this.audio.gain();
      this.juice.popCount(0, joined);
      /*
       * ★**広場がゴール**（2026-09-06・本人指定「倒したらその場でクリア」）。
       * 壇（`Stairs`）まで走らせない。**勝った直後に走らされる間延び**を作らないため。
       * 道中の一団を突破したときは今までどおり走行が続く（`isBoss` が false）
       */
      if (isBoss) {
        // 次の挑戦は満タンから。**消し忘れると次の周回が「HP1のボス」になる**
        platform.save(this.carryKey, 0);
        /*
         * ★**倒した瞬間にリザルトを出さない**（2026-09-06 夜・本人指定）。
         * 「**城の門をくぐって CLEAR の文字が出る**——そういう達成感が出る演出がゲームの本質」。
         * 間を置いて → 門まで歩いて → 判子、をやってからリザルトへ送る（`updateClear`）
         */
        this.beginClear();
      }
    };
    this.stairs.onStep = () => this.audio.stamp();
    this.stairs.onDoor = () => this.audio.door();
    this.hud = new Hud(this.host);
    this.juice = new Juice(this.host);
    // ★**判子はリザルトより先に足す** ＝ DOM の重なりで**リザルトが上**になる
    this.clearUi = new Clear(this.host);
    this.result = new Result(this.host);
    this.loadSlippers();
    this.toss = new SlipperToss(this.host);
    /*
     * ★★**伝説のスリッパの光**（2026-09-16・本人「光エフェクトあり」）。主人公の子にして、掲げた手元に置く。
     * 位置は `cutoutLayout` の heroSlipper（x −0.28 / y 肩0.88+1.00）。主人公の拡大率は親から掛かる
     */
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.position.set(-0.28, 1.88, 0.06);
    this.glow.renderOrder = 8;
    this.glow.visible = false;
    this.player.add(this.glow);
    this.scene.add(this.toss.group);
    this.result.onRetry = () => this.enter(this.level);
    // ★**次へ進めるのは勝った回だけ**（2026-09-16 にステージ選びに鍵を付けたので、負けた回は「もう一回」だけ出す）。
    // 最終レベルの次は 1本目へ回る（§8「まず5個」なので、5本目で終端にしない）
    this.result.onNext = () => this.enter(this.level + 1);
    this.result.onHome = () => this.showHome(this.lastWon ? this.level + 1 : this.level);
    this.result.onShop = () => this.openShop('result');
    // ★ルーレットの上乗せ。**基本ぶんは showResult で保存済み**なので、ここは差分だけ足す
    this.result.onRoulette = (mult) => {
      const extra = this.lastBase * (mult - 1);
      this.totalCoins = platform.load('coins', 0) + extra;
      platform.save('coins', this.totalCoins);
      this.hud.setCoins(this.totalCoins);
      this.audio.gain();
    };
    this.home = new Home(this.host);
    this.home.onPlay = () => this.enter(this.level);
    this.home.onPickStage = (i) => this.enter(i);
    this.home.onShop = () => this.openShop('home');
    this.home.onTap = () => this.audio.stamp();
    this.home.onToggleMute = () => this.toggleMute();
    this.home.onPickMode = (m) => this.setMode(m);
    this.shop = new Shop(this.host);
    this.shop.onPick = (id) => this.pickSlipper(id);
    this.shop.onBack = () => this.closeShop();
    this.shop.onTap = () => this.audio.stamp();
    this.celebrate = new Celebrate(this.host);
    // ★巨大なボスが床に着いた瞬間（2026-09-16・本人「砂煙みたいなのがもくもく」）
    this.boss.onLanded = (z, h) => {
      this.puffs.dust(0, h * 0.7, z, z - h, 70);
      this.rig.pulse(1.8);
      this.audio.thud();
      for (let i = 0; i < 20; i++) this.scraps.spawn((Math.random() - 0.5) * h * 0.6, 0);
    };
    this.result.onStamp = () => this.audio.stamp();
    // ★カウントアップで段が1つ塗られるたびに鳴らす（壇を登るのと同じ数え方・§5）
    this.result.onTick = () => this.audio.tick();
    // ★札でステージへ飛べるのは開発ビルド（npm run dev）だけ。公開版では押しても何も起きない（2026-10-03 本人）
    if (import.meta.env.DEV) this.hud.onPickLevel = (i) => this.enter(i);

    // 自動再生ポリシー: 最初の操作があるまで AudioContext を作らない
    // ★音の入り切りは保存する（2026-09-29）。電車で切った人が、次に開いたとき鳴らないように
    this.audio.setMuted(platform.load('muted', false));
    // PC は M キーでも切れる（走行中の HUD には札を増やさない ―― 常時6つの予算）
    addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) this.toggleMute(); });
    addEventListener('pointerdown', this.unlockAudio, { passive: true });
    addEventListener('keydown', this.unlockAudio, { passive: true });

    // 初期レイアウトが確定する前に大きさを取ると 0 が返る環境がある（非表示タブなど）。
    // window の resize だけに頼らず、host を直接監視して取り直す。
    addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.host);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
  }

  /**
   * ★**開発用のステージ移動**（2026-09-19）。コンソールから `__game.jumpTo(20)`。
   * Lv21「当たり判定の実験場」（0始まりで 20）へ飛ぶために足した。
   * **本番ビルドでは `__game` 自体が生えない**ので届かない（`src/main.ts`）
   */
  jumpTo(index: number): void {
    this.enter(index);
  }

  async start(): Promise<void> {
    await platform.init();
    platform.loadingProgress(1);
    // 続きから。1本目に戻したいときはリザルトの ↻ ではなく保存を消す
    // シェーダが落ちたら画面に出す。**コンソールを見ていなくても気づけるように**
    watchShaderErrors(this.renderer);
    this.stats = statsOverlay(this.renderer);
    // GPU が詰まるとブラウザは予告なくコンテキストを捨てる。**止めて・伝えて・戻す**
    guardContextLoss(
      this.renderer.domElement,
      () => { this.running = false; },
      () => { this.running = true; this.lastFrame = performance.now(); requestAnimationFrame(this.tick); },
    );
    // **紙の地合いを世界全部に乗算する**（`PLAN.md`）。シーンが組み上がった後に一度だけ。
    // 起動時に canvas へ1回描くだけなので、実行時コストはテクスチャ参照ぶんしかない
    grainScene(this.scene, paperGrain(512), { amount: 0.92, scale: 0.5 });
    // ★起動したらホーム（2026-09-16）。前はいきなり前回のステージが走り出していた
    this.showHome(platform.load('level', FIRST_LEVEL));
    // **先にコンパイルしておく。** そうしないと「そのマテリアルが初めて画面に入った瞬間」
    // まで失敗が分からない。ゲートが消えていたのに気づくのが遅れたのはこれが理由
    precompile(this.renderer, this.scene, this.rig.camera);
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.tick);
  }

  private setState(next: State): void {
    if (this.state === next) return;
    this.state = next;
    // §7: ポータルはどちらも Gameplay start/stop の発火が必須。
    // ここ1箇所に集約しておけば SDK 差し替えだけで済む
    if (next === 'RUN' || next === 'BOSS') platform.gameplayStart();
    else platform.gameplayStop();
    // ★BGM は走行中だけ（2026-09-29）。RUN⇄BOSS の行き来では切らない（`bgm(true)` は鳴っていれば何もしない）
    this.audio.bgm(next === 'RUN' || next === 'BOSS');

    if (next === 'FINISH') {
      // 走行中の音は全部止める。ここから先は「聞き取り」の場面
      this.gates.clearUnresolved();
      this.audio.noise(0);
      this.rig.shake = 0;
      this.crowd.departMode = 'send';
      this.witnesses = this.crowd.count;
      this.witnessesOver = this.crowd.over;
      // ★扉の人数はレベルごと（2026-09-16）。0（ボス回）は元の表のまま
      const door = CFG.stairs.doorAt[this.level] ?? 0;
      if (door > 0) this.stairs.begin(this.witnesses, door);
      else this.stairs.begin(this.witnesses);
    }
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    // タブ復帰時に一気に進むのを防ぐ
    const frame = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;

    this.onResize();
    /*
     * ★★**固定タイムステップ**（2026-09-19・`Collision-Sim` の `docs/collision-basics.md` §7）。
     *
     * 前は画面の更新に合わせて可変 dt で回していた。**当たり判定が端末のfpsで変わる**ので、
     * 「120Hz のスマホでは当たるのに、重い端末では抜ける」が起きる。
     * ★**貯めて、1/60 ずつ進める。** 上限を置くのは、タブを切り替えて戻ったときに
     * 何秒ぶんもまとめて計算して固まるのを防ぐため
     */
    const FD = CFG.hit.dt;
    this.acc += frame;
    let steps = 0;
    while (this.acc >= FD && steps < CFG.hit.maxSteps) {
      this.update(FD);
      this.acc -= FD;
      steps++;
    }
    if (this.acc > FD * CFG.hit.maxSteps) this.acc = 0;
    this.renderer.render(this.scene, this.rig.camera);
    // **描画の後に読む。** 前に読むと calls も tris も 0 のままで、
    // 「何も描かれていない」のと見分けがつかない（計器として意味を成さない）
    this.stats(`lv ${this.level + 1}  ${Math.round(this.distance)}m  crowd ${this.crowd.count}/${this.crowd.drawn}`);
  };

  private update(dt: number): void {
    this.time += dt;
    /*
     * ★**演出は state の外で回す**（2026-09-14）。
     * 負けた瞬間に state は 'RESULT' になるので、`RUN` の枝に置くと**1フレームも動かない**。
     */
    this.toss.update(dt);
    this.updateGlow();

    if (this.state === 'RUN' || this.state === 'FINISH') {
      // FINISH に入ったら減速する。距離が止まるとコースも群衆も自然に止まる
      if (this.state === 'FINISH') this.brake = Math.min(1, this.brake + dt / CFG.level.brake);
      /*
       * ★**坂の増減をここで掛ける**（2026-08-26）。`obstacles.slow` は
       * 正で遅く・負で速く。**前フレームの update が入れた値**を使う（`push` と同じ流儀）。
       * 上下に天井を置くのは、坂が重なったときに止まる／飛ぶのを防ぐため
       */
      this.distance += CFG.runSpeed * (1 - ease(this.brake)) * this.obstacles.speedScale * dt;
      /*
       * ★**ボス回は壇まで走らない**（2026-09-06）。広場がゴールなので、
       * `length` に着いても `FINISH` に入れない。入れてしまうと**ボスの向こうに壇が立ち**、
       * 「倒したらその場でクリア」が崩れる。（そもそもボスが手前で走行を止めるので
       * ここへは届かないはずだが、**届いたときに黙って壇が出る**のが一番たちが悪い）
       */
      if (this.state === 'RUN' && this.boss.bossAt === null && this.distance >= this.spec.length) this.setState('FINISH');
      // **0人になったら即終わり。** 走り続けても何も起きないので、
      // 「負けた」がその場で分かるようにここで打ち切る（本人指摘 2026-08-22）
      if (this.state === 'RUN' && this.crowd.count <= 0) this.setState('FINISH');
      this.input.update(dt);
      // 動く床の押し。**前フレームの obstacles.update が入れた値**を使う
      if (this.obstacles.push !== 0) this.input.nudge(this.obstacles.push * dt);

      // 目標Xへバネ追従。即時追従にすると軽くて安っぽくなる
      // ★修正テープの上では追従を鈍らせる（`obstacles.slip`）。**押されるのではなく効かない**
      const k = 1 - Math.exp(-CFG.lateral.follow * this.obstacles.slip * dt);
      this.prevPlayerX = this.playerX;
      this.playerX += (this.input.targetX - this.playerX) * k;
      /*
       * ★★**主人公は障害物に弾かれる**（2026-09-19・本人「主人公は、はじかれるかな」）。
       * **群れは弾かれない**（押し返すと隊列が崩壊する）ので、押し返しはここだけ。
       * ★`nudge` で**目標も動かす** —— 位置だけ動かすとバネが次のフレームで引き戻して、
       * 「押されたのに元に戻る」になる（動く床で 2026-08-26 に踏んだのと同じ罠）
       */
      if (this.obstacles.heroPush !== 0) {
        this.playerX = THREE.MathUtils.clamp(this.playerX + this.obstacles.heroPush, -this.lateralHalf, this.lateralHalf);
        this.input.nudge(this.obstacles.heroPush);
      }
    }

    const lateralVel = dt > 0 ? (this.playerX - this.prevPlayerX) / dt : 0;

    this.player.position.x = this.playerX;
    // 曲がったときに body を傾ける。「走ってる感」への寄与が大きいわりに只
    // 影は位置だけ合わせる。回転は渡さない
    this.playerShadow.position.set(this.playerX, 0, this.player.position.z);
    this.player.rotation.z = THREE.MathUtils.clamp(-lateralVel * 0.045, -0.28, 0.28);
    this.player.rotation.y = THREE.MathUtils.clamp(lateralVel * 0.05, -0.35, 0.35);

    this.material.uniforms.uTime.value = this.time;
    this.crowd.material.uniforms.uTime.value = this.time;
    /*
     * ★**殴り合っているあいだだけ腕を振る**（2026-09-14・本人指定）。
     * ★**急に切り替えない。** 0.12秒ほどかけて混ぜる ―― 壁に着いた瞬間に
     * 全員の腕がパチンと切り替わると、**群れが一斉に同じ動きをする不気味さ**が出る。
     * 相手が誰か（ボスか社員か道中の一団か）は問わない。**`holding` ＝ 止まって殴っている**
     */
    const wantPunch = this.boss.holding ? 1 : 0;
    this.punch += (wantPunch - this.punch) * Math.min(1, dt * 8);
    this.material.uniforms.uPunch.value = this.punch;
    this.crowd.material.uniforms.uPunch.value = this.punch;
    // ゲートは crowd より先。解決したその場で人数が変わり、同じフレームから湧き始める
    /*
     * ★**ボス戦中もここを通す**（2026-08-28）。`BOSS` は「走行が止まっている RUN」で、
     * ボスと HUD だけが動く。**湧かせる側（ゲート・障害物・拾い物・社員）は止める** ——
     * `distance` が凍るので放っておいても湧かないが、
     * **止めないと社員が輪を張ったまま横に立ち続けて削り続ける**（速度比 0.62 で振り切れる前提が崩れる）
     */
    /*
     * ★**CLEAR もここを通す**（2026-09-06）。勝ったあとの凱旋は「走行が戻った RUN」で、
     * **倒したボスが後ろへ流れていく**ためにはボスの更新が要る（止めると横で固まったまま滑る）
     */
    if (this.state === 'RUN' || this.state === 'BOSS' || this.state === 'CLEAR') {
      if (this.state === 'RUN') {
        this.gates.update(dt, this.distance, this.playerX, this.crowd.count, this.lateralHalf, this.crowd.over);
        this.obstacles.update(dt, this.distance, this.crowd, this.playerX);
        this.pickups.update(dt, this.distance, this.crowd, this.playerX);
      }
      const before: Big = this.crowd.big;
      const bossLoss = this.boss.update(dt, this.distance, this.crowd, this.playerX);
      if (bossLoss > 0 && !this.bossPopFrom) this.bossPopFrom = before;
      /*
       * ★**溜めてから出す**（2026-08-28）。相殺は毎フレーム走るので、
       * そのまま出すと 1秒に60回の点滅と連射音になる。社員の騒音と同じ作法。
       * ★**壁で殴り合っているあいだは `flash` を使わない** ——
       * 1.8秒ぶん光り続けると画面が白く飛んで、減っているのが逆に読めなくなる。
       * 代わりに**小さく揺らす**（＝ぽこぽこ殴り合っている手触り）
       */
      this.bossPopN += bossLoss;
      this.bossPopT += dt;
      if (this.bossPopN > 0 && this.bossPopT >= 0.18) {
        // ★理系用で桁を奪われたときは、奪われた本当の人数を出す（1対1の数だけだと「−25」に見える）
        const from = this.bossPopFrom;
        const digits = this.crowd.digitHit && from && (from.over > 0 || this.crowd.over > 0 || from.n - this.crowd.count > this.bossPopN);
        this.juice.popCount(this.playerX, -this.bossPopN, digits && from ? fmtDiff(from, this.crowd.big) : undefined);
        this.audio.leave();
        if (this.boss.holding) {
          this.rig.pulse(0.5);
          /*
           * ★**「ぽかぽか」の煙**（2026-09-06・本人指定）。
           * ★**ポップの間引き（0.18秒）に相乗りする。** 毎フレーム出すと 1秒に60回で
           * 画面が白く埋まり、群衆も HP バーも読めなくなる（ストロボと同じ失敗）
           */
          /*
           * ★★**煙を「両側」から出す**（2026-09-11・本人指定
           * 「実際に闘っているなーーっていう感じを出すのが本質」）。
           *
           * 前は**こちら側（相手の 1.4m 手前）にしか出ていなかった**ので、
           * 絵としては「群れが煙を出している」で、**ぶつかり合いに見えていなかった**。
           * ★**1回ごとに手前と相手側を交互**にするだけ。新しい形は足していない
           * （§15 の語彙予算が 8レベルで上限7に張り付いているので、**足せない**）。
           * 交互なのは、同時に2発出すと 0.18秒ごとに6個で画面が埋まるため
           */
          this.brawlSide ^= 1;
          this.puffs.burst(
            this.playerX + (Math.random() - 0.5) * 3.4,
            0.9,
            this.boss.group.position.z + (this.brawlSide ? 2.2 : 0.2),
            3,
          );
        }
        else this.juice.flash(0.7);
        this.bossPopN = 0;
        this.bossPopT = 0;
        this.bossPopFrom = null;
      }
      this.hud.setBoss(this.boss.active ? this.boss.hp : null);

      /*
       * ★**壁の出入り**（2026-08-28）。走行を止めるのはここ1か所。
       * `RUN` の移動ブロックは `RUN || FINISH` のままなので、
       * `BOSS` に入った瞬間に `distance` も入力も自然に凍る
       */
      if (this.state === 'RUN' && this.boss.holding) this.setState('BOSS');
      else if (this.state === 'BOSS' && !this.boss.holding) this.setState('RUN');

      // ★**削り切れずに負けた。** 止まったまま固まらせないため、その場で終わらせる
      if (this.boss.lost) {
        /*
         * ★**削った分は次の挑戦に持ち越す**（2026-09-06・本人指定）。
         * 「1回目で半分削った → 2回目はその半分から始まる」。
         * 走行はやり直しになるが、**ボスだけは前回の続き**になる
         */
        /*
         * ★**保存するのはボス回だけ**（2026-09-11）。9/7 に道中の一団でも負けられるように
         * なったので、**非ボス回でも `bosshp:<lv>` に書いていた**。読むのは `Boss.advance()` の
         * `isBoss` 側だけなので実害は出ていなかったが、**読み手のいない保存**は
         * 「死に設定」そのもので、あとで誰かが読むと道中の一団の残量がボスの初期値になる
         */
        /*
         * ★**2026-09-12 に `isBossNow` へ直した**（検品 9/12 の指摘）。
         * `bossAt !== null` は**レベル単位**の判定で、「いま負けた相手がボスか」ではない。
         * 検品は「ボス回の道中に一団を置いた瞬間に顕在化する」と書いていたが、
         * ★**同じ日に社員を道中の spot にしたので、その瞬間が実際に来た** ——
         * 直さなければ、ボス回で社員に負けた残量が `bosshp:<lv>` に入り、
         * 次の挑戦で**ボスの初期 HP として読まれていた**
         */
        if (this.boss.isBossNow) platform.save(this.carryKey, Math.max(0, Math.ceil(this.boss.hp)));
        this.showResult();
        return;
      }

      if (this.state === 'BOSS') {
        // ボス戦中は社員を止める（上のコメントの理由）。音と振動も切る
        this.audio.noise(0);
        this.rig.shake = 0;
        this.crowd.update(dt, this.playerX);
        this.scraps.update(dt);
        /*
         * ★★**煙が出ていなかった原因はここ**（2026-09-06 夜に特定）。
         * 本人「**ぽかぽかみたいな煙のエフェクトがないな**」——**バグだった。**
         *
         * `burst()` は毎回呼ばれていたのに、`update()` は下の共通部にしか無く、
         * **この早期 return が道連れにしていた**（＝ 生きている煙が1フレームも進まず、
         * `mesh.count` が 0 のまま）。つまり**殴り合っている最中だけ煙が止まる**という、
         * いちばん要る場面だけ消える形になっていた。
         *
         * ★**教訓: 「止める」ために早期 return を置いた場所は、その下の全部を道連れにする。**
         * 止めたいのは**湧かせる側**（ゲート・障害物・社員）だけで、
         * **見せる側**（煙・紙片・数字・カメラ）は必ず動かし続ける
         */
        this.puffs.update(dt);
        this.juice.update(dt, this.rig.camera, this.viewW, this.viewH);
        this.rig.update(dt, this.playerX, this.crowd.visualRadiusX, this.crowd.visualRadiusZ, false);
        this.hud.update(dt, this.distance, this.input.touched, this.crowd.count, this.crowd.drawn, this.spec.length, this.crowd.over);
        return;
      }

      /*
       * ★**2026-09-12: 社員の「騒音の輪」を廃止した**（本人指定）。
       *
       * 社員は `Boss` の spot（`kind: 'syain'`）になり、**一団と完全に同じロジック**で
       * 止まって殴り合う。だからここに社員専用の更新はもう無い。
       * それに伴って消えたもの: 騒音の音量（`audio.noise`）と、距離で揺れる画面。
       * ★**§4-D の「逃げる快感」と §5 のチェック項目を意図的に覚している**
       * （PROGRESS.md の該当箇所も同日に書き換えた）
       */
      if (this.state === 'CLEAR') this.updateClear(dt);
      else this.rig.shake = 0;
    }
    // 聞き取りの場（§4-E）。壇は「走行距離 length + approach の地点」に立っている
    const stairsZ = this.distance - (this.spec.length + CFG.level.approach);
    this.rig.setFinish(stairsZ);
    // ゴールが近づいたら壇が見えてくる。フォグの中からせり上がってくるのが「あと少し」になる
    // ボス回に壇は無い（広場がゴール）。出すと**広場の奥に立って見える**
    this.stairs.visible = this.boss.bossAt === null && this.distance > this.spec.length - 80;
    if (this.state === 'RUN') this.stairs.update(dt, stairsZ);
    if (this.state === 'FINISH') {
      const spent = this.stairs.update(dt, stairsZ);
      if (spent > 0) {
        this.crowd.remove(spent);
        // 湧きの tick とは別の音にする。ここは「増える」ではなく「払う」場面（§4-E）
        this.audio.pay();
      }
      // 最上段まで届いたら、主人公が登りきってスリッパを掲げる
      // （スリッパが意味を持つのはゲーム中でここ1回だけ・§4-E）
      const won = this.stairs.doorOpened;
      this.climb += ((won ? 1 : 0) - this.climb) * Math.min(1, dt * 2.2);
      const topY = CFG.stairs.cost.length * CFG.stairs.rise;
      const topZ = stairsZ - (CFG.stairs.cost.length - 1) * CFG.stairs.depth;
      this.player.position.y = topY * ease(this.climb);
      this.player.position.z = topZ * ease(this.climb);
      this.player.position.x = this.playerX * (1 - ease(this.climb));
      // 登り切ってから掲げる。同時にやると何が起きたか読めない
      // ★扉まで届かなくても、払い終わったら掲げる（2026-09-16・お祝いに勝ち負けを出さない）
      this.raise += ((won ? (this.climb > 0.85 ? 1 : 0) : (this.stairs.done ? 1 : 0)) - this.raise) * Math.min(1, dt * 3.2);
      this.material.uniforms.uRaise.value = this.raise;
      /*
       * ★★**払い終わったら、すぐリザルトにしない。お祝いを挟む**（2026-09-16・本人指定）。
       * 「数をバーンと出して、紙吹雪。みんなで万歳。扉も開いたらさらに豪華」
       */
      if (this.stairs.settled && this.celebrateT < 0) {
        if (this.witnesses <= 0) this.showResult();
        else this.beginCelebrate();
      }
      if (this.celebrateT >= 0) this.updateCelebrate(dt);
    }
    this.crowd.update(dt, this.playerX);
    this.scraps.update(dt);
    /*
     * ★**道の先の広い場所**（2026-09-06・本人指定）。壁と縁石がボスの手前で外へ逃げる。
     * **場面の切り替えではない。** 走っていくと道がそのまま広がるだけなので、
     * ここは `distance` からボスの相対位置を出して `Course` に渡すだけで済む
     */
    const bossAt = this.boss.bossAt;
    const bossZ = bossAt === null ? null : this.distance - bossAt;
    if (bossZ !== null && !this.openCleared && bossZ >= -CFG.boss.open.from) {
      this.openCleared = true;
      // 打ち止めより先に作られてしまった、まだ決着していないゲートを引き上げる
      this.gates.clearUnresolved();
    }
    // ★橋に乗ったらボスが収まるまで引く（`CameraRig.setBoss`）
    this.rig.setBoss(bossZ !== null && bossZ >= -CFG.boss.yard.bridgeFrom, this.boss.figure.height);
    if (bossZ === null) this.yard.hide();
    else this.yard.place(bossZ);
    this.puffs.update(dt);
    this.course.update(this.distance, bossZ);
    // 群れが太るほど横に動ける幅は狭くなる。ただしゲートを選べなくなる手前で止める
    /*
     * 群れが太るほど横に動ける幅は狭くなる。ただしゲートを選べなくなる手前で止める。
     * ★**2026-08-28: 同じ値をゲートにも渡す。**
     * ここだけで持っていたせいで、ゲートは「プレイヤーがどこまで行けるか」を
     * 知らないまま枠を置いていた ＝ 届かない枠が本番に出た
     */
    const r = this.crowd.visualRadiusX;
    this.lateralHalf = lateralHalfWidth(r);
    this.input.setHalfWidth(this.lateralHalf);
    /*
     * ★**壇の画に寄せるのは「壇がある回」だけ**（2026-09-06）。
     * 以前は `state !== 'RUN'` だったので、**壇の無いボス回**でもリザルトに入った瞬間に
     * カメラが「壇の正面」へ動き出していた（壇は 480m 先に立っていないので、
     * 誰もいない空間を正面から見る画になる）。凱旋（CLEAR）でも同じことが起きる
     */
    const hasStairs = this.boss.bossAt === null;
    this.rig.update(dt, this.playerX, r, this.crowd.visualRadiusZ, hasStairs && this.state !== 'RUN');
    /*
     * ★★**ゴールでは人数を減らして見せない**（2026-09-16）。壇を登る味方は `crowd` から抜くので
     * `crowd.count` は減っていくが、**HUD は連れてきた人数のまま**にする。
     * 前は数字がみるみる 0 へ落ちて「全滅した」ように見えていた（本人「gameover 演出が出ているみたい」）
     */
    const atGoal = this.boss.bossAt === null && this.witnesses > 0;
    const shown = atGoal ? this.witnesses : this.crowd.count;
    const shownOver = atGoal ? this.witnessesOver : this.crowd.over;
    this.hud.update(dt, this.distance, this.input.touched, shown, this.crowd.drawn, this.spec.length, shownOver);
    this.juice.update(dt, this.rig.camera, this.viewW, this.viewH);
  }

  /** ★お祝いを始める（2026-09-16） */
  private beginCelebrate(): void {
    this.celebrateT = 0;
    this.celebrateDoor = this.stairs.doorOpened;
    const prev = this.bestLog();
    const now = bigLog(this.witnesses, this.witnessesOver);
    this.celebrate.show(this.witnesses, this.celebrateDoor, prev > -Infinity && now > prev, this.witnessesOver);
    this.audio.fanfare();
    if (this.celebrateDoor) this.audio.gain();
    this.rig.pulse(0.8);
  }

  /** ★お祝いの間。**万歳を混ぜ、紙吹雪を撒き、時間が来たらリザルト** */
  private updateCelebrate(dt: number): void {
    this.celebrateT += dt;
    this.cheer += (1 - this.cheer) * Math.min(1, dt * 6);
    this.crowd.material.uniforms.uCheer.value = this.cheer;
    this.stairs.setCheer(this.cheer);
    this.clearT2 += dt;
    if (this.clearT2 >= (this.celebrateDoor ? 0.05 : 0.1)) {
      this.clearT2 = 0;
      const r = this.crowd.visualRadiusX + 4;
      this.scraps.spawn((Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * 6);
    }
    if (this.celebrateT >= (this.celebrateDoor ? CFG.stairs.partyDoor : CFG.stairs.party)) {
      this.celebrate.hide();
      this.showResult();
    }
  }

  /** ★ホーム（＝タイトル）を出す。**ステージは組んだまま止めておく**（背景に廊下と主人公が見える） */
  private showHome(level: number): void {
    this.enter(level, false);
    this.material.uniforms.uRaise.value = 1;
    this.crowd.material.uniforms.uRaise.value = 1;
    this.home.show(this.homeData());
  }

  private homeData() {
    return {
      level: this.level,
      maxLevel: Math.min(CFG.levels.length - 1, this.maxLevel),
      levels: CFG.levels.length,
      coins: this.totalCoins,
      canShop: this.shopList().some((s) => s.can),
      mode: this.mode,
      fresh: this.maxLevel === 0 && this.level === 0,
      muted: this.audio.isMuted,
    };
  }

  /**
   * ★**モードを変える**（2026-09-20）。
   * ★**その場でステージを組み直す**（`enter`）―― 数字だけの違いでも
   * ゲートの並びは種から作り直しになるので、**選んだ瞬間に反映させないと
   * 「選んだのに前のモードで走り出す」**という一番たちの悪い形になる。
   * ★**進捗（`maxLevel`・コイン・スリッパ）はモードで分けない。** 分けると
   * 「ハードで遊んだらスリッパが消えた」になる（本人の指定は「数字だけいじる」）
   */
  private setMode(mode: GameMode): void {
    if (!MODES[mode].ready || mode === this.mode) return;
    this.mode = mode;
    platform.save('mode', mode);
    /*
     * ★**持ち越しと自己ベストはモードごとに別キー**（`modeKey`）なので、
     * ここで消す必要はない。**ノーマルで削った 300 がハードの HP から引かれることはない**
     */
    this.showHome(this.level);
  }

  private openShop(from: 'home' | 'result'): void {
    this.shopFrom = from;
    // ★言い値は開くたびに変わる
    this.iinePrice = rollIine();
    // ホームの題字と重ならないように隠す（戻るときに出し直す）
    if (from === 'home') this.home.hide();
    this.shop.show(this.shopList(), this.totalCoins);
  }

  private closeShop(): void {
    this.audio.stamp();
    if (this.shopFrom === 'home') {
      this.shop.hide(true);
      this.home.show(this.homeData());
    } else {
      this.shop.hide();
      this.result.refresh(this.totalCoins, this.shopList().some((s) => s.can));
    }
  }

  private onResize = (): void => {
    const w = Math.max(1, this.host.clientWidth || innerWidth || 0);
    const h = Math.max(1, this.host.clientHeight || innerHeight || 0);
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w;
    this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  };

  /** ゲート通過（§4-C）。人数の反映・数字ポップ・SE をここ1箇所に集約する */
  private onGate = (r: GateResult): void => {
    this.crowd.setBig(r.afterBig);
    const delta = r.after - r.before;
    // ★10³⁰⁰ を越えた人数どうしは `after − before` が 0 になるので、向きと書き方は桁で決める
    const up = cmpBig(r.afterBig, r.beforeBig) >= 0;
    const big = r.afterBig.over > 0 || r.beforeBig.over > 0;
    this.juice.popCount(r.x, big ? (up ? 1 : -1) : delta, big ? fmtDiff(r.afterBig, r.beforeBig) : undefined);
    if (up) {
      this.audio.gain();
    } else {
      this.audio.loss();
      this.juice.flash(0.55);
    }
    const c = CFG.camera;
    this.rig.pulse(c.gateShakeBase + Math.abs(delta) * c.gateShakePerDelta);
    // 通過の瞬間に紙片が舞う（§4-I）。増減幅が大きいほど少し多く飛ばす
    const g = CFG.gate;
    const scrapCount = Math.min(g.scrapMax, g.scrapBase + Math.round(Math.abs(delta) * g.scrapPerDelta));
    for (let i = 0; i < scrapCount; i++) this.scraps.spawn(r.x, 0);
  };

  /** 障害物・人事部で減った（§4-D）。減るのが「痛い」と分かることが Phase 3 の合格基準 */
  /**
   * ★★**2026-09-12: 障害物の「あとから来るダメージ演出」を全部消した**（本人指定）。
   *
   * > **本人:「当たり判定を『当たったところが紙になって崩れていく』って感じで表現してくれたんですね？？
   * > これは素晴らしい。ただ、それに加えて赤文字で数字が出てさらにダメージを食らったみたいな音が
   * > 後から追加されて、なんかまたダメージ食らったんか？？と直感とは反する結果になっています」**
   *
   * ★**原因は `ObstacleField` の通知が遅延していたこと**―― `!o.reported && z > 1.5`、
   * つまり**障害物を通り過ぎてから**被害をまとめて 1 回鳴らしていた。
   * 同じ 1 回の被害が**接触時（紙屑）**と**通過後（数字＋音＋光）**の 2 回に分かれていた。
   *
   * ★**残したのは紙屑だけ**。`crowd.onLeave` が**離脱した 1 人ごとに、その人がいた座標で**
   * リアルタイムに出しているので、**どこが当たったかが絵で分かる**。
   * ★これは**とげ・ハンマー・判子・人事部・穴・柵・幅寄せ・窓口・シュレッダー全部**に効く
   * （`obstacles.onHit` の受け口はここ 1 つだけなので）。
   *
   * ★**ゲートの `+30` と、一団・社員の殴り合いは触っていない**。
   * あちらは「通り過ぎてから」ではなく**その場で**鳴っていて、直感と合っている。
   *
   * ★**通知自体は残す**（`tools/phase3-sim.ts` が被害の測定に使っている）。
   * 受け取って何もしない形にして、**測定器を壊さずに演出だけ消す**
   */
  private onObstacle = (): void => {
    /*
     * ★★**2026-09-15: 音を戻した**（本人「**当たったなあっていう効果音があればいい**」）。
     * ★**前に消したのは「通り過ぎてから鳴っていた」から**で、音が悪かったわけではない。
     * いまは `ObstacleField` が**触れた瞬間に1回だけ決着**するので、**鳴る瞬間と当たる瞬間が一致する**。
     * ★**止めない**（本人「**当たった瞬間に止めるのはやめて、気持ち悪いから**」）。数字も出さない。
     */
    this.audio.loss();
  };

  /**
   * ★**勝った。ここから達成感の演出**（2026-09-06 夜・本人指定）。
   *
   * 本人の言葉:「**倒した後、城の門をくぐって「CLEAR」みたいな文字が出るゴール演出が
   * ないと達成感が出ない。モンハンだって、あの音楽と文字が出るからこそ達成感が出る**」。
   *
   * ★**新しい場面の仕組みは、ここでも作らない**（§18・§19 と同じ）。
   * 走行を作り直すのではなく、**走行をもう一度動かして城の門まで歩かせるだけ**。
   * 世界を動かすのは `distance` 1つなので、壁も前庭も城も勝手に近づいてくる。
   * ★**主人公だけを z へ動かしてはいけない**（`Stairs` はそれをやっているが、
   * あちらは群れを払い終えた後の場面。ここは**群れごと凱旋する**ので、群れが置き去りになる）
   */
  private beginClear(): void {
    if (this.state === 'CLEAR' || this.state === 'RESULT') return;
    this.setState('CLEAR');
    this.clearPhase = 0;
    this.clearT = 0;
    this.clearT2 = 0;
    this.clearBeat = 0;
    this.marchV = 0;
    this.audio.noise(0);
    this.rig.shake = 0;
    // 決着の一撃。**煙と紙片を、殴り合いの1回ぶんより大きく出す**（ここが山だと分かるように）
    this.rig.pulse(1.1);
    this.puffs.burst(this.playerX, 1.2, this.boss.group.position.z + 1.4, 12);
    for (let i = 0; i < 14; i++) this.scraps.spawn(this.playerX + (Math.random() - 0.5) * 6, 0);
  }

  /**
   * 凱旋。**間 → 歩く → くぐる → 判子 → リザルト**の順で進める。
   * ★**順番そのものが演出**（本人の言う「達成感」）なので、
   * 1つでも飛ばすと「倒したら紙が出た」だけに戻る
   */
  private updateClear(dt: number): void {
    const C = CFG.boss.clear;
    this.clearT += dt;

    // ── 0. 間（ま）。**勝った瞬間に次を出さない。** 倒れたことに気づく時間 ──
    if (this.clearPhase === 0) {
      if (this.clearT >= C.pause) { this.clearPhase = 1; this.clearT = 0; }
      return;
    }

    // ── 1. 城の門まで歩く ──
    if (this.clearPhase === 1) {
      const at = this.boss.bossAt;
      if (at === null) { this.showResult(); return; }
      /*
       * ★**門の場所は `BossYard` にだけ書いてある**（`gateZ`）。
       * ここで `castleBeyond` から組み直すと、城を動かした日に**歩く先だけ古い場所**に残る
       * （§18 で `bossAt` を1つに集約したのと同じ理由）。
       *
       * ★**群れの奥行きぶん、手前で止める**（2026-09-06 夜・実機で直した）。
       * 門の 1.8m 手前で止めたら、**後ろに続く群れが城の壁の中に埋まり**、
       * カメラも壁に鼻を突きつけて**画面が一色になった**（大群ほどひどい）。
       * 群れは人数で深くなるので、**固定の距離では足りない** —— `visualRadiusZ` を足す。
       * これで「城の門の前に、全員で立っている」画になる
       */
      const target = at - this.yard.gateZ - C.standoff - this.crowd.visualRadiusZ;
      // 中央へ寄せながら歩く。門は道の真ん中に建っている
      this.playerX += (0 - this.playerX) * Math.min(1, dt * C.centerPull);
      this.marchV = Math.min(CFG.runSpeed * C.marchScale, this.marchV + C.accel * dt);
      /*
       * ★**紙吹雪**（§5 の「気持ちよさ」チェックリストにある語彙）。
       * 新しい部品は作らず、**離脱の紙片（`Scraps`）をそのまま撒く**。
       * この世界の紙は「人が減った証」だったので、勝って歩く場面で撒くと意味が反転して効く
       */
      this.clearT2 += dt;
      if (this.clearT2 >= C.confettiEvery) {
        this.clearT2 = 0;
        const r = this.crowd.visualRadiusX + 2.5;
        this.scraps.spawn(this.playerX + (Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * 4);
        this.scraps.spawn(this.playerX + (Math.random() - 0.5) * r * 2, (Math.random() - 0.5) * 4);
      }
      const left = target - this.distance;
      if (left <= 0) {
        this.clearPhase = 2;
        this.clearT = 0;
        this.clearBeat = 0;
        // くぐった。**扉の音は壇の最上段用に作ってあるものをそのまま使う**（新しい音を増やさない）
        this.audio.door();
        this.clearUi.show();
        return;
      }
      this.distance += Math.min(left, this.marchV * dt);
      return;
    }

    // ── 2. 判子。**音は絵に合わせて後から置く**（先に鳴らすと何の音か分からない） ──
    if (this.clearPhase === 2) {
      if (this.clearBeat === 0 && this.clearT >= C.stampAt) { this.audio.stamp(); this.clearBeat = 1; }
      // ★判子が着いてからファンファーレ。**音が無いと判子はただの絵**（本人「あの音楽があるから達成感が出る」）
      if (this.clearBeat === 1 && this.clearT >= C.chimeAt) { this.audio.fanfare(); this.clearBeat = 2; }
      if (this.clearT >= C.hold) {
        this.clearPhase = 3;
        /*
         * ★**判子を引いてからリザルトを出す**（2026-09-06 夜・実機で発見）。
         * 消し忘れると、**白い帯と判子が敷かれたままリザルトの紙が重なる**（画面が2枚重ね）。
         * `Clear` 側に退場のフェードを付けてあるので、ここは呼ぶだけでよい
         */
        this.clearUi.hide();
        this.showResult();
      }
    }
  }

  /** §4-E: 到達段でコイン決定。連れてきた人数そのものも少しだけ効かせる */
  /**
   * ★**保存の読み込み**（2026-09-16）。前の形（ビット `slipperOwn`）が残っていたら**一度だけ**移す。
   * ★前の「金・銀・漆黒」は色を掛けただけの品で、60種の図鑑には無い。**払ったコインをそのまま返す**
   */
  private loadSlippers(): void {
    const ids = platform.load<string[] | null>('slipperIds', null);
    if (ids === null) {
      const mask = platform.load('slipperOwn', 1);
      const refund = [0, 300, 900, 2400].reduce((sum, cost, i) => sum + ((mask >> i) & 1 ? cost : 0), 0);
      if (refund > 0) {
        this.totalCoins += refund;
        platform.save('coins', this.totalCoins);
      }
      platform.save('slipperIds', [FIRST_SLIPPER]);
      platform.save('slipperWearId', FIRST_SLIPPER);
    } else {
      this.owned = new Set([FIRST_SLIPPER, ...ids.filter((id) => SLIPPERS.some((x) => x.id === id))]);
    }
    const wear = platform.load('slipperWearId', FIRST_SLIPPER);
    this.wearId = this.owned.has(wear) ? wear : FIRST_SLIPPER;
  }

  private priceOf(id: string): number {
    const it = slipperById(id);
    return it.iine ? this.iinePrice : it.price;
  }

  /**
   * ★**下駄箱で押した**。持っていなければ買い、持っていれば履き替える（確認は `Shop` が出す）。
   * ★「買う」と「履く」を1本にまとめる理由: 分けると**買った直後に履かれていない**状態が生まれる
   */
  private pickSlipper(id: string): void {
    if (!SLIPPERS.some((x) => x.id === id)) return;
    if (!this.owned.has(id)) {
      const cost = this.priceOf(id);
      if (this.totalCoins < cost) {
        this.audio.hit();
        return;
      }
      this.totalCoins -= cost;
      this.owned.add(id);
      platform.save('coins', this.totalCoins);
      platform.save('slipperIds', [...this.owned]);
      this.hud.setCoins(this.totalCoins);
      this.audio.pay();
      this.audio.fanfare();
    } else {
      this.audio.stamp();
    }
    this.wearId = id;
    platform.save('slipperWearId', id);
    this.applySlipper();
    this.shop.render(this.shopList(), this.totalCoins);
  }

  /** ★履いているスリッパの絵を、**主人公と、飛んでいく演出の両方**へ。伝説なら光らせる */
  private applySlipper(): void {
    const tex = slipperTexture(this.wearId);
    const u = this.material.uniforms;
    const r = SLOT.heroSlipper;
    u.uSlip.value = tex;
    u.uHasSlip.value = 1;
    (u.uSlipRect.value as THREE.Vector4).set(r.u, r.v, r.w, r.h);
    u.uReAmt.value = 0;
    this.toss.setTexture(tex);
    this.stairs.setSlipper(this.wearId);
    this.glowKind = slipperById(this.wearId).glow;
    this.glow.visible = this.glowKind !== undefined;
    const m = this.glow.material as THREE.SpriteMaterial;
    m.blending = this.glowKind === 'dark' ? THREE.NormalBlending : THREE.AdditiveBlending;
    m.needsUpdate = true;
  }

  /**
   * ★**光の揺らぎ**（毎フレーム）。金は脈打つ・虹は色が回る・漆黒は紫の闇・ホワイトアウトは画面ごと白く飛ばす
   */
  private updateGlow(): void {
    if (!this.glowKind) return;
    const m = this.glow.material as THREE.SpriteMaterial;
    const t = this.time;
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    if (this.glowKind === 'gold') { m.color.setRGB(1, 0.82, 0.35); m.opacity = 0.9; this.glow.scale.setScalar(1.5 * pulse); }
    if (this.glowKind === 'rainbow') { m.color.setHSL((t * 0.35) % 1, 0.9, 0.6); m.opacity = 0.95; this.glow.scale.setScalar(1.6 * pulse); }
    if (this.glowKind === 'dark') { m.color.setRGB(0.35, 0.12, 0.55); m.opacity = 0.75; this.glow.scale.setScalar(1.5 * pulse); }
    // ★光りすぎて見えない（本人「光りすぎて見えない」）。スリッパが白い光の玉に埋もれる大きさ
    if (this.glowKind === 'white') { m.color.setRGB(1, 1, 0.94); m.opacity = 1; this.glow.scale.setScalar(3.4 + Math.sin(t * 6) * 0.25); }
  }

  private shopList(): ShopItem[] {
    return SLIPPERS.map((s) => {
      const owned = this.owned.has(s.id);
      const price = this.priceOf(s.id);
      return {
        id: s.id,
        design: s.design,
        name: s.name,
        colorName: s.colorName,
        img: slipperUrl(s.id),
        price,
        owned,
        on: s.id === this.wearId,
        can: !owned && this.totalCoins >= price,
        glow: s.glow !== undefined,
        iine: s.iine === true,
        blurb: s.blurb,
      };
    });
  }

  private showResult(): void {
    if (this.state === 'RESULT') return;
    this.setState('RESULT');
    this.celebrateT = -1;
    const bossRun = this.boss.bossAt !== null;
    /*
     * ★★**勝ち負けを人数 0 で決めない**（2026-09-16）。
     * 前は `crowd.count <= 0` を負けにしていたが、**非ボス回は壇へ全員払うと crowd.count が 0 になる**。
     * つまり**ゴールまで走り切って全員が壇に上がった回に、スリッパがゴミ箱へ飛んでいた**
     * （本人「今 gameover 演出が出ているみたい」の正体の1つ）。
     * ★ボス回は「倒したか」、非ボス回は「ゴールに1人でも連れてきたか」で決める
     */
    const won = bossRun ? this.boss.broken : this.witnesses > 0;
    const count = bossRun ? this.crowd.count : this.witnesses;
    const door = !bossRun && this.stairs.doorOpened;
    const R = CFG.reward;
    // ★コインは「集めた人数の平方根」。段の2乗だった前の式と、ルーレット（平均×2.8前後）込みで同じくらいになる値
    const base = won
      // ★コインに効く人数は 99,999 で頭打ち（理系用は 10³⁰⁰ まで増えるので、そのままだとコインが壊れる）
      ? Math.round(R.perSqrt * Math.sqrt(Math.min(count, MAX_CROWD))) + (door ? R.door : 0) + (bossRun ? R.boss : 0) + this.picked
      : this.picked;
    this.lastBase = base;
    this.lastWon = won;
    this.totalCoins = platform.load('coins', 0) + base;
    platform.save('coins', this.totalCoins);
    this.hud.setCoins(this.totalCoins);
    const bestKey = `bestCount:${this.modeKey}${this.level}`;
    // ★自己ベストは桁で比べる（理系用は 10³⁰⁰ を越える）。`bestCount` は今までどおり 10³⁰⁰ までの数も残す
    const countOver = bossRun ? this.crowd.over : this.witnessesOver;
    const prevLog = this.bestLog();
    const nowLog = bigLog(count, countOver);
    const isBest = won && prevLog > -Infinity && nowLog > prevLog;
    if (won && nowLog > prevLog) {
      platform.save(bestKey, count);
      platform.save(`bestLog:${this.modeKey}${this.level}`, nowLog);
    }
    if (won) {
      this.maxLevel = Math.min(CFG.levels.length - 1, Math.max(this.maxLevel, this.level + 1));
      platform.save('maxLevel', this.maxLevel);
    }
    const data: ResultData = {
      won, boss: bossRun, count, countOver,
      target: bossRun ? null : this.stairs.target,
      door, base, picked: this.picked,
      total: this.totalCoins,
      level: this.level,
      levels: CFG.levels.length,
      best: isBest,
      // ★コインを足したあとに見る。先に見ると、いま稼いだぶんで買えるものが光らない
      canShop: this.shopList().some((x) => x.can),
    };
    const needle = slipperUrl(this.wearId);
    /*
     * ★★**負けたときだけ、スリッパがゴミ箱へ飛んでいく**（2026-09-14・本人指定）。
     * ★ボス戦の敗北は「1人残った状態」で止まる（`Boss.brawl` が最後の1人を残す）ので、人数では判定しない
     */
    if (!won) {
      this.audio.slipperGone();
      // ★光も一緒に消す（手元にスリッパが無いのに光だけ残る）
      this.glow.visible = false;
      // ★手からスリッパを抜く。飛んでいくものと手元のものが二重にならないように
      this.heroGeoFull = this.player.geometry;
      this.player.geometry = this.heroGeoEmpty;
      this.toss.start(this.playerX, this.player.position.z, () => this.result.show(data, needle));
    } else {
      this.result.show(data, needle);
    }
  }

  /** ★このレベルの自己ベストの桁（log₁₀）。桁の記録が無い古い保存は `bestCount` から作る。記録なしは −∞ */
  private bestLog(): number {
    const L = platform.load(`bestLog:${this.modeKey}${this.level}`, null as number | null);
    if (typeof L === 'number') return L;
    return bigLog(platform.load(`bestCount:${this.modeKey}${this.level}`, 0));
  }

  /**
   * ★**持ち越し HP の保存キー**（2026-09-06）。**レベルごとに別にする。**
   * 共通キーにすると Lv5 で削った分が Lv10 のボスに持ち越されて、別人が半分死んだ状態で出る
   */
  private get carryKey(): string {
    return `bosshp:${this.modeKey}${this.level}`;
  }

  /**
   * ★**セーブキーのモード部分**（2026-09-20）。**ノーマルだけ空にする。**
   * 空にしないと、これまで遊んだ人の持ち越しと自己ベストが全部消えて見える。
   * ★**記録はモードごとに別**にする ―― ハードの自己ベストがノーマルの数字だと、
   * 「縮まらないベスト」になって記録の意味が無くなる
   */
  private get modeKey(): string {
    return this.mode === 'normal' ? '' : `${this.mode}:`;
  }

  /** 今のレベルの設定（§9 / CFG.levels） */
  private get spec(): LevelSpec {
    return resolveLevel(this.level, this.mode);
  }

  /**
   * レベルを頭から始める。**やり直しも次のレベルもここ1本に集約する。**
   * 別々に書くと「リトライだけリセットが漏れる」が必ず起きる（Stairs で実際に起きた）。
   * @param index CFG.levels の添字。範囲外は 1本目へ回す
   */
  /** @param run false ならステージを組むだけで走らせない（ホームの背景用・2026-09-16） */
  private enter(index: number, run = true): void {
    this.level = ((index % CFG.levels.length) + CFG.levels.length) % CFG.levels.length;
    platform.save('level', this.level);
    // ★**ここで `maxLevel` を上げない**（2026-09-25）。前は無条件に上げていたので、
    // GAME OVER の「つぎのステージへ」から入るだけで解放されていた。**解放は `showResult` の `if (won)` だけ**
    const sp = this.spec;

    this.result.hide();
    this.home.hide();
    this.shop.hide();
    this.celebrate.hide();
    this.celebrateT = -1;
    this.cheer = 0;
    this.crowd.material.uniforms.uCheer.value = 0;
    this.crowd.material.uniforms.uRaise.value = 0;
    this.stairs.setCheer(0);
    /*
     * ★★**2026-09-15: 幕が敷かれたままなら「スリッパが戻ってくる」**（本人と決めた形）。
     * 負けたあとの幕は `SlipperToss` が抜かずに残す（リザルトを黒い幕の上に出すため）。
     * `rewind()` は**幕が無ければそのまま `reset()` と同じ**なので、勝って次へ進む回は何も起きない。
     * ★演出の途中でリトライされても必ず消えるのは前と同じ（幕が残ると次の走行が真っ暗になる）
     */
    this.toss.rewind(0, 0);
    // ★スリッパを手に戻す。戻し忘れると**次の走行から手ぶらのまま**になる
    if (this.heroGeoFull) this.player.geometry = this.heroGeoFull;
    this.stairs.hide();
    // ★判子を消す。**残すと、次の走行の頭に「CLEAR」が出たままになる**
    this.clearUi.hide();
    this.clearPhase = 0;
    this.clearT = 0;
    this.marchV = 0;
    // ★区画のつまみを解決してから渡す（`GAMEPLAY.md` §14）。**毎回作り直すので前のレベルの値は残らない**
    const knobs = resolveKnobs(this.level + 1, this.mode);
    /*
     * ★**ボス回は5の倍数だけ**（2026-08-28）。ここを分けないと道中の一団まで走行を止め、
     * バトルリングが1レベルに3回出て「5本ごとにボス」という区切りが消える。
     *
     * ★**ゲートより先に呼ぶ**（2026-09-06）。ゲートの打ち止め位置が `boss.bossAt` を見るため。
     * 順番を戻すと**打ち止めが効かないまま静かに動く**（`bossAt` がまだ null）
     */
    // ★4体目までは `level / 5` がそのまま「何体目のボスか」（Lv5→0 / Lv10→1 / Lv15→2 / Lv20→3）
    this.boss.reset(sp.rivals, (this.level + 1) % 5 === 0, platform.load(this.carryKey, 0), Math.floor(this.level / 5));
    /*
     * ★**ボス回は、広場の手前でゲートを打ち止める**（2026-09-06・本人指定）。
     * 「最後のゲートを通ったら、そこから先はもうゲートが出ない」。
     * ★**障害物と拾い物はゲートが1行決まるたびに置かれる**（`ObstacleField.offer`）ので、
     * ここを止めれば**道連れで止まる**。別に打ち止めを書くと二重管理になる
     */
    const bossAt = this.boss.bossAt;
    const gateStop = bossAt === null
      ? sp.length - CFG.gate.tailClear
      : Math.min(sp.length - CFG.gate.tailClear, bossAt - CFG.boss.open.gateClear);
    // ★数学ボケのときだけ区画を引くレベルを渡す（1 始まり）。ほかのモードは null
    this.gates.reset(sp.start, sp.gateTier, gateStop, sp.minCount, sp.gateGap, knobs.gate,
      this.mode === 'math' ? this.level + 1 : null);
    this.obstacles.reset(sp.obstacles, sp.obstacleFrom, sp.obstacleChance, knobs.obstacle);
    this.openCleared = false;
    // 前の走行の煙を持ち込まない
    this.puffs.clear();
    this.pickups.reset();
    this.picked = 0;
    // ボスの帯にはゲートも障害物も置かない。0.5秒の暗算とボスを重ねない（§4-D と同じ理由）
    // 相殺の帯は ±clashZ(6m) だけ。前後に少し足すが、広くすると
    // **一団3本で走行の1/4が空白になる**（実測でゲートも拾い物も消えた）
    this.gates.reserve(sp.rivals, CFG.boss.clashZ + 6);
    this.hud.setBoss(null);
    this.crowd.departMode = 'leave';
    // ★理系用だけ人数の蓋を外す（2026-09-26）。**人数を入れる前に**差し替える
    this.crowd.cap = this.mode === 'math' ? MATH_MAX : CFG.crowd.maxCount;
    // ★桁を奪うダメージも理系用だけ（ほかのモードは null ＝ ダメージは今までどおり）
    this.crowd.digitHit = MODES[this.mode].digitHit ?? null;
    this.crowd.setCount(sp.start);
    this.distance = 0;
    /*
     * ★**横位置も頭に戻す**（2026-09-06）。`playerX` と `input.targetX` だけ前の走行の値が
     * 残っていたので、**やり直した瞬間に端から走り出す**回があった（凱旋で中央へ寄せる
     * ようにして初めて目に見えた）。ここは「頭から始める」を集める場所なので、ここで戻す
     */
    this.playerX = 0;
    this.prevPlayerX = 0;
    this.input.targetX = 0;
    this.brake = 0;
    this.raise = 0;
    this.climb = 0;
    /*
     * ★**殴っている度合いを戻す**（2026-09-15・検品 `59490ca` の指摘）。
     * `punch` は毎フレーム無条件に更新されるのに、ここで戻していなかった。
     * ボス戦で負けると `boss.holding` が `true` のまま凍り、`punch` は 1.0 に張り付く。
     * 減衰は `dt*8` なので、**次の走行の頭 0.4秒ほど「全員が殴りながら走る」**状態で始まっていた。
     * ★同じ理由で**ゲームオーバー演出の 3.1秒**も主人公が空を殴り続けていた
     */
    this.punch = 0;
    this.player.position.set(0, 0, 0);
    this.witnesses = 0;
    this.material.uniforms.uRaise.value = 0;
    this.applySlipper();
    this.hud.setLevel(this.level, CFG.levels.length);
    this.hud.setCoins(this.totalCoins);

    this.state = 'RESULT';   // setState の同値判定を通すため一度ずらす
    if (!run) { this.setState('TITLE'); return; }
    this.setState('RUN');
    // 書類の1枚（§4-I）。走行は裏で始めたまま、紙が自分で退く。綴じ札で何本目かも出る
    new Intro(this.host, this.level, CFG.levels.length);
  }

  /** 音の入り切り（2026-09-29）。@returns 切ったあとの状態（true ＝ 音なし） */
  private toggleMute(): boolean {
    const m = !this.audio.isMuted;
    this.audio.setMuted(m);
    platform.save('muted', m);
    return m;
  }

  private unlockAudio = (): void => {
    this.audio.unlock();
    // ★最初のタップより前に走行が始まっていたら、ここで BGM を起こす（AudioContext はタップまで作れない）
    if (this.state === 'RUN' || this.state === 'BOSS') this.audio.bgm(true);
    removeEventListener('pointerdown', this.unlockAudio);
    removeEventListener('keydown', this.unlockAudio);
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.audio.noise(0);
      this.audio.suspend();
      platform.gameplayStop();
      this.lastFrame = performance.now();
    } else {
      // ★ホーム・リザルトで隠して戻った場合も音を起こす（走行中だけにすると、戻ったあと無音のまま）
      this.audio.resume();
      if (this.state !== 'RUN' && this.state !== 'BOSS') return;
      this.lastFrame = performance.now();
      platform.gameplayStart();
    }
  };
}

/** ★光の玉（中心が白く、外へ透明）。1回だけ作る */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 減速のイージング。最後だけ急に効かせると「止まった」がはっきり出る */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
