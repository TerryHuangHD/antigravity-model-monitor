// esbuild build script for the extension.
// Bundles src/extension.ts → out/extension.js (CommonJS, vscode external),
// copies webview media files, and copies sql.js wasm next to the bundle.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const production = args.has('--production');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function copyWebviewMedia() {
  const mediaSrc = path.join(root, 'src', 'webview', 'media');
  const mediaDst = path.join(outDir, 'webview', 'media');
  ensureDir(mediaDst);
  for (const file of fs.readdirSync(mediaSrc)) {
    copyFile(path.join(mediaSrc, file), path.join(mediaDst, file));
  }
}

function copySqlWasm() {
  // sql.js ships a .wasm file we must place next to the bundle.
  const wasmSrc = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (fs.existsSync(wasmSrc)) {
    copyFile(wasmSrc, path.join(outDir, 'sql-wasm.wasm'));
  } else {
    console.warn('[build] sql-wasm.wasm not found; run npm install before building.');
  }
}

const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => {
      copyWebviewMedia();
      copySqlWasm();
    });
  }
};

const buildOptions = {
  entryPoints: [path.join(root, 'src', 'extension.ts')],
  bundle: true,
  outfile: path.join(outDir, 'extension.js'),
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  plugins: [copyStaticPlugin]
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[build] watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
