/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sinon from 'sinon';

import { expect } from 'chai';

import { getMetadataCachePath } from '../../src/services/dataPaths.js';
import { MetadataCache } from '../../src/services/metadataCache.js';

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

describe('MetadataCache', () => {
  let originalDataHome: string | undefined;
  let dataDir: string;

  beforeEach(async () => {
    originalDataHome = process.env.SF_DATA_HOME;
    dataDir = await fs.mkdtemp(join(tmpdir(), 'sfdata-'));
    process.env.SF_DATA_HOME = dataDir;
  });

  afterEach(async () => {
    process.env.SF_DATA_HOME = originalDataHome;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('writes and reads cached entries within TTL', async () => {
    const cache = new MetadataCache(10);
    await cache.set('sample', 'describe', { value: 42 });

    const cached = await cache.get<{ value: number }>('sample', 'describe');
    expect(cached).to.deep.equal({ value: 42 });

    const cachePath = getMetadataCachePath();
    expect(await fileExists(cachePath)).to.equal(true);
  });

  it('does not read cached entries when disabled via ttl 0', async () => {
    const cache = new MetadataCache(0);
    await cache.set('sample', 'describe', { value: 1 });

    const cached = await cache.get<{ value: number }>('sample', 'describe');
    expect(cached).to.equal(undefined);

    const cachePath = getMetadataCachePath();
    expect(await fileExists(cachePath)).to.equal(false);
  });
  it('expires cached entries when ttl elapsed', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now() });
    try {
      const cache = new MetadataCache(1);
      await cache.set('sample', 'describe', { value: 100 });

      clock.tick(61_000);

      const cached = await cache.get<{ value: number }>('sample', 'describe');
      expect(cached).to.equal(undefined);
    } finally {
      clock.restore();
    }
  });
});
