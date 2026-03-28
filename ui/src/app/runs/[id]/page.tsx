"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Run, Step, fetchRun, fetchSteps, replayRun } from "@/lib/api";

function JsonViewer({ data }: { data: any }) {
  return (
    <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs font-mono text-gray-300 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
          &#9654;
        </span>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function StepIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; label: string }> = {
    LLM_CALL: { bg: "bg-purple-500", label: "LLM" },
    TOOL_CALL: { bg: "bg-amber-500", label: "TL" },
    TOOL_RESULT: { bg: "bg-teal-500", label: "TR" },
    SYSTEM_EVENT: { bg: "bg-gray-500", label: "SY" },
  };
  const info = icons[type] || { bg: "bg-gray-500", label: "??" };
  return (
    <div
      className={`w-8 h-8 rounded-full ${info.bg} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}
    >
      {info.label}
    </div>
  );
}

function LlmStepContent({ payload }: { payload: any }) {
  return (
    <div className="space-y-3">
      <Collapsible title="Prompt" defaultOpen>
        {typeof payload.prompt === "string" ? (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap">
            {payload.prompt}
          </div>
        ) : (
          <JsonViewer data={payload.prompt} />
        )}
      </Collapsible>
      <Collapsible title="Response" defaultOpen>
        {typeof payload.response === "string" ? (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 whitespace-pre-wrap">
            {payload.response}
          </div>
        ) : (
          <JsonViewer data={payload.response} />
        )}
      </Collapsible>
      {payload.model && (
        <div className="text-xs text-gray-500">Model: {payload.model}</div>
      )}
    </div>
  );
}

function ToolStepContent({ payload }: { payload: any }) {
  return (
    <div className="space-y-3">
      {payload.name && (
        <div className="text-sm font-medium text-gray-200">
          {payload.name}
        </div>
      )}
      <Collapsible title="Arguments" defaultOpen>
        <JsonViewer data={payload.args} />
      </Collapsible>
      <Collapsible title="Result" defaultOpen>
        <JsonViewer data={payload.result} />
      </Collapsible>
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const typeLabels: Record<string, string> = {
    LLM_CALL: "LLM Call",
    TOOL_CALL: "Tool Call",
    TOOL_RESULT: "Tool Result",
    SYSTEM_EVENT: "System Event",
  };

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <StepIcon type={step.type} />
        <div className="w-px flex-1 bg-gray-800 mt-2" />
      </div>
      <div className="flex-1 pb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-200">
              {typeLabels[step.type] || step.type}
            </span>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {step.duration != null && <span>{step.duration}ms</span>}
              <span>{new Date(step.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>
          {step.payload && step.type === "LLM_CALL" && (
            <LlmStepContent payload={step.payload} />
          )}
          {step.payload &&
            (step.type === "TOOL_CALL" || step.type === "TOOL_RESULT") && (
              <ToolStepContent payload={step.payload} />
            )}
          {step.payload && step.type === "SYSTEM_EVENT" && (
            <JsonViewer data={step.payload} />
          )}
        </div>
      </div>
    </div>
  );
}

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

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    Promise.all([fetchRun(id), fetchSteps(id)])
      .then(([r, s]) => {
        setRun(r);
        setSteps(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleReplay() {
    setReplaying(true);
    try {
      const result = await replayRun(id);
      router.push(`/runs/${result.run_id}`);
    } catch (e: any) {
      alert(`Replay failed: ${e.message}`);
    } finally {
      setReplaying(false);
    }
  }

  function handleCompareWithOriginal() {
    const originalId = run?.metadata?.original_run_id;
    if (originalId) {
      router.push(`/diff?left=${originalId}&right=${id}`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading...
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        {error || "Run not found"}
      </div>
    );
  }

  const hasOriginal = !!run.metadata?.original_run_id;

  return (
    <div>
      <a
        href="/"
        className="text-sm text-gray-500 hover:text-gray-300 transition mb-4 inline-block"
      >
        &larr; Back to runs
      </a>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{run.name}</h1>
            <p className="text-xs text-gray-500 font-mono mt-1">{run.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
          <div>
            <div className="text-gray-500 text-xs">Model</div>
            <div className="text-gray-300">{run.model || "-"}</div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Temperature</div>
            <div className="text-gray-300">
              {run.temperature != null ? run.temperature : "-"}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Created</div>
            <div className="text-gray-300">
              {new Date(run.created_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-gray-500 text-xs">Tags</div>
            <div className="flex gap-1 flex-wrap mt-0.5">
              {run.tags?.map((t) => (
                <span
                  key={t}
                  className="text-xs px-1.5 py-0.5 bg-gray-800 rounded text-gray-400"
                >
                  {t}
                </span>
              )) || <span className="text-gray-500">-</span>}
            </div>
          </div>
        </div>

        {/* Action buttons (item 12) */}
        <div className="flex gap-3 mt-4 pt-4 border-t border-gray-800">
          <button
            onClick={handleReplay}
            disabled={replaying}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition"
          >
            {replaying ? "Replaying..." : "Replay this run"}
          </button>
          {hasOriginal && (
            <button
              onClick={handleCompareWithOriginal}
              className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition"
            >
              Compare with original
            </button>
          )}
          <a
            href={`/diff?left=${id}`}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition inline-flex items-center"
          >
            Compare with another run
          </a>
        </div>
      </div>

      {hasOriginal && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-4 py-3 mb-6 text-sm text-indigo-300">
          This run is a replay of{" "}
          <a
            href={`/runs/${run.metadata!.original_run_id}`}
            className="underline hover:text-indigo-200"
          >
            {run.metadata!.original_run_id.slice(0, 8)}...
          </a>
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-400 mb-4">
        Steps ({steps.length})
      </h2>

      {steps.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No steps recorded for this run.
        </div>
      ) : (
        <div>
          {steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
