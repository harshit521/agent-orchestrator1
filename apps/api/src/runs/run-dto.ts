function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseJsonValue(value: string | null): unknown {
  return parseJson(value);
}

/** Converts stored JSON strings into real JSON for API responses. */
export function runToDto<T extends { output: string | null }>(
  run: T
): Omit<T, "output"> & { output: unknown } {
  return { ...run, output: parseJson(run.output) };
}

export function eventToDto<T extends { data: string | null }>(
  event: T
): Omit<T, "data"> & { data: unknown } {
  return { ...event, data: parseJson(event.data) };
}

export function artifactToDto<T extends { data: string | null }>(
  artifact: T
): Omit<T, "data"> & { data: unknown } {
  return { ...artifact, data: parseJson(artifact.data) };
}
