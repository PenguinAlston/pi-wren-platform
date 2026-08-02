import Link from 'next/link';

export default function Home() {
  return (
    <main className="container">
      <div className="card">
        <h1 className="title">Pi Wren Enterprise Agent Platform</h1>
        <p className="meta">
          基于 Pi Agent Runtime 与 Wren Context Engine 的企业级自然语言数据分析平台
        </p>
      </div>

      <div className="card">
        <h2 className="section">快速开始</h2>
        <p className="meta">
          用自然语言向企业数据提问，平台将完成：业务理解 → 语义层生成 SQL → 数据查询 →
          结果分析 → 执行摘要。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/query" className="btn">
            传统业务查询
          </Link>
          <Link href="/chat" className="btn btn-secondary">
            进入分析控制台
          </Link>
          <Link href="/agents" className="btn btn-secondary">
            自定义 Agent 管理
          </Link>
        </div>
      </div>
    </main>
  );
}
