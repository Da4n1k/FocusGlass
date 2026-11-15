import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { ELECTRODE_RESISTANCE_LIMITS_KOHM } from '../../services/signalQuality';

const rows = [
  { channel: 'T3', position: 'left temporal', limit: ELECTRODE_RESISTANCE_LIMITS_KOHM.t3.maxUsable },
  { channel: 'T4', position: 'right temporal', limit: ELECTRODE_RESISTANCE_LIMITS_KOHM.t4.maxUsable },
  { channel: 'O1', position: 'left occipital', limit: ELECTRODE_RESISTANCE_LIMITS_KOHM.o1.maxUsable },
  { channel: 'O2', position: 'right occipital', limit: ELECTRODE_RESISTANCE_LIMITS_KOHM.o2.maxUsable },
];

export const SignalQualityGuide: React.FC = () => (
  <section className="space-y-4" aria-labelledby="signal-quality-title">
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <h3 id="signal-quality-title" className="text-sm font-semibold text-white">Signal quality control</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">FocusGlass screening limits for dry electrodes. Resistance is measured in kΩ and checked before feedback and during calibration.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2">Electrode</th><th className="px-3 py-2">Position</th><th className="px-3 py-2 text-right">Maximum usable</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.channel} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono font-bold text-white">{row.channel}</td>
                <td className="px-3 py-2 text-slate-400">{row.position}</td>
                <td className="px-3 py-2 text-right font-mono text-cyan-200">≤ {row.limit} kΩ</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 text-[11px]">
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Good contact</div>
          <p className="leading-relaxed text-slate-400">0–500 kΩ: preferred. Readings up to 800 kΩ remain acceptable.</p>
        </div>
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-200"><AlertTriangle className="h-3.5 w-3.5" />Borderline</div>
          <p className="leading-relaxed text-slate-400">500–800 kΩ: usable; adjust the fit and check that the reading is stable.</p>
        </div>
        <div className="rounded-lg border border-rose-400/20 bg-rose-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-rose-200"><AlertTriangle className="h-3.5 w-3.5" />Reject</div>
          <p className="leading-relaxed text-slate-400">&gt;800 kΩ, null/NaN/negative reading or quality=false: channel is unusable.</p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-white/5 bg-black/20 p-3 text-[11px] leading-relaxed text-slate-300">
        <h4 className="font-semibold text-white">Artifact and frame rejection</h4>
        <ul className="list-disc space-y-1 pl-4 text-slate-400">
          <li>Bipolar pairs O1−T3 and O2−T4 are formed first, followed by the 50 Hz notch. Thresholds are applied to each filtered pair.</li>
          <li>A pair jump &gt;75 µV per sample or amplitude &gt;110 µV marks that side as artifacted. The affected side is excluded from spectral analysis; if both sides fail, the frame does not update feedback.</li>
          <li>An artifact/artefact flag in a recording is preserved during replay. Artifact frames, loss of any electrode or resistance above the limit are excluded from calibration.</li>
          <li>If an older SDK frame omits resistance, quality bits are used. A null value in an explicitly supplied measurement means loss of contact.</li>
        </ul>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500">
        The 800 kΩ limit is a conservative project default, not a certified manufacturer specification or medical standard. Verify it against the device documentation and reference recordings for the actual NeuroSDK/Neurotech export version. FocusGlass is a development and testing tool, not a medical diagnostic system.
      </p>
    </div>
  </section>
);
