import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vitest/config';

const fsp = fs.promises;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PluginAutoPatchFileOptions {
  root?: string;
  mateFile: string;
}

interface Context {
  root: string;
  metaFile: string;
  shadcnExportsFile: string;
}

async function parseMetaFile(metaFile: string) {
  const meta = await fsp.readFile(metaFile, 'utf-8');
  return JSON.parse(meta);
}

async function initializeNamespace(namespacePath: string) {
  await fsp.mkdir(namespacePath, { recursive: true });
  await fsp.writeFile(path.resolve(namespacePath, 'index.ts'), 'export {};\n');
  return namespacePath;
}

function initializeNamespaces(namespaces: string[], ctx: Context) {
  return Promise.all(
    namespaces.map(async (ns) => {
      const nsp = path.resolve(ctx.root, 'src', formatDirname(ns));
      if (fs.existsSync(nsp) && fs.statSync(nsp).isDirectory()) {
        return { namespace: ns, namespacePath: nsp };
      }
      return { namespace: ns, namespacePath: await initializeNamespace(nsp) };
    }),
  );
}

interface ToolMate {
  name: string;
}

function formatDirname(name: string) {
  return name.replace(/\B[A-Z]/g, (match) => `-${match.toLowerCase()}`).toLowerCase();
}

const templateMap = new Proxy({} as Record<string, string>, {
  get(target, prop: string, receiver) {
    const cacheValue = Reflect.get(target, prop, receiver);
    if (cacheValue) {
      return cacheValue;
    }
    const template = fs.readFileSync(path.resolve(__dirname, 'template', prop), 'utf-8');
    Reflect.set(target, prop, template, receiver);
    return template;
  },
});

function parseTemplate(tempName: string, data: Record<string, any>) {
  let template = templateMap[tempName];
  (Reflect.ownKeys(data) as string[]).forEach((key) => {
    template = template.replace(new RegExp(`\\$\\$${key}\\$\\$`, 'g'), data[key]);
  });
  return template;
}

const toolFiles = fs.readdirSync(path.resolve(__dirname, 'template'));

async function createToolFiles(toolName: string, toolPath: string) {
  const entryPath = path.resolve(toolPath, 'index.ts');
  if (fs.existsSync(entryPath)) {
    return entryPath;
  }
  for (let i = 0, tempName = toolFiles[i]; i < toolFiles.length; tempName = toolFiles[++i]) {
    const filePath = path.resolve(toolPath, tempName);
    if (fs.existsSync(filePath)) {
      continue;
    }
    await fsp.writeFile(filePath, parseTemplate(tempName, { name: toolName }), 'utf-8');
  }
  return entryPath;
}

async function initializeTools(namespace: string, namespacePath: string, toolMetas: ToolMate[], _ctx: Context) {
  return Promise.all(
    toolMetas.map(async (tool) => {
      const toolPath = path.resolve(namespacePath, formatDirname(tool.name));
      if (!(fs.existsSync(toolPath) && fs.statSync(toolPath).isDirectory())) {
        await fsp.mkdir(toolPath, { recursive: true });
      }
      return { meta: tool, namespace, filePath: await createToolFiles(tool.name, toolPath) };
    }),
  );
}

async function packageJsonPatch(namesapces: string[], ctx: Context) {
  const packageJsonPath = path.resolve(ctx.root, 'package.json');
  const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, 'utf-8'));

  const exports: Record<string, any> = packageJson.exports || {};

  namesapces.forEach((ns) => {
    exports[`./${ns}`] = {
      types: `./dist/${ns}/index.d.ts`,
      import: `./dist/${ns}.js`,
    };
    exports[`./${ns}/*`] = {
      import: `./dist/${ns}/*`,
    };
  });

  packageJson.exports = exports;

  return fsp.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
}

type ToolInfo = Awaited<ReturnType<typeof initializeTools>>[number];

function formatNameFromTool(toolInfo: ToolInfo) {
  const { meta } = toolInfo;
  return `${toolInfo.namespace}${meta.name[0].toUpperCase()}${meta.name.slice(1)}`;
}

async function generateShadcnExports(toolInfos: ToolInfo[], ctx: Context) {
  const { root, shadcnExportsFile } = ctx;
  const exports = toolInfos.map((toolInfo) => {
    return {
      ...toolInfo.meta,
      name: formatNameFromTool(toolInfo),
      path: path.relative(root, toolInfo.filePath),
    };
  });

  return fsp.writeFile(
    shadcnExportsFile,
    JSON.stringify(
      {
        // biome-ignore lint/style/useNamingConvention: ignore
        $schema: './node_modules/@cmtlyt/unplugin-shadcn-registry-generate/configuration-schema.json',
        exports,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function createContext(options: PluginAutoPatchFileOptions) {
  const { root = process.cwd(), mateFile } = options;

  const realMetaFile = path.resolve(root, mateFile);
  const shadcnExportsFile = path.resolve(root, 'shadcn-exports.json');
  const ctx = {
    root,
    metaFile: realMetaFile,
    shadcnExportsFile,
  };
  return ctx;
}

async function processHandler(ctx: Context) {
  const meta = await parseMetaFile(ctx.metaFile);
  const namespaces = (Reflect.ownKeys(meta) as string[]).filter((key) => key !== '$schema');
  const namespaceInfos = await initializeNamespaces(namespaces, ctx);
  await packageJsonPatch(namespaces, ctx);
  const toolInfos = (
    await Promise.all(
      namespaceInfos.map(async (namespaceInfo) => {
        const { namespace, namespacePath } = namespaceInfo;
        return initializeTools(namespace, namespacePath, meta[namespace], ctx);
      }),
    )
  ).flat(1);
  return generateShadcnExports(toolInfos, ctx);
}

export function pluginAutoPatchFile(options: PluginAutoPatchFileOptions) {
  const ctx = createContext(options);

  void processHandler(ctx);

  return {
    name: '@cmtlyt/lingshu-toolkit:auto-patch-file',
    apply: 'serve',
    async watchChange(id) {
      if (id === ctx.metaFile) {
        void processHandler(ctx);
      }
    },
  } satisfies Plugin;
}
