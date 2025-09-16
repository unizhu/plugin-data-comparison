#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const excludedDirs = new Set(['.git', 'coverage', 'lib', 'node_modules', 'tmp']);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const findNutTests = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) {
        continue;
      }

      const childFiles = await findNutTests(join(directory, entry.name));
      files.push(...childFiles);
    } else if (entry.isFile() && entry.name.endsWith('.nut.ts')) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
};

const nutTests = (await findNutTests(rootDir)).sort();

if (nutTests.length === 0) {
  console.log('No .nut.ts files found; skipping nut tests.');
  process.exit(0);
}

const nycExecutable = resolve(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'nyc.cmd' : 'nyc');

const args = ['mocha', ...nutTests, '--slow', '4500', '--timeout', '600000', '--parallel'];

const runner = spawn(nycExecutable, args, {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

runner.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

runner.on('error', (error) => {
  console.error('Failed to run nut tests:', error);
  process.exit(1);
});
