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

import { expect } from 'chai';

import { exportComparisonToCsv } from '../../src/services/csvExporter.js';
import type { CompareDataResult } from '../../src/commands/compare/data.js';

const buildResult = (): CompareDataResult => ({
  object: 'Account',
  metrics: [
    {
      metric: { kind: 'count', valueType: 'number' },
      alias: 'count__all',
      sourceValue: 10,
      targetValue: 12,
      difference: 2,
    },
    {
      metric: {
        kind: 'sum',
        field: 'AnnualRevenue',
        fieldType: 'currency',
        label: 'Annual Revenue',
        valueType: 'number',
      },
      alias: 'sum__annualrevenue',
      sourceValue: 5000,
      targetValue: 6500,
      difference: 1500,
    },
  ],
  filters: {
    where: "BillingCountry = 'US'",
    sampleSize: 2,
  },
  format: 'csv',
  outputFile: undefined,
  reportTitle: 'Data Comparison Sample',
  metadataCacheMinutes: 10,
  source: {
    aliasOrUsername: 'prod',
    orgId: '00D-source',
    apiVersion: '60.0',
  },
  target: {
    aliasOrUsername: 'sbx',
    orgId: '00D-target',
    apiVersion: '60.0',
  },
  queries: {
    aggregate: 'SELECT COUNT() count__all FROM Account',
    sample: undefined,
  },
  samples: {
    source: [
      { Id: '001-source-1', AnnualRevenue: 1200 },
      { Id: '001-source-2', AnnualRevenue: 1800 },
    ],
    target: [{ Id: '001-target-1', AnnualRevenue: 1500 }],
  },
});

describe('exportComparisonToCsv', () => {
  it('writes summary and samples to csv file', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'csv-export-'));
    const outputPath = join(tempDir, 'report.csv');

    const result = buildResult();
    const resolvedPath = await exportComparisonToCsv(result, outputPath);
    const fileContent = await fs.readFile(resolvedPath, 'utf8');

    expect(resolvedPath).to.equal(outputPath);
    expect(fileContent).to.include('Report Title,Data Comparison Sample');
    expect(fileContent).to.include('Metric,Source,Target,Difference');
    expect(fileContent).to.include('COUNT(),10,12,2');
    expect(fileContent).to.include('SUM(AnnualRevenue),5000,6500,1500');
    expect(fileContent).to.include('Sample Records - Source');
    expect(fileContent).to.include('Sample Records - Target');
    expect(fileContent).to.include('001-source-1');
    expect(fileContent).to.include('001-target-1');
  });
});
