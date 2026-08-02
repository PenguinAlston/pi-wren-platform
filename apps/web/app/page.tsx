import Link from 'next/link';

const STATS = [
  { label: '内置数据 Agent', value: '02', hint: 'FINANCE / INSURANCE' },
  { label: '业务表模型', value: '22', hint: 'PRODUCTION SCHEMA' },
  { label: '查询模式', value: 'Dual', hint: 'TRADITIONAL + AI' },
  { label: 'SQL 安全关口', value: '01', hint: 'UNIFIED GATE' },
];

const FEATURES = [
  {
    href: '/query',
    icon: '▦',
    title: '传统业务查询',
    desc: '契约 / 保全 / 理赔三大业务模块，多条件组合查询，参数化 SQL 与出口脱敏。',
    code: 'DBQ·01',
  },
  {
    href: '/chat',
    icon: '◎',
    title: 'AI 智能问答',
    desc: '自然语言向企业数据提问，语义层生成 SQL，实时执行轨迹与图表可视化。',
    code: 'CHAT·02',
  },
  {
    href: '/agents',
    icon: '✦',
    title: '自定义 Agent',
    desc: '自带 MDL 与数据库连接串，注册专属查询 Agent，无需修改代码即可生效。',
    code: 'AGENT·03',
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
        <div className="hero-flow">
          <span>
            <b>01</b>业务理解
          </span>
          <i>→</i>
          <span>
            <b>02</b>生成 SQL
          </span>
          <i>→</i>
          <span>
            <b>03</b>安全校验
          </span>
          <i>→</i>
          <span>
            <b>04</b>数据查询
          </span>
          <i>→</i>
          <span>
            <b>05</b>执行摘要
          </span>
        </div>
      </section>

      <section className="stat-grid">
        {STATS.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-value">
              <em>{s.value}</em>
            </div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <Link key={f.href} href={f.href} className="feature-card">
            <span className="fc-icon">{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            <span className="fc-go">
              {f.code} <i>→</i>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
