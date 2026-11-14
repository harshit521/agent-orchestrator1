import { ApiError } from "../api";

/** Turns an unknown thrown value into a human-readable message. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/** Validation issues keyed by their request field path. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) {
    return {};
  }

  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    if (issue.path && !(issue.path in fields)) {
      fields[issue.path] = issue.message;
    }
  }

  return fields;
}
