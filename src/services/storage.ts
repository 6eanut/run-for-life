import { emptyRecord, type RunRecord, type Split } from '../domain/model';
import { duplicateMatch, validateRecord, withChallenge } from '../domain/records';

const KEY = 'run-for-life:v1';
const MAX_BYTES = 5 * 1024 * 1024;

function normalize(input: unknown): RunRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('记录格式不正确');
  const source = input as Record<string, unknown>;
  const base = emptyRecord();
  const entries = Object.entries(base).filter(([key]) => !['challenge', 'splits', 'awards'].includes(key));
  const record = { ...base, ...Object.fromEntries(entries.map(([key]) => [key, source[key] ?? base[key as keyof RunRecord]])), ...(source.id ? { id: source.id as string } : {}) } as RunRecord;
  if (source.id !== undefined && (typeof source.id !== 'string' || source.id.length > 100)) throw new Error('记录编号无效');
  if (source.awards !== undefined && (!Array.isArray(source.awards) || source.awards.length > 100 || source.awards.some(x => typeof x !== 'string' || x.length > 200))) throw new Error('奖章格式无效');
  const awards = (source.awards ?? []) as string[];
  if (source.splits !== undefined && (!Array.isArray(source.splits) || source.splits.length > 500)) throw new Error('分段格式无效');
  const splits = ((source.splits ?? []) as unknown[]).map((item): Split => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('分段格式无效');
    const split = item as Split;
    if (split.isPartialSplit !== undefined && typeof split.isPartialSplit !== 'boolean') throw new Error('末段标记无效');
    return { index: split.index, durationSeconds: split.durationSeconds ?? null, paceSecondsPerKm: split.paceSecondsPerKm ?? null, heartRateBpm: split.heartRateBpm ?? null, ...(split.isPartialSplit === undefined ? {} : { isPartialSplit: split.isPartialSplit }) };
  });
  const normalized = withChallenge({ ...record, awards: [...awards], splits });
  const errors = validateRecord(normalized);
  if (errors.length) throw new Error(errors.join('；'));
  return normalized;
}

function decode(json: string): RunRecord[] {
  if (new Blob([json]).size > MAX_BYTES) throw new Error('备份文件过大，最多 5 MB');
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('无法读取 JSON，请选择有效的备份文件'); }
  if (!Array.isArray(data)) {
    const envelope = data as { version?: number; records?: unknown } | null;
    if (!envelope || envelope.version !== 1 || !Array.isArray(envelope.records)) throw new Error('不支持的备份格式或版本');
    data = envelope.records;
  }
  if ((data as unknown[]).length > 10000) throw new Error('一次最多导入 10000 条记录');
  return (data as unknown[]).map(normalize);
}

export function loadRecords(): RunRecord[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try { return decode(raw); } catch { throw new Error('本地记录已损坏或格式不兼容。请保留浏览器数据，并从备份恢复。'); }
}

function persist(records: RunRecord[]): RunRecord[] {
  const json = JSON.stringify({ version: 1, records });
  if (records.length > 10000 || new Blob([json]).size > MAX_BYTES) throw new Error('档案已达到本机容量上限，请先导出备份');
  try { localStorage.setItem(KEY, json); }
  catch { throw new Error('本地存储失败，可能空间不足。请先导出备份，再释放空间。'); }
  return records;
}

export function saveRecord(record: RunRecord, options: { allowPossibleDuplicate?: boolean } = {}): RunRecord[] {
  const candidate = normalize(record);
  const records = loadRecords();
  const others = records.filter(r => !candidate.id || r.id !== candidate.id);
  const matches = others.map(r => duplicateMatch(r, candidate));
  if (matches.includes('exact')) throw new Error('这次训练已存在，不能重复保存');
  if (matches.includes('possible') && !options.allowPossibleDuplicate) throw new Error('发现相似训练，请核对后确认是否为另一场训练');
  const saved = { ...candidate, id: candidate.id ?? crypto.randomUUID() };
  return persist(records.some(r => r.id === saved.id) ? records.map(r => r.id === saved.id ? saved : r) : [...records, saved]);
}

export function deleteRecord(id: string): RunRecord[] {
  return persist(loadRecords().filter(record => record.id !== id));
}

function planImport(candidates: RunRecord[], existing: RunRecord[]) {
  return candidates.reduce((plan, item) => {
    const candidate = normalize(item);
    if (candidate.id && plan.records.some(record => record.id === candidate.id && JSON.stringify(record) === JSON.stringify(candidate))) return { ...plan, duplicates: plan.duplicates + 1 };
    const matches = plan.records.map(r => duplicateMatch(r, candidate));
    if (matches.includes('exact')) return { ...plan, duplicates: plan.duplicates + 1 };
    const uncertain = matches.includes('possible');
    return { ...plan, records: [...plan.records, { ...candidate, id: crypto.randomUUID() }], possibleDuplicates: plan.possibleDuplicates + Number(uncertain) };
  }, { records: existing, duplicates: 0, possibleDuplicates: 0 });
}

export function previewImport(json: string): { records: RunRecord[]; duplicates: number; possibleDuplicates: number; recoveryRequired?: boolean } {
  const candidates = decode(json);
  let existing: RunRecord[];
  try { existing = loadRecords(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('损坏')) throw error;
    const plan = planImport(candidates, []);
    return { records: candidates, duplicates: plan.duplicates, possibleDuplicates: plan.possibleDuplicates, recoveryRequired: true };
  }
  const plan = planImport(candidates, existing);
  return { records: candidates, duplicates: plan.duplicates, possibleDuplicates: plan.possibleDuplicates };
}

export function confirmImport(records: RunRecord[], allowPossibleDuplicates = false, replaceDamaged = false): RunRecord[] {
  let existing: RunRecord[];
  try { existing = loadRecords(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('损坏') || !replaceDamaged) throw error;
    existing = [];
  }
  const plan = planImport(records, existing);
  if (plan.possibleDuplicates && !allowPossibleDuplicates) throw new Error('备份包含相似训练，请确认后导入');
  return persist(plan.records);
}

export function exportRecords(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: loadRecords() }, null, 2);
}

export function exportRawRecords(): string {
  return localStorage.getItem(KEY) ?? JSON.stringify({ version: 1, records: [] });
}
