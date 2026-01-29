import path from 'node:path';
import shadcnRegistryGenerate from '@cmtlyt/unplugin-shadcn-registry-generate';
import { defineConfig } from 'rspress/config';
import { config } from './scripts/config';

export default defineConfig({
  base: '/lingshu-toolkit/',
  root: path.resolve(__dirname, 'src'),
  title: 'lingshu',
  route: {
    exclude: ['**/*.test.{ts,tsx,js,jsx}', '**/*.{ts,tsx,js,jsx}'],
  },
  themeConfig: {
    outlineTitle: '目录',
    prevPageText: '上一页',
    nextPageText: '下一页',
  },
  markdown: {
    showLineNumbers: true,
  },
  builderConfig: {
    source: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    output: {
      copy: [
        {
          from: path.resolve(__dirname, 'src/public'),
          to: path.resolve(__dirname, 'doc_build'),
        },
      ],
    },
    tools: {
      rspack: {
        plugins: [
          shadcnRegistryGenerate.rspack({
            outputDir: config.shadcnRegistryPluginOutputDir,
            basePath: config.shadcnRegistryPluginBasePath,
            registryUrl: config.registryUrl,
            noRootRegistry: config.shadcnRegistryPluginNoRoot,
          }),
        ],
      },
    },
  },
});
