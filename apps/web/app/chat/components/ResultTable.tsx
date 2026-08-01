export function ResultTable({ data }: { data: Record<string, unknown>[] }) {
  if (data.length === 0) {
    return <p className="meta">查询未返回数据。</p>;
  }

  const columns = Object.keys(data[0] ?? {});

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                style={thStyle}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} style={tdStyle}>
                  {String(row[column] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--border)',
  color: 'var(--text-secondary)',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
};
