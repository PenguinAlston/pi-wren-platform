import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { SemanticConfig, SemanticIntent, SemanticMetric, SemanticModel } from './types';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Parse and validate a YAML semantic config string. */
export function parseSemanticConfig(raw: string, source = '<inline>'): SemanticConfig {
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new Error(`failed to parse semantic config ${source}: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`invalid semantic config ${source}: expected a YAML object`);
  }

  const config = parsed as Record<string, unknown>;
  if (!isString(config['name'])) {
    throw new Error(`invalid semantic config ${source}: missing "name"`);
  }

  const models: SemanticModel[] = Array.isArray(config['models'])
    ? (config['models'] as Record<string, unknown>[]).map((model, index) => {
        if (!isString(model['name']) || !isString(model['table'])) {
          throw new Error(`invalid semantic config ${source}: models[${index}] needs name + table`);
        }
        return {
          name: model['name'],
          table: model['table'],
          description: isString(model['description']) ? model['description'] : undefined,
          columns: Array.isArray(model['columns'])
            ? (model['columns'] as Record<string, unknown>[]).map((column) => ({
                name: String(column['name']),
                type: String(column['type'] ?? 'unknown'),
                label: isString(column['label']) ? String(column['label']) : undefined,
              }))
            : undefined,
        };
      })
    : [];

  const intents: SemanticIntent[] = Array.isArray(config['intents'])
    ? (config['intents'] as Record<string, unknown>[]).map((intent, index) => {
        if (!isString(intent['name']) || !isStringArray(intent['keywords']) || !isString(intent['sql'])) {
          throw new Error(
            `invalid semantic config ${source}: intents[${index}] needs name, keywords[], sql`,
          );
        }
        return {
          name: intent['name'],
          keywords: intent['keywords'],
          description: isString(intent['description']) ? intent['description'] : undefined,
          sql: intent['sql'],
        };
      })
    : [];

  const metrics: SemanticMetric[] = Array.isArray(config['metrics'])
    ? (config['metrics'] as Record<string, unknown>[]).map((metric, index) => {
        if (!isString(metric['name']) || !isString(metric['definition'])) {
          throw new Error(
            `invalid semantic config ${source}: metrics[${index}] needs name + definition`,
          );
        }
        return {
          name: metric['name'],
          definition: metric['definition'],
          unit: isString(metric['unit']) ? metric['unit'] : undefined,
        };
      })
    : [];

  if (models.length === 0 || intents.length === 0) {
    throw new Error(`invalid semantic config ${source}: must declare at least one model and intent`);
  }

  return {
    name: config['name'],
    catalog: isString(config['catalog']) ? config['catalog'] : undefined,
    schema: isString(config['schema']) ? config['schema'] : undefined,
    models,
    intents,
    metrics,
    knowledge: isStringArray(config['knowledge']) ? config['knowledge'] : [],
    defaultIntent: isString(config['defaultIntent']) ? config['defaultIntent'] : undefined,
  };
}

/** Load a semantic config from a YAML file. */
export function loadSemanticConfig(path: string): SemanticConfig {
  const raw = readFileSync(path, 'utf8');
  return parseSemanticConfig(raw, path);
}

/** Resolve the semantic config file relative to this module, with cwd fallback. */
export function resolveSemanticFile(filename: string): string {
  const candidates = [
    // dev（源码位置 services/context-engine/src/mdl/ -> 仓库根/semantic）
    fileURLToPath(new URL(`../../../../semantic/${filename}`, import.meta.url)),
    // tsup 打包后（apps/api/dist/server.js -> 仓库根/semantic）
    fileURLToPath(new URL(`../../semantic/${filename}`, import.meta.url)),
    // 以仓库根为 cwd 运行时
    join(process.cwd(), 'semantic', filename),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`semantic config not found: ${filename} (tried ${candidates.join(', ')})`);
}
