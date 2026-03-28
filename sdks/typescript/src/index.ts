export type StepType = "LLM_CALL" | "TOOL_CALL" | "TOOL_RESULT" | "SYSTEM_EVENT";

export interface StartRunOptions {
  name?: string;
  model?: string;
  temperature?: number;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface StepOptions {
  type: StepType;
  payload: Record<string, any>;
  duration?: number;
  timestamp?: string;
}

export interface FinishRunOptions {
  status: string;
  metadata?: Record<string, any>;
}

export interface LlmCallOptions {
  prompt: any;
  response: any;
  model?: string;
  duration?: number;
}

export interface ToolCallOptions {
  name: string;
  args: Record<string, any>;
  result: any;
  duration?: number;
}

export class FlightRecorder {
  private apiUrl: string;
  private currentRunId: string | null = null;
  private apiKey: string | null = null;

  constructor(apiUrl?: string, apiKey?: string) {
    this.apiUrl =
      apiUrl ||
      (typeof process !== "undefined" && process.env?.FLIGHT_RECORDER_API_URL) ||
      "http://localhost:3001/api";
    this.apiKey =
      apiKey ||
      (typeof process !== "undefined" && process.env?.AFR_API_KEY) ||
      null;
  }

  get runId(): string | null {
    return this.currentRunId;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async startRun(options: StartRunOptions = {}): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiUrl}/runs/start`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(options),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.currentRunId = data.run_id;
      return this.currentRunId;
    } catch (e) {
      console.warn(`FlightRecorder: Failed to start run: ${e}`);
      return null;
    }
  }

  async recordStep(options: StepOptions): Promise<string | null> {
    if (!this.currentRunId) return null;
    try {
      const res = await fetch(
        `${this.apiUrl}/runs/${this.currentRunId}/step`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(options),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.step_id;
    } catch (e) {
      console.warn(`FlightRecorder: Failed to record step: ${e}`);
      return null;
    }
  }

  async finishRun(
    options: FinishRunOptions = { status: "success" }
  ): Promise<void> {
    if (!this.currentRunId) return;
    try {
      const res = await fetch(
        `${this.apiUrl}/runs/${this.currentRunId}/finish`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(options),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.currentRunId = null;
    } catch (e) {
      console.warn(`FlightRecorder: Failed to finish run: ${e}`);
    }
  }

  async recordLlmCall(options: LlmCallOptions): Promise<string | null> {
    return this.recordStep({
      type: "LLM_CALL",
      payload: {
        prompt: options.prompt,
        response: options.response,
        model: options.model,
      },
      duration: options.duration,
    });
  }

  async recordToolCall(options: ToolCallOptions): Promise<string | null> {
    return this.recordStep({
      type: "TOOL_CALL",
      payload: {
        name: options.name,
        args: options.args,
        result: options.result,
      },
      duration: options.duration,
    });
  }

  /**
   * Run a block of code within a recorded run. Automatically starts and
   * finishes the run, marking it as "error" if the function throws.
   */
  async withRun<T>(
    options: StartRunOptions,
    fn: (recorder: FlightRecorder) => Promise<T>
  ): Promise<T> {
    await this.startRun(options);
    try {
      const result = await fn(this);
      await this.finishRun({ status: "success" });
      return result;
    } catch (e) {
      await this.finishRun({
        status: "error",
        metadata: { error: String(e) },
      });
      throw e;
    }
  }

  /**
   * Wrap an async function so that its execution is automatically recorded
   * as a step of the given type.
   */
  wrap<TArgs extends any[], TResult>(
    type: StepType,
    name: string,
    fn: (...args: TArgs) => Promise<TResult>
  ): (...args: TArgs) => Promise<TResult> {
    const recorder = this;
    return async function (...args: TArgs): Promise<TResult> {
      const start = Date.now();
      try {
        const result = await fn(...args);
        const duration = Date.now() - start;
        await recorder.recordStep({
          type,
          payload: { name, args, result },
          duration,
        });
        return result;
      } catch (e) {
        const duration = Date.now() - start;
        await recorder.recordStep({
          type,
          payload: { name, args, error: String(e) },
          duration,
        });
        throw e;
      }
    };
  }
}

// ---------------------------------------------------------------------------
// wrapFetch (item 16)
// ---------------------------------------------------------------------------

/** URLs that look like LLM API endpoints */
const LLM_URL_PATTERNS = [
  /api\.openai\.com\/v1\/chat\/completions/,
  /api\.anthropic\.com/,
  /generativelanguage\.googleapis\.com/,
  /api\.cohere\.ai/,
  /api\.mistral\.ai/,
];

/**
 * Wraps globalThis.fetch to automatically record requests to known LLM API
 * endpoints as LLM_CALL steps.
 *
 * Returns a cleanup function that restores the original fetch.
 */
export function wrapFetch(recorder: FlightRecorder): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as any).url || "";
    const isLlmCall = LLM_URL_PATTERNS.some((p) => p.test(url));

    if (!isLlmCall || !recorder.runId) {
      return originalFetch(input, init);
    }

    const start = Date.now();
    let responseBody: any = null;
    let errorMsg: string | null = null;

    try {
      const res = await originalFetch(input, init);
      const duration = Date.now() - start;

      // Clone so we can read body without consuming
      const cloned = res.clone();
      try {
        responseBody = await cloned.json();
      } catch {
        responseBody = await cloned.text();
      }

      let requestBody: any = null;
      if (init?.body) {
        try {
          requestBody = JSON.parse(init.body as string);
        } catch {
          requestBody = String(init.body);
        }
      }

      await recorder.recordStep({
        type: "LLM_CALL",
        payload: {
          url,
          prompt: requestBody?.messages || requestBody,
          response: responseBody,
          model: requestBody?.model,
          status: res.status,
        },
        duration,
      });

      return res;
    } catch (e) {
      const duration = Date.now() - start;
      errorMsg = String(e);

      let requestBody: any = null;
      if (init?.body) {
        try {
          requestBody = JSON.parse(init.body as string);
        } catch {
          requestBody = String(init.body);
        }
      }

      await recorder.recordStep({
        type: "LLM_CALL",
        payload: {
          url,
          prompt: requestBody?.messages || requestBody,
          error: errorMsg,
          model: requestBody?.model,
        },
        duration,
      });

      throw e;
    }
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ---------------------------------------------------------------------------
// wrapOpenAI (item 16)
// ---------------------------------------------------------------------------

/**
 * Monkey-patches an OpenAI client's chat.completions.create to automatically
 * record calls as LLM_CALL steps.
 *
 * Works with the official `openai` npm package (v4+).
 */
export function wrapOpenAI(client: any, recorder: FlightRecorder): void {
  if (!client?.chat?.completions?.create) {
    console.warn("wrapOpenAI: client does not have chat.completions.create");
    return;
  }

  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async function (
    params: any,
    options?: any
  ): Promise<any> {
    const start = Date.now();
    let result: any = null;
    let errorMsg: string | null = null;

    try {
      result = await originalCreate(params, options);
      return result;
    } catch (e) {
      errorMsg = String(e);
      throw e;
    } finally {
      const duration = Date.now() - start;

      let responseData: any;
      if (result) {
        try {
          responseData = {
            content: result.choices?.[0]?.message?.content,
            role: result.choices?.[0]?.message?.role,
            finish_reason: result.choices?.[0]?.finish_reason,
            usage: result.usage
              ? {
                  prompt_tokens: result.usage.prompt_tokens,
                  completion_tokens: result.usage.completion_tokens,
                  total_tokens: result.usage.total_tokens,
                }
              : undefined,
          };
        } catch {
          responseData = result;
        }
      }

      if (errorMsg) {
        responseData = { error: errorMsg };
      }

      await recorder.recordStep({
        type: "LLM_CALL",
        payload: {
          prompt: params.messages,
          response: responseData,
          model: params.model,
        },
        duration,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Default singleton instance + convenience exports
// ---------------------------------------------------------------------------
const defaultRecorder = new FlightRecorder();

export async function startRun(
  options?: StartRunOptions
): Promise<string | null> {
  return defaultRecorder.startRun(options);
}

export async function recordStep(
  options: StepOptions
): Promise<string | null> {
  return defaultRecorder.recordStep(options);
}

export async function finishRun(options?: FinishRunOptions): Promise<void> {
  return defaultRecorder.finishRun(options);
}

export async function recordLlmCall(
  options: LlmCallOptions
): Promise<string | null> {
  return defaultRecorder.recordLlmCall(options);
}

export async function recordToolCall(
  options: ToolCallOptions
): Promise<string | null> {
  return defaultRecorder.recordToolCall(options);
}

export default FlightRecorder;
