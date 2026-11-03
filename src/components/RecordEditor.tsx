import { useState, type FormEvent } from 'react';
import type { RunRecord } from '../domain/model';
import { parseDuration, parsePace } from '../domain/parser';
import { validateRecord, withChallenge } from '../domain/records';
import { formatDuration, formatPace } from './format';

type Conflict = { field: string; values: unknown[] };
type Props = {
  record: RunRecord;
  conflicts: Conflict[];
  sample: boolean;
  onSave: (record: RunRecord, allowPossibleDuplicate: boolean) => void;
  error: string;
  recognizedTexts?: string[];
};

const extraFields = [
  ['averagePowerWatts', '平均功率（瓦）'], ['activeCaloriesKcal', '动态消耗（千卡）'],
  ['totalCaloriesKcal', '总消耗（千卡）'], ['elevationGainMeters', '累计爬升（米）'],
  ['effortLevel', '运动强度（1–10）'], ['temperatureCelsius', '气温（°C）'],
  ['humidityPercent', '湿度（%）'], ['airQualityIndex', '空气质量指数'],
] as const;
const labels: Record<string, string> = {
  date: '日期', startTime: '开始时间', endTime: '结束时间', activityType: '运动类型',
  durationSeconds: '运动时长', distanceKm: '距离', averageHeartRateBpm: '平均心率',
  averageCadenceSpm: '平均步频', averagePaceSecondsPerKm: '平均配速', timezone: '时区',
};

export function RecordEditor({ record, conflicts, sample, onSave, error, recognizedTexts }: Props) {
  const [draft, setDraft] = useState(record);
  const [duration, setDuration] = useState(record.durationSeconds == null ? '' : formatDuration(record.durationSeconds));
  const [pace, setPace] = useState(record.averagePaceSecondsPerKm == null ? '' : formatPace(record.averagePaceSecondsPerKm));
  const [splitText, setSplitText] = useState(JSON.stringify(record.splits, null, 2));
  const [confirmedConflicts, setConfirmedConflicts] = useState(false);
  const [allowPossible, setAllowPossible] = useState(false);
  const [validationError, setValidationError] = useState('');
  const change = (field: keyof RunRecord, value: unknown) => setDraft(current => ({ ...current, [field]: value }));
  const numeric = (field: keyof RunRecord, label: string) => <label key={field}>{label}<input
    type="number" step="any" inputMode="decimal" value={(draft[field] as number | null) ?? ''}
    onChange={event => change(field, event.target.value === '' ? null : Number(event.target.value))} /></label>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const seconds = duration.trim() === '' ? null : parseDuration(duration);
      if (duration.trim() && seconds === null) throw new Error('请按 时:分:秒 或 分:秒 填写运动时长。');
      const parsedPace = pace.trim() === '' ? null : parsePace(pace);
      if (pace.trim() && parsedPace === null) throw new Error('请按 6:55 或 6′55″ 填写配速。');
      const splits: unknown = JSON.parse(splitText);
      if (!Array.isArray(splits)) throw new Error('分段数据必须是 JSON 数组。');
      // The domain validator checks every split before anything can be persisted.
      const candidate = withChallenge({ ...draft, durationSeconds: seconds, averagePaceSecondsPerKm: parsedPace, splits: splits as RunRecord['splits'] });
      const errors = validateRecord(candidate);
      if (errors.length) throw new Error(errors.join('；'));
      if (conflicts.length && !confirmedConflicts) throw new Error('请先核对截图中的冲突字段。');
      setValidationError('');
      onSave(candidate, allowPossible);
    } catch (cause) { setValidationError(cause instanceof Error ? cause.message : '请检查输入的数据。'); }
  };
  const completed = (parseDuration(duration) ?? 0) >= 1800;
  return <form className="record-editor" onSubmit={submit}>
    {sample && <p className="notice">演示数据 · 保存后才会加入你的记录，请先核对它是否是你的真实训练。示例时区 Asia/Shanghai 根据北京地点推定，请核对并修改。</p>}
    <p className="editor-hint">空白字段表示未识别。请核对日期和运动时长，其余数据可以稍后补充。</p>
    {recognizedTexts && <details className="ocr-source"><summary>查看识别文字</summary><p className="editor-hint">包含 OCR 原文与按版面整理的指标，核对后再保存。</p>{recognizedTexts.map((text, index) => <section key={index}><strong>截图 {index + 1}</strong><pre>{text.trim() || '未识别到文字'}</pre></section>)}</details>}
    {!!conflicts.length && <section className="conflicts" aria-label="识别冲突">
      <strong>两张截图存在不同数值，请确认属于同一次训练</strong>
      <ul>{conflicts.map(conflict => <li key={conflict.field}>{labels[conflict.field] ?? conflict.field}：{conflict.values.map(value => JSON.stringify(value)).join(' / ')}</li>)}</ul>
      <label className="check"><input type="checkbox" checked={confirmedConflicts} onChange={event => setConfirmedConflicts(event.target.checked)} />我已核对并在下方填写正确数据，确认是同一次训练</label>
    </section>}
    <div className="form-grid">
      <label>运动日期<input type="date" value={draft.date ?? ''} onChange={event => change('date', event.target.value || null)} required /></label>
      <label>运动类型<select value={draft.activityType ?? ''} onChange={event => change('activityType', event.target.value || null)}><option value="">未识别</option><option value="outdoor_running">户外跑步</option><option value="indoor_running">室内跑步</option><option value="running">跑步</option></select></label>
      <label>运动时长<input placeholder="30:12 或 0:30:12" value={duration} onChange={event => setDuration(event.target.value)} required /></label>
      {numeric('distanceKm', '跑步距离（公里）')}
      <label>开始时间<input type="time" value={draft.startTime ?? ''} onChange={event => change('startTime', event.target.value || null)} /></label>
      <label>结束时间<input type="time" value={draft.endTime ?? ''} onChange={event => change('endTime', event.target.value || null)} /></label>
      <label>平均配速（分/公里）<input placeholder="6:55" value={pace} onChange={event => setPace(event.target.value)} /></label>
      {numeric('averageHeartRateBpm', '平均心率（次/分）')}
      {numeric('averageCadenceSpm', '平均步频（步/分）')}
      <label>时区<input placeholder="例如 Asia/Shanghai" value={draft.timezone ?? ''} onChange={event => change('timezone', event.target.value || null)} /></label>
    </div>
    <p className={`challenge-result ${completed ? 'is-complete' : ''}`}>{completed ? '✓ 达到 30 分钟，保存后计入 1 次挑战' : '未满 30 分钟也可以保存，暂不计入挑战次数'}</p>
    <details className="extra-fields"><summary>更多数据与分段记录 <span>展开编辑</span></summary>
      <div className="form-grid">{extraFields.map(([field, label]) => numeric(field, label))}
        {([['effortDescription', '强度描述'], ['location', '地点'], ['source', '记录设备']] as const).map(([field, label]) => <label key={field}>{label}<input value={draft[field] ?? ''} onChange={event => change(field, event.target.value || null)} /></label>)}
        <label>获得奖章（每行一个）<textarea value={draft.awards.join('\n')} onChange={event => change('awards', event.target.value.split('\n').filter(Boolean))} /></label>
      </div>
      {draft.splits.length > 0 && <div className="table-scroll"><table><thead><tr><th>分段</th><th>时间</th><th>配速 / km</th><th>心率</th></tr></thead><tbody>{draft.splits.map(split => <tr key={split.index}><td>{split.index}{split.isPartialSplit && '（不足1公里）'}</td><td>{formatDuration(split.durationSeconds)}</td><td>{formatPace(split.paceSecondsPerKm)}</td><td>{split.heartRateBpm ?? '—'}</td></tr>)}</tbody></table></div>}
      <label className="split-editor">分段 JSON（时长和配速单位为秒，可编辑）<textarea rows={9} spellCheck={false} value={splitText} onChange={event => setSplitText(event.target.value)} /></label>
      <p className="editor-hint">末段不补算精确距离；运动时长采用明确显示的训练时长。</p>
    </details>
    {(error.includes('疑似') || error.includes('相似')) && <label className="check notice"><input type="checkbox" checked={allowPossible} onChange={event => setAllowPossible(event.target.checked)} />我已核对，确认这是另一场训练，允许保存</label>}
    {(validationError || error) && <p role="alert" className="error">{validationError || error}</p>}
    <button className="button primary save-button" type="submit" disabled={conflicts.length > 0 && !confirmedConflicts}>确认并保存 <span>↗</span></button>
  </form>;
}
