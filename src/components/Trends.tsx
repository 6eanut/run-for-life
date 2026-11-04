import { useMemo, useState, type MouseEvent } from 'react';
import type { RunRecord } from '../domain/model';
import { chartGeometry, formatMetricValue, getMonthlyActivity, getTrendSeries, trendMetrics, type TrendMetric, type TrendPoint } from '../domain/trends';
import './Trends.css';

function changeLabel(points: TrendPoint[], metric: TrendMetric) {
  const values = points.flatMap(point => point.value === null ? [] : [point.value]);
  if (values.length < 2 || points.at(-1)?.value === null) return null;
  const difference = values.at(-1)! - values[0];
  if (Math.abs(difference) < 0.005) return '最新一次与最早有数据的记录相同';
  const formatted = formatMetricValue(metric, Math.abs(difference));
  if (metric === 'pace') return `最新较最早有数据的记录${difference < 0 ? '快' : '慢'} ${formatted}`;
  const unit = trendMetrics.find(item => item.id === metric)!.unit;
  return `最新较最早有数据的记录 ${difference > 0 ? '+' : '−'}${formatted}${metric === 'duration' ? '' : ` ${unit}`}`;
}

function axisLabel(metric: TrendMetric, value: number) {
  if (metric === 'distance') return value < 10 ? value.toFixed(1) : String(Math.round(value));
  return formatMetricValue(metric, value);
}

function MonthlyActivity({ records }: { records: RunRecord[] }) {
  const months = useMemo(() => getMonthlyActivity(records), [records]);
  if (!months.length) return null;
  const maxCount = Math.max(1, ...months.map(month => month.count));
  return <section className="trend-month-panel" aria-label="每月跑量">
    <div className="trend-month-heading"><div><span className="eyebrow">A LITTLE, OVER TIME</span><h3>每个月的脚印</h3></div><span>每月跑步次数</span></div>
    <div className="trend-month-bars" role="img" aria-label={months.map(month => `${month.month}：${month.count} 次`).join('；')}>
      {months.map(month => <div className="trend-month-column" key={month.month}>
        <strong>{month.count}</strong><div className="trend-month-track"><div className={month.count ? 'trend-month-bar' : 'trend-month-bar is-empty'} style={{ height: `${month.count / maxCount * 100}%` }} /></div>
        <span>{Number(month.month.slice(5))}月</span>
        <small>{month.month.slice(5) === '01' || month === months[0] ? month.month.slice(0, 4) : '\u00a0'}</small>
      </div>)}
    </div>
    <p className="trend-footnote">截至最近一次记录 · {months[0].month.replace('-', '.')}—{months.at(-1)!.month.replace('-', '.')}，最多展示 12 个月。休息的月份也属于你的节奏。</p>
    <details className="trend-data-table"><summary>查看每月汇总</summary><div className="trend-table-scroll"><table aria-label="每月跑量汇总"><thead><tr><th>月份</th><th>次数</th><th>已记录距离 / 公里</th></tr></thead><tbody>{months.map(month => <tr key={month.month}><td>{month.month}</td><td>{month.count}</td><td>{month.distanceKm === null ? '未记录' : month.distanceKm.toFixed(2)}{month.missingDistanceCount > 0 && <small> · {month.missingDistanceCount} 次距离缺失</small>}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function Trends({ records }: { records: RunRecord[] }) {
  const [metric, setMetric] = useState<TrendMetric>('distance');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const series = useMemo(() => getTrendSeries(records, metric), [records, metric]);
  const geometry = useMemo(() => chartGeometry(series.points, metric === 'pace'), [series.points, metric]);
  const definition = trendMetrics.find(item => item.id === metric)!;
  const storedIndex = geometry.points.findIndex(point => point.key === selectedKey);
  const selectedIndex = storedIndex >= 0 ? storedIndex : geometry.points.length - 1;
  const selected = geometry.points[selectedIndex];
  const knownCount = geometry.points.filter(point => point.value !== null).length;
  const difference = changeLabel(series.points, metric);
  const selectIndex = (index: number) => setSelectedKey(geometry.points[index]?.key ?? null);
  const selectNearest = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 760;
    const nearest = geometry.points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(geometry.points[best].x - x) ? index : best, 0);
    selectIndex(nearest);
  };
  const first = geometry.points[0];
  const last = geometry.points.at(-1);
  const topValue = metric === 'pace' ? geometry.min : geometry.max;
  const bottomValue = metric === 'pace' ? geometry.max : geometry.min;
  return <>
    <section className="trend-section" aria-label="单次跑步趋势">
      <div className="trend-section-heading"><div><span className="eyebrow">YOUR OWN PACE</span><h2>随时间，看见变化。</h2></div><p>每个点，都是一次出发。</p></div>
      <div className="trend-card">
        <div className="trend-card-top"><div><h3>{definition.label}</h3><p>{definition.hint}</p></div><label className="trend-metric-label"><span>查看指标</span><select aria-label="趋势指标" value={metric} onChange={event => setMetric(event.target.value as TrendMetric)}>{trendMetrics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        {!geometry.points.length ? <div className="trend-empty"><span aria-hidden="true">↗</span><h3>你的第一张趋势图，从下一次出发开始。</h3><p>在「数据导入」中记下一次跑步，这里就会长出第一个点。</p></div> : <>
          <output className="trend-reading" aria-live="polite" aria-atomic="true"><div><span className="trend-value">{formatMetricValue(metric, selected?.value ?? null)}</span>{selected?.value !== null && <small>{definition.unit}</small>}</div><span className="trend-selected-date">{selected?.date} {selected?.time ?? '时间未记录'}<span>{selectedIndex + 1} / {geometry.points.length} 次记录</span></span></output>
          {knownCount ? <>
            <div className="trend-plot">
              <div className="trend-y-labels" aria-hidden="true"><span>{axisLabel(metric, topValue)}</span><span>{axisLabel(metric, (topValue + bottomValue) / 2)}</span><span>{axisLabel(metric, bottomValue)}</span></div>
              <svg viewBox="0 0 760 260" preserveAspectRatio="none" role="img" aria-label={`${definition.label}随日期变化图，${knownCount} 次有数据。可用下方滑块选择记录，或查看图表数据。`} onClick={selectNearest}>
                {[22, 130, 238].map(y => <line className="trend-grid-line" key={y} x1="64" x2="736" y1={y} y2={y} />)}
                {selected && <line className="trend-selection-line" x1={selected.x} x2={selected.x} y1="22" y2="238" />}
                {geometry.paths.map((path, index) => <path className="trend-line" key={index} d={path} />)}
                {geometry.points.filter(point => point.y !== null).map(point => <circle className={point.key === selected?.key ? 'trend-dot is-selected' : 'trend-dot'} key={point.key} cx={point.x} cy={point.y!} r={point.key === selected?.key ? 7 : 4}><title>{point.date} {point.time} · {formatMetricValue(metric, point.value)} {definition.unit}</title></circle>)}
              </svg>
            </div>
            <div className="trend-x-labels" aria-hidden="true"><span>{first.date.replaceAll('-', '.')}</span>{first.date !== last?.date && <span>{last?.date.replaceAll('-', '.')}</span>}</div>
          </> : <div className="trend-no-metric"><p>这些记录里，还没有「{definition.label}」。</p><span>可以切换指标，或在数据导入中补充记录。</span></div>}
          <div className="trend-scrubber"><button type="button" aria-label="上一次跑步" disabled={selectedIndex <= 0} onClick={() => selectIndex(selectedIndex - 1)}>←</button><label><span>滑动查看每次跑步</span><input aria-label="选择跑步记录" type="range" min="0" max={Math.max(0, geometry.points.length - 1)} step="1" value={Math.max(0, selectedIndex)} disabled={geometry.points.length < 2} aria-valuetext={`${selected?.date} ${selected?.time ?? ''}，${formatMetricValue(metric, selected?.value ?? null)}${selected?.value === null ? '' : ` ${definition.unit}`}`} onChange={event => selectIndex(Number(event.target.value))} /></label><button type="button" aria-label="下一次跑步" disabled={selectedIndex >= geometry.points.length - 1} onClick={() => selectIndex(selectedIndex + 1)}>→</button></div>
          <div className="trend-chart-notes">{difference && <span className="trend-difference">{difference}</span>}<p>{knownCount === 1 ? '已有 1 次数据。再记录几次，就能看见变化。' : '按训练日期与时间排列；缺失指标保留为空，不连接折线。'}</p></div>
          <details className="trend-data-table"><summary>查看图表数据</summary><div className="trend-table-scroll"><table aria-label="单次跑步趋势数据"><thead><tr><th>训练日期</th><th>开始时间</th><th>{definition.label} / {definition.unit}</th></tr></thead><tbody>{series.points.map(point => <tr key={point.key}><td>{point.date}</td><td>{point.time ?? '未记录'}</td><td>{formatMetricValue(metric, point.value)}</td></tr>)}</tbody></table></div></details>
        </>}
        {series.excludedDateCount > 0 && <p className="trend-footnote">{series.excludedDateCount} 条记录的日期缺失或无效，暂未加入图表。</p>}
      </div>
    </section>
    <MonthlyActivity records={records} />
  </>;
}
