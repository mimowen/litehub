// src/lib/types.ts — 类型定义
export interface FilePointer {
  id: string;
  queue: string;
  size: number;
  createdAt: string;
  producerId: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface QueueMeta {
  name: string;
  description?: string;
  createdAt: string;
  pending: string[];      // 指针 IDs，FIFO
  consumed: string[];      // 已消费指针 IDs
}

export interface AgentInfo {
  agentId: string;
  name: string;
  role: "producer" | "consumer" | "both";
  queues: string[];
  pollInterval?: number;
  registeredAt: string;
}

export interface PointerRecord {
  id: string;
  queue: string;
  producerId: string;
  data: string;           // 数据内容（直接存 DB）
  size: number;
  contentType?: string;
  metadata?: string;    // JSON 字符串
  createdAt: string;
  status: "pending" | "consumed";
}