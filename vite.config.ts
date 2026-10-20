import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  publicDir: 'pipelines',
  build: { target: 'esnext' },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
