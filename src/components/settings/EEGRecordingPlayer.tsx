import React, { useRef } from 'react';
import { AlertTriangle, FileUp, Pause, Play, RotateCcw, Square, Waves } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassButton } from '../glass/GlassButton';

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

export const EEGRecordingPlayer: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    recording,
    recordingStatus,
    recordingProgress,
    recordingSpeed,
    recordingError,
    loadRecording,
    playRecording,
    pauseRecording,
    stopRecording,
    seekRecording,
    setRecordingSpeed,
    settings,
  } = useFocusStore();

  const isPlaying = recordingStatus === 'playing';
  const canPlay = Boolean(recording) && settings.deviceSource === 'simulator';
  const currentSeconds = recording ? recording.durationSeconds * recordingProgress : 0;

  const openFile = async (file?: File) => {
    if (!file) return;
    try {
      loadRecording(await file.text(), file.name);
    } catch {
      loadRecording('', file.name);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="space-y-4" aria-labelledby="recording-player-title">
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300"><Waves className="h-5 w-5" /></div>
            <div>
              <h3 id="recording-player-title" className="text-sm font-semibold text-white">EEG recording player</h3>
              <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-400">
                Replay clean recordings and real-world interference without a physical headband. Samples run through the same 50 Hz notch, spectral analysis and artifact rejection as live input.
              </p>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,text/csv,application/json,text/plain"
            className="hidden"
            aria-label="Choose EEG recording"
            onChange={(event) => void openFile(event.currentTarget.files?.[0])}
          />
          <GlassButton
            size="sm"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            icon={<FileUp className="h-4 w-4" />}
          >
            Open recording
          </GlassButton>
        </div>

        {recordingError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <span>{recordingError}</span>
          </div>
        )}

        {recording ? (
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white" title={recording.name}>{recording.name}</p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {recording.format.toUpperCase()} · {recording.frames.length.toLocaleString()} samples · {recording.sampleRateHz} Hz · {formatTime(recording.durationSeconds)}
                </p>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${
                isPlaying ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' :
                recordingStatus === 'ended' ? 'border-slate-400/20 bg-white/5 text-slate-300' :
                'border-cyan-400/25 bg-cyan-500/10 text-cyan-200'
              }`}>
                {isPlaying ? 'Playing' : recordingStatus === 'paused' ? 'Paused' : recordingStatus === 'ended' ? 'Finished' : 'Ready'}
              </span>
            </div>

            <div className="space-y-1.5">
              <input
                aria-label="Playback position"
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(recordingProgress * 1000)}
                disabled={isPlaying}
                onChange={(event) => seekRecording(Number(event.currentTarget.value) / 1000)}
                className="w-full accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-45"
              />
              <div className="flex justify-between font-mono text-[10px] text-slate-500">
                <span>{formatTime(currentSeconds)}</span>
                <span>{Math.round(recordingProgress * 100)}%</span>
                <span>{formatTime(recording.durationSeconds)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {isPlaying ? (
                  <GlassButton size="sm" variant="primary" onClick={pauseRecording} icon={<Pause className="h-3.5 w-3.5" />}>Pause</GlassButton>
                ) : (
                  <GlassButton size="sm" variant="primary" disabled={!canPlay} onClick={playRecording} icon={<Play className="h-3.5 w-3.5 fill-current" />}>
                    {recordingStatus === 'paused' ? 'Resume' : recordingStatus === 'ended' ? 'Play from start' : 'Play'}
                  </GlassButton>
                )}
                <GlassButton size="sm" variant="secondary" onClick={stopRecording} icon={<Square className="h-3.5 w-3.5" />}>Stop</GlassButton>
                {recordingStatus === 'ended' && (
                  <button className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white" title="Restart from beginning" onClick={stopRecording}>
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                Speed
                <select
                  aria-label="Playback speed"
                  value={recordingSpeed}
                  onChange={(event) => setRecordingSpeed(Number(event.currentTarget.value))}
                  className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50"
                >
                  {[0.25, 0.5, 1, 2, 4].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
                </select>
              </label>
            </div>
          </div>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-black/10 px-4 py-5 text-center transition hover:border-cyan-300/40 hover:bg-cyan-400/5"
          >
            <FileUp className="h-5 w-5 text-slate-400" />
            <span className="text-xs font-medium text-slate-200">Choose a CSV, TSV, TXT or JSON file</span>
            <span className="text-[10px] text-slate-500">Four raw channels are required: T3, T4, O1 and O2 in µV (or mV indicated in the header)</span>
          </button>
        )}

        {recording && settings.deviceSource !== 'simulator' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>Select Simulator in the BrainBit & Simulator tab before playback. Recorded samples are never mixed with a live Bluetooth stream.</span>
          </div>
        )}

        <div className="rounded-lg border border-white/5 bg-white/[0.025] p-3 text-[10px] leading-relaxed text-slate-500">
          CSV: T3, T4, O1, O2 headers; optional timestamp, T3_kOhm…O2_kOhm resistance, quality bits and artifact flag. JSON: a sample array or an object containing samples, frames or data. Files are read locally in this window.
        </div>
      </div>
    </section>
  );
};
