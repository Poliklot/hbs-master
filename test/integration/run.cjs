const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

function getLocalVSCodeExecutable() {
  if (process.env.VSCODE_TEST_EXECUTABLE_PATH) return process.env.VSCODE_TEST_EXECUTABLE_PATH;

  const macOSAppExecutable = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
  if (process.platform === 'darwin' && fs.existsSync(macOSAppExecutable)) {
    return macOSAppExecutable;
  }

  return undefined;
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.cjs');
  const smokeWorkspace = path.resolve(extensionDevelopmentPath, 'test', 'smoke-workspace');
  const vscodeExecutablePath = getLocalVSCodeExecutable();

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    vscodeExecutablePath,
    launchArgs: [
      smokeWorkspace,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    extensionTestsEnv: {
      HBS_MASTER_SMOKE_WORKSPACE: smokeWorkspace,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
