import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/domain/**/*.ts', 'src/services/storage.ts', 'src/services/ocr.ts', 'src/services/ocr-layout.ts', 'src/services/ocr-regions.ts', 'src/services/export-csv.ts'], exclude: ['src/domain/sample.ts'], thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 } },
  },
});
