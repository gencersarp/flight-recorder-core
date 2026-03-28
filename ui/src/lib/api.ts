const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

export interface Run {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: string;
  model: string | null;
  temperature: number | null;
  metadata: Record<string, any> | null;
  tags: string[] | null;
}

export interface Step {
  id: string;
  run_id: string;
  type: "LLM_CALL" | "TOOL_CALL" | "TOOL_RESULT" | "SYSTEM_EVENT";
  timestamp: string;
  duration: number | null;
  payload: Record<string, any> | null;
}

export interface PaginatedRuns {
  data: Run[];
  total: number;
  page: number;
  limit: number;
}

export interface RunsFilter {
  page?: number;
  limit?: number;
  status?: string;
  model?: string;
  search?: string;
  created_after?: string;
  created_before?: string;
}

export interface CompareResult {
  left: { run: Run; steps: Step[] };
  right: { run: Run; steps: Step[] };
  summary: {
    left_steps_count: number;
    right_steps_count: number;
    left_duration_ms: number;
    right_duration_ms: number;
    left_model: string | null;
    right_model: string | null;
    left_status: string;
    right_status: string;
    left_type_counts: Record<string, number>;
    right_type_counts: Record<string, number>;
    steps_same: number;
    steps_changed: number;
    steps_added: number;
    steps_removed: number;
  };
  step_diffs: Array<{
    index: number;
    status: "same" | "changed" | "added" | "removed";
    left: Step | null;
    right: Step | null;
  }>;
}

export interface HealthCheck {
  status: string;
  version: string;
  runs_count: number;
}

export async function fetchRunsPaginated(filters: RunsFilter = {}): Promise<PaginatedRuns> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.status) params.set("status", filters.status);
  if (filters.model) params.set("model", filters.model);
  if (filters.search) params.set("search", filters.search);
  if (filters.created_after) params.set("created_after", filters.created_after);
  if (filters.created_before) params.set("created_before", filters.created_before);

  const url = `${API_BASE}/runs${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch runs");
  return res.json();
}

// Keep backward compat
export async function fetchRuns(): Promise<Run[]> {
  const result = await fetchRunsPaginated({ limit: 200 });
  return result.data;
}

export async function fetchRun(id: string): Promise<Run> {
  const res = await fetch(`${API_BASE}/runs/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch run");
  return res.json();
}

export async function fetchSteps(runId: string): Promise<Step[]> {
  const res = await fetch(`${API_BASE}/runs/${runId}/steps`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch steps");
  return res.json();
}

export async function replayRun(id: string): Promise<{ run_id: string; original_run_id: string; steps_copied: number }> {
  const res = await fetch(`${API_BASE}/runs/${id}/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to replay run");
  return res.json();
}

export async function compareRuns(leftId: string, rightId: string): Promise<CompareResult> {
  const res = await fetch(`${API_BASE}/runs/compare?left=${leftId}&right=${rightId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to compare runs");
  return res.json();
}

export async function fetchHealth(): Promise<HealthCheck> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch health");
  return res.json();
}
