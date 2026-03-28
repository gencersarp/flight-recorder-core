"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Run,
  Step,
  CompareResult,
  fetchRuns,
  compareRuns,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Myers diff algorithm (proper LCS-based diff)
// ---------------------------------------------------------------------------
type DiffOp = "equal" | "insert" | "delete";
interface DiffEntry {
  op: DiffOp;
  left?: string;
  right?: string;
  leftLine?: number;
  rightLine?: number;
}

function myersDiff(a: string[], b: string[]): DiffEntry[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (max === 0) return [];

  // For very large diffs, fall back to simple line comparison
  if (max > 10000) {
    return simpleDiff(a, b);
  }

  const v: Record<number, number> = { 1: 0 };
  const trace: Array<Record<number, number>> = [];

  outer: for (let d = 0; d <= max; d++) {
    const vCopy: Record<number, number> = {};
    for (const key of Object.keys(v)) {
      vCopy[Number(key)] = v[Number(key)];
    }
    trace.push(vCopy);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= n && y >= m) {
        break outer;
      }
    }
  }

  // Backtrack
  const result: DiffEntry[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d > 0; d--) {
    const vPrev = trace[d - 1];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (vPrev[k - 1] ?? 0) < (vPrev[k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.unshift({ op: "equal", left: a[x], right: b[y], leftLine: x, rightLine: y });
    }
    if (x > prevX) {
      x--;
      result.unshift({ op: "delete", left: a[x], leftLine: x });
    } else if (y > prevY) {
      y--;
      result.unshift({ op: "insert", right: b[y], rightLine: y });
    }
  }

  while (x > 0 && y > 0) {
    x--;
    y--;
    result.unshift({ op: "equal", left: a[x], right: b[y], leftLine: x, rightLine: y });
  }

  return result;
}

function simpleDiff(a: string[], b: string[]): DiffEntry[] {
  const result: DiffEntry[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const l = a[i];
    const r = b[i];
    if (l === r) {
      result.push({ op: "equal", left: l, right: r, leftLine: i, rightLine: i });
    } else if (l !== undefined && r !== undefined) {
      result.push({ op: "delete", left: l, leftLine: i });
      result.push({ op: "insert", right: r, rightLine: i });
    } else if (l !== undefined) {
      result.push({ op: "delete", left: l, leftLine: i });
    } else {
      result.push({ op: "insert", right: r, rightLine: i });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Diff rendering
// ---------------------------------------------------------------------------
function DiffLine({ entry }: { entry: DiffEntry }) {
  if (entry.op === "equal") {
    return (
      <div className="flex text-xs font-mono border-b border-gray-800/30">
        <div className="w-10 text-right pr-2 py-1 text-gray-600 select-none shrink-0">
          {entry.leftLine != null ? entry.leftLine + 1 : ""}
        </div>
        <div className="w-10 text-right pr-2 py-1 text-gray-600 select-none shrink-0">
          {entry.rightLine != null ? entry.rightLine + 1 : ""}
        </div>
        <div className="flex-1 px-3 py-1 whitespace-pre-wrap break-all text-gray-400">
          {entry.left}
        </div>
      </div>
    );
  }
  if (entry.op === "delete") {
    return (
      <div className="flex text-xs font-mono border-b border-gray-800/30 bg-red-500/10">
        <div className="w-10 text-right pr-2 py-1 text-red-400/60 select-none shrink-0">
          {entry.leftLine != null ? entry.leftLine + 1 : ""}
        </div>
        <div className="w-10 text-right pr-2 py-1 select-none shrink-0" />
        <div className="flex-1 px-3 py-1 whitespace-pre-wrap break-all text-red-300">
          - {entry.left}
        </div>
      </div>
    );
  }
  // insert
  return (
    <div className="flex text-xs font-mono border-b border-gray-800/30 bg-green-500/10">
      <div className="w-10 text-right pr-2 py-1 select-none shrink-0" />
      <div className="w-10 text-right pr-2 py-1 text-green-400/60 select-none shrink-0">
        {entry.rightLine != null ? entry.rightLine + 1 : ""}
      </div>
      <div className="flex-1 px-3 py-1 whitespace-pre-wrap break-all text-green-300">
        + {entry.right}
      </div>
    </div>
  );
}

function StepDiff({
  leftStep,
  rightStep,
  status,
}: {
  leftStep?: Step | null;
  rightStep?: Step | null;
  status: string;
}) {
  const leftJson = leftStep?.payload
    ? JSON.stringify(leftStep.payload, null, 2)
    : "";
  const rightJson = rightStep?.payload
    ? JSON.stringify(rightStep.payload, null, 2)
    : "";

  const leftLines = leftJson ? leftJson.split("\n") : [];
  const rightLines = rightJson ? rightJson.split("\n") : [];
  const diffEntries = myersDiff(leftLines, rightLines);

  const typeLabel = leftStep?.type || rightStep?.type || "UNKNOWN";
  const typeColors: Record<string, string> = {
    LLM_CALL: "text-purple-400",
    TOOL_CALL: "text-amber-400",
    TOOL_RESULT: "text-teal-400",
    SYSTEM_EVENT: "text-gray-400",
  };

  const statusColors: Record<string, string> = {
    same: "border-gray-800",
    changed: "border-yellow-500/40",
    added: "border-green-500/40",
    removed: "border-red-500/40",
  };

  const statusLabels: Record<string, string> = {
    same: "Unchanged",
    changed: "Changed",
    added: "Added in right",
    removed: "Removed from left",
  };

  const statusBadgeColors: Record<string, string> = {
    same: "bg-gray-700 text-gray-300",
    changed: "bg-yellow-500/20 text-yellow-300",
    added: "bg-green-500/20 text-green-300",
    removed: "bg-red-500/20 text-red-300",
  };

  return (
    <div
      className={`border ${statusColors[status] || "border-gray-800"} rounded-lg overflow-hidden mb-4`}
    >
      <div className="bg-gray-900/50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-medium ${typeColors[typeLabel] || "text-gray-400"}`}
          >
            {typeLabel}
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadgeColors[status] || ""}`}
          >
            {statusLabels[status] || status}
          </span>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          {leftStep?.duration != null && (
            <span>Left: {leftStep.duration}ms</span>
          )}
          {rightStep?.duration != null && (
            <span>Right: {rightStep.duration}ms</span>
          )}
        </div>
      </div>
      {status === "same" ? (
        <div className="px-4 py-2 text-xs text-gray-500">
          Identical content (collapsed)
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {diffEntries.map((entry, i) => (
            <DiffLine key={i} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function DiffPage() {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<Run[]>([]);
  const [leftId, setLeftId] = useState(searchParams.get("left") || "");
  const [rightId, setRightId] = useState(searchParams.get("right") || "");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [compared, setCompared] = useState(false);

  useEffect(() => {
    fetchRuns().then(setRuns).catch(() => {});
  }, []);

  // Auto-compare if both IDs are provided from URL params
  useEffect(() => {
    if (leftId && rightId && !compared) {
      handleCompare();
    }
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCompare() {
    if (!leftId || !rightId) return;
    setLoading(true);
    setCompared(false);
    try {
      const result = await compareRuns(leftId, rightId);
      setCompareResult(result);
      setCompared(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  const summary = compareResult?.summary;
  const stepDiffs = compareResult?.step_diffs ?? [];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Compare Runs</h1>

      <div className="flex gap-4 mb-6 items-end">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Run A</label>
          <select
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.id.slice(0, 8)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Run B</label>
          <select
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.id.slice(0, 8)})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleCompare}
          disabled={!leftId || !rightId || loading}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-sm text-gray-200 rounded-lg transition"
        >
          {loading ? "Loading..." : "Compare"}
        </button>
      </div>

      {compared && compareResult && summary && (
        <div>
          {/* Summary header */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
            <h2 className="text-sm font-medium text-gray-300 mb-3">
              Diff Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-gray-500">Steps (left / right)</div>
                <div className="text-gray-200 mt-0.5">
                  {summary.left_steps_count} / {summary.right_steps_count}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Models</div>
                <div className="text-gray-200 mt-0.5">
                  {summary.left_model || "none"} / {summary.right_model || "none"}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Duration (left / right)</div>
                <div className="text-gray-200 mt-0.5">
                  {formatDuration(summary.left_duration_ms)} /{" "}
                  {formatDuration(summary.right_duration_ms)}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Status (left / right)</div>
                <div className="text-gray-200 mt-0.5">
                  {summary.left_status} / {summary.right_status}
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-3 pt-3 border-t border-gray-800">
              <span className="text-xs text-gray-400">
                {summary.steps_same} unchanged
              </span>
              <span className="text-xs text-yellow-400">
                {summary.steps_changed} changed
              </span>
              <span className="text-xs text-green-400">
                {summary.steps_added} added
              </span>
              <span className="text-xs text-red-400">
                {summary.steps_removed} removed
              </span>
            </div>
          </div>

          {/* Run headers */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="text-sm font-medium">
                {compareResult.left.run.name}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {summary.left_steps_count} steps |{" "}
                {summary.left_model || "no model"} | {summary.left_status}
              </div>
            </div>
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="text-sm font-medium">
                {compareResult.right.run.name}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {summary.right_steps_count} steps |{" "}
                {summary.right_model || "no model"} | {summary.right_status}
              </div>
            </div>
          </div>

          {stepDiffs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              Both runs have no steps.
            </div>
          ) : (
            stepDiffs.map((d, i) => (
              <StepDiff
                key={i}
                leftStep={d.left}
                rightStep={d.right}
                status={d.status}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
