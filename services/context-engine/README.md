# Context Engine Service

Wren integration layer.

Responsibilities:

- Semantic model access
- Business knowledge retrieval
- Metric definitions
- SQL context generation

Interface goal:

```ts
searchKnowledge(query)
getMetric(name)
generateSQL(question)
```
