import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginAutoPatchFile } from '../plugins/auto-patch-file';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

pluginAutoPatchFile({
  mateFile: path.resolve(__dirname, '../meta/toolkit.meta.json'),
});
