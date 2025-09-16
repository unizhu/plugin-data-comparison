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

import { expect } from 'chai';
import { Org } from '@salesforce/core';
import { TestContext } from '@salesforce/core/testSetup';

import { DataComparisonService } from '../../src/services/dataComparisonService.js';
import type { AggregatePlan } from '../../src/services/aggregateQueryBuilder.js';

const COUNT_ALIAS = 'countAll';
const SUM_ANNUAL_REVENUE_ALIAS = 'sumAnnualrevenue';
// const MAX_LAST_MODIFIED_ALIAS = 'maxLastmodifieddate';

const service = new DataComparisonService();

const buildPlan = (): AggregatePlan => ({
  objectName: 'Account',
  whereClause: undefined,
  expressions: [
    {
      alias: COUNT_ALIAS,
      metric: { kind: 'count', valueType: 'number' },
      soql: 'COUNT()',
    },
    {
      alias: SUM_ANNUAL_REVENUE_ALIAS,
      metric: {
        kind: 'sum',
        field: 'AnnualRevenue',
        fieldType: 'currency',
        label: 'Annual Revenue',
        valueType: 'number',
      },
      soql: 'SUM(AnnualRevenue)',
    },
  ],
  aggregateQuery: 'SELECT COUNT() countAll, SUM(AnnualRevenue) sumAnnualrevenue FROM Account',
  sampleFields: ['AnnualRevenue'],
});

describe('DataComparisonService', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  const buildOrg = (
    orgId: string,
    aggregateRecord: Record<string, unknown>,
    samples: Array<Record<string, unknown>> = []
  ): Org => {
    const connectionQuery = $$.SANDBOX.stub();
    connectionQuery.callsFake(async (query: string) => {
      if (query.startsWith('SELECT')) {
        if (query.includes('ORDER BY Id LIMIT')) {
          return {
            records: samples,
          };
        }

        return {
          records: [aggregateRecord],
        };
      }

      throw new Error(`Unexpected query executed: ${query}`);
    });

    return {
      getOrgId: $$.SANDBOX.stub().returns(orgId),
      getConnection: $$.SANDBOX.stub().returns({
        setApiVersion: $$.SANDBOX.stub(),
        getApiVersion: $$.SANDBOX.stub().returns('60.0'),
        query: connectionQuery,
      }),
    } as unknown as Org;
  };

  it('returns metrics with computed differences and samples', async () => {
    const plan = buildPlan();
    const sourceOrg = buildOrg('00D-source', { countAll: 10, sumAnnualrevenue: 5000 }, [
      { Id: '001-source-1', AnnualRevenue: 100 },
    ]);
    const targetOrg = buildOrg('00D-target', { countAll: 12, sumAnnualrevenue: 6500 }, [
      { Id: '001-target-1', AnnualRevenue: 200 },
    ]);

    const comparison = await service.compare({
      sourceOrg,
      targetOrg,
      plan,
      sampleQuery: 'SELECT Id FROM Account ORDER BY Id LIMIT 1',
    });

    expect(comparison.metrics).to.have.length(2);
    expect(comparison.metrics[0].difference).to.equal(2);
    expect(comparison.metrics[1].difference).to.equal(1500);
    expect(comparison.samples.source).to.have.length(1);
    expect(comparison.samples.target).to.have.length(1);
  });

  it('returns null difference for non-numeric metrics', async () => {
    const plan: AggregatePlan = {
      objectName: 'Account',
      whereClause: undefined,
      expressions: [
        {
          alias: 'maxLastmodifieddate',
          metric: { kind: 'max', field: 'LastModifiedDate', fieldType: 'datetime', valueType: 'date' },
          soql: 'MAX(LastModifiedDate)',
        },
      ],
      aggregateQuery: 'SELECT MAX(LastModifiedDate) maxLastmodifieddate FROM Account',
      sampleFields: ['LastModifiedDate'],
    };

    const aggregateRecord = { maxLastmodifieddate: '2025-01-01T00:00:00.000Z' };
    const sourceOrg = buildOrg('00D-source', aggregateRecord);
    const targetOrg = buildOrg('00D-target', aggregateRecord);

    const comparison = await service.compare({ sourceOrg, targetOrg, plan });
    expect(comparison.metrics[0].difference).to.equal(null);
  });
});
