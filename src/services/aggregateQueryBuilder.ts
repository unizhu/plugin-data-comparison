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

import type { ResolvedMetric } from './metricParser.js';

export type AggregateExpression = {
  metric: ResolvedMetric;
  alias: string;
  soql: string;
};

export type AggregatePlan = {
  objectName: string;
  whereClause?: string;
  expressions: AggregateExpression[];
  aggregateQuery: string;
  sampleFields: string[];
};

const sanitizeAlias = (value: string): string => value.replace(/[^a-z0-9_]/gi, '_');

const uniqueAlias = (base: string, existing: Set<string>): string => {
  let candidate = base;
  let counter = 1;
  while (existing.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  existing.add(candidate);
  return candidate;
};

export class AggregateQueryBuilder {
  public constructor(
    private readonly options: {
      objectName: string;
      metrics: ResolvedMetric[];
      where?: string;
    }
  ) {}

  public build(): AggregatePlan {
    const { objectName, metrics, where } = this.options;

    if (metrics.length === 0) {
      throw new Error('At least one metric is required to build an aggregate query.');
    }

    const aliasSet = new Set<string>();
    const expressions = metrics.map((metric) => createExpression(metric, aliasSet));

    const selectClause = expressions.map((expr) => `${expr.soql} ${expr.alias}`).join(', ');
    const whereClause = buildWhereClause(where);
    const aggregateQuery = `SELECT ${selectClause} FROM ${objectName}${whereClause ? ` WHERE ${whereClause}` : ''}`;

    const sampleFields = Array.from(
      new Set(
        metrics
          .filter((metric) => metric.kind !== 'count')
          .flatMap((metric) => ('field' in metric ? [metric.field] : []))
      )
    );

    return {
      objectName,
      whereClause,
      expressions,
      aggregateQuery,
      sampleFields,
    } satisfies AggregatePlan;
  }
}

const createExpression = (metric: ResolvedMetric, aliasSet: Set<string>): AggregateExpression => {
  if (metric.kind === 'count') {
    const alias = uniqueAlias('count__all', aliasSet);
    return {
      metric,
      alias,
      soql: 'COUNT()',
    } satisfies AggregateExpression;
  }

  const fieldSegment = metric.field;
  const baseAlias = sanitizeAlias(`${metric.kind}__${metric.field.toLowerCase()}`);
  const alias = uniqueAlias(baseAlias, aliasSet);
  const functionName = metric.kind.toUpperCase();

  return {
    metric,
    alias,
    soql: `${functionName}(${fieldSegment})`,
  } satisfies AggregateExpression;
};

const buildWhereClause = (where?: string): string | undefined => {
  if (!where) {
    return undefined;
  }

  const trimmed = where.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
};
