export function TracePanel({ trace }: { trace: string[] }) {
  return (
    <div>
      <h3>Agent Process</h3>
      <ul>
        {trace.map((item) => (
          <li key={item}>✓ {item}</li>
        ))}
      </ul>
    </div>
  );
}
