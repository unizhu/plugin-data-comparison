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

import { parseMetricTokens, validateMetricsAgainstDescribe } from '../../src/services/metricParser.js';

type DescribeResult = {
  name: string;
  fields: Array<{
    name: string;
    label?: string;
    type: string;
    aggregatable?: boolean;
  }>;
};

const describeMock: DescribeResult = {
  name: 'Account',
  fields: [
    {
      name: 'Id',
      type: 'id',
      aggregatable: true,
    },
    {
      name: 'AnnualRevenue',
      type: 'currency',
      aggregatable: true,
      label: 'Annual Revenue',
    },
    {
      name: 'LastActivityDate',
      type: 'date',
      aggregatable: true,
      label: 'Last Activity Date',
    },
  ],
};

describe('metricParser', () => {
  it('defaults to count metric when none provided', () => {
    const parsed = parseMetricTokens(undefined);
    expect(parsed).to.deep.equal([{ kind: 'count' }]);
    const validated = validateMetricsAgainstDescribe(parsed, describeMock, 'source');
    expect(validated).to.deep.equal([{ kind: 'count', valueType: 'number' }]);
  });

  it('parses comma separated metrics and validates numeric field', () => {
    const parsed = parseMetricTokens(['count', 'sum:AnnualRevenue']);
    const validated = validateMetricsAgainstDescribe(parsed, describeMock, 'source');

    expect(validated).to.deep.equal([
      { kind: 'count', valueType: 'number' },
      { kind: 'sum', field: 'AnnualRevenue', fieldType: 'currency', label: 'Annual Revenue', valueType: 'number' },
    ]);
  });

  it('throws when field is missing', () => {
    const parsed = parseMetricTokens(['sum:MissingField']);
    expect(() => validateMetricsAgainstDescribe(parsed, describeMock, 'source')).to.throw(/MissingField/);
  });

  it('throws when metric type incompatible', () => {
    const parsed = parseMetricTokens(['avg:LastActivityDate']);
    expect(() => validateMetricsAgainstDescribe(parsed, describeMock, 'source')).to.throw(/must be numeric/);
  });
});
