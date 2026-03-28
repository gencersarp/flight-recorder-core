"use client";

import { useEffect, useState, useCallback } from "react";
import { Run, PaginatedRuns, fetchRunsPaginated, RunsFilter } from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    replaying: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    success: "bg-green-500/20 text-green-400 border-green-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const cls =
    colors[status] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

function formatDuration(created: string, updated: string): string {
  const ms = new Date(updated).getTime() - new Date(created).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

const TIME_PRESETS = [
  { label: "All time", value: "" },
  { label: "Last 1h", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7d", value: "7d" },
  { label: "Last 30d", value: "30d" },
];

function getTimePresetDate(preset: string): string {
  if (!preset) return "";
  const now = Date.now();
  const offsets: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const offset = offsets[preset];
  if (!offset) return "";
  return new Date(now - offset).toISOString();
}

export default function RunsPage() {
  const [result, setResult] = useState<PaginatedRuns | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [timePreset, setTimePreset] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: RunsFilter = { page, limit };
      if (statusFilter) filters.status = statusFilter;
      if (search) filters.search = search;
      const createdAfter = getTimePresetDate(timePreset);
      if (createdAfter) filters.created_after = createdAfter;

      const data = await fetchRunsPaginated(filters);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search, timePreset]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, search, timePreset]);

  const runs = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading runs...
      </div>
    );
  }

  if (error && !result) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to load runs</p>
          <p className="text-gray-500 text-sm">{error}</p>
          <p className="text-gray-600 text-xs mt-2">
            Make sure the backend is running at http://localhost:3001
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Agent Runs</h1>
        <span className="text-sm text-gray-500">{total} total runs</span>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search by name, model, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
        >
          <option value="">All statuses</option>
          <option value="running">running</option>
          <option value="replaying">replaying</option>
          <option value="success">success</option>
          <option value="error">error</option>
          <option value="failed">failed</option>
        </select>
        <select
          value={timePreset}
          onChange={(e) => setTimePreset(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
        >
          {TIME_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {runs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {total === 0
            ? "No runs match the current filters."
            : "No runs on this page."}
        </div>
      ) : (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900/50 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-gray-900/30 cursor-pointer transition"
                  onClick={() =>
                    (window.location.href = `/runs/${run.id}`)
                  }
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-200">
                      {run.name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono mt-0.5">
                      {run.id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {run.model || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatTime(run.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDuration(run.created_at, run.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {run.tags?.map((t) => (
                        <span
                          key={t}
                          className="text-xs px-1.5 py-0.5 bg-gray-800 rounded text-gray-400"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            Page {page} of {totalPages} ({total} runs)
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              First
            </button>
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Prev
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) {
                p = i + 1;
              } else if (page <= 3) {
                p = i + 1;
              } else if (page >= totalPages - 2) {
                p = totalPages - 4 + i;
              } else {
                p = page - 2 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 text-sm border rounded-lg transition ${
                    p === page
                      ? "bg-gray-700 border-gray-600 text-white"
                      : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:border-gray-600"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-lg text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
