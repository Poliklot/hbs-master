const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listFiles, PackageManager } = require('@vscode/vsce');

test('the VSIX file set loads the real parser without workspace dependencies', { timeout: 60000 }, async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const files = await listFiles({ cwd: repoRoot, packageManager: PackageManager.Npm });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hbs-master-package-test-'));
  const extensionRoot = path.join(temporaryRoot, 'extension');

  try {
    for (const file of files) {
      const normalized = file.replaceAll('\\', '/');
      assert.ok(!/^(?:src|test|\.github|\.vscode|\.vscode-test)\//.test(normalized), `Development file included: ${file}`);
      assert.ok(!/\.(?:map|d\.ts|vsix)$/.test(normalized), `Development artifact included: ${file}`);
      const destination = path.resolve(extensionRoot, file);
      const relative = path.relative(extensionRoot, destination);
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Unexpected package path: ${file}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, file), destination);
    }

    // Copy the harness as well: running it from the source tree could let Node
    // resolve missing dependencies from the developer's node_modules directory.
    const supportRoot = path.join(temporaryRoot, 'support');
    fs.mkdirSync(supportRoot);
    for (const file of ['packaged-parser-smoke.cjs', 'vscode-mock.cjs', 'text-document.cjs']) {
      fs.copyFileSync(path.join(__dirname, 'support', file), path.join(supportRoot, file));
    }
    const result = spawnSync(process.execPath, [path.join(supportRoot, 'packaged-parser-smoke.cjs'), extensionRoot], {
      cwd: temporaryRoot,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
