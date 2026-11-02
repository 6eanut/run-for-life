import { createWorker } from 'tesseract.js';
import { prepareImage } from './image';

let busy = false;

export function validateScreenshots(files: File[]): void {
  if (files.length !== 2) throw new Error('请选择同一次训练的两张截图');
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 截图');
    if (file.size > 15 * 1024 * 1024 || file.size === 0) throw new Error('每张截图需大于 0 且不超过 15 MB');
  }
}

export async function recognizeScreenshots(files: File[], onProgress: (progress: number) => void = () => {}): Promise<string[]> {
  validateScreenshots(files);
  if (busy) throw new Error('正在识别，请等待当前任务完成');
  busy = true;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let currentImage = 0;
  try {
    const root = new URL(`${import.meta.env.BASE_URL}ocr/`, globalThis.location?.href ?? 'http://localhost/').href;
    worker = await createWorker(['chi_sim', 'eng'], 1, {
      workerPath: `${root}worker.min.js`, corePath: root, langPath: root.replace(/\/$/, ''),
      workerBlobURL: false,
      logger: message => {
        if (message.status === 'recognizing text') onProgress(0.1 + (currentImage + message.progress) * 0.45);
      },
    });
    onProgress(0.1);
    const results: string[] = [];
    for (const file of files) {
      const image = await prepareImage(file);
      const result = await worker.recognize(image);
      results.push(result.data.text);
      currentImage += 1;
    }
    onProgress(1);
    return results;
  } catch (error) {
    console.error('本地截图识别失败', error instanceof Error ? error.message : 'unknown');
    throw new Error('截图识别失败。请联网重新尝试，或使用手动记录。首次识别需要加载本地识别资源。');
  } finally {
    try { await worker?.terminate(); } finally { busy = false; }
  }
}
