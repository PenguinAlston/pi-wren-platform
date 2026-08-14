'use client';

import { useEffect } from 'react';
import { Button } from 'animal-island-ui';
import type { ModuleId, ModuleDef } from '../modules';
import { COLUMN_LABELS, formatValue } from '../modules';

export interface DetailPayload {
  module: ModuleId;
  id: string;
  data: Record<string, unknown>;
}

interface Props {
  payload: DetailPayload | null;
  module: ModuleDef;
  onClose: () => void;
  onOpenDetail: (module: ModuleId, id: string) => void;
}

function isRowList(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value);
}

function labelOf(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}

/** 详情抽屉：主记录关键值 + 子表（需求 3.x「查看详情」）。 */
export default function DetailDrawer({ payload, module, onClose, onOpenDetail }: Props) {
  // Esc 关闭抽屉（hook 必须在条件返回前调用，遵守 Rules of Hooks）
  useEffect(() => {
    if (!payload) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [payload, onClose]);

  if (!payload) {
    return null;
  }

  const { data } = payload;
  const mainKey = payload.module === 'contract' ? 'policy' : payload.module === 'preserve' ? 'preserve' : 'claim';
  const main = (data[mainKey] ?? data) as Record<string, unknown> | undefined;
  const entries = Object.entries(main ?? {});

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <h2 className="drawer-title">
            {module.label}详情
            <span className="drawer-module-tag">{payload.module.toUpperCase()}</span>
          </h2>
          <Button size="small" onClick={onClose}>
            关闭
          </Button>
        </header>

        <div className="drawer-body">
          <section>
            <h3 className="drawer-section-title">基本信息</h3>
            <dl className="detail-grid">
              {entries.map(([key, value]) => {
                if (key === 'id' || Array.isArray(value)) {
                  return null;
                }
                return (
                  <div key={key} className="detail-item">
                    <dt>{labelOf(key)}</dt>
                    <dd>{formatValue(value)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>

          {module.detailSections.map(({ key, title }) => {
            const rows = data[key];
            if (!isRowList(rows)) {
              return null;
            }
            return (
              <section key={key}>
                <h3 className="drawer-section-title">{title}（{rows.length}）</h3>
                {rows.length === 0 ? (
                  <p className="meta">暂无记录</p>
                ) : (
                <div className="drawer-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {Object.keys(rows[0] ?? {}).map((column) => (
                          <th key={column}>{labelOf(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index}>
                          {Object.entries(row).map(([column, value]) => {
                            const isPolicyLink =
                              column === 'policy_id' && typeof value === 'string' && value !== '';
                            return (
                              <td key={column}>
                                {isPolicyLink ? (
                                  <button
                                    className="link-btn"
                                    onClick={() => onOpenDetail('contract', value)}
                                  >
                                    {formatValue(value)}
                                  </button>
                                ) : (
                                  formatValue(value)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
