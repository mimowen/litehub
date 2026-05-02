// src/handlers/pages.ts — Page data and discovery handlers
import type { DbClient } from "../adapters/db/interface.js";
import { listAgents, listQueues } from "../core/queue.js";
import { listPools } from "../core/pool.js";
import { listTasks } from "../core/a2a.js";
import { listRuns } from "../core/acp.js";
import { buildMcpDiscoveryConfig } from "../utils.js";

export async function getDashboardData(db: DbClient) {
  const [agents, queues, pools, tasks, runs] = await Promise.all([
    listAgents(db),
    listQueues(db),
    listPools(db),
    listTasks(db, { limit: 20 }),
    listRuns(db, { limit: 20 }),
  ]);
  return { agents, queues, pools, tasks, runs };
}

export async function handleMcpDiscovery(baseUrl: string) {
  return buildMcpDiscoveryConfig(baseUrl);
}

export async function handleSkillDownload() {
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const content = readFileSync(join(process.cwd(), "skills", "litehub.md"), "utf-8");
    return { content, contentType: "text/markdown; charset=utf-8" };
  } catch {
    return null;
  }
}
