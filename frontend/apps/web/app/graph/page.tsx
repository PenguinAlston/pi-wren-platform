'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsType, ECElementEvent } from 'echarts';
import { Button } from '../components/ui';
import { apiFetch } from '../lib/api';

interface GraphNode {
  id: string;
  label: string;
  name: string;
  props: Record<string, unknown>;
}
interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
}
interface GraphData {
  categories: { name: string }[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodeCount: number; edgeCount: number; labels: Record<string, number> };
}

// Neo4j Browser 同款节点配色（每种节点标签固定一色）+ 中文标题
const LABEL_META: Record<string, { title: string; color: string }> = {
  Org: { title: '机构', color: '#4c8eda' },
  SysUser: { title: '员工', color: '#57c7e3' },
  Product: { title: '产品', color: '#ffc454' },
  Customer: { title: '客户', color: '#57bb8a' },
  Policy: { title: '保单', color: '#f79767' },
  Claim: { title: '理赔', color: '#f16667' },
  Preserve: { title: '保全', color: '#8a60b8' },
};

const EDGE_COLOR = '#a5abb3';
const EDGE_FOCUS = '#5c6b7a';
// 同向平行边依次外扩的弧度（Neo4j 的关系曲线风格）
const CURVES = [0.12, 0.28, -0.28, 0.45, -0.45, 0.6, -0.6];

const CANVAS_FONT =
  typeof window === 'undefined'
    ? 'sans-serif'
    : (getComputedStyle(document.documentElement).getPropertyValue('--pw-font') || 'sans-serif').trim();

const labelMeta = (label: string) => LABEL_META[label] ?? { title: label, color: '#90a4ae' };
const labelOf = (id: string) => id.split(':')[0] ?? '';
const gidOf = (id: string) => id.split(':')[1] ?? '';

function rgba(hex: string, alpha: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function formatProp(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString('zh-CN');
  if (value == null) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 知识图谱可视化（M2）：Neo4j Browser 风格力导向图。
 * 单击节点查看属性详情卡，双击/卡片按钮下钻一跳关联子图；图例芯片可隐藏对应标签/关系。 */
export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(new Set());
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(new Set());
  const [layoutNonce, setLayoutNonce] = useState(0);
  const chartElRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const firstRunRef = useRef(true);
  const prevNonceRef = useRef(0);
  const pointerDownRef = useRef<[number, number] | null>(null);

  const load = useCallback(async (mode: 'overview' | { label: string; gid: string }) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        mode === 'overview'
          ? '/api/graph/overview'
          : `/api/graph/neighbors?label=${encodeURIComponent(mode.label)}&gid=${encodeURIComponent(mode.gid)}`;
      const response = await apiFetch(url);
      const body = (await response.json()) as GraphData & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `加载失败（${response.status}）`);
      }
      setCenter(mode === 'overview' ? null : `${mode.label}:${mode.gid}`);
      setData(body);
      setLayoutNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图谱加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('overview');
  }, [load]);

  const visible = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], degree: new Map<string, number>() };
    const nodes = data.nodes.filter((n) => !hiddenLabels.has(n.label));
    const edges = data.edges.filter(
      (e) => !hiddenRels.has(e.relation) && !hiddenLabels.has(labelOf(e.source)) && !hiddenLabels.has(labelOf(e.target)),
    );
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    return { nodes, edges, degree };
  }, [data, hiddenLabels, hiddenRels]);

  const nodeIndex = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n]) ?? []), [data]);

  const labelChips = useMemo(() => {
    if (!data) return [];
    return Object.entries(LABEL_META)
      .map(([key, meta]) => ({ key, ...meta, count: data.stats.labels[key] ?? 0 }))
      .filter((chip) => chip.count > 0);
  }, [data]);

  const relChips = useMemo(() => {
    if (!data) return [];
    const tally = new Map<string, number>();
    for (const e of data.edges) tally.set(e.relation, (tally.get(e.relation) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const toggleLabel = useCallback((key: string) => {
    setHiddenLabels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSelected((sel) => (sel && sel.label === key ? null : sel));
  }, []);

  const toggleRel = useCallback((key: string) => {
    setHiddenRels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expand = useCallback(
    (node: GraphNode) => {
      setSelected(null);
      void load({ label: node.label, gid: gidOf(node.id) });
    },
    [load],
  );

  // 画布空白处单击关闭详情卡（拖拽/平移后松手不触发）
  const onZrDown = useCallback((e: unknown) => {
    const ev = e as { offsetX?: number; offsetY?: number };
    pointerDownRef.current = [ev.offsetX ?? 0, ev.offsetY ?? 0];
  }, []);
  const onZrClick = useCallback((e: unknown) => {
    const ev = e as { target?: unknown; offsetX?: number; offsetY?: number };
    const down = pointerDownRef.current;
    const moved = down ? Math.hypot((ev.offsetX ?? 0) - down[0], (ev.offsetY ?? 0) - down[1]) : 0;
    if (!ev.target && moved < 6) setSelected(null);
  }, []);

  // ECharts 渲染（data / 可见性 / 布局重置变化时重建 option）
  useEffect(() => {
    if (!data || !chartElRef.current) return;
    let disposed = false;

    (async () => {
      const echarts = await import('echarts');
      if (disposed || !chartElRef.current) return;
      if (!chartRef.current) {
        chartRef.current = echarts.init(chartElRef.current);
        const zr = chartRef.current.getZr();
        zr.on('mousedown', onZrDown);
        zr.on('click', onZrClick);
      }
      const chart = chartRef.current;
      if (!chart) return;

      const resetLayout = firstRunRef.current || layoutNonce !== prevNonceRef.current;
      firstRunRef.current = false;
      prevNonceRef.current = layoutNonce;

      const nodeData = visible.nodes.map((node) => {
        const meta = labelMeta(node.label);
        const degree = visible.degree.get(node.id) ?? 0;
        const size = 24 + Math.min(degree, 8) * 2.2 + (node.id === center ? 8 : 0);
        return {
          id: node.id,
          name: node.name,
          value: node.label,
          symbolSize: size,
          itemStyle: {
            color: meta.color,
            borderColor: '#ffffff',
            borderWidth: 2,
            shadowBlur: 6,
            shadowColor: 'rgba(31,45,61,0.28)',
            shadowOffsetY: 1,
          },
          label: { formatter: truncate(node.name, 14) },
          emphasis: {
            itemStyle: { borderWidth: 3, shadowBlur: 16, shadowColor: rgba(meta.color, 0.45) },
            label: { fontWeight: 600 },
          },
        };
      });

      const curveIndex = new Map<string, number>();
      const linkData = visible.edges.map((edge) => {
        const key = `${edge.source}->${edge.target}`;
        const idx = curveIndex.get(key) ?? 0;
        curveIndex.set(key, idx + 1);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          value: edge.relation,
          lineStyle: { curveness: CURVES[Math.min(idx, CURVES.length - 1)] },
        };
      });

      chart.setOption(
        {
          animationDuration: 400,
          animationEasingUpdate: 'quinticInOut',
          tooltip: {
            confine: true,
            backgroundColor: '#ffffff',
            borderColor: 'rgba(20,40,35,0.08)',
            padding: [6, 10],
            textStyle: { color: '#37474f', fontSize: 12, fontFamily: CANVAS_FONT },
            extraCssText: 'box-shadow: 0 6px 18px rgba(15,35,30,0.14); border-radius: 8px;',
            formatter: (params: unknown) => {
              const p = Array.isArray(params) ? params[0] : params;
              if (!p || typeof p !== 'object') return '';
              const { dataType, data: item } = p as { dataType?: string; data?: { name?: unknown; value?: unknown } };
              if (dataType === 'edge') return `<b>:${escapeHtml(String(item?.value ?? ''))}</b>`;
              const label = String(item?.value ?? '');
              const title = labelMeta(label).title;
              return `<b>${escapeHtml(String(item?.name ?? ''))}</b><br/>${title} · :${escapeHtml(label)}`;
            },
          },
          series: [
            {
              type: 'graph',
              layout: 'force',
              roam: true,
              draggable: true,
              scaleLimit: { min: 0.25, max: 4 },
              ...(resetLayout ? { zoom: 1 } : {}),
              data: nodeData,
              links: linkData,
              label: {
                show: true,
                position: 'bottom',
                distance: 5,
                color: '#52606b',
                fontSize: 11,
                fontWeight: 500,
                fontFamily: CANVAS_FONT,
              },
              lineStyle: { color: EDGE_COLOR, width: 1.2, opacity: 0.95 },
              edgeSymbol: ['none', 'arrow'],
              edgeSymbolSize: 8,
              edgeLabel: { show: false },
              force: { repulsion: 460, gravity: 0.22, edgeLength: [40, 95], friction: 0.2, layoutAnimation: true },
              emphasis: {
                focus: 'adjacency',
                lineStyle: { color: EDGE_FOCUS, width: 2.2 },
                edgeLabel: {
                  show: true,
                  formatter: '{c}',
                  fontSize: 10,
                  color: '#ffffff',
                  backgroundColor: '#37474f',
                  padding: [3, 6],
                  borderRadius: 3,
                },
              },
              blur: {
                itemStyle: { opacity: 0.12 },
                label: { opacity: 0.1 },
                lineStyle: { opacity: 0.05 },
              },
            },
          ],
        },
        resetLayout,
      );

      const nodeId = (params: ECElementEvent) =>
        String((params.data as { id?: string } | undefined)?.id ?? '');
      const onClick = (params: ECElementEvent) => {
        if (params.dataType !== 'node') return;
        const node = nodeIndex.get(nodeId(params));
        if (node) setSelected(node);
      };
      const onDblClick = (params: ECElementEvent) => {
        if (params.dataType !== 'node') return;
        const node = nodeIndex.get(nodeId(params));
        if (node) expand(node);
      };
      chart.off('click', onClick);
      chart.on('click', onClick);
      chart.off('dblclick', onDblClick);
      chart.on('dblclick', onDblClick);
    })();

    return () => {
      disposed = true;
    };
  }, [data, visible, nodeIndex, center, layoutNonce, load, expand, onZrDown, onZrClick]);

  const zoomBy = useCallback((factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const opt = chart.getOption() as { series?: Array<{ zoom?: number }> };
    const current = typeof opt.series?.[0]?.zoom === 'number' ? opt.series[0].zoom : 1;
    const next = Math.min(4, Math.max(0.25, current * factor));
    chart.setOption({ series: [{ zoom: next }] });
  }, []);

  const resetView = useCallback(() => {
    setSelected(null);
    setLayoutNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const centerNode = center ? data?.nodes.find((n) => n.id === center) : undefined;

  return (
    <main className="graph-page">
      <div className="graph-toolbar">
        <div className="graph-stats">
          {data ? (
            centerNode ? (
              <span className="meta">
                聚焦：<b>{centerNode.name}</b> 的一跳关联
              </span>
            ) : (
              <span className="meta">
                全图 · {data.stats.nodeCount} 节点 / {data.stats.edgeCount} 关系 · 单击查看详情，双击展开关联
              </span>
            )
          ) : null}
        </div>
        {center ? (
          <Button size="small" onClick={() => void load('overview')}>
            返回全图
          </Button>
        ) : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="graph-stage">
        <div className="graph-canvas" ref={chartElRef} />

        {!loading && !error && data && data.nodes.length === 0 ? (
          <div className="graph-empty meta">当前数据范围内没有图谱节点（可能未分配机构或图谱未装载）。</div>
        ) : null}

        {data && labelChips.length > 0 ? (
          <div className="graph-legend">
            <div className="graph-legend-row">
              {labelChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={`graph-chip${hiddenLabels.has(chip.key) ? ' off' : ''}`}
                  onClick={() => toggleLabel(chip.key)}
                >
                  <i style={{ background: chip.color }} />
                  {chip.title}
                  <span>{chip.count}</span>
                </button>
              ))}
            </div>
            {relChips.length > 0 ? (
              <div className="graph-legend-row rels">
                {relChips.map(([rel, count]) => (
                  <button
                    key={rel}
                    type="button"
                    className={`graph-rel${hiddenRels.has(rel) ? ' off' : ''}`}
                    onClick={() => toggleRel(rel)}
                  >
                    <code>:{rel}</code>
                    <span>{count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="graph-zoomer">
          <button type="button" title="放大" aria-label="放大" onClick={() => zoomBy(1.25)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button type="button" title="缩小" aria-label="缩小" onClick={() => zoomBy(0.8)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button type="button" title="重新布局" aria-label="重新布局" onClick={resetView}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
        </div>

        {selected ? (
          <div className="graph-card">
            <div className="graph-card-head">
              <i style={{ background: labelMeta(selected.label).color }} />
              <code>:{selected.label}</code>
              <strong title={selected.name}>{selected.name}</strong>
              <button type="button" className="graph-card-close" aria-label="关闭" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="graph-card-props">
              {Object.entries(selected.props).filter(([k]) => k !== 'name').length > 0 ? (
                Object.entries(selected.props)
                  .filter(([k]) => k !== 'name')
                  .map(([k, v]) => (
                    <div key={k} className="graph-prop">
                      <span>{k}</span>
                      <b>{formatProp(v)}</b>
                    </div>
                  ))
              ) : (
                <div className="meta">无属性</div>
              )}
            </div>
            <div className="graph-card-actions">
              <Button size="small" onClick={() => expand(selected)}>
                展开关联 →
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="graph-loading">
            <i />
          </div>
        ) : null}
      </div>
    </main>
  );
}
