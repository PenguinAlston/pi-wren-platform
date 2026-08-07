'use client';

import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { detectChart, formatCell, type ChartSpec } from './chat-utils';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

// 动物之森风调色板：薄荷/青/黄/绿/橙/粉，深棕文字
const PALETTE = ['#19c8b9', '#3dd4c6', '#f5c31c', '#6fba2c', '#e59266', '#f8a6b2'];
const AXIS_COLOR = '#9f927d';
const SPLIT_LINE = 'rgba(159, 146, 125, 0.18)';

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
      backgroundColor: 'rgba(248, 248, 240, 0.96)',
      borderColor: 'rgba(159, 146, 125, 0.5)',
      textStyle: { color: '#794f27' },
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
          itemStyle: { borderColor: '#f8f8f0', borderWidth: 2 },
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
      axisLine: { lineStyle: { color: 'rgba(159, 146, 125, 0.5)' } },
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
