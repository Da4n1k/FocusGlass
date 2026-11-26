import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';
import {
  formatHistoryDateRu,
  formatTableDurationRu,
  getLightbarColorHex,
  getTotalFocusSummary,
  getWeeklyBarDays,
  getWeeklyFocusSummary,
} from '../../services/sessionHistoryMetrics';

export const HistoryScreen: React.FC = () => {
  const { sessionHistory, exportSessionsCsv, openSessionSummary } = useFocusStore();

  const weeklyDays = React.useMemo(() => getWeeklyBarDays(sessionHistory), [sessionHistory]);
  const maxMinutes = Math.max(...weeklyDays.map((d) => d.minutes), 60);

  const weeklyFocus = React.useMemo(() => getWeeklyFocusSummary(sessionHistory), [sessionHistory]);
  const totalFocus = React.useMemo(() => getTotalFocusSummary(sessionHistory), [sessionHistory]);

  const weeklyDeltaColorClass =
    weeklyFocus.deltaTone === 'positive'
      ? 'text-[#6EE7B7]'
      : weeklyFocus.deltaTone === 'negative'
        ? 'text-[#F87171]'
        : 'text-[#6E7891]';

  return (
    <div className="w-full pt-7 px-8 pb-6 flex flex-col space-y-5 shrink-0 select-none animate-in fade-in duration-200">
      {/* Header */}
      <div className="w-full flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex flex-col">
          <h1 className="text-[28px] font-bold tracking-[-0.42px] text-[#EEF1F8] leading-[36px]">
            История
          </h1>
          <p className="text-[15px] font-normal text-[#A3ACC2] leading-[22px] mt-[4px]">
            Как меняется ваша концентрация от сессии к сессии.
          </p>
        </div>

        {/* Экспорт всех сессий */}
        <button
          onClick={exportSessionsCsv}
          className="h-[36px] px-[14px] rounded-[10px] bg-transparent hover:bg-white/[0.04] border border-white/[0.12] text-[14px] font-semibold text-[#C9D1E3] flex items-center gap-2 transition-colors cursor-pointer self-start shrink-0"
        >
          <svg className="w-[17px] h-[17px] text-[#C9D1E3] shrink-0" viewBox="0 0 17 17" fill="none">
            <path
              d="M 8.5 2.125 V 10.625 M 12.04 7.083 L 8.5 10.625 L 4.96 7.083"
              stroke="currentColor"
              strokeWidth="1.275"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 3.54 14.875 H 13.46"
              stroke="currentColor"
              strokeWidth="1.275"
              strokeLinecap="round"
            />
          </svg>
          <span>Экспорт всех сессий</span>
        </button>
      </div>

      {/* Top Grid: Weekly Bar Chart + Real Summary Stats */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-[minmax(0,1.31fr)_minmax(0,1fr)] gap-4">
        {/* Left Card: Weekly Bar Chart */}
        <div className="p-[22px_24px] rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col justify-between h-[247px] min-w-0">
          <div className="text-[15px] font-semibold text-[#EEF1F8]">
            Минуты в фокусе за неделю
          </div>

          <div className="flex items-end justify-between gap-4 pt-3">
            {weeklyDays.map((d) => {
              const heightPct =
                d.minutes > 0 ? Math.min(100, Math.max(16, (d.minutes / maxMinutes) * 100)) : 0;

              return (
                <div
                  key={d.label}
                  className="flex-1 flex flex-col items-center min-w-0"
                  title={d.minutes > 0 ? `${d.label}: ${d.minutes} мин` : `${d.label}: 0 мин`}
                >
                  <div className="w-full flex items-end justify-center h-[128px]">
                    {d.minutes > 0 ? (
                      <div
                        className="w-full max-w-[44px] min-h-[20px] rounded-[10px] bg-gradient-to-b from-[#FF9A5C] to-[#FF7A2F] transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                    ) : (
                      <div className="w-full max-w-[44px] h-[4px] rounded-full bg-white/[0.06]" />
                    )}
                  </div>
                  <span className="text-[12px] text-[#A3ACC2] font-normal mt-2.5">{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Stack: 2 Summary Cards */}
        <div className="flex flex-col justify-center gap-4 min-w-0">
          <div className="h-[111px] px-[22px] py-[18px] rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col justify-center min-w-0">
            <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate">
              Средний фокус за неделю
            </span>
            <div className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight mt-1">
              {weeklyFocus.averageFocusPct}%
            </div>
            <span
              className={`text-[12px] font-normal leading-[15px] mt-1.5 truncate ${weeklyDeltaColorClass}`}
            >
              {weeklyFocus.deltaText}
            </span>
          </div>

          <div className="h-[111px] px-[22px] py-[18px] rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col justify-center min-w-0">
            <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate">
              Всего в фокусе
            </span>
            <div className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight mt-1">
              {totalFocus.totalFormatted}
            </div>
            <span className="text-[12px] font-normal text-[#6E7891] leading-[15px] mt-1.5 truncate">
              {totalFocus.sessionCountLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Sessions Table Card */}
      <div className="w-full shrink-0 rounded-[20px] bg-[#131A2A] border border-white/[0.06] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.05] text-[11px] uppercase font-semibold text-[#6E7891] tracking-wider h-[47px]">
                <th className="px-6 font-semibold">Дата</th>
                <th className="px-6 font-semibold">Длительность</th>
                <th className="px-6 font-semibold">Средний фокус</th>
                <th className="px-6 font-semibold">Отвлечения</th>
                <th className="px-6 text-right w-14"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {sessionHistory.length === 0 ? (
                <tr className="h-[64px]">
                  <td colSpan={5} className="px-6 text-center text-[14px] text-[#6E7891]">
                    Пока нет завершённых сессий
                  </td>
                </tr>
              ) : (
                sessionHistory.map((record, index) => {
                  const avg = Math.round(record.averageFocusScore);
                  const lightbarColor = getLightbarColorHex(avg);
                  const isLatest = index === 0;

                  return (
                    <tr
                      key={record.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSessionSummary(record)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openSessionSummary(record);
                        }
                      }}
                      className={`h-[50px] transition-colors group cursor-pointer focus:outline-none focus:bg-white/[0.05] ${
                        isLatest
                          ? 'bg-[#FF7A2F]/[0.05] hover:bg-[#FF7A2F]/[0.09]'
                          : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className="px-6 text-[14px] font-medium text-[#EEF1F8] whitespace-nowrap">
                        {formatHistoryDateRu(record.startedAt)}
                      </td>
                      <td className="px-6 text-[14px] font-normal text-[#EEF1F8] whitespace-nowrap">
                        {formatTableDurationRu(record.durationSeconds)}
                      </td>
                      <td className="px-6 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-[120px] h-[6px] rounded-full shrink-0"
                            style={{ backgroundColor: lightbarColor }}
                          />
                          <span className="text-[14px] font-semibold text-[#EEF1F8] tabular-nums">
                            {avg}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 text-[14px] font-normal text-[#EEF1F8] tabular-nums whitespace-nowrap">
                        {record.distractionEventsCount}
                      </td>
                      <td className="px-6 text-right">
                        <span
                          aria-label="Открыть статистику сессии"
                          className="inline-flex items-center justify-center p-1 text-[#6E7891] group-hover:text-[#EEF1F8] transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M 1.5 6 H 10.83 M 6.83 10 L 10.83 6 L 6.83 2"
                              stroke="currentColor"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
