import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig, type TestProjectInlineConfiguration } from 'vitest/config';
import vitestBaseConfig from './vitest.base.config';

function getProjectConfig(config: TestProjectInlineConfiguration) {
  return mergeConfig(
    vitestBaseConfig,
    mergeConfig(
      defineConfig({
        test: {
          browser: {
            enabled: true,
            provider: playwright(),
            // https://vitest.dev/config/browser/playwright
            instances: [{ browser: 'chromium', headless: true }],
          },
        },
      }),
      config,
    ),
  );
}

export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      projects: [
        getProjectConfig({
          test: {
            include: ['src/shared/**/*.test.ts'],
          },
        }),
        getProjectConfig({
          plugins: [react()],
          test: {
            include: ['src/react/**/*.test.tsx', 'src/react/**/*.test.ts'],
          },
        }),
        getProjectConfig({
          plugins: [vue()],
          test: {
            include: ['src/vue/**/*.test.ts'],
          },
        }),
      ],
    },
  }),
);
