import { z } from "zod";

import { DEFAULT_AGENT_ID } from "../agents/index.js";

export const researchRequestSchema = z.object({
  input: z
    .string({ message: "A valid input string is required." })
    .trim()
    .min(1, "A valid input string is required."),
  agentId: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_AGENT_ID),
});

export type ResearchRequest = z.infer<typeof researchRequestSchema>;
