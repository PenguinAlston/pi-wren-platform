'use client';

import { useCallback, useEffect, useState } from 'react';
import DetailDrawer, { type DetailPayload } from './components/DetailDrawer';
import { MODULES, formatValue, type ModuleId, type QueryFieldDef } from './modules';

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

export default function QueryPage() {
  const [moduleId, setModuleId] = useState<ModuleId>('contract');
  const [conditions, setConditions] = useState<Record<string, string>>({ ...EMPTY_CONDITIONS });
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
    async (nextPage = 1, nextSort: SortState = sort) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/traditional/${moduleId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conditions: buildPayload(module.fields, conditions),
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
    [moduleId, conditions, pageSize, sort],
  );

  const switchModule = (next: ModuleId) => {
    if (next === moduleId) {
      return;
    }
    setModuleId(next);
    setConditions({ ...EMPTY_CONDITIONS });
    setResult(null);
    setPage(1);
    setSort({ sortOrder: 'desc' });
    setError(null);
    setDetail(null);
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

  const renderField = (field: QueryFieldDef) => {
    const value = conditions[field.key] ?? '';
    const setValue = (next: string) => setConditions((prev) => ({ ...prev, [field.key]: next }));
    if (field.type === 'select') {
      const options =
        field.source === 'orgs'
          ? orgs.map((org) => ({ value: org.orgId, label: org.orgName }))
          : (dicts[field.dictType ?? ''] ?? []);
      return (
        <select className="field-input" value={value} onChange={(e) => setValue(e.target.value)}>
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
        <input
          className="field-input"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    }
    if (field.type === 'number') {
      return (
        <input
          className="field-input"
          type="number"
          min={0}
          placeholder={field.placeholder ?? '请输入金额'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      );
    }
    return (
      <input
        className="field-input"
        type="text"
        placeholder={field.placeholder ?? '请输入'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  };

  const totalPages = Math.max(result?.totalPages ?? 0, 1);

  return (
    <main className="query-layout">
      {/* 左侧模块切换（需求 3.1） */}
      <aside className="query-sidebar">
        {(['contract', 'preserve', 'claim'] as ModuleId[]).map((id) => (
          <button
            key={id}
            className={`query-module-btn${moduleId === id ? ' active' : ''}`}
            onClick={() => switchModule(id)}
          >
            {MODULES[id].label}
          </button>
        ))}
      </aside>

      <section className="query-main">
        <div className="card">
          <h2 className="section">{module.label} · 条件查询</h2>
          <div className="query-form-grid">
            {module.fields.map((field) => (
              <div key={field.key} className="query-field">
                <label className="query-field-label">{field.label}</label>
                {renderField(field)}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={() => void runQuery(1)} disabled={loading}>
              {loading ? '查询中…' : '查询'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setConditions({ ...EMPTY_CONDITIONS });
                setResult(null);
                setError(null);
              }}
            >
              重置
            </button>
            <button className="btn btn-secondary" onClick={() => void exportCsv()} disabled={loading}>
              导出
            </button>
            <span className="meta" style={{ marginLeft: 'auto' }}>
              所有条件为且关系，可自由搭配
            </span>
          </div>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="card">
          <div className="query-result-head">
            <h2 className="section" style={{ margin: 0 }}>
              查询结果
            </h2>
            {result ? (
              <span className="meta">
                共 {result.total} 条记录 · 第 {result.page} / {totalPages} 页
              </span>
            ) : null}
          </div>

          {loading && !result ? <p className="meta">加载中…</p> : null}

          {result && !loading ? (
            result.items.length === 0 ? (
              <p className="meta">未查询到符合条件的记录。</p>
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
                        <tr key={index}>
                          {module.columns.map((column) => (
                            <td key={column.key} className={column.narrow ? 'col-narrow' : undefined}>
                              {formatValue(row[column.key])}
                            </td>
                          ))}
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
                  <button
                    className="btn btn-secondary"
                    disabled={page <= 1 || loading}
                    onClick={() => void runQuery(page - 1)}
                  >
                    上一页
                  </button>
                  <select
                    className="field-input page-size"
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
                  <button
                    className="btn btn-secondary"
                    disabled={page >= totalPages || loading}
                    onClick={() => void runQuery(page + 1)}
                  >
                    下一页
                  </button>
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
