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

import type { Connection, Org } from '@salesforce/core';
import { SfError } from '@salesforce/core';

import { MetadataCache } from './metadataCache.js';

type SimpleDescribeField = {
  name: string;
  label?: string;
  type: string;
  aggregatable?: boolean;
  filterable?: boolean;
};

type SimpleDescribeSObjectResult = {
  name: string;
  fields: SimpleDescribeField[];
};

type SimpleDescribeGlobalResult = {
  sobjects: Array<{ name: string }>;
};

type SimpleDescribeMetadataResult = Record<string, unknown>;
type SimpleListMetadataResult = Record<string, unknown>;
type SimpleListMetadataQuery = { type: string; folder?: string };
import { ensurePluginDataDir } from './dataPaths.js';

const TYPES = {
  describeGlobal: 'describeGlobal',
  describeSObject: 'describeSObject',
  metadataDescribe: 'metadataDescribe',
  metadataList: 'metadataList',
} as const;

const buildDescribeKey = (orgId: string, apiVersion: string, objectApiName?: string): string => {
  const base = `${orgId}:${apiVersion}`;
  return objectApiName ? `${base}:sobject:${objectApiName.toLowerCase()}` : `${base}:global`;
};

const buildMetadataKey = (orgId: string, apiVersion: string, metadataType: string, folder?: string): string => {
  const base = `${orgId}:${apiVersion}:${metadataType}`;
  return folder ? `${base}:${folder}` : base;
};

export type MetadataDiscoveryOptions = {
  org: Org;
  apiVersion?: string;
  metadataCacheTtlMinutes: number;
};

export class MetadataDiscoveryService {
  public constructor(
    private readonly options: MetadataDiscoveryOptions,
    private readonly cache = new MetadataCache(options.metadataCacheTtlMinutes)
  ) {}

  public async describeGlobal(): Promise<SimpleDescribeGlobalResult> {
    const { connection, orgId, apiVersion } = await this.resolveContext();
    const cacheKey = buildDescribeKey(orgId, apiVersion);
    const cached = await this.cache.get<SimpleDescribeGlobalResult>(cacheKey, TYPES.describeGlobal);
    if (cached) {
      return cached;
    }

    const describe = (await connection.describeGlobal()) as SimpleDescribeGlobalResult;
    await this.cache.set(cacheKey, TYPES.describeGlobal, describe);
    return describe;
  }

  public async describeSObject(objectApiName: string): Promise<SimpleDescribeSObjectResult> {
    const normalized = objectApiName.trim();
    if (!normalized) {
      throw new SfError('Object API name must be provided for describe.', 'MissingObjectName');
    }

    const { connection, orgId, apiVersion } = await this.resolveContext();
    const cacheKey = buildDescribeKey(orgId, apiVersion, normalized);
    const cached = await this.cache.get<SimpleDescribeSObjectResult>(cacheKey, TYPES.describeSObject);
    if (cached) {
      return cached;
    }

    const describe = (await connection.describe(normalized)) as SimpleDescribeSObjectResult;
    await this.cache.set(cacheKey, TYPES.describeSObject, describe);
    return describe;
  }

  public async describeMetadata(): Promise<SimpleDescribeMetadataResult> {
    const { connection, orgId, apiVersion } = await this.resolveContext();
    const cacheKey = buildMetadataKey(orgId, apiVersion, 'describe');
    const cached = await this.cache.get<SimpleDescribeMetadataResult>(cacheKey, TYPES.metadataDescribe);
    if (cached) {
      return cached;
    }

    const describe = (await Promise.resolve(connection.metadata.describe(apiVersion))) as SimpleDescribeMetadataResult;
    await this.cache.set(cacheKey, TYPES.metadataDescribe, describe);
    return describe;
  }

  public async listMetadata(metadataType: string, folder?: string): Promise<SimpleListMetadataResult[]> {
    const typeName = metadataType.trim();
    if (!typeName) {
      throw new SfError('Metadata type name must be provided for list metadata.', 'MissingMetadataType');
    }

    const { connection, orgId, apiVersion } = await this.resolveContext();
    const cacheKey = buildMetadataKey(orgId, apiVersion, typeName, folder);
    const cached = await this.cache.get<SimpleListMetadataResult[]>(cacheKey, TYPES.metadataList);
    if (cached) {
      return cached;
    }

    const queries: SimpleListMetadataQuery[] = [{ type: typeName }];
    if (folder) {
      queries[0].folder = folder;
    }

    const response = await Promise.resolve(connection.metadata.list(queries, apiVersion));
    const results = Array.isArray(response)
      ? (response as SimpleListMetadataResult[])
      : response
      ? ([response] as SimpleListMetadataResult[])
      : [];

    await this.cache.set(cacheKey, TYPES.metadataList, results);
    return results;
  }

  private async resolveContext(): Promise<{ connection: Connection; orgId: string; apiVersion: string }> {
    await ensurePluginDataDir();

    const { org, apiVersion } = this.options;
    const connection = org.getConnection(apiVersion);

    const resolvedApiVersion = apiVersion ?? connection.getApiVersion();
    const orgId = org.getOrgId();

    return { connection, orgId, apiVersion: resolvedApiVersion };
  }
}
