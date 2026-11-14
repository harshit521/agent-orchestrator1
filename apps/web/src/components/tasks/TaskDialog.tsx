import { useEffect, useState } from "react";

import { api } from "../../api";
import { fieldErrorsOf, messageOf } from "../../lib/errors";
import type {
  AgentSummary,
  Run,
  Task,
  TaskPriority,
  TaskStatus,
} from "../../types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineError } from "../ui/States";
import { Checkbox, FormField, Input, Select, Textarea } from "../ui/Field";

const PRIORITIES: Array<{ value: TaskPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const STATUSES: Array<{ value: TaskStatus; label: string }> = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "in_review", label: "In review" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "ready_to_merge", label: "Ready to merge" },
];

export interface TaskDialogResult {
  task: Task;
  run: Run | null;
}

export function TaskDialog({
  open,
  mode,
  task,
  agents,
  onClose,
  onCompleted,
}: {
  open: boolean;
  mode: "create" | "edit";
  task?: Task | null;
  agents: AgentSummary[];
  onClose: () => void;
  onCompleted: (result: TaskDialogResult) => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("queued");
  const [start, setStart] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [agentTouched, setAgentTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setError(null);
    setFieldErrors({});
    setSaving(false);
    setAgentTouched(false);

    if (mode === "edit" && task) {
      setTitle(task.title);
      setPrompt(task.prompt);
      setAgentId(task.agentId);
      setPriority(task.priority);
      setStatus(task.status);
      setStart(false);
    } else {
      setTitle("");
      setPrompt("");
      setAgentId("");
      setPriority("medium");
      setStatus("queued");
      setStart(true);
    }
  }, [open, mode, task?.id]);

  // Agents load asynchronously; adopt the first one until the user picks one.
  useEffect(() => {
    if (
      open &&
      mode === "create" &&
      !agentTouched &&
      !agentId &&
      agents.length > 0
    ) {
      setAgentId(agents[0]?.id ?? "");
    }
  }, [open, mode, agentTouched, agentId, agents]);

  async function submit() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setFieldErrors({ prompt: "A prompt is required." });
      return;
    }

    if (!agentId) {
      setFieldErrors({ agentId: "Select an agent." });
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      if (mode === "edit" && task) {
        const updated = await api.tasks.update(task.id, {
          title: title.trim() || task.title,
          prompt: trimmedPrompt,
          agentId,
          priority,
          status,
        });

        onCompleted({ task: updated.task, run: null });
      } else {
        const response = await api.tasks.create({
          ...(title.trim() ? { title: title.trim() } : {}),
          prompt: trimmedPrompt,
          agentId,
          priority,
          start,
        });

        onCompleted({ task: response.task, run: response.run });
      }
    } catch (cause: unknown) {
      setError(messageOf(cause));
      setFieldErrors(fieldErrorsOf(cause));
      setSaving(false);
    }
  }

  const isEdit = mode === "edit";
  const selectedAgent = agents.find((agent) => agent.id === agentId);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      title={isEdit ? "Edit task" : "New task"}
      description={
        isEdit
          ? "Update the task definition. Changes are persisted immediately."
          : "Create a task and optionally dispatch it to an agent right away."
      }
      width="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="task-dialog-form"
            loading={saving}
          >
            {isEdit ? "Save changes" : start ? "Create and run" : "Create task"}
          </Button>
        </>
      }
    >
      <form
        id="task-dialog-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <InlineError message={error} /> : null}

        <FormField
          label="Title"
          htmlFor="task-title"
          hint={
            isEdit
              ? undefined
              : "Optional. Derived from the prompt when left empty."
          }
          error={fieldErrors.title}
        >
          <Input
            id="task-title"
            value={title}
            maxLength={200}
            placeholder="Short, scannable summary"
            onChange={(event) => setTitle(event.target.value)}
            autoFocus={!isEdit}
          />
        </FormField>

        <FormField
          label="Prompt"
          htmlFor="task-prompt"
          hint={
            isEdit
              ? undefined
              : "This prompt is sent verbatim to the selected agent."
          }
          error={fieldErrors.prompt}
        >
          <Textarea
            id="task-prompt"
            value={prompt}
            rows={5}
            placeholder="Describe the work the agent should perform…"
            onChange={(event) => {
              setPrompt(event.target.value);
              setFieldErrors((current) => {
                if (!current.prompt) {
                  return current;
                }

                const next = { ...current };
                delete next.prompt;

                return next;
              });
            }}
            autoFocus={isEdit}
          />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Agent"
            htmlFor="task-agent"
            error={fieldErrors.agentId}
            hint={
              agents.length === 0
                ? "No agents are registered by the backend."
                : selectedAgent?.requiresWorkspace
                  ? "Runs in an isolated git worktree, then diffs, tests, commits, and optionally opens a GitHub PR."
                  : selectedAgent?.provider === "stub"
                    ? "Offline stub provider: this agent does not call a live model."
                    : undefined
            }
          >
            <Select
              id="task-agent"
              value={agentId}
              disabled={agents.length === 0}
              onChange={(event) => {
                setAgentTouched(true);
                setAgentId(event.target.value);
              }}
            >
              {agents.length === 0 ? (
                <option value="">No agents available</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Priority"
            htmlFor="task-priority"
            error={fieldErrors.priority}
          >
            <Select
              id="task-priority"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
            >
              {PRIORITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {isEdit ? (
          <FormField
            label="Status"
            htmlFor="task-status"
            error={fieldErrors.status}
            hint="Status is normally managed by the orchestrator; override it only when correcting data."
          >
            <Select
              id="task-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as TaskStatus)
              }
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <Checkbox
            label="Start execution immediately"
            description="Creates the task and dispatches it to the agent. Uncheck to save it as queued."
            checked={start}
            onChange={(event) => setStart(event.target.checked)}
          />
        )}
      </form>
    </Dialog>
  );
}
