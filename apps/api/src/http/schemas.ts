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

export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "in_review",
  "completed",
  "failed",
  "ready_to_merge",
]);

export const createTaskSchema = z.object({
  prompt: promptSchema,
  title: z.string().trim().min(1).max(200).optional(),
  agentId: agentIdSchema,
  priority: taskPrioritySchema.default("medium"),
  start: z.boolean().default(true),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    prompt: promptSchema.optional(),
    agentId: z.string().trim().min(1).optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: "At least one field must be provided." }
  );

export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: taskStatusSchema.optional(),
  agentId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const researchRequestSchema = z.object({
  input: promptSchema,
  agentId: agentIdSchema,
});

export type ResearchRequestBody = z.infer<typeof researchRequestSchema>;
