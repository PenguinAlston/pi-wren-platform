'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// 节点类型 → ECharts 分类配色（与 M3 品牌色系协调）
const CATEGORY_COLORS = ['#19b49d', '#4a7dd8', '#e8a13c', '#7451d0', '#d4526e', '#3ba6c4', '#8aa63c'];

/** 知识图谱可视化（M2）：ECharts 力导向图，点击节点下钻一跳关联子图。 */
export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<string | null>(null);
  const chartElRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : '图谱加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('overview');
  }, [load]);

  // ECharts 渲染（data 变化时重建 option）
  useEffect(() => {
    if (!data || !chartElRef.current) return;
    let disposed = false;

    (async () => {
      const echarts = await import('echarts');
      if (disposed || !chartElRef.current) return;
      if (!chartRef.current) {
        chartRef.current = echarts.init(chartElRef.current);
      }
      const chart = chartRef.current;
      if (!chart) return;

      const categoryName = (label: string) => {
        const idx = { Org: 0, SysUser: 1, Product: 2, Customer: 3, Policy: 4, Claim: 5, Preserve: 6 }[label];
        return idx ?? 0;
      };
      const centerGid = center;

      chart.setOption(
        {
          tooltip: {},
          legend: [{ data: data.categories.map((c) => c.name), top: 8 }],
          series: [
            {
              type: 'graph',
              layout: 'force',
              roam: true,
              draggable: true,
              data: data.nodes.map((node) => ({
                id: node.id,
                name: node.name,
                category: categoryName(node.label),
                symbolSize: node.id === centerGid ? 46 : node.label === 'Org' ? 34 : 28,
                label: { show: true },
              })),
              links: data.edges.map((edge) => ({
                source: edge.source,
                target: edge.target,
                lineStyle: { color: 'source', curveness: 0.1 },
                value: edge.relation,
              })),
              edgeLabel: { show: true, fontSize: 10, formatter: '{c}' },
              edgeSymbol: ['none', 'arrow'],
              categories: data.categories.map((c, i) => ({ name: c.name, itemStyle: { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] } })),
              force: { repulsion: 420, edgeLength: [70, 160], gravity: 0.08 },
              emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
            },
          ],
        },
        true,
      );

      const onClick = (params: ECElementEvent) => {
        if (params.dataType !== 'node') return;
        const id = String((params.data as { id?: string } | undefined)?.id ?? '');
        const [label, gid] = id.split(':');
        if (label && gid) void load({ label, gid });
      };
      chart.off('click', onClick);
      chart.on('click', onClick);
    })();

    return () => {
      disposed = true;
    };
  }, [data, center, load]);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return (
    <main className="graph-page">
      <div className="graph-toolbar">
        <div className="graph-stats">
          {data ? (
            <>
              <span className="pill pill-info">节点 {data.stats.nodeCount}</span>
              <span className="pill pill-ok">关系 {data.stats.edgeCount}</span>
              {center ? (
                <span className="meta">
                  聚焦：{data.nodes.find((n) => n.id === center)?.name ?? center}
                </span>
              ) : (
                <span className="meta">全图视图 · 点击节点查看一跳关联</span>
              )}
            </>
          ) : null}
        </div>
        {center ? (
          <Button size="small" onClick={() => void load('overview')}>
            返回全图
          </Button>
        ) : null}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="graph-canvas" ref={chartElRef} />

      {!loading && !error && data && data.nodes.length === 0 ? (
        <div className="meta" style={{ textAlign: 'center', padding: 20 }}>
          当前数据范围内没有图谱节点（可能未分配机构或图谱未装载）。
        </div>
      ) : null}
    </main>
  );
}
