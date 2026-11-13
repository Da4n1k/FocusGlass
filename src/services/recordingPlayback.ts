import type { EEGRecording, EEGRecordingFrame } from './eegRecording';

export type RecordingFrameBatchHandler = (frames: EEGRecordingFrame[]) => void;
export type RecordingProgressHandler = (progress: number) => void;

/** Timer-driven replay which preserves the recording's relative sample timing. */
export class RecordingPlayback {
  private recording: EEGRecording | null = null;
  private frameIndex = 0;
  private speed = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private anchorWallTime = 0;
  private anchorRecordingTime = 0;
  private onFrames: RecordingFrameBatchHandler | null = null;
  private onProgress: RecordingProgressHandler | null = null;
  private onEnded: (() => void) | null = null;

  public load(recording: EEGRecording): void {
    this.clearTimer();
    this.recording = recording;
    this.frameIndex = 0;
  }

  public play(
    speed: number,
    onFrames: RecordingFrameBatchHandler,
    onProgress: RecordingProgressHandler,
    onEnded: () => void
  ): boolean {
    if (!this.recording || this.recording.frames.length === 0) return false;
    if (this.frameIndex >= this.recording.frames.length) this.frameIndex = 0;
    this.speed = Math.max(0.25, Math.min(4, speed));
    this.onFrames = onFrames;
    this.onProgress = onProgress;
    this.onEnded = onEnded;
    this.anchorWallTime = this.now();
    this.anchorRecordingTime = this.recording.frames[this.frameIndex].timestamp;
    this.clearTimer();
    this.tick();
    if (this.recording && this.frameIndex < this.recording.frames.length) {
      this.timer = setInterval(() => this.tick(), 16);
    }
    return true;
  }

  public pause(): void {
    this.clearTimer();
  }

  public stop(): void {
    this.clearTimer();
    this.frameIndex = 0;
    this.onProgress?.(0);
  }

  public seek(progress: number): number {
    this.clearTimer();
    if (!this.recording) return 0;
    const lastIndex = Math.max(0, this.recording.frames.length - 1);
    this.frameIndex = Math.round(Math.max(0, Math.min(1, progress)) * lastIndex);
    const nextProgress = this.getProgress();
    this.onProgress?.(nextProgress);
    return nextProgress;
  }

  public getProgress(): number {
    if (!this.recording || this.recording.frames.length <= 1) return 0;
    return Math.min(1, this.frameIndex / (this.recording.frames.length - 1));
  }

  public getIsLoaded(): boolean {
    return this.recording !== null;
  }

  private tick(): void {
    const recording = this.recording;
    if (!recording) return;
    const targetTime = this.anchorRecordingTime + (this.now() - this.anchorWallTime) * this.speed;
    const due: EEGRecordingFrame[] = [];
    while (
      this.frameIndex < recording.frames.length &&
      recording.frames[this.frameIndex].timestamp <= targetTime + 0.5
    ) {
      due.push(recording.frames[this.frameIndex]);
      this.frameIndex++;
    }
    if (due.length) this.onFrames?.(due);
    this.onProgress?.(this.getProgress());

    if (this.frameIndex >= recording.frames.length) {
      this.clearTimer();
      const ended = this.onEnded;
      this.onEnded = null;
      ended?.();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
