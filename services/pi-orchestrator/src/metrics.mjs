/** 进程内指标（Prometheus 文本格式暴露，零依赖；与后端 app/metrics.py 同思路）。
 *
 * - 计数器：incCounter(name, labels?, value?)，暴露为 piwrenpi_<name>_total
 * - 直方图：observe(name, valueMs, labels?)，固定桶（毫秒），暴露为 piwrenpi_<name>_milliseconds
 * 线程模型：Node 单线程事件循环，无需加锁。
 */

const BUCKETS_MS = [500, 1_000, 5_000, 10_000, 30_000, 60_000, 120_000, 180_000];

const labelKey = (labels) =>
  Object.keys(labels ?? {})
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');

const renderLabels = (key) => (key ? `{${key}}` : '');

/** 桶线标签：数据标签 + le 合并进同一个 {} 块（Prometheus 要求单标签块）。 */
const renderBucketLabels = (key, le) => (key ? `{${key},${le}}` : `{${le}}`);

export function createMetrics({ bucketsMs = BUCKETS_MS } = {}) {
  const buckets = [...bucketsMs].sort((a, b) => a - b);
  const counters = new Map(); // name -> Map(labelKey -> value)
  const histograms = new Map(); // name -> Map(labelKey -> { counts, sum, count })

  const seriesOf = (map, name) => {
    let series = map.get(name);
    if (!series) {
      series = new Map();
      map.set(name, series);
    }
    return series;
  };

  return {
    incCounter(name, labels = undefined, value = 1) {
      const series = seriesOf(counters, name);
      const key = labelKey(labels);
      series.set(key, (series.get(key) ?? 0) + value);
    },

    observe(name, valueMs, labels = undefined) {
      const series = seriesOf(histograms, name);
      const key = labelKey(labels);
      let state = series.get(key);
      if (!state) {
        state = { counts: new Array(buckets.length + 1).fill(0), sum: 0, count: 0 };
        series.set(key, state);
      }
      let idx = buckets.length;
      for (let i = 0; i < buckets.length; i += 1) {
        if (valueMs <= buckets[i]) {
          idx = i;
          break;
        }
      }
      state.counts[idx] += 1;
      state.sum += valueMs;
      state.count += 1;
    },

    render() {
      const lines = [];
      lines.push('# HELP piwrenpi_process_uptime_seconds Process uptime in seconds');
      lines.push('# TYPE piwrenpi_process_uptime_seconds gauge');
      lines.push(`piwrenpi_process_uptime_seconds ${process.uptime().toFixed(1)}`);

      for (const name of [...counters.keys()].sort()) {
        const metric = `piwrenpi_${name}_total`;
        lines.push(`# HELP ${metric} Counter ${name}`);
        lines.push(`# TYPE ${metric} counter`);
        const series = counters.get(name);
        for (const key of [...series.keys()].sort()) {
          lines.push(`${metric}${renderLabels(key)} ${series.get(key)}`);
        }
      }

      for (const name of [...histograms.keys()].sort()) {
        const metric = `piwrenpi_${name}_milliseconds`;
        lines.push(`# HELP ${metric} Histogram ${name} in milliseconds`);
        lines.push(`# TYPE ${metric} histogram`);
        const series = histograms.get(name);
        for (const key of [...series.keys()].sort()) {
          const state = series.get(key);
          let cumulative = 0;
          buckets.forEach((bound, i) => {
            cumulative += state.counts[i];
            lines.push(`${metric}_bucket${renderBucketLabels(key, `le="${bound}"`)} ${cumulative}`);
          });
          cumulative += state.counts[buckets.length];
          lines.push(`${metric}_bucket${renderBucketLabels(key, 'le="+Inf"')} ${cumulative}`);
          lines.push(`${metric}_sum${renderLabels(key)} ${state.sum.toFixed(1)}`);
          lines.push(`${metric}_count${renderLabels(key)} ${state.count}`);
        }
      }
      return `${lines.join('\n')}\n`;
    },
  };
}
