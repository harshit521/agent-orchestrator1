import { z } from "zod";

import { DEFAULT_AGENT_ID } from "../agents/index.js";

const promptSchema = z
  .string()
  .trim()
  .min(1, "A non-empty prompt is required.")
  .max(8000, "Prompt is too long.");

const agentIdSchema = z
  .string()
  .trim()
  .min(1)
  .default(DEFAULT_AGENT_ID);

export const createTaskSchema = z.object({
  prompt: promptSchema,
  title: z.string().trim().min(1).max(200).optional(),
  agentId: agentIdSchema,
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;

export const researchRequestSchema = z.object({
  input: promptSchema,
  agentId: agentIdSchema,
});

export type ResearchRequestBody = z.infer<typeof researchRequestSchema>;
