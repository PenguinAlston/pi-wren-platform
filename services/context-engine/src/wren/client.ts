export interface WrenAIClientConfig {
  endpoint: string;
  token?: string;
  timeoutMs?: number;
}

export interface GenerateSQLResult {
  sql?: string;
  query?: string;
  error?: string;
}

/**
 * HTTP client for a Wren AI service.
 * Calls the semantic SQL generation endpoint with a bearer token when configured.
 */
export class WrenAIClient {
  constructor(private readonly config: WrenAIClientConfig) {}

  async generateSQL(question: string): Promise<GenerateSQLResult> {
    const { endpoint, token, timeoutMs = 30_000 } = this.config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${endpoint}/v1/generate_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { error: `Wren AI request failed (${response.status})` };
      }

      const data = (await response.json()) as GenerateSQLResult;
      return {
        sql: data.sql ?? data.query,
        error: data.error,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Wren AI request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
