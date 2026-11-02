import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), recognize: vi.fn(), terminate: vi.fn() }));
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }));
vi.mock('../../src/services/image', () => ({ prepareImage: vi.fn(async (file: File) => file) }));
import { recognizeScreenshots, validateScreenshots } from '../../src/services/ocr';
const png = () => new File(['png'], 'run.png', { type: 'image/png' });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recognize.mockResolvedValue({ data: { text: '运动时间 0:30:12' } });
  mocks.createWorker.mockResolvedValue({ recognize: mocks.recognize, terminate: mocks.terminate });
});
describe('local two-screenshot OCR', () => {
  it('requires exactly two supported bounded images', () => {
    expect(() => validateScreenshots([png()])).toThrow(/两张/);
    expect(() => validateScreenshots([png(), new File(['x'], 'x.svg', { type: 'image/svg+xml' })])).toThrow(/PNG/);
    const file = png();
    Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 });
    expect(() => validateScreenshots([file, png()])).toThrow(/15/);
    expect(() => validateScreenshots([png(), png()])).not.toThrow();
  });
  it('recognizes both images with one locally provisioned worker and releases it', async () => {
    const progress = vi.fn();
    mocks.createWorker.mockImplementationOnce(async (_langs, _oem, options) => {
      options.logger({ status: 'loading tesseract core', progress: 0 });
      options.logger({ status: 'recognizing text', progress: 0.5 });
      return { recognize: mocks.recognize, terminate: mocks.terminate };
    });
    const result = await recognizeScreenshots([png(), png()], progress);
    expect(result).toHaveLength(2);
    expect(mocks.createWorker).toHaveBeenCalledOnce();
    expect(mocks.recognize).toHaveBeenCalledTimes(2);
    expect(mocks.terminate).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith(1);
  });
  it('releases the worker on OCR error', async () => {
    mocks.recognize.mockRejectedValueOnce(new Error('recognition failed'));
    await expect(recognizeScreenshots([png(), png()])).rejects.toThrow(/识别/);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
  it('reports worker initialization errors and blocks concurrent recognition', async () => {
    mocks.createWorker.mockRejectedValueOnce(new Error('load failed'));
    await expect(recognizeScreenshots([png(), png()])).rejects.toThrow(/识别/);
    let resolve!: (value: unknown) => void;
    mocks.recognize.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const first = recognizeScreenshots([png(), png()]);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await expect(recognizeScreenshots([png(), png()])).rejects.toThrow(/正在/);
    resolve({ data: { text: '' } });
    await first;
  });
});
