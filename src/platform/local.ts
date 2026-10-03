import type { Platform } from './index';

const PREFIX = 'slipper-run:';

/** ポータルSDKなしの実装。localStorage に保存する（§4-H） */
export class LocalPlatform implements Platform {
  readonly name = 'local';
  private playing = false;

  async init(): Promise<void> {
    // no-op
  }

  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
  }

  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
  }

  loadingProgress(_p: number): void {
    // no-op
  }

  save(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // プライベートモード等。保存できなくてもゲームは続行する
    }
  }

  load<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }
}
