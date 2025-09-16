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

import { AggregateQueryBuilder } from '../../src/services/aggregateQueryBuilder.js';
import type { ResolvedMetric } from '../../src/services/metricParser.js';

const metrics: ResolvedMetric[] = [
  { kind: 'count', valueType: 'number' },
  { kind: 'sum', field: 'AnnualRevenue', fieldType: 'currency', label: 'Annual Revenue', valueType: 'number' },
  { kind: 'max', field: 'CloseDate', fieldType: 'date', label: 'Close Date', valueType: 'date' },
];

describe('AggregateQueryBuilder', () => {
  it('builds aggregate query with aliases and where clause', () => {
    const builder = new AggregateQueryBuilder({
      objectName: 'Opportunity',
      metrics,
      where: "StageName = 'Closed Won'",
    });
    const plan = builder.build();

    expect(plan.aggregateQuery).to.equal(
      "SELECT COUNT() count__all, SUM(AnnualRevenue) sum__annualrevenue, MAX(CloseDate) max__closedate FROM Opportunity WHERE StageName = 'Closed Won'"
    );
    expect(plan.sampleFields).to.deep.equal(['AnnualRevenue', 'CloseDate']);
    expect(plan.whereClause).to.equal("StageName = 'Closed Won'");
    expect(plan.expressions).to.have.length(3);
    expect(plan.expressions[0].alias).to.equal('count__all');
  });

  it('ensures unique aliases when duplicates occur', () => {
    const duplicateMetrics: ResolvedMetric[] = [
      { kind: 'sum', field: 'Amount', fieldType: 'currency', valueType: 'number', label: 'Amount' },
      { kind: 'sum', field: 'Amount', fieldType: 'currency', valueType: 'number', label: 'Amount' },
    ];

    const plan = new AggregateQueryBuilder({ objectName: 'Opportunity', metrics: duplicateMetrics }).build();
    expect(plan.expressions[0].alias).to.equal('sum__amount');
    expect(plan.expressions[1].alias).to.equal('sum__amount_1');
  });
});
