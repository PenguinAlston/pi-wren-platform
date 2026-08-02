'use client';

import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { detectChart, formatCell, type ChartSpec } from './chat-utils';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  data: Record<string, unknown>[];
}

function buildOption(spec: ChartSpec, rows: Record<string, unknown>[]) {
  const labels = rows.map((row) => String(row[spec.labelKey] ?? ''));
  const toValue = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
  const common = {
    tooltip: { trigger: spec.type === 'pie' ? 'item' : 'axis' },
    legend: { show: spec.type === 'line' || spec.type === 'bar' },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
  };

  if (spec.type === 'pie') {
    return {
      ...common,
      series: [
        {
          type: 'pie',
          radius: ['38%', '68%'],
          data: rows.map((row) => ({
            name: formatCell(row[spec.labelKey]),
            value: toValue(row, spec.valueKeys[0] ?? ''),
          })),
        },
      ],
    };
  }

  return {
    ...common,
    xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: labels.length > 6 ? 30 : 0 } },
    yAxis: { type: 'value' },
    series: spec.valueKeys.map((key) => ({
      name: key,
      type: spec.type,
      smooth: spec.type === 'line',
      data: rows.map((row) => toValue(row, key)),
    })),
  };
}

/** AI 回复可视化图表（需求 4.3.2-3）：按结果形状自动适配柱状/折线/饼图。 */
export default function ChatChart({ data }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const spec = detectChart(data);
    if (!spec) {
      return;
    }
    const chart = echarts.init(node);
    chart.setOption(buildOption(spec, data));
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={ref} className="ai-chart" style={{ height: 280, width: '100%' }} />;
}
