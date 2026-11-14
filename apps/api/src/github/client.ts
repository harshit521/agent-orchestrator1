import { z } from "zod";

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().url(),
  state: z.string(),
  title: z.string(),
});

export interface GitHubClientOptions {
  token: string;
  repository: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CreatePullRequestInput {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
}

export interface PullRequest {
  number: number;
  url: string;
  state: string;
  title: string;
}

export class GitHubError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/**
 * Thin client for the GitHub REST API. PR creation is deliberately the only
 * operation implemented so far; the orchestrator will call it once a worker
 * has pushed its branch.
 */
export class GitHubClient {
  readonly #token: string;
  readonly #repository: string;
  readonly #baseUrl: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: GitHubClientOptions) {
    this.#token = options.token;
    this.#repository = options.repository;
    this.#baseUrl = (options.baseUrl ?? "https://api.github.com").replace(
      /\/+$/,
      ""
    );
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async createPullRequest(
    input: CreatePullRequestInput
  ): Promise<PullRequest> {
    const response = await this.#fetchImpl(
      `${this.#baseUrl}/repos/${this.#repository}/pulls`,
      {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({
          title: input.title,
          head: input.head,
          base: input.base,
          ...(input.body ? { body: input.body } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");

      throw new GitHubError(
        `GitHub PR creation failed (${response.status}): ${detail.slice(0, 300)}`,
        response.status
      );
    }

    const parsed = pullRequestSchema.safeParse(await response.json());

    if (!parsed.success) {
      throw new GitHubError("Unexpected GitHub pull request response.");
    }

    return {
      number: parsed.data.number,
      url: parsed.data.html_url,
      state: parsed.data.state,
      title: parsed.data.title,
    };
  }

  #headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.#token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    };
  }
}
