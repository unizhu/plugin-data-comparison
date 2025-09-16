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
import { dirname, resolve } from 'node:path';

import type { CompareDataResult } from '../commands/compare/data.js';

const escapePdfText = (input: string): string =>
  input.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const formatMetricLabel = (comparison: CompareDataResult['metrics'][number]): string => {
  const metric = comparison.metric;
  if (metric.kind === 'count') {
    return 'COUNT()';
  }

  return `${metric.kind.toUpperCase()}(${metric.field})`;
};

const padColumn = (value: string, width: number): string => value.padEnd(width, ' ');

const buildContentStream = (result: CompareDataResult): string => {
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push(`Report Title: ${result.reportTitle ?? 'Salesforce Data Comparison'}`);
  lines.push(`Generated At: ${now}`);
  lines.push(`Source Org: ${result.source.aliasOrUsername} (${result.source.orgId})`);
  lines.push(`Target Org: ${result.target.aliasOrUsername} (${result.target.orgId})`);
  lines.push(`Object: ${result.object}`);
  lines.push(`Metrics: ${result.metrics.map((metric) => formatMetricLabel(metric)).join(' | ')}`);
  lines.push(`Filter: ${result.filters.where ?? ''}`);
  lines.push(`Sample Size: ${result.filters.sampleSize}`);
  lines.push('');

  const header = `${padColumn('Metric', 30)}${padColumn('Source', 15)}${padColumn('Target', 15)}Difference`;
  lines.push(header);
  for (const metric of result.metrics) {
    const source = metric.sourceValue === null ? '—' : String(metric.sourceValue);
    const target = metric.targetValue === null ? '—' : String(metric.targetValue);
    const difference = metric.difference === null ? '—' : String(metric.difference);
    lines.push(
      `${padColumn(formatMetricLabel(metric), 30)}${padColumn(source, 15)}${padColumn(target, 15)}${difference}`
    );
  }

  lines.push('');
  lines.push(`Source Samples: ${result.samples.source.length}`);
  lines.push(`Target Samples: ${result.samples.target.length}`);

  const escaped = lines.map((line) => `(${escapePdfText(line)}) Tj`).join('\nT*\n');
  return `BT\n/F1 10 Tf\n72 720 Td\n${escaped}\nET`;
};

const buildPdf = (contentStream: string): string => {
  const objects: string[] = [];
  const offsets: number[] = [0];

  const addObject = (body: string): void => {
    objects.push(`${body}\nendobj\n`);
  };

  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>');
  addObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  );

  const streamLength = contentStream.length;
  addObject(`4 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream`);
  addObject('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return pdf;
};

export const exportComparisonToPdf = async (result: CompareDataResult, outputFile: string): Promise<string> => {
  const resolvedPath = resolve(outputFile);
  await fs.mkdir(dirname(resolvedPath), { recursive: true });

  const contentStream = buildContentStream(result);
  const pdf = buildPdf(contentStream);

  await fs.writeFile(resolvedPath, pdf, 'utf8');
  return resolvedPath;
};
