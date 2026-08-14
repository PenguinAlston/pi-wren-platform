'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Input } from 'animal-island-ui';
import DetailDrawer, { type DetailPayload } from './components/DetailDrawer';
import {
  MODULES,
  formatValue,
  type FilterGroupDef,
  type ModuleId,
  type QueryFieldDef,
} from './modules';

interface DictOption {
  value: string;
  label: string;
}

interface OrgOption {
  orgId: string;
  orgName: string;
}

interface QueryPageResult {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SortState {
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

const EMPTY_CONDITIONS: Record<string, string> = {};

/** 从 URL ?m= 读取初始模块（侧边栏切换会同步 URL）。 */
function initialModule(): ModuleId {
  if (typeof window !== 'undefined') {
    const m = new URLSearchParams(window.location.search).get('m');
    if (m === 'contract' || m === 'preserve' || m === 'claim') {
      return m;
    }
  }
  return 'contract';
}

function buildPayload(fields: QueryFieldDef[], conditions: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = conditions[field.key];
    if (raw === undefined || raw === '') {
      continue;
    }
    if (field.type === 'number') {
      const number = Number(raw);
      if (Number.isFinite(number)) {
        payload[field.key] = number;
      }
    } else {
      payload[field.key] = raw;
    }
  }
  return payload;
}

/** 状态列 → 胶囊语义色（终止/退保/拒赔=红，待办/处理中=黄，正常=绿，其余=信息蓝）。 */
function pillTone(text: string): string {
  if (/终止|退保|失效|拒赔|撤销|驳回|失败|错误/.test(text)) {
    return 'pill-bad';
  }
  if (/待|中|申请|暂|查勘|审核中|处理中/.test(text)) {
    return 'pill-warn';
  }
  if (/通过|有效|办结|结案|承保|完成|成功|正常/.test(text)) {
    return 'pill-ok';
  }
  return 'pill-info';
}

/** 是否以等宽字体展示（编号/日期/金额）。 */
function isMonoColumn(key: string): boolean {
  return /_id$|_no$|time|amount|premium|_year$|date$/.test(key);
}

export default function QueryPage() {
  return (
    <Suspense fallback={null}>
      <QueryPageInner />
    </Suspense>
  );
}

function QueryPageInner() {
  const [moduleId, setModuleId] = useState<ModuleId>(initialModule);
  const [conditions, setConditions] = useState<Record<string, string>>({ ...EMPTY_CONDITIONS });
  /** 手动展开的筛选分组（有值的分组始终自动展开）。 */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [dicts, setDicts] = useState<Record<string, DictOption[]>>({});
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [result, setResult] = useState<QueryPageResult | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortState>({ sortOrder: 'desc' });
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);

  const module = MODULES[moduleId];
  const searchParams = useSearchParams();
  const urlModule = searchParams.get('m');

  // 全局侧栏已细分契约/保全/理赔：模块由 URL ?m= 驱动，页面只展示对应业务
  useEffect(() => {
    if (urlModule === 'contract' || urlModule === 'preserve' || urlModule === 'claim') {
      setModuleId(urlModule);
      setConditions({ ...EMPTY_CONDITIONS });
      setOpenGroups(new Set());
      setResult(null);
      setPage(1);
      setSort({ sortOrder: 'desc' });
      setError(null);
      setDetail(null);
    }
  }, [urlModule]);

  // 下拉选项与数据库联动（需求 3.2）：字典 + 机构一次拉取
  useEffect(() => {
    void (async () => {
      try {
        const [dictResponse, orgResponse] = await Promise.all([
          fetch('/api/dicts').then((r) => r.json() as Promise<{ dicts: Record<string, DictOption[]> }>),
          fetch('/api/orgs').then((r) => r.json() as Promise<{ orgs: OrgOption[] }>),
        ]);
        setDicts(dictResponse.dicts);
        setOrgs(orgResponse.orgs);
      } catch {
        // 服务未就绪时保持空下拉，不阻塞页面
      }
    })();
  }, []);

  const runQuery = useCallback(
    async (nextPage = 1, nextSort: SortState = sort, conds?: Record<string, string>) => {
      const effective = conds ?? conditions;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/traditional/${moduleId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conditions: buildPayload(module.fields, effective),
            page: nextPage,
            pageSize,
            sortBy: nextSort.sortBy,
            sortOrder: nextSort.sortOrder,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `查询失败（${response.status}）`);
        }
        const body = (await response.json()) as QueryPageResult;
        setResult(body);
        setPage(body.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : '查询失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [moduleId, conditions, pageSize, sort, module.fields],
  );

  const clearCondition = (key: string) => {
    const next = { ...conditions, [key]: '' };
    setConditions(next);
    void runQuery(1, sort, next);
  };

  const resetConditions = () => {
    setConditions({ ...EMPTY_CONDITIONS });
    setResult(null);
    setError(null);
  };

  const toggleSort = (sortKey: string) => {
    const nextSort: SortState =
      sort.sortBy === sortKey
        ? { sortBy: sortKey, sortOrder: sort.sortOrder === 'asc' ? 'desc' : 'asc' }
        : { sortBy: sortKey, sortOrder: 'desc' };
    setSort(nextSort);
    void runQuery(1, nextSort);
  };

  const openDetail = useCallback(async (targetModule: ModuleId, id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/traditional/${targetModule}/${encodeURIComponent(id)}/detail`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `详情加载失败（${response.status}）`);
      }
      const data = (await response.json()) as Record<string, unknown>;
      setDetail({ module: targetModule, id, data });
    } catch (err) {
      setError(err instanceof Error ? err.message : '详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const exportCsv = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/traditional/${moduleId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditions: buildPayload(module.fields, conditions),
          sortBy: sort.sortBy,
          sortOrder: sort.sortOrder,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `导出失败（${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = module.exportFilename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setLoading(false);
    }
  };

  const selectOptions = (field: QueryFieldDef) => {
    if (field.source === 'orgs') {
      return orgs.map((org) => ({ value: org.orgId, label: org.orgName }));
    }
    return dicts[field.dictType ?? ''] ?? [];
  };

  const fieldDisplay = (field: QueryFieldDef): string => {
    const raw = conditions[field.key] ?? '';
    if (!raw) {
      return '';
    }
    if (field.type === 'select') {
      const match = selectOptions(field).find((o) => o.value === raw);
      if (match) {
        return match.label;
      }
    }
    return raw;
  };

  const activeChips = module.fields
    .filter((field) => conditions[field.key])
    .map((field) => ({ field, display: fieldDisplay(field) }));

  const groupActiveCount = (keys: string[]) => keys.filter((key) => conditions[key]).length;

  const isGroupOpen = (group: FilterGroupDef) =>
    openGroups.has(group.id) || groupActiveCount(group.keys) > 0;

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const allGroupsOpen = module.filterGroups.length > 0 && module.filterGroups.every(isGroupOpen);

  const toggleAllGroups = () => {
    setOpenGroups(allGroupsOpen ? new Set() : new Set(module.filterGroups.map((g) => g.id)));
  };

  const renderField = (field: QueryFieldDef) => {
    const value = conditions[field.key] ?? '';
    const setValue = (next: string) => setConditions((prev) => ({ ...prev, [field.key]: next }));
    if (field.type === 'select') {
      const options = selectOptions(field);
      return (
        <select className="ai-select" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">全部</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === 'date') {
      return (
        <Input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: '100%' }}
        />
      );
    }
    if (field.type === 'number') {
      return (
        <Input
          type="number"
          min={0}
          placeholder={field.placeholder ?? '请输入金额'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: '100%' }}
        />
      );
    }
    return (
      <Input
        type="text"
        placeholder={field.placeholder ?? '请输入'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: '100%' }}
      />
    );
  };

  const totalPages = Math.max(result?.totalPages ?? 0, 1);

  return (
    <main className="query-layout">
      {/* 左侧：查询条件筛选（模块由全局侧栏 ?m= 驱动，此处不再细分业务模块） */}
      <aside className="query-sidebar">
        <section className="side-panel">
          <header className="side-panel-head">
            <h3>查询条件</h3>
            <button className="panel-toggle" onClick={toggleAllGroups}>
              {allGroupsOpen ? '收起全部' : '展开全部'}
            </button>
          </header>
          <div className="filter-sections">
            {module.filterGroups.map((group) => {
              const count = groupActiveCount(group.keys);
              const open = isGroupOpen(group);
              return (
                <div key={group.id} className="filter-section">
                  <button
                    className="filter-section-head"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={open}
                  >
                    <span className={'f-arrow' + (open ? ' open' : '')}>▸</span>
                    {group.title}
                    <span className={'g-count' + (count > 0 ? '' : ' empty')}>
                      {count > 0 ? count : '0'}
                    </span>
                  </button>
                  {open ? (
                    <div className="filter-section-body">
                      {group.keys.map((key) => {
                        const field = module.fields.find((f) => f.key === key);
                        if (!field) {
                          return null;
                        }
                        return (
                          <div key={key} className="query-field">
                            <label className="query-field-label">{field.label}</label>
                            {renderField(field)}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="filter-actions">
              <Button type="primary" loading={loading} onClick={() => void runQuery(1)}>
                {loading ? '查询中' : '查询'}
              </Button>
              <Button onClick={resetConditions}>重置</Button>
              <Button onClick={() => void exportCsv()} disabled={loading}>
                导出
              </Button>
            </div>
          </div>
        </section>
      </aside>

      {/* 右侧：结果监控区 */}
      <section className="query-main">
        <div className="query-page-head">
          <h2>
            {module.label}
            <span className="tag">{moduleId.toUpperCase()}</span>
          </h2>
          <span className="meta">所有条件为且关系 · 可自由搭配</span>
        </div>

        {activeChips.length > 0 ? (
          <div className="chips">
            {activeChips.map(({ field, display }) => (
              <span key={field.key} className="chip">
                <b>{field.label}</b>
                {display}
                <button onClick={() => clearCondition(field.key)} aria-label={'清除' + field.label}>
                  ✕
                </button>
              </span>
            ))}
            <button className="chip chip-clear" onClick={resetConditions}>
              清空全部
            </button>
          </div>
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="card">
          <div className="query-result-head">
            <h2 className="card-title">
              <span className="live" />
              查询结果
            </h2>
            {result ? (
              <span className="meta">
                共 {result.total} 条记录 · 第 {result.page} / {totalPages} 页
              </span>
            ) : null}
          </div>

          {loading && !result ? (
            <div className="result-loading">
              <span className="spinner" />
              正在向数据库发起查询…
            </div>
          ) : null}

          {result && !loading ? (
            result.items.length === 0 ? (
              <p className="meta empty-result">未查询到符合条件的记录，试试放宽筛选条件。</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {module.columns.map((column) => (
                          <th
                            key={column.key}
                            className={column.narrow ? 'col-narrow' : undefined}
                            onClick={column.sortKey ? () => toggleSort(column.sortKey!) : undefined}
                            style={column.sortKey ? { cursor: 'pointer' } : undefined}
                            title={column.sortKey ? '点击排序' : undefined}
                          >
                            {column.label}
                            {column.sortKey === sort.sortBy
                              ? sort.sortOrder === 'asc'
                                ? ' ↑'
                                : ' ↓'
                              : column.sortKey
                                ? ' ⇅'
                                : ''}
                          </th>
                        ))}
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((row, index) => (
                        <tr
                          key={index}
                          style={{ animationDelay: Math.min(index * 28, 320) + 'ms' }}
                        >
                          {module.columns.map((column) => {
                            const text = formatValue(row[column.key]);
                            const isStatus = column.key.endsWith('_label');
                            return (
                              <td
                                key={column.key}
                                className={
                                  (column.narrow ? 'col-narrow' : '') +
                                  (isMonoColumn(column.key) ? ' mono' : '')
                                }
                              >
                                {isStatus ? (
                                  <span className={'pill ' + pillTone(text)}>{text}</span>
                                ) : (
                                  text
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <button
                              className="link-btn"
                              disabled={detailLoading}
                              onClick={() => {
                                const id =
                                  moduleId === 'preserve'
                                    ? row.preserve_id
                                    : moduleId === 'claim'
                                      ? row.claim_id
                                      : row.policy_id;
                                if (typeof id === 'string') {
                                  void openDetail(moduleId, id);
                                }
                              }}
                            >
                              查看详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="query-pagination">
                  <Button size="small" disabled={page <= 1 || loading} onClick={() => void runQuery(page - 1)}>
                    上一页
                  </Button>
                  <select
                    className="ai-select page-size"
                    value={pageSize}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setPageSize(next);
                      void runQuery(1, sort);
                    }}
                  >
                    {[10, 20, 50].map((size) => (
                      <option key={size} value={size}>
                        {size} 条/页
                      </option>
                    ))}
                  </select>
                  <Button size="small" disabled={page >= totalPages || loading} onClick={() => void runQuery(page + 1)}>
                    下一页
                  </Button>
                </div>
              </>
            )
          ) : null}
        </div>
      </section>

      <DetailDrawer
        payload={detail}
        module={MODULES[detail?.module ?? moduleId]}
        onClose={() => setDetail(null)}
        onOpenDetail={(nextModule, id) => void openDetail(nextModule, id)}
      />
    </main>
  );
}
