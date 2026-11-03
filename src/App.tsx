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
import { formatDuration, formatPace, milestones } from './components/format';
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
  const [section, setSection] = useState('overview');
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
      setEditing(null); setImages([]); setMessage('已保存这次跑步。每一次出发，都算数。');
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
      setRecords(confirmImport(importPreview.records, importAllowed, replaceDamaged)); setImportPreview(null);
      setMessage('备份已合并导入，确定重复的训练不会重复计数。');
    } catch (cause) { setError(errorText(cause)); }
  };
  const remove = () => {
    if (!deleting?.id) return;
    try { setRecords(deleteRecord(deleting.id)); setDeleting(null); setMessage('已删除记录，累计进度已更新。'); }
    catch (cause) { setError(errorText(cause)); }
  };
  const history = (limit?: number) => <div className="runs-list">{sorted.slice(0, limit).map((record, index) => <article className="run-row" key={record.id ?? index}>
    <div className="run-marker" aria-hidden="true">↗</div><div className="run-info"><strong>{record.date?.replaceAll('-', '.')} <span>{record.startTime}</span></strong><p>{record.activityType === 'indoor_running' ? '室内跑步' : '跑步'} · {formatDuration(record.durationSeconds)}{record.location && ` · ${record.location}`}</p></div>
    <div className="run-distance"><strong>{record.distanceKm?.toFixed(2) ?? '—'}</strong><span>公里</span></div>
    <span className={`run-badge ${record.challenge.completed ? 'complete' : ''}`}>{record.challenge.completed ? '已完成' : '训练记录'}</span>
    <button className="text-button" onClick={() => showEditor(record)} aria-label={`查看或编辑 ${record.date} ${record.startTime ?? ''} 的记录`}>查看 <span>↗</span></button>
    {section === 'history' && <button className="text-button danger" aria-label={`删除 ${record.date} ${record.startTime ?? ''} 的记录`} onClick={() => { setError(''); setDeleting(record); }}>删除</button>}
  </article>)}{!records.length && <div className="empty-state"><span aria-hidden="true">↗</span><h3>下一次出发，值得记下来。</h3><p>上传跑步截图，或手动记录你的第一程。</p><button className="text-button" onClick={() => showEditor(emptyRecord())}>记录第一次跑步 →</button></div>}</div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setSection('overview'); }}><span className="brand-symbol">↗</span><div>跑步一生<small>RUN FOR A LIFETIME</small></div></a>
      <nav aria-label="主导航">{[['overview', '◉', '我的旅程'], ['history', '≡', '跑步记录'], ['milestones', '✳', '里程碑'], ['settings', '⚙', '设置与备份']].map(([id, icon, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}><span aria-hidden="true">{icon}</span>{label}<span className="nav-arrow">↗</span></button>)}</nav>
      <div className="sidebar-note"><span className="small-star">✳</span><p>不追求连续，<br />只追求累计。</p><small>休息不会清零。<br />回来，随时接着跑。</small></div>
      <div className="local-status"><span />记录保存在本机</div>
    </aside>
    <main className="main-content">
      <header className="topbar"><span>个人终身运动计划 <span className="topbar-dot">·</span> 始于每一次出发</span><span className="open-ended">∞ 长期开放</span></header>
      <div className="page-heading"><div><span className="eyebrow">{section === 'overview' ? 'A LITTLE RUN. A LONG JOURNEY.' : 'YOUR PERSONAL RUNNING JOURNAL'}</span><h1>{{ overview: '每一次出发，都算数。', history: '把走过的路，留在这里。', milestones: '给每一段旅程，一点奖励。', settings: '为长久的记录，留一份备份。' }[section]}</h1><p>30 分钟跑步挑战 · 没有截止日期，也没有必须连续的天数。</p></div><button className="button primary new-run" onClick={() => document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' })}>＋ 记录跑步</button></div>
      <div role="status" aria-live="polite" className={`status-message ${message ? 'visible' : ''}`}>{message}</div>
      {updateReady && <div className="notice update-notice"><span>有新版本可用，更新会保留已保存的跑步记录。</span><button className="text-button" disabled={busy || !!editing || !!importPreview || !!deleting} onClick={() => window.dispatchEvent(new Event('app-apply-update'))}>更新并刷新</button></div>}
      {section === 'overview' && <>
        <section className="journey-hero" aria-label="终身累计进度">
          <div className="hero-main"><span className="hero-kicker"><span /> 一场没有终点的挑战</span><div className="hero-count"><strong data-testid="completed-count">{stats.completedCount}</strong><span>次完成<br /><small>30 分钟的自己</small></span></div><p>跑一次，算一次。跑一生，记一生。</p><div className="hero-bottom"><span>YOUR JOURNEY CONTINUES</span><span>∞</span></div></div>
          <div className="hero-side"><div className="route-art" aria-hidden="true"><svg viewBox="0 0 280 170"><path className="route-shadow" d="M22 130 C74 130 40 38 107 38 S143 153 205 115 S215 37 260 35" /><path className="route-line" d="M22 130 C74 130 40 38 107 38 S143 153 205 115 S215 37 260 35" /><circle cx="22" cy="130" r="6" /><circle cx="260" cy="35" r="7" /></svg><span className="route-label start">START</span><span className="route-label next">KEEP GOING ↗</span></div><span className="eyebrow">下一个里程碑</span><h2>{next.title} <span>{next.count} 次</span></h2><div className="progress-track"><div style={{ width: `${stageProgress}%` }} /></div><p>再跑 <strong>{next.count - stats.completedCount}</strong> 次，解锁「{next.reward}」</p></div>
        </section>
        <section className="stats-strip" aria-label="累计数据"><div><span>累计距离</span><p>{stats.distanceKm.toFixed(2)}<small>公里</small></p></div><div><span>累计运动时间</span><p>{(stats.durationSeconds / 3600).toFixed(1)}<small>小时</small></p></div><div><span>留下的脚印</span><p>{records.length}<small>条记录</small></p></div><div className="stats-quote"><span>你的节奏，你的旅程。</span><small>今天休息，之前的努力也不会归零。</small></div></section>
      </>}
      {(section === 'overview' || section === 'history') && <section className="history-section"><div className="section-heading"><div><span className="eyebrow">THE RUNNING JOURNAL</span><h2>{section === 'overview' ? '最近的脚印' : '全部跑步记录'} <span>{records.length}</span></h2></div>{section === 'overview' && records.length > 0 && <button className="text-button" onClick={() => setSection('history')}>全部记录 ↗</button>}</div>{history(section === 'overview' ? 3 : undefined)}</section>}
      {section === 'milestones' && <section className="milestone-grid">{milestones.map(milestone => <article className={`milestone ${stats.completedCount >= milestone.count ? 'unlocked' : ''}`} key={milestone.count}><span className="milestone-star">✳</span><span className="milestone-count">{milestone.count} <small>次</small></span><h2>{milestone.title}</h2><p>{milestone.reward}</p><small>{stats.completedCount >= milestone.count ? '已解锁 · 好好奖励自己' : `还差 ${milestone.count - stats.completedCount} 次`}</small></article>)}<p className="milestone-note">1000 次之后，每 500 次都是新的纪念。没有最后一天，只有下一次出发。</p></section>}
      {section === 'settings' && <section className="settings-panel"><span className="eyebrow">KEEP YOUR MEMORIES</span><h2>让记录陪你跑得更久。</h2><p>数据保存在当前浏览器，不会自动同步到其他设备。换手机、清除网站数据前，请先导出备份。</p><div className="backup-actions"><button className="button primary" onClick={() => download()}>导出 JSON 备份 ↗</button><button className="button secondary" onClick={() => importInput.current?.click()}>导入 JSON 备份</button></div><button className="text-button" onClick={() => download(true)}>导出本机原始数据 ↗</button><p>如果档案损坏，先保存原始数据，再通过有效备份恢复。原始文件用于保留现场，不保证可以直接导入。</p><hr /><h3>添加到 iPhone 主屏幕</h3><p>用 Safari 打开本应用，点击分享，选择“添加到主屏幕”。以后从桌面图标进入。</p><h3>挑战规则</h3><p>单次运动时长达到 30 分钟记 1 次，60 分钟仍计 1 次。不足 30 分钟可以保留训练记录。休息不扣分、不清零。</p></section>}
      <section className="upload-section" id="upload-section" aria-label="截图导入"><div className="upload-copy"><span className="eyebrow">LESS TYPING. MORE RUNNING.</span><h2>两张截图，记下一次奔跑。</h2><p>选择同一次 Apple 健身训练的概览与详情截图。<br />在本机提取数据，核对后才会保存。</p><div className="upload-steps"><span>01 选择截图</span><i>→</i><span>02 核对数据</span><i>→</i><span>03 留下脚印</span></div></div><div className="upload-controls"><button disabled={busy} className="upload-zone" onClick={() => uploadInput.current?.click()}><span className="upload-icon" aria-hidden="true">＋</span><strong>{images.length ? '已选择 2 张截图' : '选择两张跑步截图'}</strong><small>{images.length ? images.map(file => file.name).join(' · ') : 'PNG / JPEG / WebP · 每张不超过 15 MB'}</small></button>{images.length > 0 && <label className="ocr-unit-selector">训练时区<input value={workoutTimezone} disabled={busy} placeholder="Asia/Shanghai" onChange={event => setWorkoutTimezone(event.target.value)} /></label>}{images.length > 0 && <label className="ocr-unit-selector">截图气温单位<select disabled={busy} value={temperatureUnit} onChange={event => setTemperatureUnit(event.target.value as typeof temperatureUnit)}><option value="celsius">摄氏 °C</option><option value="fahrenheit">华氏 °F</option><option value="">不确定，留空</option></select></label>}{images.length > 0 && <button disabled={busy} className="button primary recognize-button" onClick={recognize}>{busy ? `本地识别中 ${Math.round(progress * 100)}%` : '开始识别并核对 →'}</button>}<div className="upload-alternatives"><button disabled={busy} className="text-button" onClick={() => showEditor(emptyRecord())}>手动记录</button><span>·</span><button disabled={busy} className="text-button" onClick={() => showEditor(structuredClone(SAMPLE_RECORD), true)}>演示数据</button></div></div></section>
      <input ref={uploadInput} className="visually-hidden" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="上传两张跑步截图" onChange={selectImages} />
      <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="导入 JSON 备份文件" onChange={readImport} />
      <footer className="footer"><span>跑步一生 <span className="footer-arrow">↗</span> RUN FOR A LIFETIME</span><span>没有最后一天，只有下一次出发。 <span data-testid="app-version">v{appVersion}</span></span></footer>
    </main>
    {editing && <Modal title="核对跑步记录" onClose={() => setEditing(null)}><RecordEditor key={editing.key} record={editing.record} sample={editing.sample} conflicts={editing.conflicts} recognizedTexts={editing.recognizedTexts} timezoneSuggested={editing.timezoneSuggested} error={error} onSave={save} /></Modal>}
    {importPreview && <Modal title="核对备份导入" onClose={() => setImportPreview(null)}><div className="import-preview">{importPreview.recoveryRequired && <section className="conflicts"><strong>本机档案已损坏，需要通过备份恢复</strong><p>恢复将替换当前损坏档案。请先在设置中导出本机原始数据，核对下方备份内容，再明确确认替换。</p><label className="check"><input type="checkbox" checked={replaceDamaged} onChange={event => setReplaceDamaged(event.target.checked)} />我确认用此备份替换损坏的本机档案</label></section>}<p>读取到 <strong>{importPreview.records.length}</strong> 条训练记录。</p><p>确定重复：{importPreview.duplicates} 条，将自动跳过。</p><p>疑似重复：{importPreview.possibleDuplicates} 条。</p><div className="table-scroll"><table><thead><tr><th>日期</th><th>开始</th><th>时长</th><th>距离 km</th></tr></thead><tbody>{importPreview.records.map((record, index) => <tr key={index}><td>{record.date}</td><td>{record.startTime ?? '—'}</td><td>{formatDuration(record.durationSeconds)}</td><td>{record.distanceKm ?? '—'}</td></tr>)}</tbody></table></div>{importPreview.possibleDuplicates > 0 && <label className="check notice"><input type="checkbox" checked={importAllowed} onChange={event => setImportAllowed(event.target.checked)} />已核对疑似重复记录，确认它们属于不同训练</label>}<p>{importPreview.recoveryRequired ? '确认后使用此备份恢复本机档案。' : '仅在你确认后合并到本机记录，现有记录会保留。'}</p>{error && <p className="error" role="alert">{error}</p>}<button className="button primary save-button" disabled={(importPreview.possibleDuplicates > 0 && !importAllowed) || (!!importPreview.recoveryRequired && !replaceDamaged)} onClick={importData}>确认导入</button></div></Modal>}
    {deleting && <Modal title="删除这次记录？" onClose={() => setDeleting(null)}><div className="delete-preview"><p>{deleting.date} · {formatDuration(deleting.durationSeconds)} · {deleting.distanceKm ?? '—'} 公里</p><p>删除后累计次数和里程将重新计算。此操作无法撤销。</p>{error && <p className="error" role="alert">{error}</p>}<button className="button danger-button" onClick={remove}>确认删除</button><button className="button secondary" onClick={() => setDeleting(null)}>保留记录</button></div></Modal>}
  </div>;
}
