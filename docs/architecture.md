# pi-wren-platform Architecture

## Design Principle

Pi provides the execution layer.

Wren provides the enterprise context layer.

Together they form an Enterprise Agent Operating System.

## High Level

```
                    Users
                      |
              Enterprise Frontend
                      |
              API Gateway / BFF
                      |
              Pi Agent Runtime
                      |
       +--------------+--------------+
       |                             |
 Wren Context Engine              Tools
       |                             |
 Semantic Layer              Enterprise APIs
 Data Knowledge              SaaS Systems
```

## Core Services

### Agent Runtime

Responsibilities:

- planning
- reasoning loop
- tool execution
- task state
- agent extensions

### Context Engine

Responsibilities:

- business definitions
- semantic models
- metric discovery
- SQL generation context

### Memory Service

Stores:

- conversation memory
- task memory
- business memory
- execution history

### Policy Engine

Controls:

- permissions
- approvals
- audit requirements

## Enterprise Flow

Example:

User:

> Analyze why quarterly profit decreased

Agent flow:

1. Pi plans analysis
2. Wren provides metric definitions
3. Tools query enterprise systems
4. Agent generates explanation
5. Result is stored in memory

## Long Term Goal

Build an open Enterprise Agent Platform similar to combining:

- Claude Code
- Semantic Layer
- Workflow Automation
- Enterprise Knowledge System
