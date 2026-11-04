import { useMemo, useState } from 'react';
import type { RunRecord } from '../domain/model';
import { MemoryCardDialog } from './MemoryCardDialog';
import {
  analyzeSplits,
  getMetricCoverage,
  getPersonalBests,
  getRecentRuns,
  type BestMetric,
  type SplitAnalysis,
} from '../domain/run-report';
import { formatDuration, formatPace } from './format';
import './RunReport.css';

// Only the twenty most recent runs are selectable; earlier ones come back after
// shrinking the page-level time range, which keeps the picker short and honest.
const MAX_PICKS = 20;

const text = (value: string | null | undefined) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const amount = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const dotDate = (iso: string) => iso.replaceAll('-', '.');
const cnDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(y)}年${Number(m)}月${Number(d)}日`; };
const kmText = (value: number | null) => (value === null ? '—' : value.toFixed(2));
const intText = (value: number | null) => (value === null ? '—' : String(Math.round(value)));
const celsiusText = (value: number | null) => (value === null ? '—' : `${value}°C`);
const humidityText = (value: number | null) => (value === null ? '—' : `${value}%`);
const plainText = (value: number | null) => (value === null ? '—' : String(value));

function activityLabel(value: string | null): string {
  const raw = text(value);
  if (!raw) return '运动类型未记录';
  if (raw === 'outdoor_running') return '户外跑步';
  if (raw === 'indoor_running') return '室内跑步';
  return raw;
}

// Identity for the picker. Prefer the stored id; without one, identify the run by
// its own facts (never by array position), so filtering the page range or re-sorting
// can never silently swap which run the user is reviewing.
function recordKey(record: RunRecord): string {
  const id = text(record.id);
  if (id) return `id:${id}`;
  const identity = [
    text(record.date) ?? '',
    text(record.startTime) ?? '',
    text(record.endTime) ?? '',
    amount(record.durationSeconds) ?? '',
    amount(record.distanceKm) ?? '',
    amount(record.averagePaceSecondsPerKm) ?? '',
    text(record.activityType) ?? '',
    text(record.location) ?? '',
  ].join('\u001f');
  return `fp:${identity}`;
}

// Fallback keys only need disambiguating when two records share the exact same facts
// (upstream normally de-duplicates). A stable occurrence ordinal keeps React keys
// unique without inventing ids or touching the stored records.
function keyRecords(records: readonly RunRecord[]) {
  const seen = new Map<string, number>();
  return records.map(record => {
    const base = recordKey(record);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { record, key: occurrence === 0 ? base : `${base}\u001f${occurrence}` };
  });
}

function optionLabel(record: RunRecord): string {
  const date = record.date ? dotDate(record.date) : '日期未记录';
  const time = text(record.startTime) ?? '时间未记录';
  const distance = amount(record.distanceKm);
  return `${date} ${time}${distance === null ? '' : ` · ${distance.toFixed(2)} 公里`}`;
}

interface BestMeta { label: string; unit: string; note?: string; format: (value: number) => string; }

const BEST_META: Record<BestMetric, BestMeta> = {
  distance: { label: '最长距离', unit: '公里', format: value => value.toFixed(2) },
  duration: { label: '最长时长', unit: '', format: value => formatDuration(value) },
  pace: { label: '最快平均配速', unit: '/公里', note: '仅统计满 30 分钟的训练', format: value => formatPace(value) },
  elevation: { label: '最高爬升', unit: '米', format: value => String(Math.round(value)) },
};

// Bar length maps to seconds per kilometre: the longer the bar, the slower that
// segment actually was. The partial final segment keeps its raw values and is
// never stretched into a full kilometre.
function SplitBars({ analysis }: { analysis: SplitAnalysis }) {
  const splits = analysis.splits;
  if (!splits.length) return <p className="run-report-none" data-testid="run-report-splits-empty">这次记录没有分段数据。</p>;

  const paces = splits.flatMap(split => (amount(split.paceSecondsPerKm) === null ? [] : [split.paceSecondsPerKm as number]));
  const longest = paces.length ? Math.max(...paces) : 0;
  const delta = analysis.firstToLastPaceDeltaSeconds;
  const difference = analysis.durationDifferenceSeconds;

  return <>
    <ul className="run-report-splits" data-testid="run-report-splits" aria-label="分段配速。条形越长，表示这一公里用时越久。">
      {splits.map((split, position) => {
        const pace = amount(split.paceSecondsPerKm);
        const partial = split.isPartialSplit === true;
        const width = pace === null || longest <= 0 ? '0%' : `${Math.max(2, Math.round(pace / longest * 100))}%`;
        // The domain explicitly allows repeated indices, so identity is the index
        // plus the position in the already index-sorted array. Every split stays.
        return <li className={partial ? 'run-report-split is-partial' : 'run-report-split'} data-testid="run-report-split" key={`${split.index}-${position}`}>
          <span className="run-report-split-index" aria-hidden="true">{split.index}</span>
          <span className="run-report-split-track" aria-hidden="true">
            <span className="run-report-split-bar" data-empty={pace === null || undefined} style={{ width }} />
          </span>
          <span className="run-report-split-figures">
            <span data-testid="run-report-split-duration">{formatDuration(split.durationSeconds)}</span>
            <span data-testid="run-report-split-pace">{formatPace(pace)}<small>/公里</small></span>
            <span data-testid="run-report-split-hr">{intText(amount(split.heartRateBpm))}<small>次/分</small></span>
          </span>
          {partial && <span className="run-report-split-partial">末段 · 不足1公里</span>}
        </li>;
      })}
    </ul>
    <p className="run-report-split-note">横条越长，每公里用时越久。斜纹为不足1公里的末段。</p>
    {delta !== null && <p className="run-report-split-delta" data-testid="run-report-split-delta">
      {delta === 0
        ? '第一个与最后一个可比较分段配速持平。'
        : `最后一个可比较分段较第一个${delta < 0 ? '快' : '慢'} ${formatPace(Math.abs(delta))}/公里。`}
    </p>}
    {difference !== null && Math.abs(difference) > 2 && <p className="run-report-split-check" data-testid="run-report-split-check">
      分段时长合计与记录总时长相差 {Math.abs(difference)} 秒，可回记录核对。这里不会自动改动任何数值。
    </p>}
  </>;
}

function CoverageBlock({ record }: { record: RunRecord }) {
  const coverage = useMemo(() => getMetricCoverage(record), [record]);
  return <div className="run-report-coverage">
    <div className="run-report-coverage-head">
      <span className="run-report-subhead">记录完整程度</span>
      <span className="run-report-coverage-count" data-testid="run-report-coverage">已记录 <strong>{coverage.known} / {coverage.total}</strong> 项</span>
    </div>
    {coverage.missingLabels.length > 0
      ? <details className="run-report-missing">
        <summary>查看 {coverage.missingLabels.length} 项未记录</summary>
        <ul>{coverage.missingLabels.map(label => <li key={label}>{label}</li>)}</ul>
      </details>
      : <p className="run-report-coverage-note">这条记录的可选指标都已记录。</p>}
    <p className="run-report-coverage-note">未知可以留空，记录仍然有效。</p>
  </div>;
}

function RunReportCard({ record }: { record: RunRecord }) {
  const analysis = useMemo(() => analyzeSplits(record), [record]);
  const distance = amount(record.distanceKm);
  const duration = amount(record.durationSeconds);
  const pace = amount(record.averagePaceSecondsPerKm);
  const heartRate = amount(record.averageHeartRateBpm);
  const temperature = amount(record.temperatureCelsius);
  const humidity = amount(record.humidityPercent);
  const airQuality = amount(record.airQualityIndex);
  const effortLevel = amount(record.effortLevel);
  const effortDescription = text(record.effortDescription);
  const awards = record.awards.flatMap(award => (text(award) ? [text(award)!] : []));

  const heroStats = [
    { id: 'run-report-distance', label: '运动距离', value: kmText(distance), unit: distance === null ? '' : '公里' },
    { id: 'run-report-duration', label: '运动时长', value: formatDuration(duration), unit: '' },
    { id: 'run-report-pace', label: '平均配速', value: formatPace(pace), unit: pace === null ? '' : '/公里' },
    { id: 'run-report-hr', label: '平均心率', value: intText(heartRate), unit: heartRate === null ? '' : '次/分' },
  ];

  const weather = [
    { id: 'run-report-temperature', label: '气温', value: celsiusText(temperature) },
    { id: 'run-report-humidity', label: '湿度', value: humidityText(humidity) },
    { id: 'run-report-air', label: '空气质量指数', value: plainText(airQuality) },
  ];

  const metrics = [
    { label: '平均步频', value: intText(amount(record.averageCadenceSpm)), unit: '步/分' },
    { label: '平均功率', value: intText(amount(record.averagePowerWatts)), unit: '瓦' },
    { label: '动态千卡', value: intText(amount(record.activeCaloriesKcal)), unit: '千卡' },
    { label: '总千卡数', value: intText(amount(record.totalCaloriesKcal)), unit: '千卡' },
    { label: '累计爬升', value: intText(amount(record.elevationGainMeters)), unit: '米' },
    { label: '运动强度', value: intText(effortLevel), unit: '/10' },
  ];

  return <div className="run-report-body">
    <div className="run-report-hero">
      <div className="run-report-hero-top">
        <div className="run-report-identity">
          <p className="run-report-date">{record.date ? cnDate(record.date) : '日期未记录'}</p>
          <span className="run-report-overline">RUN LOOKED BACK</span>
          <ul className="run-report-meta">
            <li><span>开始</span><b>{text(record.startTime) ?? '时间未记录'}</b></li>
            <li><span>运动类型</span><b>{activityLabel(record.activityType)}</b></li>
            <li><span>地点</span><b>{text(record.location) ?? '地点未记录'}</b></li>
            <li><span>设备</span><b>{text(record.source) ?? '记录设备未记录'}</b></li>
          </ul>
        </div>
        {(effortLevel !== null || effortDescription) && <p className="run-report-effort" data-testid="run-report-effort">
          {effortLevel !== null && <span>强度 <strong>{effortLevel}/10</strong></span>}
          {effortDescription && <span>{effortDescription}</span>}
        </p>}
      </div>

      <div className="run-report-stats">
        {heroStats.map(stat => <div className="run-report-stat" key={stat.id}>
          <span>{stat.label}</span>
          <p><strong data-testid={stat.id}>{stat.value}</strong>{stat.unit && <small>{stat.unit}</small>}</p>
        </div>)}
      </div>

      {awards.length > 0 && <ul className="run-report-awards" aria-label="这次记录中的荣誉">
        {awards.map(award => <li key={award}>{award}</li>)}
      </ul>}
    </div>

    <div className="run-report-weather" aria-label="当天气象记录">
      {weather.map(cell => <div className="run-report-weather-cell" key={cell.id}>
        <span>{cell.label}</span>
        <p data-testid={cell.id}>{cell.value}</p>
      </div>)}
    </div>

    <details className="run-report-details">
      <summary>
        <span>更多指标与分段</span>
        <span className="run-report-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="run-report-details-body">
        <h4 className="run-report-subhead">其余指标</h4>
        <div className="run-report-metrics">
          {metrics.map(metric => <div className="run-report-metric" key={metric.label}>
            <span>{metric.label}</span>
            <p><strong>{metric.value}</strong><small>{metric.unit}</small></p>
          </div>)}
        </div>
        <h4 className="run-report-subhead run-report-subhead-splits">分段配速</h4>
        <SplitBars analysis={analysis} />
      </div>
    </details>

    <CoverageBlock record={record} />
  </div>;
}

function PersonalBests({ records }: { records: RunRecord[] }) {
  const bests = useMemo(() => getPersonalBests(records), [records]);
  if (!bests.length) {
    if (!records.length) return null;
    return <section className="run-report-bests" aria-label="这段时间的个人纪录">
      <div className="run-report-bests-head">
        <div><span className="eyebrow">BESTS, IN THIS STRETCH</span><h2>这段时间的个人纪录</h2></div>
      </div>
      <p className="run-report-none" data-testid="run-report-bests-empty">这段时间的记录里，还没有可用于个人纪录的有效数值。未知的指标留空即可。</p>
    </section>;
  }

  return <section className="run-report-bests" aria-label="这段时间的个人纪录">
    <div className="run-report-bests-head">
      <div><span className="eyebrow">BESTS, IN THIS STRETCH</span><h2>这段时间的个人纪录</h2></div>
      <p>只和过去的自己比较，范围跟随上方的时间筛选。</p>
    </div>
    <ul className="run-report-best-grid">
      {bests.map(best => {
        const meta = BEST_META[best.metric];
        const date = best.record.date;
        return <li className="run-report-best" data-testid={`run-report-best-${best.metric}`} key={best.metric}>
          <span className="run-report-best-label">{meta.label}{meta.note && <small>{meta.note}</small>}</span>
          <p><strong>{meta.format(best.value)}</strong>{meta.unit && <small>{meta.unit}</small>}</p>
          <span className="run-report-best-date">
            {date ? dotDate(date) : '日期未记录'}{text(best.record.startTime) ? ` ${best.record.startTime}` : ''}
            {best.tiedCount > 1 ? ` · 共 ${best.tiedCount} 次并列` : ''}
          </span>
        </li>;
      })}
    </ul>
  </section>;
}

export function RunReport({ records, busy = false }: { records: RunRecord[]; busy?: boolean }) {
  const [selectedKey, setSelectedKey] = useState('');
  // A frozen snapshot of the exact run being turned into a card, captured on click
  // so a later range change or re-render can never swap which run the dialog shows.
  const [cardRecord, setCardRecord] = useState<RunRecord | null>(null);
  const recent = useMemo(() => getRecentRuns(records), [records]);
  const keyed = useMemo(() => keyRecords(recent), [recent]);
  const top = keyed.slice(0, MAX_PICKS);
  const chosen = keyed.find(entry => entry.key === selectedKey) ?? null;
  // A selected run that dropped out of the top twenty is kept as an option so the
  // choice survives; a run that left the records entirely falls back to the latest.
  const options = chosen && !top.includes(chosen) ? [chosen, ...top] : top;
  const active = chosen ?? top[0] ?? null;

  return <>
    <section className="run-report" aria-label="跑步回顾">
      <div className="run-report-head">
        <div><span className="eyebrow">ONE RUN, LOOKED BACK</span><h2>跑步回顾</h2></div>
        {keyed.length > 0 && <div className="run-report-controls">
          <label className="run-report-pick"><span>回顾哪次跑步</span>
            <select aria-label="回顾哪次跑步" value={active?.key ?? ''} onChange={event => setSelectedKey(event.target.value)}>
              {options.map(entry => <option key={entry.key} value={entry.key}>{optionLabel(entry.record)}</option>)}
            </select>
          </label>
          {active && <button type="button" className="button secondary run-report-card-button" disabled={busy}
            onClick={() => setCardRecord(active.record)}>生成纪念卡</button>}
        </div>}
      </div>
      {active
        ? <RunReportCard key={active.key} record={active.record} />
        : <p className="run-report-empty" data-testid="run-report-empty" role="status">这一段范围里还没有跑步记录。记下第一程，回顾就有了起点。</p>}
      {keyed.length > 0 && <p className="run-report-scope">回顾最近 {MAX_PICKS} 次；更早训练可用上方日期筛选。</p>}
    </section>
    <PersonalBests records={records} />
    {cardRecord && <MemoryCardDialog record={cardRecord} onClose={() => setCardRecord(null)} />}
  </>;
}
