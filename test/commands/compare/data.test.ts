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
import { Org } from '@salesforce/core';
import { TestContext } from '@salesforce/core/testSetup';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';

import CompareData from '../../../src/commands/compare/data.js';
import { MetadataDiscoveryService } from '../../../src/services/metadataDiscoveryService.js';

const COUNT_ALIAS = 'count__all';
const SUM_ANNUAL_REVENUE_ALIAS = 'sum__annualrevenue';

describe('compare:data command', () => {
  const $$ = new TestContext();
  let uxStubs: ReturnType<typeof stubSfCommandUx>;

  type DescribeResult = Awaited<ReturnType<MetadataDiscoveryService['describeSObject']>>;

  const describeResult: DescribeResult = {
    name: 'Account',
    label: 'Account',
    fields: [
      {
        name: 'AnnualRevenue',
        label: 'Annual Revenue',
        type: 'currency',
        aggregatable: true,
        filterable: true,
        groupable: true,
      },
    ],
  } as unknown as DescribeResult;

  beforeEach(() => {
    uxStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  const buildOrgStub = (
    orgId: string,
    aggregateRecord: Record<string, unknown>,
    samples: Array<Record<string, unknown>> = []
  ): Org => {
    const connectionQuery = $$.SANDBOX.stub();
    connectionQuery.callsFake(async (query: string) => {
      if (query.includes('ORDER BY Id LIMIT')) {
        return { records: samples };
      }

      if (query.startsWith('SELECT')) {
        return { records: [aggregateRecord] };
      }

      expect.fail(`Unexpected query executed: ${query}`);
    });

    const orgStub = {
      getOrgId: $$.SANDBOX.stub().returns(orgId),
      getConnection: $$.SANDBOX.stub().returns({
        setApiVersion: $$.SANDBOX.stub(),
        getApiVersion: $$.SANDBOX.stub().returns('60.0'),
        query: connectionQuery,
      }),
    };

    return orgStub as unknown as Org;
  };

  it('executes aggregate comparison and returns metric differences', async () => {
    $$.SANDBOX.stub(MetadataDiscoveryService.prototype, 'describeSObject').resolves(describeResult);

    const createStub = $$.SANDBOX.stub(Org, 'create');

    createStub.onCall(0).resolves(buildOrgStub('00D-source', { [COUNT_ALIAS]: 10, [SUM_ANNUAL_REVENUE_ALIAS]: 5000 }));
    createStub.onCall(1).resolves(buildOrgStub('00D-target', { [COUNT_ALIAS]: 12, [SUM_ANNUAL_REVENUE_ALIAS]: 6500 }));

    const result = await CompareData.run([
      '--source-org',
      'prod',
      '--target-org',
      'sbx',
      '--object',
      'Account',
      '--metrics',
      'count',
      '--metrics',
      'sum:AnnualRevenue',
    ]);

    expect(result.object).to.equal('Account');
    expect(result.metrics).to.have.length(2);
    expect(result.metrics[0].difference).to.equal(2);
    expect(result.metrics[1].difference).to.equal(1500);
    expect(result.metrics[1].sourceValue).to.equal(5000);
    expect(result.metrics[1].targetValue).to.equal(6500);

    expect(uxStubs.table.calledOnce).to.equal(true);
  });

  it('writes csv output when format=csv', async () => {
    $$.SANDBOX.stub(MetadataDiscoveryService.prototype, 'describeSObject').resolves(describeResult);

    const createStub = $$.SANDBOX.stub(Org, 'create');
    const sourceSamples = [
      { Id: '001-source-1', AnnualRevenue: 1200 },
      { Id: '001-source-2', AnnualRevenue: 1800 },
    ];
    const targetSamples = [{ Id: '001-target-1', AnnualRevenue: 1500 }];

    createStub
      .onCall(0)
      .resolves(buildOrgStub('00D-source', { [COUNT_ALIAS]: 10, [SUM_ANNUAL_REVENUE_ALIAS]: 5000 }, sourceSamples));
    createStub
      .onCall(1)
      .resolves(buildOrgStub('00D-target', { [COUNT_ALIAS]: 12, [SUM_ANNUAL_REVENUE_ALIAS]: 6500 }, targetSamples));

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'compare-csv-'));
    const outputPath = join(tempDir, 'comparison.csv');
    const result = await CompareData.run([
      '--source-org',
      'prod',
      '--target-org',
      'sbx',
      '--object',
      'Account',
      '--metrics',
      'count',
      '--metrics',
      'sum:AnnualRevenue',
      '--format',
      'csv',
      '--output-file',
      outputPath,
      '--sample-size',
      '2',
    ]);

    const csv = await fs.readFile(outputPath, 'utf8');

    expect(result.outputFile).to.equal(outputPath);
    expect(csv).to.include('Metric,Source,Target,Difference');
    expect(csv).to.include('COUNT(),10,12,2');
    expect(csv).to.include('Sample Records - Source');
    expect(csv).to.include('Sample Records - Target');
  });

  it('writes pdf output when format=pdf', async () => {
    $$.SANDBOX.stub(MetadataDiscoveryService.prototype, 'describeSObject').resolves(describeResult);

    const createStub = $$.SANDBOX.stub(Org, 'create');
    const sourceSamples = [{ Id: '001-source-1', AnnualRevenue: 1200 }];
    const targetSamples = [{ Id: '001-target-1', AnnualRevenue: 1500 }];

    createStub
      .onCall(0)
      .resolves(buildOrgStub('00D-source', { [COUNT_ALIAS]: 10, [SUM_ANNUAL_REVENUE_ALIAS]: 5000 }, sourceSamples));
    createStub
      .onCall(1)
      .resolves(buildOrgStub('00D-target', { [COUNT_ALIAS]: 12, [SUM_ANNUAL_REVENUE_ALIAS]: 6500 }, targetSamples));

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'compare-pdf-'));
    const outputPath = join(tempDir, 'comparison.pdf');
    const result = await CompareData.run([
      '--source-org',
      'prod',
      '--target-org',
      'sbx',
      '--object',
      'Account',
      '--metrics',
      'count',
      '--metrics',
      'sum:AnnualRevenue',
      '--format',
      'pdf',
      '--output-file',
      outputPath,
      '--sample-size',
      '1',
    ]);
    const pdf = await fs.readFile(outputPath);

    expect(result.outputFile).to.equal(outputPath);
    expect(pdf.subarray(0, 4).toString()).to.equal('%PDF');
  });
  it('throws when csv format lacks output file', async () => {
    $$.SANDBOX.stub(MetadataDiscoveryService.prototype, 'describeSObject').resolves(describeResult);
    const createStub = $$.SANDBOX.stub(Org, 'create');
    createStub.onCall(0).resolves(buildOrgStub('00D-source', { [COUNT_ALIAS]: 10, [SUM_ANNUAL_REVENUE_ALIAS]: 5000 }));
    createStub.onCall(1).resolves(buildOrgStub('00D-target', { [COUNT_ALIAS]: 12, [SUM_ANNUAL_REVENUE_ALIAS]: 6500 }));

    try {
      await CompareData.run([
        '--source-org',
        'prod',
        '--target-org',
        'sbx',
        '--object',
        'Account',
        '--metrics',
        'count',
        '--metrics',
        'sum:AnnualRevenue',
        '--format',
        'csv',
      ]);
      expect.fail('Expected csv output without --output-file to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).to.include('The --output-file flag is required');
    }
  });
});
