import { defineConfig, mergeConfig } from 'vitest/config';
import vitestBaseConfig from './vitest.base.config';

export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {},
  }),
);
