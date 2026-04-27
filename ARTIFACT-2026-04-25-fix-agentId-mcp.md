# Artifact: Parameter Unification & MCP Fix — 2026-04-25

## Objective
Unify parameter naming across all LiteHub API endpoints (`producerId`/`processorId` → `agentId`), and fix MCP tool execution returning empty `{}` due to un-read Response bodies.

## Key Reasoning
- `produce` used `producerId`, `pipe` used `processorId`, while all other endpoints used `agentId` — inconsistent and confusing for callers
- MCP `executeMcpTool()` was returning raw `Response` objects; `JSON.stringify(Response)` = `{}`, so MCP clients got empty results
- Fix: add `getJson(res)` helper to parse Response body to JSON before returning to MCP handler

## Conclusions
- ✅ All 6 parameter references unified to `agentId`
- ✅ MCP `executeMcpTool` now correctly returns parsed JSON to MCP clients
- ✅ End-to-end MCP test passed: register → produce → consume all work with `agentId`
- ✅ Deployed to production: `litehub.feiyangyang.cn`

## Files Modified
- `api/main.ts` — parameter rename (6 sites) + `getJson()` helper + all `executeMcpTool` branches
- Commits: `a5e0fd1`, deployed as `dpl_FZpN4cPhYBQMMlYfImtKn6O7rvK`
