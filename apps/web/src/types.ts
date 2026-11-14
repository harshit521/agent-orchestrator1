export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskStatus =
  | "queued"
  | "running"
  | "in_review"
  | "completed"
  | "failed"
  | "ready_to_merge";

export type RunStatus = "running" | "completed" | "failed";

export type RunEventType =
  | "run.started"
  | "agent.started"
  | "run.progress"
  | "agent.progress"
  | "agent.completed"
  | "agent.failed"
  | "run.completed"
  | "run.failed";

export interface AgentRunStats {
  agentId: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  activeRuns: number;
  lastStartedAt: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  provider: string | null;
  model: string | null;
  status: "idle" | "running";
  stats: AgentRunStats;
}

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

export interface RunTaskRef {
  id: string;
  title: string;
  prompt?: string;
  status: string;
  priority: string;
  agentId: string;
}

export interface Run {
  id: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  provider: string | null;
  model: string | null;
  output: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  task?: RunTaskRef;
  events?: RunEvent[];
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  runs: Run[];
}

export interface TaskCounts {
  total: number;
  queued: number;
  running: number;
  inReview: number;
  completed: number;
  failed: number;
  readyToMerge: number;
}

export interface RunCounts {
  total: number;
  active: number;
  completed: number;
  failed: number;
}

export interface ActivityItem {
  id: string;
  runId: string;
  taskId: string;
  taskTitle: string;
  runStatus: string;
  type: string;
  stage: string | null;
  message: string;
  percent: number | null;
  data: unknown;
  createdAt: string;
}

export interface StatsResponse {
  success: boolean;
  tasks: TaskCounts;
  runs: RunCounts;
  agents: { total: number };
  activeRuns: Run[];
  recentActivity: ActivityItem[];
}

export interface TaskListResponse {
  success: boolean;
  tasks: Task[];
}

export interface TaskResponse {
  success: boolean;
  task: Task;
}

export interface CreateTaskResponse {
  success: boolean;
  task: Task;
  run: Run | null;
}

export interface DeleteResponse {
  success: boolean;
}

export interface RunsResponse {
  success: boolean;
  runs: Run[];
}

export interface RunResponse {
  success: boolean;
  run: Run;
}

export interface AgentsResponse {
  success: boolean;
  agents: AgentSummary[];
}

export interface AgentResponse {
  success: boolean;
  agent: AgentSummary;
  recentRuns: Run[];
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
}

export interface IntegrationsResponse {
  success: boolean;
  health: HealthResponse;
  llm: {
    provider: string;
    model: string | null;
    configured: boolean;
  };
  github: {
    repository: string | null;
    tokenConfigured: boolean;
    webhookConfigured: boolean;
  };
  worktrees: {
    enabled: boolean;
  };
  security: {
    enabled: boolean;
  };
}

export interface Worktree {
  taskId: string;
  branch: string;
  path: string;
}

export interface WorktreesResponse {
  success: boolean;
  enabled: boolean;
  isGitRepository?: boolean;
  worktrees: Worktree[];
}

export interface SecurityTool {
  id: string;
  label: string;
  available: boolean;
}

export interface SecurityToolsResponse {
  success: boolean;
  enabled: boolean;
  root: string;
  tools: SecurityTool[];
}

export interface ScanResult {
  id: string;
  label: string;
  status: "passed" | "failed" | "unavailable" | "error";
  exitCode: number | null;
  durationMs: number;
  output: string;
}

export interface ScanResponse {
  success: boolean;
  target: string;
  status: "passed" | "failed" | "error";
  results: ScanResult[];
}

export type ActivityResponse = {
  success: boolean;
  activity: ActivityItem[];
};
