# pi-wren-platform

Enterprise Agent Platform powered by Pi Agent Runtime + Wren Context Engine.

## Demo Quick Start

```bash
docker compose up
```

Open:

```
http://localhost:3000/chat
```

Try:

```
为什么利润下降？
```

## Demo Flow

```
User
 |
Finance Agent
 |
Agent Runtime
 |
Wren Context
 |
Business Metrics
 |
Analysis Result
```

## Vision

`pi-wren-platform` combines:

- Pi Runtime - Agent execution, planning, tool calling and workflow orchestration
- Wren Context Engine - Enterprise semantic context and business intelligence
- Enterprise Control Plane - Security, governance, memory and observability

## Architecture

```
User
 |
Web Chat
 |
Agent Gateway
 |
Pi Agent Runtime
 |
+----------------+
|                |
Wren Context   Tools
Engine          |
 |
Semantic       Enterprise
Layer          Systems
```

## Roadmap

### v0.1 Demo

- [x] Agent runtime foundation
- [x] Finance agent demo
- [x] Wren context simulation
- [x] Chat workflow foundation

### v0.2 Enterprise Context

- Wren production integration
- Semantic model access
- SQL generation workflow
- Database connectors

### v0.3 Enterprise Platform

- Memory service
- Workflow engine
- RBAC
- Audit logging
