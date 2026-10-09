import { spawn } from 'node:child_process';

const PICK_FILE_SCRIPT = 'POSIX path of (choose file with prompt "Select one file to upload to your Connexease Gateway WhatsApp account")';

/** The developer, not the AI client, selects a local file in the native macOS picker. */
export function selectGatewayUploadFile(spawnImpl = spawn) {
  if (process.platform !== 'darwin' && spawnImpl === spawn) throw new Error('Native file selection currently supports macOS only');
  return new Promise((resolve, reject) => {
    const child = spawnImpl('/usr/bin/osascript', ['-e', PICK_FILE_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('macOS file picker is unavailable')));
    child.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else if (code === 1) resolve(null);
      else reject(new Error('macOS file picker is unavailable'));
    });
  });
}

/** Native save dialog; the AI client cannot select or overwrite a local path. */
export function selectGatewayCsvDestination(filename, spawnImpl = spawn) {
  if (!/^insights_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/.test(filename)) throw new Error('Invalid insights CSV filename');
  if (process.platform !== 'darwin' && spawnImpl === spawn) throw new Error('Native CSV save currently supports macOS only');
  const script = `POSIX path of (choose file name with prompt "Save Connexease Gateway insights CSV" default name "${filename}")`;
  return new Promise((resolve, reject) => {
    const child = spawnImpl('/usr/bin/osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('macOS save dialog is unavailable')));
    child.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else if (code === 1) resolve(null);
      else reject(new Error('macOS save dialog is unavailable'));
    });
  });
}
