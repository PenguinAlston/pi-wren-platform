import Link from 'next/link';
import { Button, Card } from './components/ui';

const STATS = [
  { label: '内置数据 Agent', value: '01', hint: '保险综合查询' },
  { label: '业务表模型', value: '22', hint: '生产级数据 schema' },
  { label: '查询模式', value: '2', hint: '传统查询 + AI 问答' },
  { label: 'SQL 安全关口', value: '01', hint: '统一治理校验' },
];

const FEATURES = [
  {
    href: '/query',
    title: '传统业务查询',
    desc: '契约 / 保全 / 理赔三大业务模块，多条件组合查询，参数化 SQL 与出口脱敏。',
    accent: true as const,
  },
  {
    href: '/chat',
    title: 'AI 智能问答',
    desc: '自然语言向企业数据提问，语义层生成 SQL，实时执行轨迹与图表可视化。',
    accent: false as const,
  },
  {
    href: '/agents',
    title: '自定义 Agent',
    desc: '自带语义工程与数据库连接串，注册专属查询 Agent，无需修改代码即可生效。',
    accent: false as const,
  },
];

export default function Home() {
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-eyebrow">ENTERPRISE DATA INTELLIGENCE PLATFORM</div>
        <h1>
          让企业数据开口说话
          <br />
          <em>PI · WREN 智能数据平台</em>
        </h1>
        <p>
          用自然语言向企业数据提问：业务理解 → 语义层生成 SQL → 安全校验 → 数据查询 →
          执行摘要，全链路自动化。
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
          <Link href="/query" style={{ textDecoration: 'none' }}>
            <Button type="primary" size="large">
              开始查询
            </Button>
          </Link>
          <Link href="/chat" style={{ textDecoration: 'none' }}>
            <Button size="large">去 AI 问答</Button>
          </Link>
        </div>
      </section>

      <section className="stat-grid">
        {STATS.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-value">
              <em>{s.value}</em>
            </div>
            <div className="stat-label">{s.label}</div>
            <div className="meta" style={{ marginTop: 4 }}>
              {s.hint}
            </div>
          </div>
        ))}
      </section>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <Link key={f.href} href={f.href} style={{ textDecoration: 'none' }}>
            <Card className="feature-card">
              <h3>
                {f.title}
                {f.accent && <span className="tag" style={{ marginLeft: 8 }}>核心</span>}
              </h3>
              <p>{f.desc}</p>
              <span className="fc-go">进入 →</span>
            </Card>
          </Link>
        ))}
      </section>
    </main>
  );
}
