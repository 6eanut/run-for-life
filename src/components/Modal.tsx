import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onCancel={onClose}>
    <header className="modal-header"><div><span className="eyebrow">YOUR RUNNING JOURNAL</span><h2 id="modal-title">{title}</h2></div><button type="button" className="icon-button" aria-label="关闭窗口" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}
