/**
 * Web Audio API Ambient Biofeedback Synthesizer (Аудио-БОС)
 * Generates zero-CPU-overhead looping Paul Kellet 1/f Pink Noise passed through
 * a warm 420 Hz lowpass filter (soft rain/wind texture) modulated by focus deficit.
 */

class AudioBiofeedbackService {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private isInitialized = false;

  private ensureContext(): boolean {
    if (typeof window === 'undefined') return false;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }

    if (!this.isInitialized && this.ctx) {
      const sampleRate = this.ctx.sampleRate;
      const durationSec = 4;
      const length = sampleRate * durationSec;
      const buffer = this.ctx.createBuffer(2, length, sampleRate);

      // Paul Kellet 1/f pink noise filter per stereo channel with smooth loop crossfade
      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          b6 = white * 0.115926;
          data[i] = pink * 0.08;
        }

        // Crossfade 200ms seam so loop wrap has zero audible click
        const fadeSamples = Math.min(Math.floor(sampleRate * 0.2), Math.floor(length / 8));
        for (let i = 0; i < fadeSamples; i++) {
          const alpha = i / fadeSamples;
          data[i] = data[i] * alpha + data[length - fadeSamples + i] * (1 - alpha);
        }
      }

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.7;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start();

      this.sourceNode = src;
      this.gainNode = gain;
      this.isInitialized = true;
    }

    return true;
  }

  /**
   * Call from a user gesture (e.g. toggling Audio-БОС ON) to unlock browser AudioContext
   */
  public unlock(): void {
    if (!this.ensureContext()) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /**
   * Updates target audio volume [0.0 .. 1.0] smoothly without clicks
   */
  public setVolume(normalizedVolume: number, enabled: boolean): void {
    if (!enabled || normalizedVolume <= 0.005) {
      if (this.gainNode && this.ctx) {
        this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
      }
      return;
    }

    if (!this.ensureContext() || !this.ctx || !this.gainNode) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    // Cap maximum ambient loudness at a gentle, non-startling 0.30 gain
    const safeGain = Math.max(0, Math.min(0.30, normalizedVolume * 0.30));
    this.gainNode.gain.setTargetAtTime(safeGain, this.ctx.currentTime, 0.18);
  }

  public stop(): void {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Ignore if already stopped
      }
      this.sourceNode = null;
    }
    this.isInitialized = false;
  }
}

export const audioBiofeedback = new AudioBiofeedbackService();
