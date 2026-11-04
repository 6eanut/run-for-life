import { useEffect, useMemo, useState } from 'react';
import type { RunRecord } from '../domain/model';
import { Modal } from './Modal';
import { createRunMemoryPng, memoryCardFilename } from '../services/memory-card';
import './MemoryCardDialog.css';

type Status = 'loading' | 'ready' | 'error';

// The preview is only ever shown/saved when it belongs to the exact record and
// location choice that is selected right now, so a superseded async result can
// never masquerade as the current card.
interface Preview {
  url: string;
  blob: Blob;
  includeLocation: boolean;
  // Content signature of the record the PNG was generated from. Matching on it
  // (not just the option) keeps a stale blob from being used on the first frame
  // after the record prop changes and before the effect runs.
  signature: string;
}

const LOCATION_LABEL = '在卡片上显示地点';
const NO_LOCATION_NOTE = '这次记录没有地点';

const hasRealLocation = (record: RunRecord): boolean =>
  typeof record.location === 'string' && record.location.trim().length > 0;

const trainingDate = (record: RunRecord): string =>
  typeof record.date === 'string' && record.date.trim() ? record.date.trim() : '日期未记录';

export function MemoryCardDialog({ record, onClose }: { record: RunRecord; onClose: () => void }) {
  const [includeLocation, setIncludeLocation] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const locationAvailable = hasRealLocation(record);
  // A content signature, not the object identity, drives regeneration: a parent
  // re-render with an equal record never churns, while a real change always does.
  const signature = useMemo(() => JSON.stringify(record), [record]);
  const filename = memoryCardFilename(record);

  useEffect(() => {
    // Generation token: cleanup flips `cancelled` before any newer run starts and
    // on unmount, so a stale result is dropped before it can allocate a URL.
    let cancelled = false;
    let createdUrl: string | null = null;

    setStatus('loading');
    setMessage('');
    setSaveError('');
    setPreview(null);

    createRunMemoryPng(record, { includeLocation })
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setPreview({ url, blob, includeLocation, signature });
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(error instanceof Error && error.message ? error.message : '纪念卡生成失败，请重试');
        setStatus('error');
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // The record is keyed by its content signature above: an equal record on a
    // parent re-render never restarts work, while a real change always does.
  }, [signature, includeLocation, attempt]);

  // Only a result that matches the currently selected record AND option counts as
  // current; anything else is treated as absent, so a superseded blob can never be
  // shown or downloaded, even on the frame before the effect re-runs.
  const active = preview && preview.signature === signature && preview.includeLocation === includeLocation ? preview : null;
  const canSave = status === 'ready' && active !== null;

  const save = () => {
    if (!active) return;
    // Clear a previous failure before this attempt, so a later success never keeps
    // showing the stale "保存失败" alert.
    setSaveError('');
    let url: string | null = null;
    try {
      url = URL.createObjectURL(active.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => { if (url) URL.revokeObjectURL(url); }, 1000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setSaveError('保存失败，请重试');
    }
  };

  return <Modal title="跑步纪念卡" onClose={onClose}>
    <div className="memory-card-dialog">
      <p className="memory-card-lead">把这次跑步留下来。</p>

      <div className="memory-card-frame" data-state={active ? 'ready' : status}>
        {active
          ? <img className="memory-card-preview" data-testid="memory-card-preview" src={active.url}
              alt={`跑步纪念卡 · ${trainingDate(record)}`} />
          : status === 'error'
            ? <span className="memory-card-frame-note" aria-hidden="true">未能生成</span>
            : <span className="memory-card-spinner" aria-hidden="true" />}
      </div>

      {active === null && status !== 'error' && <p className="memory-card-status" role="status" data-testid="memory-card-status">正在生成纪念卡…</p>}
      {status === 'error' && <p className="memory-card-error" role="alert" data-testid="memory-card-error">{message}</p>}
      {saveError && <p className="memory-card-error" role="alert" data-testid="memory-card-save-error">{saveError}</p>}

      <label className={`memory-card-option${locationAvailable ? '' : ' is-disabled'}`}>
        <input type="checkbox" checked={includeLocation} disabled={!locationAvailable}
          onChange={event => setIncludeLocation(event.target.checked)} />
        <span>{LOCATION_LABEL}</span>
        {!locationAvailable && <small>{NO_LOCATION_NOTE}</small>}
      </label>

      <div className="memory-card-actions">
        {status === 'error' && <button type="button" className="button secondary" onClick={() => setAttempt(value => value + 1)}>重新生成</button>}
        <button type="button" className="button primary memory-card-save" disabled={!canSave} onClick={save}>保存 PNG</button>
      </div>
    </div>
  </Modal>;
}
