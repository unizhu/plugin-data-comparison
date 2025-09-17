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

import { afterEach, describe, it } from 'mocha';
import { expect } from 'chai';
import { Org } from '@salesforce/core';
import { TestContext } from '@salesforce/core/testSetup';

import { AggregateQueryBuilder } from '../../src/services/aggregateQueryBuilder.js';
import { DataComparisonService } from '../../src/services/dataComparisonService.js';
import type { AggregatePlan, MetricDefinition } from '../../src/services/aggregateQueryBuilder.js';
import type { ResolvedMetric } from '../../src/services/metricParser.js';

const service = new DataComparisonService();

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
    const countMetric: ResolvedMetric = { kind: 'count', valueType: 'number' };
    const sumMetric: ResolvedMetric = {
      kind: 'fieldAggregate',
      fn: 'sum',
      field: 'AnnualRevenue',
      fieldType: 'currency',
      label: 'Annual Revenue',
      valueType: 'number',
    };

    const plan = new AggregateQueryBuilder({
      objectName: 'Account',
      metrics: [countMetric, sumMetric],
    }).build();

    const countAlias = (plan.metrics[0] as MetricDefinition & { kind: 'direct' }).alias;
    const sumAlias = (plan.metrics[1] as MetricDefinition & { kind: 'direct' }).alias;

    const sourceRecord: Record<string, unknown> = { [countAlias]: 10, [sumAlias]: 5000 };
    const targetRecord: Record<string, unknown> = { [countAlias]: 12, [sumAlias]: 6500 };

    const sourceOrg = buildOrg('00D-source', sourceRecord, [{ Id: '001-source-1', AnnualRevenue: 100 }]);
    const targetOrg = buildOrg('00D-target', targetRecord, [{ Id: '001-target-1', AnnualRevenue: 200 }]);

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

  it('computes ratio metrics from shared expressions', async () => {
    const numerator: ResolvedMetric = {
      kind: 'fieldAggregate',
      fn: 'sum',
      field: 'AnnualRevenue',
      fieldType: 'currency',
      label: 'Annual Revenue',
      valueType: 'number',
    };
    const denominator: ResolvedMetric = {
      kind: 'fieldAggregate',
      fn: 'sum',
      field: 'Amount',
      fieldType: 'currency',
      label: 'Amount',
      valueType: 'number',
    };
    const ratioMetric: ResolvedMetric = {
      kind: 'ratio',
      label: 'SUM(AnnualRevenue)/SUM(Amount)',
      numerator,
      denominator,
      valueType: 'number',
    };

    const plan = new AggregateQueryBuilder({
      objectName: 'Opportunity',
      metrics: [ratioMetric],
    }).build();

    const ratioDefinition = plan.metrics[0];
    if (ratioDefinition.kind !== 'ratio') {
      throw new Error('Expected ratio metric definition.');
    }

    const sourceRecord: Record<string, unknown> = {
      [ratioDefinition.numeratorAlias]: 200,
      [ratioDefinition.denominatorAlias]: 100,
    };
    const targetRecord: Record<string, unknown> = {
      [ratioDefinition.numeratorAlias]: 300,
      [ratioDefinition.denominatorAlias]: 150,
    };

    const sourceOrg = buildOrg('00D-source', sourceRecord);
    const targetOrg = buildOrg('00D-target', targetRecord);

    const comparison = await service.compare({ sourceOrg, targetOrg, plan });
    expect(comparison.metrics[0].sourceValue).to.equal(2);
    expect(comparison.metrics[0].targetValue).to.equal(2);
    expect(comparison.metrics[0].difference).to.equal(0);
  });

  it('returns null difference for non-numeric metrics', async () => {
    const maxMetric: ResolvedMetric = {
      kind: 'fieldAggregate',
      fn: 'max',
      field: 'LastModifiedDate',
      fieldType: 'datetime',
      valueType: 'date',
    };

    const plan: AggregatePlan = {
      objectName: 'Account',
      whereClause: undefined,
      aggregateQuery: 'SELECT MAX(LastModifiedDate) max__lastmodifieddate FROM Account',
      expressions: [{ alias: 'max__lastmodifieddate', soql: 'MAX(LastModifiedDate)', valueType: 'date' }],
      metrics: [{ kind: 'direct', metric: maxMetric, alias: 'max__lastmodifieddate' } as MetricDefinition],
      sampleFields: ['LastModifiedDate'],
    };

    const aggregateRecord: Record<string, unknown> = { ['max__lastmodifieddate']: '2025-01-01T00:00:00.000Z' };
    const sourceOrg = buildOrg('00D-source', aggregateRecord);
    const targetOrg = buildOrg('00D-target', aggregateRecord);

    const comparison = await service.compare({ sourceOrg, targetOrg, plan });
    expect(comparison.metrics[0].difference).to.equal(null);
  });
});
