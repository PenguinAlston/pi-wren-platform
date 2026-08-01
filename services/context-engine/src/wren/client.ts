export class WrenAIClient {
  constructor(
    private endpoint: string,
    private token?: string,
  ) {}

  async generateSQL(question: string) {
    const response = await fetch(`${this.endpoint}/v1/generate_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token
          ? { Authorization: `Bearer ${this.token}` }
          : {}),
      },
      body: JSON.stringify({ question }),
    });

    return response.json();
  }
}
