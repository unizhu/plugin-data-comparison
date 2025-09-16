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
import { dirname } from 'node:path';

import { ensurePluginDataDir, getMetadataCachePath } from './dataPaths.js';

const CACHE_VERSION = 1;

export type Cacheable = unknown;

type CacheRecord = {
  fetchedAt: number;
  type: string;
  data: Cacheable;
};

type CacheFile = {
  version: number;
  entries: Record<string, CacheRecord>;
};

const createDefaultCache = (): CacheFile => ({ version: CACHE_VERSION, entries: {} });

export class MetadataCache {
  private readonly disabled: boolean;
  private readonly ttlMs: number;
  private cache: CacheFile | undefined;
  private readonly cachePath: string;

  public constructor(ttlMinutes: number) {
    this.disabled = ttlMinutes <= 0;
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.cachePath = getMetadataCachePath();
  }

  public async get<T extends Cacheable>(key: string, expectedType: string): Promise<T | undefined> {
    if (this.disabled) {
      return undefined;
    }

    await this.ensureLoaded();

    const record = this.cache?.entries[key];
    if (!record || record.type !== expectedType) {
      return undefined;
    }

    if (!this.isRecordFresh(record)) {
      return undefined;
    }

    return record.data as T;
  }

  public async set(key: string, type: string, data: Cacheable): Promise<void> {
    if (this.disabled) {
      return;
    }

    await this.ensureLoaded();

    if (!this.cache) {
      this.cache = createDefaultCache();
    }

    this.cache.entries[key] = {
      fetchedAt: Date.now(),
      type,
      data,
    } satisfies CacheRecord;

    await this.persist();
  }

  private isRecordFresh(record: CacheRecord): boolean {
    if (this.disabled) {
      return false;
    }

    if (this.ttlMs === 0) {
      return false;
    }

    return Date.now() - record.fetchedAt <= this.ttlMs;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.disabled || this.cache) {
      return;
    }

    await ensurePluginDataDir();

    try {
      const raw = await fs.readFile(this.cachePath, 'utf8');
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version === CACHE_VERSION && parsed.entries) {
        this.cache = parsed;
        return;
      }
    } catch (error) {
      // File does not exist or is malformed; fall through to initialize default cache.
    }

    this.cache = createDefaultCache();
  }

  private async persist(): Promise<void> {
    if (this.disabled || !this.cache) {
      return;
    }

    const tmpPath = `${this.cachePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify(this.cache);

    await fs.mkdir(dirname(this.cachePath), { recursive: true });
    await fs.writeFile(tmpPath, payload, 'utf8');
    await fs.rename(tmpPath, this.cachePath);
  }
}
