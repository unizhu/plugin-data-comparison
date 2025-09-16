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

import type { MetricValueType, ResolvedFieldAggregateMetric, ResolvedMetric } from './metricParser.js';

export type AggregateExpression = {
  alias: string;
  soql: string;
  valueType: MetricValueType;
};

export type MetricDefinition =
  | {
      kind: 'direct';
      metric: Exclude<ResolvedMetric, { kind: 'ratio' }>;
      alias: string;
    }
  | {
      kind: 'ratio';
      metric: Extract<ResolvedMetric, { kind: 'ratio' }>;
      numeratorAlias: string;
      denominatorAlias: string;
      alias: string;
    };

export type AggregatePlan = {
  objectName: string;
  whereClause?: string;
  aggregateQuery: string;
  expressions: AggregateExpression[];
  metrics: MetricDefinition[];
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
    const metricAliasSet = new Set<string>();
    const expressionCache = new Map<string, AggregateExpression>();
    const expressions: AggregateExpression[] = [];
    const metricDefinitions: MetricDefinition[] = [];
    const sampleFieldSet = new Set<string>();

    const addExpression = (key: string, soql: string, baseAlias: string, valueType: MetricValueType): string => {
      const cached = expressionCache.get(key);
      if (cached) {
        return cached.alias;
      }

      const alias = uniqueAlias(baseAlias, aliasSet);
      const expression = { alias, soql, valueType } satisfies AggregateExpression;
      expressionCache.set(key, expression);
      expressions.push(expression);
      return alias;
    };

    for (const metric of metrics) {
      if (metric.kind === 'ratio') {
        const numeratorAlias = addExpression(
          buildAggregateKey(metric.numerator),
          buildAggregateExpression(metric.numerator),
          sanitizeAlias(`${metric.numerator.fn}__${metric.numerator.field.toLowerCase()}`),
          metric.numerator.valueType
        );
        const denominatorAlias = addExpression(
          buildAggregateKey(metric.denominator),
          buildAggregateExpression(metric.denominator),
          sanitizeAlias(`${metric.denominator.fn}__${metric.denominator.field.toLowerCase()}`),
          metric.denominator.valueType
        );

        sampleFieldSet.add(metric.numerator.field);
        sampleFieldSet.add(metric.denominator.field);

        const alias = uniqueAlias(
          sanitizeAlias(
            `ratio__${metric.numerator.fn}_${metric.numerator.field.toLowerCase()}_${
              metric.denominator.fn
            }_${metric.denominator.field.toLowerCase()}`
          ),
          metricAliasSet
        );

        metricDefinitions.push({
          kind: 'ratio',
          metric,
          numeratorAlias,
          denominatorAlias,
          alias,
        });
        continue;
      }

      const alias = addDirectMetric(metric, addExpression);
      if ('field' in metric) {
        sampleFieldSet.add(metric.field);
      }

      metricAliasSet.add(alias);
      metricDefinitions.push({ kind: 'direct', metric, alias } satisfies MetricDefinition);
    }

    const selectClause = expressions.map((expr) => `${expr.soql} ${expr.alias}`).join(', ');
    const whereClause = buildWhereClause(where);
    const aggregateQuery = `SELECT ${selectClause} FROM ${objectName}${whereClause ? ` WHERE ${whereClause}` : ''}`;

    return {
      objectName,
      whereClause,
      aggregateQuery,
      expressions,
      metrics: metricDefinitions,
      sampleFields: Array.from(sampleFieldSet),
    } satisfies AggregatePlan;
  }
}

const addDirectMetric = (
  metric: Exclude<ResolvedMetric, { kind: 'ratio' }>,
  addExpression: (key: string, soql: string, baseAlias: string, valueType: MetricValueType) => string
): string => {
  switch (metric.kind) {
    case 'count':
      return addExpression('COUNT()', 'COUNT(Id)', 'count__all', metric.valueType);
    case 'fieldAggregate': {
      const soql = `${metric.fn.toUpperCase()}(${metric.field})`;
      return addExpression(
        buildAggregateKey(metric),
        soql,
        sanitizeAlias(`${metric.fn}__${metric.field.toLowerCase()}`),
        metric.valueType
      );
    }
    case 'countDistinct': {
      const soql = `COUNT_DISTINCT(${metric.field})`;
      return addExpression(
        buildAggregateKey(metric),
        soql,
        sanitizeAlias(`countDistinct__${metric.field.toLowerCase()}`),
        metric.valueType
      );
    }
    case 'countIf': {
      const soql = `SUM(CASE WHEN ${metric.condition} THEN 1 ELSE 0 END)`;
      return addExpression(
        buildConditionalKey('countIf', metric.condition),
        soql,
        sanitizeAlias(`countIf__${hashCondition(metric.condition)}`),
        metric.valueType
      );
    }
    case 'sumIf': {
      const soql = `SUM(CASE WHEN ${metric.condition} THEN ${metric.field} ELSE 0 END)`;
      return addExpression(
        buildConditionalKey(`sumIf:${metric.field}`, metric.condition),
        soql,
        sanitizeAlias(`sumIf__${metric.field.toLowerCase()}_${hashCondition(metric.condition)}`),
        metric.valueType
      );
    }
    default:
      throw new Error(`Unsupported metric kind ${(metric as ResolvedMetric).kind}`);
  }
};

const buildAggregateKey = (
  metric: ResolvedFieldAggregateMetric | Extract<ResolvedMetric, { kind: 'countDistinct' }>
): string => {
  if ('fn' in metric) {
    return `${metric.fn}(${metric.field})`;
  }

  return `COUNT_DISTINCT(${metric.field})`;
};

const buildAggregateExpression = (metric: ResolvedFieldAggregateMetric): string =>
  `${metric.fn.toUpperCase()}(${metric.field})`;

const buildConditionalKey = (prefix: string, condition: string): string => `${prefix}:[${condition}]`;

const hashCondition = (condition: string): string => sanitizeAlias(condition.toLowerCase()).slice(0, 40) || 'expr';

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
