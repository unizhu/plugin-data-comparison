#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('.wireit');
try {
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`Failed to remove ${target}:`, error);
    process.exitCode = 1;
  }
}
