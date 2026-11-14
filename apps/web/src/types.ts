export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
}

export type RunEventType =
  | "run.started"
  | "run.progress"
  | "run.completed"
  | "run.failed";

export interface RunEvent {
  id: string;
  runId: string;
  taskId: string;
  type: RunEventType;
  stage: string | null;
  message: string;
  percent: number | null;
  data: unknown;
  createdAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  agentId: string;
  status: string;
  provider: string | null;
  model: string | null;
  output: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  events?: RunEvent[];
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  runs: Run[];
}

export interface TaskListResponse {
  success: boolean;
  tasks: Task[];
}

export interface TaskResponse {
  success: boolean;
  task: Task;
}

export interface AgentsResponse {
  success: boolean;
  agents: AgentSummary[];
}

export interface CreateTaskResponse {
  success: boolean;
  task: Task;
  run: Run;
}
