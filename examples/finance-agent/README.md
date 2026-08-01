# Finance Analyst Agent

## Goal

Answer business questions using Pi Agent Runtime + Wren Context.

Example:

User:

> 为什么本季度利润下降？

Flow:

1. Understand business question
2. Retrieve metric definition from Wren
3. Generate analysis context
4. Produce executive summary

## Architecture

```
User
 |
Finance Agent
 |
Agent Runtime
 |
Wren Context
 |
Business Data
```
