import { z } from "zod";

export const agentStatusSchema = z.enum(["completed", "failed"]);

export const agentErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
});

export const agentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

export const agentResultSchema = z.object({
  agentId: z.string().min(1),
  status: agentStatusSchema,
  output: z.unknown().optional(),
  error: agentErrorSchema.optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  usage: agentUsageSchema.optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type AgentError = z.infer<typeof agentErrorSchema>;
export type AgentUsage = z.infer<typeof agentUsageSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;

export function parseAgentResult(value: unknown): AgentResult {
  return agentResultSchema.parse(value);
}
