/**
 * Filtered pink-noise synthesizer for non-intrusive Audio-БОС feedback.
 * Uses Web Audio API directly so no external audio files are required.
 */
class AudioFeedbackService {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private isEnabled: boolean = false;
  private targetVolume: number = 0;
  private readonly maxMasterGain = 0.16;

  private canUseWebAudio(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('AudioContext' in window || 'webkitAudioContext' in window)
    );
  }

  private ensureGraph(): void {
    if (this.ctx || !this.canUseWebAudio()) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();

    // 2-second seamless stereo pink noise buffer (Paul Kellet's filter)
    const bufferLength = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(2, bufferLength, ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const output = buffer.getChannelData(channel);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;

      for (let i = 0; i < bufferLength; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
        b6 = white * 0.115926;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 620;
    lowpass.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    this.ctx = ctx;
    this.sourceNode = source;
    this.gainNode = gain;
  }

  public sync(enabled: boolean, normalizedVolume: number): void {
    this.isEnabled = enabled;
    this.targetVolume = Math.max(0, Math.min(1, normalizedVolume));

    if (!this.canUseWebAudio()) return;

    if (!enabled) {
      if (this.ctx && this.gainNode) {
        this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
      }
      return;
    }

    this.ensureGraph();
    if (!this.ctx || !this.gainNode) return;

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Autoplay restriction until next user interaction
      });
    }

    const desiredGain = this.targetVolume * this.maxMasterGain;
    this.gainNode.gain.setTargetAtTime(desiredGain, this.ctx.currentTime, 0.15);
  }

  public dispose(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Ignore if already stopped
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.gainNode = null;
  }

  public getState(): { enabled: boolean; targetVolume: number } {
    return { enabled: this.isEnabled, targetVolume: this.targetVolume };
  }
}

export const audioFeedback = new AudioFeedbackService();
