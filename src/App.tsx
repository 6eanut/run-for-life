import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { version as appVersion } from '../package.json';
import { emptyRecord, type RunRecord } from './domain/model';
import { mergeWorkoutResults, parseWorkoutText } from './domain/parser';
import { getStats } from './domain/records';
import { SAMPLE_RECORD } from './domain/sample';
import { recognizeScreenshots } from './services/ocr';
import { confirmImport, deleteRecord, exportRawRecords, exportRecords, loadRecords, previewImport, saveRecord } from './services/storage';
import { Modal } from './components/Modal';
import { RecordEditor } from './components/RecordEditor';
import { formatDuration, milestones } from './components/format';
import { Trends } from './components/Trends';
import './styles.css';

type Conflict = { field: string; values: unknown[] };
type Editing = { record: RunRecord; conflicts: Conflict[]; sample: boolean; key: number; recognizedTexts?: string[]; timezoneSuggested?: boolean };
type ImportPreview = ReturnType<typeof previewImport>;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '操作未完成，请重试。';

export default function App() {
  const [initial] = useState(() => {
    try { return { records: loadRecords(), error: '' }; }
    catch (cause) { return { records: [] as RunRecord[], error: errorText(cause) }; }
  });
  const [records, setRecords] = useState<RunRecord[]>(initial.records);
  const [section, setSection] = useState<'stats' | 'import'>('stats');
  const [message, setMessage] = useState(initial.error);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [temperatureUnit, setTemperatureUnit] = useState<'celsius' | 'fahrenheit' | ''>('celsius');
  const [workoutTimezone, setWorkoutTimezone] = useState('Asia/Shanghai');
  const [updateReady, setUpdateReady] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importAllowed, setImportAllowed] = useState(false);
  const [replaceDamaged, setReplaceDamaged] = useState(false);
  const [deleting, setDeleting] = useState<RunRecord | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener('app-update-ready', ready);
    window.dispatchEvent(new Event('app-check-update'));
    return () => window.removeEventListener('app-update-ready', ready);
  }, []);
  const stats = getStats(records);
  const missingDistances = records.filter(record => record.distanceKm === null).length;
  const distanceDisplay = records.length > 0 && missingDistances === records.length ? '—' : stats.distanceKm.toFixed(2);
  const next = milestones.find(milestone => milestone.count > stats.completedCount) ?? { count: Math.ceil((stats.completedCount + 1) / 500) * 500, title: '继续奔跑', reward: '为下一程选择一份自己的奖励' };
  const previous = [...milestones].reverse().find(milestone => milestone.count <= stats.completedCount)?.count ?? 0;
  const stageProgress = Math.max(0, Math.min(100, (stats.completedCount - previous) / (next.count - previous) * 100));
  const sorted = [...records].sort((a, b) => `${b.date ?? ''} ${b.startTime ?? ''}`.localeCompare(`${a.date ?? ''} ${a.startTime ?? ''}`));
  const showEditor = (record: RunRecord, sample = false, conflicts: Conflict[] = []) => {
    setError(''); setEditing({ record, sample, conflicts, key: Date.now() });
  };
  const recognize = async () => {
    if (images.length !== 2) { setMessage('请选择同一次跑步的两张截图。'); return; }
    if (workoutTimezone.trim()) {
      try { new Intl.DateTimeFormat('zh-CN', { timeZone: workoutTimezone.trim() }).format(); }
      catch { setMessage('训练时区无效，请核对后再识别，例如 Asia/Shanghai。'); return; }
    }
    setBusy(true); setProgress(0); setMessage('正在本地识别，首次使用需要下载识别模型…');
    try {
      const texts = await recognizeScreenshots(images, setProgress);
      const merged = mergeWorkoutResults(texts.map(text => parseWorkoutText(text, { temperatureUnit: temperatureUnit || undefined })));
      const timezoneConflict = merged.conflicts.some(conflict => conflict.field === 'timezone');
      const timezoneSuggested = !merged.record.timezone && !!workoutTimezone.trim() && !timezoneConflict;
      const record = { ...merged.record, timezone: merged.record.timezone || (timezoneConflict ? null : workoutTimezone.trim() || null) };
      setError(''); setEditing({ record, sample: false, conflicts: merged.conflicts, key: Date.now(), recognizedTexts: texts, timezoneSuggested });
      setMessage('识别完成，请核对后保存。空白指标可以查看识别文字后补充。');
    } catch (cause) { setMessage(errorText(cause)); }
    finally { setBusy(false); }
  };
  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (files.length !== 2) { setMessage('每次请选择同一次训练的两张截图。'); setImages([]); }
    else if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024)) {
      setMessage('请选择 PNG、JPEG 或 WebP 截图，每张不超过 15 MB。'); setImages([]);
    } else { setImages(files); setMessage('已选择两张截图，点击开始识别。'); }
    event.target.value = '';
  };
  const save = (record: RunRecord, allowPossibleDuplicate: boolean) => {
    try {
      setRecords(saveRecord(record, { allowPossibleDuplicate }));
      setEditing(null); setImages([]); setSection('stats'); setMessage('已保存这次跑步。每一次出发，都算数。');
    } catch (cause) { setError(errorText(cause)); }
  };
  const download = (raw = false) => {
    try {
      const url = URL.createObjectURL(new Blob([raw ? exportRawRecords() : exportRecords()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `跑步一生-${raw ? '原始数据-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('备份文件已生成，请妥善保存。');
    } catch (cause) { setMessage(errorText(cause)); }
  };
  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setMessage('JSON 文件不能超过 5 MB。'); return; }
    try { setImportPreview(previewImport(await file.text())); setImportAllowed(false); setReplaceDamaged(false); setError(''); }
    catch (cause) { setMessage(errorText(cause)); }
  };
  const importData = () => {
    if (!importPreview) return;
    try {
      setRecords(confirmImport(importPreview.records, importAllowed, replaceDamaged)); setImportPreview(null); setSection('stats');
      setMessage('备份已合并导入，确定重复的训练不会重复计数。');
    } catch (cause) { setError(errorText(cause)); }
  };
  const remove = () => {
    if (!deleting?.id) return;
    try { setRecords(deleteRecord(deleting.id)); setDeleting(null); setMessage('已删除记录，累计进度已更新。'); }
    catch (cause) { setError(errorText(cause)); }
  };
  const history = () => <div className="runs-list">{sorted.map((record, index) => <article className="run-row" key={record.id ?? index}>
    <div className="run-marker" aria-hidden="true">↗</div>
    <div className="run-info"><strong>{record.date?.replaceAll('-', '.')} <span>{record.startTime}</span></strong><p>{record.activityType === 'indoor_running' ? '室内跑步' : '跑步'} · {formatDuration(record.durationSeconds)}{record.location && ` · ${record.location}`}</p></div>
    <div className="run-distance"><strong>{record.distanceKm?.toFixed(2) ?? '—'}</strong><span>公里</span></div>
    <span className={`run-badge ${record.challenge.completed ? 'complete' : ''}`}>{record.challenge.completed ? '30 分钟 ✓' : '训练记录'}</span>
    <div className="run-actions"><button disabled={busy} className="text-button" onClick={() => showEditor(record)} aria-label={`查看或编辑 ${record.date} ${record.startTime ?? ''} 的记录`}>编辑</button><button disabled={busy} className="text-button danger" aria-label={`删除 ${record.date} ${record.startTime ?? ''} 的记录`} onClick={() => { setError(''); setDeleting(record); }}>删除</button></div>
  </article>)}{!records.length && <div className="empty-state"><span aria-hidden="true">↗</span><h3>还没有跑步记录</h3><p>从上方导入截图，你的第一程就会出现在这里。</p></div>}</div>;
  return <div className="app-shell">
    <header className="app-header">
      <div className="header-inner">
        <a className="brand" href="#" onClick={event => { event.preventDefault(); setSection('stats'); }}><span className="brand-symbol" aria-hidden="true">↗</span><div>跑步一生<small>RUN FOR A LIFETIME</small></div></a>
        <nav className="main-nav" aria-label="主导航">
          <button className={section === 'stats' ? 'active' : ''} aria-current={section === 'stats' ? 'page' : undefined} onClick={() => setSection('stats')}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3 16V9m7 7V4m7 12v-6" /></svg>统计</button>
          <button className={section === 'import' ? 'active' : ''} aria-current={section === 'import' ? 'page' : undefined} onClick={() => setSection('import')}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 13V3m-4 4 4-4 4 4M3 12v5h14v-5" /></svg>数据导入{busy && <span className="nav-busy" aria-label="正在识别" />}</button>
        </nav>
        <span className="version-badge" aria-label={`当前版本 v${appVersion}`}>版本 <strong data-testid="app-version">v{appVersion}</strong></span>
      </div>
    </header>
    <main className="main-content" id="main-content">
      <div className="page-heading">
        <div><span className="eyebrow">{section === 'stats' ? 'YOUR RUNNING, OVER TIME' : 'ONE RUN. TWO SCREENSHOTS.'}</span><h1>{section === 'stats' ? '看见每一次出发的积累。' : '把新的一程，记进来。'}</h1><p>{section === 'stats' ? '不必连续，不必赶路。用时间，看见自己的变化。' : '上传两张截图，核对数据，留下一次真实的跑步。'}</p></div>
        {section === 'stats' && <button className="button primary new-run" onClick={() => setSection('import')}>＋ 记录跑步</button>}
      </div>
      <div role="status" aria-live="polite" className={`status-message ${message ? 'visible' : ''}`}>{message}</div>
      {updateReady && <div className="notice update-notice"><span>有新版本可用，更新会保留已保存的跑步记录。</span><button className="text-button" disabled={busy || !!editing || !!importPreview || !!deleting} onClick={() => window.dispatchEvent(new Event('app-apply-update'))}>更新并刷新</button></div>}
      {section === 'stats' && <div className="stats-page">
        <section className="summary-hero" aria-label="累计数据">
          <div className="summary-intro"><span className="hero-kicker"><span /> 从第一次，到每一次</span><span className="hero-loop" aria-hidden="true">∞</span></div>
          <div className="summary-grid">
            <div className="summary-stat"><span>累计跑步</span><p><strong data-testid="total-runs">{records.length}</strong><small>次</small></p><span className="summary-note">每一条真实记录，都算数</span></div>
            <div className="summary-stat"><span>累计距离</span><p><strong data-testid="total-distance" className={distanceDisplay.length > 6 ? 'long-number' : undefined}>{distanceDisplay}</strong><small>公里</small></p><span className="summary-note">{missingDistances ? `${missingDistances} 次未记录距离，合计已知数据` : '一步一步，跑到这里'}</span></div>
            <div className="summary-stat"><span>累计时间</span><p><strong>{(stats.durationSeconds / 3600).toFixed(1)}</strong><small>小时</small></p><span className="summary-note">留给自己的运动时间</span></div>
          </div>
          <div className="challenge-strip"><span><strong data-testid="completed-count">{stats.completedCount}</strong> 次达到 30 分钟</span><span>休息不会清零，随时接着跑。<span aria-hidden="true"> ↗</span></span></div>
        </section>
        {!records.length && <section className="first-run-note"><span className="note-symbol" aria-hidden="true">✳</span><div><h2>先记下一次，变化就有了起点。</h2><p>导入第一次跑步后，这里会开始呈现你的距离、配速与心率变化。</p></div><button className="text-button" onClick={() => setSection('import')}>导入第一程 <span aria-hidden="true">↗</span></button></section>}
        <Trends records={records} />
        <section className="milestone-summary" aria-label="挑战里程碑"><div className="milestone-label"><span aria-hidden="true">✳</span><div><span className="eyebrow">下一个小小的庆祝</span><h2>{next.count} 次 · {next.title}</h2></div></div><div className="milestone-progress"><div className="progress-track"><div style={{ width: `${stageProgress}%` }} /></div><p>再完成 {next.count - stats.completedCount} 次 30 分钟跑步 · {next.reward}</p></div></section>
      </div>}
      {section === 'import' && <div className="import-page">
        <section className="upload-section" id="upload-section" aria-label="截图导入">
          <div className="upload-copy"><span className="eyebrow">留住这次出发</span><h2>两张截图，<br />记下一次跑步。</h2><p>选择同一次 Apple 健身训练的<br className="desktop-break" />概览和分段详情截图。</p><ol className="upload-steps"><li><span>01</span><div><strong>选择截图</strong><small>一次选中两张</small></div></li><li><span>02</span><div><strong>本机识别</strong><small>提取数据，合并同一次训练</small></div></li><li><span>03</span><div><strong>核对后保存</strong><small>只有你确认，才会加入统计</small></div></li></ol></div>
          <div className="upload-controls"><button disabled={busy} className={`upload-zone ${images.length ? 'has-images' : ''}`} onClick={() => uploadInput.current?.click()}><span className="upload-icon" aria-hidden="true">＋</span><strong>{images.length ? '已选择 2 张截图' : '选择两张跑步截图'}</strong><small>{images.length ? images.map(file => file.name).join(' · ') : 'PNG / JPEG / WebP · 每张不超过 15 MB'}</small>{images.length > 0 && <span className="change-images">重新选择</span>}</button>
            {images.length > 0 && <div className="recognition-settings"><label className="ocr-unit-selector">训练时区<input value={workoutTimezone} disabled={busy} placeholder="Asia/Shanghai" onChange={event => setWorkoutTimezone(event.target.value)} /></label><label className="ocr-unit-selector">截图气温单位<select disabled={busy} value={temperatureUnit} onChange={event => setTemperatureUnit(event.target.value as typeof temperatureUnit)}><option value="celsius">摄氏 °C</option><option value="fahrenheit">华氏 °F</option><option value="">不确定，留空</option></select></label><p>截图未注明时区时按此填写，保存前可以修改。</p></div>}
            {images.length > 0 && <><button disabled={busy} className="button primary recognize-button" onClick={recognize}>{busy ? `本地识别中 ${Math.round(progress * 100)}%` : '开始识别并核对 →'}</button>{busy && <progress className="ocr-progress" value={progress} max={1} aria-label="图片识别进度" />}</>}
            <p className="local-processing"><span aria-hidden="true">◇</span> 图片仅在本机处理，核对后才会保存记录</p><div className="upload-alternatives"><button disabled={busy} className="text-button" onClick={() => showEditor(emptyRecord())}>手动记录</button><span>·</span><button disabled={busy} className="text-button" onClick={() => showEditor(structuredClone(SAMPLE_RECORD), true)}>演示数据</button></div>
          </div>
        </section>
        <section className="history-section" aria-label="已保存的跑步记录"><div className="section-heading"><div><span className="eyebrow">YOUR RUNNING JOURNAL</span><h2>已保存的记录 <span>{records.length}</span></h2></div><span className="section-caption">核对、编辑，或删除一条记录</span></div>{history()}</section>
        <details className="backup-panel"><summary><span><span className="backup-icon" aria-hidden="true">↓</span>备份与使用说明</span><small>JSON 导入 / 导出 <span aria-hidden="true">＋</span></small></summary><div className="settings-panel"><h3>让记录陪你跑得更久。</h3><p>数据保存在当前浏览器，不会自动同步到其他设备。换手机、清除网站数据前，请先导出备份。</p><div className="backup-actions"><button className="button primary" onClick={() => download()}>导出 JSON 备份 ↗</button><button disabled={busy} className="button secondary" onClick={() => importInput.current?.click()}>导入 JSON 备份</button></div><button className="text-button" onClick={() => download(true)}>导出本机原始数据 ↗</button><p>如果档案损坏，先保存原始数据，再通过有效备份恢复。原始文件用于保留现场，不保证可以直接导入。</p><div className="usage-notes"><div><h3>添加到 iPhone 主屏幕</h3><p>用 Safari 打开，点击分享，选择“添加到主屏幕”，以后可以从桌面进入。</p></div><div><h3>30 分钟挑战规则</h3><p>单次时长达到 30 分钟记 1 次，60 分钟仍计 1 次。不足 30 分钟也可以保留记录。休息不扣分、不清零。</p></div></div></div></details>
      </div>}
      <input ref={uploadInput} className="visually-hidden" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="上传两张跑步截图" onChange={selectImages} />
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="导入 JSON 备份文件" onChange={readImport} />
      <footer className="footer"><span><span className="local-dot" />记录保存在本机 · 记得定期备份</span><span>跑一次，算一次。<span className="footer-arrow" aria-hidden="true">↗</span></span></footer>
    </main>
    {editing && <Modal title="核对跑步记录" onClose={() => setEditing(null)}><RecordEditor key={editing.key} record={editing.record} sample={editing.sample} conflicts={editing.conflicts} recognizedTexts={editing.recognizedTexts} timezoneSuggested={editing.timezoneSuggested} error={error} onSave={save} /></Modal>}
    {importPreview && <Modal title="核对备份导入" onClose={() => setImportPreview(null)}><div className="import-preview">{importPreview.recoveryRequired && <section className="conflicts"><strong>本机档案已损坏，需要通过备份恢复</strong><p>恢复将替换当前损坏档案。请先在备份与使用说明中导出本机原始数据，核对下方备份内容，再明确确认替换。</p><label className="check"><input type="checkbox" checked={replaceDamaged} onChange={event => setReplaceDamaged(event.target.checked)} />我确认用此备份替换损坏的本机档案</label></section>}<p>读取到 <strong>{importPreview.records.length}</strong> 条训练记录。</p><p>确定重复：{importPreview.duplicates} 条，将自动跳过。</p><p>疑似重复：{importPreview.possibleDuplicates} 条。</p><div className="table-scroll"><table><thead><tr><th>日期</th><th>开始</th><th>时长</th><th>距离 km</th></tr></thead><tbody>{importPreview.records.map((record, index) => <tr key={index}><td>{record.date}</td><td>{record.startTime ?? '—'}</td><td>{formatDuration(record.durationSeconds)}</td><td>{record.distanceKm ?? '—'}</td></tr>)}</tbody></table></div>{importPreview.possibleDuplicates > 0 && <label className="check notice"><input type="checkbox" checked={importAllowed} onChange={event => setImportAllowed(event.target.checked)} />已核对疑似重复记录，确认它们属于不同训练</label>}<p>{importPreview.recoveryRequired ? '确认后使用此备份恢复本机档案。' : '仅在你确认后合并到本机记录，现有记录会保留。'}</p>{error && <p className="error" role="alert">{error}</p>}<button className="button primary save-button" disabled={(importPreview.possibleDuplicates > 0 && !importAllowed) || (!!importPreview.recoveryRequired && !replaceDamaged)} onClick={importData}>确认导入</button></div></Modal>}
    {deleting && <Modal title="删除这次记录？" onClose={() => setDeleting(null)}><div className="delete-preview"><p>{deleting.date} · {formatDuration(deleting.durationSeconds)} · {deleting.distanceKm ?? '—'} 公里</p><p>删除后累计次数和里程将重新计算。此操作无法撤销。</p>{error && <p className="error" role="alert">{error}</p>}<button className="button danger-button" onClick={remove}>确认删除</button><button className="button secondary" onClick={() => setDeleting(null)}>保留记录</button></div></Modal>}
  </div>;
}
