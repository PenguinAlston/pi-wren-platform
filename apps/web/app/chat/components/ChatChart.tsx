'use client';

import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { detectChart, formatCell, type ChartSpec } from './chat-utils';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const PALETTE = ['#38e1ff', '#5b8cff', '#8b6cff', '#3ddc97', '#ffb454', '#ff5d73'];
const AXIS_COLOR = '#8fa3c9';
const SPLIT_LINE = 'rgba(148, 180, 255, 0.12)';

interface Props {
  data: Record<string, unknown>[];
}

function buildOption(spec: ChartSpec, rows: Record<string, unknown>[]) {
  const labels = rows.map((row) => String(row[spec.labelKey] ?? ''));
  const toValue = (row: Record<string, unknown>, key: string) => Number(row[key] ?? 0);
  const common = {
    // 关闭入场动画：避免"图表容器已出现、数据还没画出来"的空白窗口
    animation: false,
    color: PALETTE,
    tooltip: {
      trigger: spec.type === 'pie' ? 'item' : 'axis',
      backgroundColor: 'rgba(10, 17, 32, 0.92)',
      borderColor: 'rgba(148, 180, 255, 0.25)',
      textStyle: { color: '#eaf1ff' },
    },
    legend: {
      show: spec.type === 'line' || spec.type === 'bar',
      textStyle: { color: AXIS_COLOR },
    },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
  };

  if (spec.type === 'pie') {
    return {
      ...common,
      series: [
        {
          type: 'pie',
          radius: ['38%', '68%'],
          itemStyle: { borderColor: '#0b1222', borderWidth: 2 },
          label: { color: AXIS_COLOR },
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
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { interval: 0, rotate: labels.length > 6 ? 30 : 0, color: AXIS_COLOR },
      axisLine: { lineStyle: { color: 'rgba(148, 180, 255, 0.3)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: AXIS_COLOR },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
    },
    series: spec.valueKeys.map((key) => ({
      name: key,
      type: spec.type,
      smooth: spec.type === 'line',
      itemStyle: { borderRadius: 3 },
      data: rows.map((row) => toValue(row, key)),
    })),
  };
}

/** AI 回复可视化图表（需求 4.3.2-3）：按结果形状自动适配柱状/折线/饼图（深色主题）。 */
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
    // 布局稳定后再校正一次尺寸（防止容器初始宽度为 0 时画布为空）
    const raf = requestAnimationFrame(() => chart.resize());
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      chart.dispose();
    };
  }, [data]);

  return <div ref={ref} className="ai-chart" style={{ height: 280, width: '100%' }} />;
}
