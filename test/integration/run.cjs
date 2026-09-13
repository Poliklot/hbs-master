const fs = require('node:fs');
const os = require('node:os');
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
  const repoRoot = path.resolve(__dirname, '..', '..');
  // Allows the same editor scenarios to validate an extracted/isolated VSIX,
  // rather than accidentally loading source-tree dependencies.
  const extensionDevelopmentPath = process.env.HBS_MASTER_EXTENSION_PATH
    ? path.resolve(process.env.HBS_MASTER_EXTENSION_PATH)
    : repoRoot;
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.cjs');
  const version = process.env.VSCODE_TEST_VERSION;
  const vscodeExecutablePath = version ? undefined : getLocalVSCodeExecutable();

  // Keep profiles isolated from the user's editor and paths short enough for
  // macOS Unix-domain sockets, even when the checkout lives in a deep folder.
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hbsm-'));
  try {
    const smokeWorkspace = path.join(profileRoot, 'workspace');
    fs.cpSync(path.join(repoRoot, 'test', 'smoke-workspace'), smokeWorkspace, { recursive: true });
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      version,
      reuseMachineInstall: false,
      launchArgs: [
        smokeWorkspace,
        `--user-data-dir=${path.join(profileRoot, 'user')}`,
        `--extensions-dir=${path.join(profileRoot, 'extensions')}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
      ],
      extensionTestsEnv: {
        HBS_MASTER_SMOKE_WORKSPACE: smokeWorkspace,
        HBS_MASTER_EXPECTED_EXTENSION_PATH: extensionDevelopmentPath,
      },
    });
  } finally {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
