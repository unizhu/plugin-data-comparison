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
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA_HOME_ENV = 'SF_DATA_HOME';
const DEFAULT_DATA_HOME_FOLDER = '.sfdata';
const PLUGIN_FOLDER = 'sf-data-comparison';
const METADATA_CACHE_FILE = 'metadata-cache.json';

export const getDataHome = (): string => {
  const override = process.env[DATA_HOME_ENV];
  if (override && override.trim().length > 0) {
    return override.trim();
  }

  return join(homedir(), DEFAULT_DATA_HOME_FOLDER);
};

export const getPluginDataDir = (): string => join(getDataHome(), PLUGIN_FOLDER);

export const getMetadataCachePath = (): string => join(getPluginDataDir(), METADATA_CACHE_FILE);

export const ensurePluginDataDir = async (): Promise<void> => {
  await fs.mkdir(getPluginDataDir(), { recursive: true });
};
