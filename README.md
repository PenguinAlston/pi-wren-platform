# pi-wren-platform

Enterprise Agent Platform powered by Pi Agent Runtime + Wren Context Engine.

## Vision

`pi-wren-platform` is an open-source Enterprise Agent Operating System that combines:

- **Pi Runtime** - Agent execution, planning, tool calling and workflow orchestration
- **Wren Context Engine** - Enterprise semantic context, business knowledge and data intelligence
- **Enterprise Control Plane** - Security, governance, memory and observability

## Architecture

```
User
 |
Web / IDE / Chat
 |
Enterprise Agent Gateway
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

### v0.1 Agent Foundation

- [x] Repository initialized
- [ ] Agent runtime adapter
- [ ] Streaming chat API
- [ ] Tool execution framework
- [ ] Session management

### v0.2 Enterprise Context

- [ ] Wren integration
- [ ] Semantic model access
- [ ] Business knowledge API
- [ ] SQL generation workflow

### v0.3 Enterprise Platform

- [ ] Memory service
- [ ] Workflow engine
- [ ] RBAC
- [ ] Audit logging
- [ ] Approval workflows

## Repository Structure

```
apps/
  web/                  # Enterprise frontend
  api/                  # Backend gateway

services/
  agent-runtime/        # Pi integration
  context-engine/       # Wren integration
  memory-service/
  workflow-engine/
  policy-engine/

packages/
  agent-sdk/
  tool-sdk/
  shared-types/

infra/
  docker/
  kubernetes/

docs/
  architecture.md
  roadmap.md
```

## License

Apache-2.0