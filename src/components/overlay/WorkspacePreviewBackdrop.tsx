import React, { useState } from 'react';
import { Code2, CheckSquare, Terminal } from 'lucide-react';

interface Props {
  lang: 'ru' | 'en';
}

/**
 * Interactive simulated workspace shown ONLY in browser HUD preview mode
 * (never inside native Tauri transparent OS window) so viewers on "Вертушка"
 * can test typing and clicking while the passive BiofeedbackOverlay dims/clears above it.
 */
export const WorkspacePreviewBackdrop: React.FC<Props> = ({ lang }) => {
  const [notes, setNotes] = useState(
    lang === 'ru'
      ? `// Рабочее окно разработчика / студента (демо-фон для браузера)\n// Попробуйте печатать здесь или отмечать задачи ниже,\n// пока оверлей FocusGlass отслеживает фокус (клавиши 1, 2, 3, 4).\n\nfunction computeBipolarChannel(t3_uV: number, o1_uV: number): number {\n  return t3_uV - o1_uV; // Дифференциальное отведение BrainBit\n}`
      : `// Developer / Student active workspace (browser preview backdrop)\n// Try typing here or checking tasks below while FocusGlass\n// modulates screen transparency in real time (keys 1, 2, 3, 4).\n\nfunction computeBipolarChannel(t3_uV: number, o1_uV: number): number {\n  return t3_uV - o1_uV; // BrainBit differential derivation\n}`
  );

  const [checked, setChecked] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: false });

  const tasks =
    lang === 'ru'
      ? [
          'Проверить плавное затемнение при падении концентрации ниже порога (клавиша 3)',
          'Проверить заморозку прозрачности при моргании без мигания экрана (клавиша 4)',
          'Убедиться, что ввод текста и клики работают без прерывания потока',
        ]
      : [
          'Verify smooth dimming when concentration drops below threshold (key 3)',
          'Verify anti-flicker opacity freeze on eye blink artifact (key 4)',
          'Confirm typing and mouse clicks continue without interrupting flow',
        ];

  return (
    <div className="fixed inset-0 z-0 bg-[#0B101E] text-slate-200 p-6 md:p-10 overflow-y-auto select-text">
      <div className="max-w-4xl mx-auto pt-8 space-y-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white">
                {lang === 'ru'
                  ? 'Имитация рабочего окружения (браузерное превью сквозного режима)'
                  : 'Simulated Desktop Workspace (Browser Pass-Through Preview)'}
              </h2>
              <p className="text-xs text-slate-400">
                {lang === 'ru'
                  ? 'В Windows-сборке Tauri вместо этого фона видно ваш реальный VS Code, браузер или конспект.'
                  : 'In the native Windows Tauri build, your real IDE, browser, or study app appears here.'}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300">
            workspace_preview.ts
          </span>
        </div>

        {/* Interactive code/notes editor */}
        <div className="rounded-2xl bg-[#070B14] border border-white/10 overflow-hidden shadow-xl">
          <div className="px-4 py-2 bg-white/5 border-b border-white/10 flex items-center gap-2 text-xs text-slate-400 font-mono">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {lang === 'ru'
                ? 'Интерактивный редактор — кликните и наберите текст сквозь оверлей:'
                : 'Interactive editor — click and type right under the overlay:'}
            </span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            className="w-full bg-transparent p-4 font-mono text-xs md:text-sm text-emerald-100 focus:outline-none resize-y leading-relaxed"
          />
        </div>

        {/* Interactive checklist */}
        <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <CheckSquare className="w-4 h-4 text-[#FF6600]" />
            <span>
              {lang === 'ru'
                ? 'Чек-лист проверки пассивной нейроадаптации (кликабельно):'
                : 'Passive neuro-adaptation verification checklist (clickable):'}
            </span>
          </div>
          {tasks.map((task, idx) => (
            <label
              key={idx}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer text-xs text-slate-200 transition-colors"
            >
              <input
                type="checkbox"
                checked={Boolean(checked[idx])}
                onChange={() => setChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                className="rounded accent-[#FF6600] w-4 h-4 cursor-pointer"
              />
              <span className={checked[idx] ? 'line-through text-slate-400' : ''}>{task}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
