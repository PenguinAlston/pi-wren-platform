import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** 一个 WrenAI 模型的列定义（仅提取 TS 侧需要的字段）。 */
export interface WrenProjectColumn {
  name: string;
  type: string;
  description?: string;
}

/** 一个 WrenAI 模型（对应 models/<name>/metadata.yml）。 */
export interface WrenProjectModel {
  name: string;
  table: string;
  description?: string;
  columns: WrenProjectColumn[];
}

/** 一个 NL→SQL 示例对（对应 knowledge/sql/<name>.md 的 frontmatter）。 */
export interface WrenProjectExample {
  name: string;
  nl: string;
  sql: string;
}

/**
 * 从 WrenAI 工程目录解析出的结构化信息。
 * 运行时的语义检索仍由 `wren memory fetch`（WrenCli）完成；
 * 此结构仅供 TS 侧做表名白名单（sql-validation）与 LLM few-shot 示例注入。
 */
export interface WrenProject {
  /** 工程目录绝对路径。 */
  projectDir: string;
  models: WrenProjectModel[];
  /** knowledge/sql/*.md 解析出的示例对（按文件名排序）。 */
  examples: WrenProjectExample[];
}

/** 提取白名单表名（含写死的 sys_dict 字典表）。 */
export function allowedTablesOf(project: WrenProject): string[] {
  return [...project.models.map((m) => m.table), 'sys_dict'].map((t) => t.toLowerCase());
}

/**
 * 从 WrenAI 工程目录加载结构化信息。
 * 目录布局（schema_version 5）：wren_project.yml + models/<name>/metadata.yml + knowledge/sql/*.md。
 * 任何文件缺失或解析失败都跳过该条目（不抛错），保证加载的健壮性。
 */
export function loadWrenProject(projectDir: string): WrenProject {
  const models = loadModels(join(projectDir, 'models'));
  const examples = loadExamples(join(projectDir, 'knowledge', 'sql'));
  return { projectDir, models, examples };
}

/** 判断目录是否是一个就绪的 WrenAI 工程（wren_project.yml 存在）。 */
export function isWrenProjectReady(projectDir: string): boolean {
  return existsSync(join(projectDir, 'wren_project.yml'));
}

interface MetadataColumn {
  name?: unknown;
  type?: unknown;
  properties?: { description?: unknown };
}

interface MetadataYaml {
  name?: unknown;
  table_reference?: { schema?: unknown; table?: unknown };
  properties?: { description?: unknown };
  columns?: MetadataColumn[];
}

function loadModels(modelsDir: string): WrenProjectModel[] {
  if (!existsSync(modelsDir)) return [];
  const models: WrenProjectModel[] = [];
  for (const entry of readdirSync(modelsDir).sort()) {
    const metaPath = join(modelsDir, entry, 'metadata.yml');
    if (!existsSync(metaPath)) continue;
    const raw = parseYamlFile(metaPath);
    if (!raw || typeof raw !== 'object') continue;
    const meta = raw as MetadataYaml;
    const table = stringOrNull(meta.table_reference?.table);
    if (typeof meta.name !== 'string' || !table) continue;
    models.push({
      name: meta.name,
      table,
      description: stringOrNull(meta.properties?.description),
      columns: (meta.columns ?? []).reduce<WrenProjectColumn[]>((acc, c) => {
        if (typeof c?.name === 'string' && typeof c?.type === 'string') {
          acc.push({
            name: c.name,
            type: c.type,
            description: stringOrNull(c.properties?.description),
          });
        }
        return acc;
      }, []),
    });
  }
  return models;
}

function loadExamples(sqlDir: string): WrenProjectExample[] {
  if (!existsSync(sqlDir)) return [];
  const examples: WrenProjectExample[] = [];
  for (const entry of readdirSync(sqlDir).sort()) {
    if (!entry.endsWith('.md')) continue;
    const fullPath = join(sqlDir, entry);
    if (!statSync(fullPath).isFile()) continue;
    const text = readFileSync(fullPath, 'utf8');
    const frontmatter = parseFrontmatter(text);
    const nl = stringOrNull(frontmatter.nl);
    const sql = stringOrNull(frontmatter.sql);
    if (!nl || !sql) continue;
    examples.push({ name: entry.replace(/\.md$/, ''), nl, sql });
  }
  return examples;
}

function parseYamlFile(path: string): unknown {
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 解析 markdown 文件的 YAML frontmatter（--- 之间的内容）。 */
function parseFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return {};
  try {
    const parsed = parse(match[1]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
