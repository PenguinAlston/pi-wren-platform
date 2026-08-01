"use client";

import { useState } from "react";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");

  async function send() {
    const response = await fetch("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message: input }),
    });

    const data = await response.json();
    setAnswer(data.answer);
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Finance Agent</h1>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={send}>分析</button>
      <pre>{answer}</pre>
    </main>
  );
}
