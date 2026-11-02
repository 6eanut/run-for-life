import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RECORD } from '../../src/domain/sample';
import { confirmImport, deleteRecord, exportRawRecords, exportRecords, loadRecords, previewImport, saveRecord } from '../../src/services/storage';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
});
describe('confirmed record storage', () => {
  it('starts empty; saves one record and recomputes challenge', () => {
    expect(loadRecords()).toEqual([]);
    const saved = saveRecord({ ...SAMPLE_RECORD, challenge: { requiredDurationSeconds: 1800, completed: false, completedCount: 0 } });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBeTruthy();
    expect(saved[0].challenge.completedCount).toBe(1);
    expect(loadRecords()).toEqual(saved);
  });
  it('blocks repeated workouts but allows two different workouts per day', () => {
    saveRecord(SAMPLE_RECORD);
    expect(() => saveRecord(SAMPLE_RECORD)).toThrow(/重复/);
    expect(saveRecord({ ...SAMPLE_RECORD, startTime: '08:00', endTime: '08:31' })).toHaveLength(2);
  });
  it('requires confirmation for a possible duplicate', () => {
    saveRecord(SAMPLE_RECORD);
    const candidate = { ...SAMPLE_RECORD, startTime: null };
    expect(() => saveRecord(candidate)).toThrow(/相似/);
    expect(saveRecord(candidate, { allowPossibleDuplicate: true })).toHaveLength(2);
  });
  it('updates by ID and deletes without mutating the input', () => {
    const before = saveRecord(SAMPLE_RECORD);
    const input = { ...before[0], distanceKm: 5 };
    expect(saveRecord(input)[0].distanceKm).toBe(5);
    expect(before[0].distanceKm).toBe(4.36);
    expect(deleteRecord(before[0].id!)).toEqual([]);
  });
  it('rejects invalid saves', () => {
    expect(() => saveRecord({ ...SAMPLE_RECORD, distanceKm: -2 })).toThrow();
  });
  it('does not wipe corrupt stored data or hide write errors', () => {
    memory.set('run-for-life:v1', '{broken');
    expect(() => loadRecords()).toThrow(/损坏/);
    expect(memory.get('run-for-life:v1')).toBe('{broken');
    memory.clear();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => saveRecord(SAMPLE_RECORD)).toThrow(/存储/);
  });
});
describe('JSON backup integration', () => {
  it('does not duplicate an unchanged exported manual record with incomplete identity', () => {
    saveRecord({ ...SAMPLE_RECORD, startTime: null });
    const preview = previewImport(exportRecords());
    expect(preview.duplicates).toBe(1);
    expect(confirmImport(preview.records)).toHaveLength(1);
  });
  it('preserves raw damaged data until explicitly confirmed recovery', () => {
    expect(exportRawRecords()).toContain('records');
    memory.set('run-for-life:v1', '{broken');
    const preview = previewImport(JSON.stringify([SAMPLE_RECORD]));
    expect(preview.recoveryRequired).toBe(true);
    expect(exportRawRecords()).toBe('{broken');
    expect(() => confirmImport(preview.records)).toThrow(/损坏/);
    expect(confirmImport(preview.records, false, true)).toHaveLength(1);
  });
  it('rejects oversized final store before writing and preserves existing data', () => {
    const stored = saveRecord(SAMPLE_RECORD);
    const huge = { ...SAMPLE_RECORD, startTime: '08:00', awards: Array.from({ length: 100 }, () => '中'.repeat(200)) };
    const candidates = Array.from({ length: 95 }, (_, i) => ({ ...huge, date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}` }));
    expect(() => confirmImport(candidates)).toThrow(/容量/);
    expect(loadRecords()).toEqual(stored);
  });
  it('previews without saving; confirms and reimports idempotently', () => {
    const json = JSON.stringify([SAMPLE_RECORD]);
    const preview = previewImport(json);
    expect(preview.records).toHaveLength(1);
    expect(loadRecords()).toEqual([]);
    confirmImport(preview.records);
    const exported = exportRecords();
    const again = previewImport(exported);
    expect(again.duplicates).toBe(1);
    expect(confirmImport(again.records)).toHaveLength(1);
  });
  it('previews duplicate records within a backup', () => {
    const preview = previewImport(JSON.stringify([SAMPLE_RECORD, SAMPLE_RECORD]));
    expect(preview.duplicates).toBe(1);
    expect(confirmImport(preview.records)).toHaveLength(1);
  });
  it('requires explicit approval for uncertain imports and preserves existing IDs', () => {
    const existing = saveRecord(SAMPLE_RECORD)[0];
    const input = { ...SAMPLE_RECORD, id: existing.id, startTime: null, distanceKm: 5 };
    const preview = previewImport(JSON.stringify([input]));
    expect(preview.possibleDuplicates).toBe(1);
    expect(() => confirmImport(preview.records)).toThrow(/相似/);
    const result = confirmImport(preview.records, true);
    expect(result).toHaveLength(2);
    expect(result[0].id).not.toBe(result[1].id);
    expect(result[0].distanceKm).toBe(4.36);
  });
  it.each(['{}', 'null', 'no json', '[{}]', '{"version":9,"records":[]}', '[{"date":"<script>"}]'])('rejects malformed import %s atomically', json => {
    expect(() => previewImport(json)).toThrow();
    expect(loadRecords()).toEqual([]);
  });
  it('bounds import file size and strips unknown properties', () => {
    expect(() => previewImport(' '.repeat(5 * 1024 * 1024 + 1))).toThrow(/过大/);
    const preview = previewImport(JSON.stringify([{ ...SAMPLE_RECORD, dangerous: '<script>' }]));
    expect(preview.records[0]).not.toHaveProperty('dangerous');
  });
});
