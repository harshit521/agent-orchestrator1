import { z } from "zod";

export const agentInputSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt cannot be empty."),
  data: z.unknown().optional(),
});

export type AgentInput = z.infer<typeof agentInputSchema>;

export const agentProgressSchema = z.object({
  stage: z.string().min(1),
  message: z.string(),
  percent: z.number().int().min(0).max(100).optional(),
  data: z.unknown().optional(),
});

export type AgentProgress = z.infer<typeof agentProgressSchema>;

export type ProgressReporter = (progress: AgentProgress) => void;
