import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Trỏ @erp/audit vào NGUỒN, không vào dist: nếu không, test sẽ chạy trên bản build cũ
  // và xanh trong khi mã nguồn đã đổi.
  resolve: {
    alias: {
      '@erp/audit': fileURLToPath(new URL('../../packages/audit/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
