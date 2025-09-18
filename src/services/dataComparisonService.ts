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

import type { Org } from '@salesforce/core';

import type { AggregatePlan, MetricDefinition } from './aggregateQueryBuilder.js';
import type { MetricValueType, ResolvedMetric } from './metricParser.js';

export type MetricComparisonRow = {
  metric: ResolvedMetric;
  alias: string;
  sourceValue: number | string | null;
  targetValue: number | string | null;
  difference: number | null;
};

export type SampleData = {
  source: Array<Record<string, unknown>>;
  target: Array<Record<string, unknown>>;
};

export type OrgEvaluation = {
  aggregates: Record<string, number | string | null>;
  samples: Array<Record<string, unknown>>;
};

export type ComparisonEvaluation = {
  metrics: MetricComparisonRow[];
  samples: SampleData;
  evaluations: {
    source: OrgEvaluation;
    target: OrgEvaluation;
  };
};

export type ComparisonInput = {
  sourceOrg: Org;
  targetOrg: Org;
  plan: AggregatePlan;
  apiVersionOverride?: string;
  sampleQuery?: string;
};

export const compareData = async ({
  sourceOrg,
  targetOrg,
  plan,
  apiVersionOverride,
  sampleQuery,
}: ComparisonInput): Promise<ComparisonEvaluation> => {
  const [sourceEvaluation, targetEvaluation] = await Promise.all([
    evaluateOrg({ org: sourceOrg, plan, sampleQuery, apiVersionOverride }),
    evaluateOrg({ org: targetOrg, plan, sampleQuery, apiVersionOverride }),
  ]);

  const metrics = plan.metrics.map((definition) =>
    buildMetricRow(definition, sourceEvaluation.aggregates, targetEvaluation.aggregates)
  );

  return {
    metrics,
    samples: {
      source: sourceEvaluation.samples,
      target: targetEvaluation.samples,
    },
    evaluations: {
      source: sourceEvaluation,
      target: targetEvaluation,
    },
  } satisfies ComparisonEvaluation;
};

const evaluateOrg = async ({
  org,
  plan,
  sampleQuery,
  apiVersionOverride,
}: {
  org: Org;
  plan: AggregatePlan;
  sampleQuery?: string;
  apiVersionOverride?: string;
}): Promise<OrgEvaluation> => {
  const connection = await Promise.resolve(org.getConnection(apiVersionOverride));
  const aggregates: Record<string, number | string | null> = {};

  if (plan.aggregateQuery) {
    const aggregateResponse = await connection.query<Record<string, unknown>>(plan.aggregateQuery);
    const record = aggregateResponse.records[0] ?? {};

    for (const expression of plan.expressions) {
      const value = record[expression.alias];
      aggregates[expression.alias] = normalizeAggregateValue(expression.valueType, value);
    }
  }

  if (plan.conditionalMetrics.length > 0) {
    const conditionalResults = await Promise.all(
      plan.conditionalMetrics.map(async (conditional) => {
        const response = await connection.query<Record<string, unknown>>(conditional.aggregateQuery);
        const conditionalRecord = response.records[0] ?? {};
        return {
          alias: conditional.alias,
          value: conditionalRecord[conditional.alias],
          valueType: conditional.valueType,
        } as const;
      })
    );

    for (const result of conditionalResults) {
      aggregates[result.alias] = normalizeAggregateValue(result.valueType, result.value);
    }
  }

  let samples: Array<Record<string, unknown>> = [];
  if (sampleQuery) {
    const sampleResponse = await connection.query<Record<string, unknown>>(sampleQuery);
    samples = sampleResponse.records ?? [];
  }

  return { aggregates, samples } satisfies OrgEvaluation;
};

const normalizeAggregateValue = (valueType: MetricValueType, raw: unknown): number | string | null => {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (valueType === 'number') {
    if (typeof raw === 'number') {
      return raw;
    }

    const numeric = Number(raw);
    return Number.isNaN(numeric) ? null : numeric;
  }

  if (raw instanceof Date) {
    return raw.toISOString();
  }

  return typeof raw === 'string' ? raw : String(raw);
};

const buildMetricRow = (
  definition: MetricDefinition,
  sourceAggregates: Record<string, number | string | null>,
  targetAggregates: Record<string, number | string | null>
): MetricComparisonRow => {
  if (definition.kind === 'direct') {
    const sourceValue = sourceAggregates[definition.alias] ?? null;
    const targetValue = targetAggregates[definition.alias] ?? null;
    const difference = computeDifference(definition.metric, sourceValue, targetValue);

    return {
      metric: definition.metric,
      alias: definition.alias,
      sourceValue,
      targetValue,
      difference,
    } satisfies MetricComparisonRow;
  }

  const numeratorSource = sourceAggregates[definition.numeratorAlias] ?? null;
  const numeratorTarget = targetAggregates[definition.numeratorAlias] ?? null;
  const denominatorSource = sourceAggregates[definition.denominatorAlias] ?? null;
  const denominatorTarget = targetAggregates[definition.denominatorAlias] ?? null;

  const sourceRatio = computeRatioValue(numeratorSource, denominatorSource);
  const targetRatio = computeRatioValue(numeratorTarget, denominatorTarget);
  const difference = computeDifference(definition.metric, sourceRatio, targetRatio);

  return {
    metric: definition.metric,
    alias: definition.alias,
    sourceValue: sourceRatio,
    targetValue: targetRatio,
    difference,
  } satisfies MetricComparisonRow;
};

const computeRatioValue = (numerator: number | string | null, denominator: number | string | null): number | null => {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') {
    return null;
  }

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
};

const computeDifference = (
  metric: ResolvedMetric,
  sourceValue: number | string | null,
  targetValue: number | string | null
): number | null => {
  if (metric.valueType !== 'number') {
    return null;
  }

  if (typeof sourceValue !== 'number' || typeof targetValue !== 'number') {
    return null;
  }

  return targetValue - sourceValue;
};

export class DataComparisonService {
  private readonly compareImpl = compareData;

  public async compare(input: ComparisonInput): Promise<ComparisonEvaluation> {
    return this.compareImpl(input);
  }
}
