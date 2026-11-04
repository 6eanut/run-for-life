import { useMemo, useState } from 'react';
import type { RunRecord } from '../domain/model';
import {
  buildActivityCalendar,
  filterRuns,
  resolveDateRange,
  summarizePeriod,
  type CalendarDay,
  type DateRange,
  type StatsRange,
} from '../domain/analytics';
import { formatDuration } from './format';
import { RunReport } from './RunReport';
import { Trends } from './Trends';
import './AnalyticsOverview.css';

const presets: { id: StatsRange; label: string }[] = [
  { id: 'all', label: '全部记录' },
  { id: '30d', label: '近30天' },
  { id: '90d', label: '近90天' },
  { id: 'year', label: '今年' },
  { id: 'custom', label: '自定义' },
];
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// Browser-local calendar day, never toISOString (which can shift across timezones).
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dotDate = (value: string) => value.replaceAll('-', '.');
const cnDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(y)}年${Number(m)}月${Number(d)}日`; };
const CN_WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekdayOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return CN_WEEKDAY[new Date(y, m - 1, d).getDay()]; };
const countBucket = (count: number) => count <= 0 ? 0 : Math.min(4, count);
const known = (value: number | null) => value === null ? '—' : value.toFixed(2);
const whole = (value: number | null) => value === null ? '—' : String(Math.round(value));
const periodDuration = (value: number | null) => { if (value === null) return '—'; const hours = Math.floor(value / 3600); const minutes = Math.floor((value % 3600) / 60); return hours ? `${hours}小时${minutes}分` : `${minutes}分`; };
// Split value/unit so a long span (e.g. 1000 hours) never bloats the big number on narrow screens.
const periodDurationParts = (value: number | null): { value: string; unit: string } => {
  if (value === null) return { value: '—', unit: '' };
  if (value >= 3600) return { value: (value / 3600).toFixed(1), unit: '小时' };
  if (value >= 60) return { value: String(Math.round(value / 60)), unit: '分钟' };
  return { value: String(value), unit: '秒' };
};

export function AnalyticsOverview({ records, busy = false }: { records: RunRecord[]; busy?: boolean }) {
  const [today] = useState(() => localDate(new Date()));
  const [preset, setPreset] = useState<StatsRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [appliedRange, setAppliedRange] = useState<DateRange>({ start: null, end: null });
  const [customError, setCustomError] = useState('');
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const filteredRecords = useMemo(() => filterRuns(records, appliedRange), [records, appliedRange]);
  const summary = useMemo(() => summarizePeriod(filteredRecords), [filteredRecords]);
  const anchorEnd = appliedRange.end ?? today;
  const calendarDays = useMemo(() => buildActivityCalendar(filteredRecords, anchorEnd, 12), [filteredRecords, anchorEnd]);
  const daysWithRuns = useMemo(() => calendarDays.filter(day => day.count > 0), [calendarDays]);
  const defaultDate = daysWithRuns.at(-1)?.date ?? anchorEnd;
  // The picker lists recorded days when any exist, otherwise just the anchor day (never outside/future).
  const optionDays = useMemo(
    () => daysWithRuns.length ? daysWithRuns : calendarDays.filter(day => day.date === anchorEnd),
    [daysWithRuns, calendarDays, anchorEnd],
  );
  const inAppliedRange = (date: string) => (appliedRange.start === null || date >= appliedRange.start) && (appliedRange.end === null || date <= appliedRange.end);
  // A picked day only counts while it is still selectable: inside the range and not in the future.
  const picked = pickedDate && calendarDays.find(day => day.date === pickedDate);
  const selectedDate = picked && inAppliedRange(picked.date) && !picked.isFuture ? picked.date : defaultDate;
  const selectedDay = calendarDays.find(day => day.date === selectedDate);
  const selectedRuns = useMemo(
    () => filteredRecords.filter(record => record.date === selectedDate)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')),
    [filteredRecords, selectedDate],
  );

  const choosePreset = (value: StatsRange) => {
    setPreset(value);
    setCustomError('');
    if (value === 'custom') return; // keep showing the last applied range until the user applies
    try {
      setAppliedRange(resolveDateRange(value, today));
    } catch {
      setCustomError('无法应用这个时间范围，请重试。');
    }
  };
  const applyCustom = () => {
    try {
      setAppliedRange(resolveDateRange('custom', today, { start: customStart, end: customEnd }));
      setCustomError('');
    } catch {
      setCustomError('请检查日期：开始日期需早于或等于结束日期，且两个日期都有效。');
    }
  };

  const appliedText = appliedRange.start && appliedRange.end
    ? `${dotDate(appliedRange.start)} — ${dotDate(appliedRange.end)}`
    : appliedRange.start ? `从 ${dotDate(appliedRange.start)} 起`
      : appliedRange.end ? `至 ${dotDate(appliedRange.end)}` : '全部记录';
  const isOutside = (date: string) => !inAppliedRange(date);
  const durationParts = periodDurationParts(summary.durationSeconds);

  const periodStats = [
    { id: 'period-runs', index: '01', label: '跑步次数', value: String(summary.runCount), unit: '次', unitId: undefined as string | undefined },
    { id: 'period-active-days', index: '02', label: '活跃天数', value: String(summary.activeDays), unit: '天', unitId: undefined },
    { id: 'period-distance', index: '03', label: '已记录公里', value: known(summary.distanceKm), unit: '公里', unitId: undefined },
    { id: 'period-duration', index: '04', label: '运动时间', value: durationParts.value, unit: durationParts.unit, unitId: 'period-duration-unit' },
    { id: 'period-calories', index: '05', label: '动态千卡', value: whole(summary.activeCaloriesKcal), unit: '千卡', unitId: undefined },
    { id: 'period-elevation', index: '06', label: '累计爬升', value: whole(summary.elevationGainMeters), unit: '米', unitId: undefined },
  ];

  return <>
    <section className="analytics-toolbar" aria-label="统计时间范围">
      <div className="analytics-toolbar-head">
        <div><span className="eyebrow">THIS STRETCH OF YOURS</span><h2>这一段时间的你</h2></div>
        <label className="analytics-range-label"><span>统计时间范围</span>
          <select aria-label="统计时间范围" value={preset} onChange={event => choosePreset(event.target.value as StatsRange)}>
            {presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {preset === 'custom' && <div className="analytics-custom">
        <label>开始日期<input type="date" value={customStart} max={today} onChange={event => setCustomStart(event.target.value)} /></label>
        <label>结束日期<input type="date" value={customEnd} max={today} onChange={event => setCustomEnd(event.target.value)} /></label>
        <button type="button" className="button secondary analytics-apply" onClick={applyCustom}>应用时间范围</button>
      </div>}
      {customError && <p className="analytics-error" role="alert">{customError}</p>}
      <p className="analytics-applied" data-testid="applied-range">当前统计：{appliedText} · {filteredRecords.length} 条记录</p>
    </section>

    <section className="analytics-period" aria-label="期间汇总">
      <div className="analytics-period-head">
        <span className="eyebrow">THE PERIOD, IN NUMBERS</span>
        <p>只统计当前选定的时间范围，与页面顶部的终身累计相互独立。</p>
      </div>
      <div className="analytics-period-strip">
        {periodStats.map(item => <div className="analytics-period-cell" key={item.id}>
          <span className="analytics-index" aria-hidden="true">{item.index}</span>
          <span className="analytics-period-label">{item.label}</span>
          <p><strong data-testid={item.id}>{item.value}</strong>{item.unit && <small data-testid={item.unitId}>{item.unit}</small>}</p>
        </div>)}
      </div>
      {summary.missingDistanceCount > 0 && <p className="analytics-distance-note" data-testid="period-distance-note">{summary.missingDistanceCount} 次距离未记录，合计已知数据。</p>}
      <p className="analytics-coverage-note">热量与爬升为已记录数据的合计。</p>
      {!filteredRecords.length && <p className="analytics-period-empty" role="status">这段时间还没有跑步记录。换一个范围，或去「数据导入」记下一次出发。</p>}
    </section>

    <details className="run-report-disclosure">
      <summary>
        <span className="run-report-disclosure-copy">
          <span className="eyebrow">ONE RUN, LOOKED BACK</span>
          <strong>跑步回顾与个人纪录</strong>
          <small>天气、分段和每一次特别的记录</small>
        </span>
        <span className="run-report-disclosure-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="run-report-disclosure-body">
        <RunReport records={filteredRecords} busy={busy} />
      </div>
    </details>

    <section className="analytics-calendar" aria-label="12周跑步日历">
      <div className="analytics-cal-head">
        <div><span className="eyebrow">TWELVE WEEKS</span><h2>十二周的脚步</h2>
          <p className="analytics-cal-span" data-testid="calendar-span">{calendarDays.length ? `${cnDate(calendarDays[0].date)} — ${cnDate(calendarDays.at(-1)!.date)} · 共 12 周` : ''}</p>
        </div>
        <p className="analytics-cal-hint">按已导入的记录展示，空格不代表必须跑。周一到周日，按周从旧到新。</p>
      </div>
      <div className="analytics-cal-body">
        <div className="analytics-cal-main">
          <div className="analytics-cal-layout">
            <div className="analytics-cal-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
            <div className="analytics-cal-grid">
              {calendarDays.map(day => {
                const outside = isOutside(day.date);
                const blocked = outside || day.isFuture;
                const state = outside ? 'outside' : day.isFuture ? 'future' : 'in';
                return <button type="button" key={day.date} className="analytics-day" data-state={state} data-count={countBucket(day.count)}
                  aria-disabled={blocked || undefined}
                  aria-pressed={!blocked && day.date === selectedDate}
                  aria-label={`${cnDate(day.date)}，${day.count ? `${day.count} 次跑步` : '没有记录'}${outside ? '，不在选定范围' : day.isFuture ? '，未来日期' : ''}`}
                  disabled={blocked}
                  onClick={() => setPickedDate(day.date)} />;
              })}
            </div>
          </div>
          <div className="analytics-cal-legend">
            <span className="analytics-legend-title">次数</span>
            <span className="analytics-legend-scale" aria-hidden="true">
              <i data-count="0" /> <i data-count="1" /> <i data-count="2" /> <i data-count="3" /> <i data-count="4" />
            </span>
            <span className="analytics-legend-caption">少 → 多 · 空格为没有记录，不代表休息日</span>
          </div>
          <label className="analytics-day-select"><span>选择日期</span>
            <select aria-label="选择日历中的日期" value={selectedDate} onChange={event => setPickedDate(event.target.value)}>
              {optionDays.map(day => <option key={day.date} value={day.date}>{`${cnDate(day.date)} · ${day.count ? `${day.count} 次` : '没有记录'}`}</option>)}
              {!optionDays.some(day => day.date === selectedDate) && <option value={selectedDate}>{cnDate(selectedDate)}{selectedDay?.count ? ` · ${selectedDay.count} 次` : ' · 没有记录'}</option>}
            </select>
          </label>
        </div>
        <aside className="analytics-day-panel" data-testid="selected-day" aria-label="选中日期详情" aria-live="polite">
          <span className="eyebrow">SELECTED DAY</span>
          <h3>{cnDate(selectedDate)}<small>{weekdayOf(selectedDate)}</small></h3>
          {selectedDay?.count ? <>
            <div className="analytics-day-figures">
              <span><strong>{selectedDay.count}</strong>次</span>
              <span><strong>{known(selectedDay.distanceKm)}</strong>公里</span>
              <span><strong>{periodDuration(selectedDay.durationSeconds)}</strong></span>
            </div>
            {selectedDay.missingDistanceCount > 0 && <p className="analytics-day-note">{selectedDay.missingDistanceCount} 次距离未记录。</p>}
            <ul className="analytics-day-runs">
              {selectedRuns.map((record, index) => <li key={record.id ?? index}>
                <span className="analytics-run-time">{record.startTime ?? '时间未记录'}</span>
                <span className="analytics-run-distance">{record.distanceKm === null ? '距离未记录' : `${record.distanceKm.toFixed(2)} 公里`}</span>
                <span className="analytics-run-duration">{formatDuration(record.durationSeconds)}</span>
              </li>)}
            </ul>
          </> : <p className="analytics-day-empty">这一天没有跑步记录。空格不代表必须跑。</p>}
        </aside>
      </div>
    </section>

    <Trends records={filteredRecords} />
  </>;
}
