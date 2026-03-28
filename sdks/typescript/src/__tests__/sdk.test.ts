import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlightRecorder, wrapFetch, wrapOpenAI } from '../index';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchResponse(data: any, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
    clone: () => ({
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    }),
  });
}

describe('FlightRecorder', () => {
  describe('startRun', () => {
    it('sends POST to /runs/start and stores run_id', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ run_id: 'test-123' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      const id = await recorder.startRun({ name: 'Test', model: 'gpt-4' });

      expect(id).toBe('test-123');
      expect(recorder.runId).toBe('test-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/runs/start',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"name":"Test"'),
        })
      );
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      const id = await recorder.startRun({ name: 'Test' });

      expect(id).toBeNull();
      expect(recorder.runId).toBeNull();
    });

    it('returns null on HTTP error', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({}, false, 500));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      const id = await recorder.startRun({ name: 'Test' });

      expect(id).toBeNull();
    });
  });

  describe('recordStep', () => {
    it('sends step to the current run', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ step_id: 'step-1' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-123';

      const stepId = await recorder.recordStep({
        type: 'LLM_CALL',
        payload: { prompt: 'Hello' },
        duration: 100,
      });

      expect(stepId).toBe('step-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/runs/run-123/step',
        expect.anything()
      );
    });

    it('returns null when no active run', async () => {
      const recorder = new FlightRecorder('http://localhost:3001/api');
      const stepId = await recorder.recordStep({
        type: 'LLM_CALL',
        payload: { prompt: 'Hello' },
      });

      expect(stepId).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('finishRun', () => {
    it('sends finish and clears run_id', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({}));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-123';

      await recorder.finishRun({ status: 'success' });

      expect(recorder.runId).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/runs/run-123/finish',
        expect.anything()
      );
    });

    it('does nothing when no active run', async () => {
      const recorder = new FlightRecorder('http://localhost:3001/api');
      await recorder.finishRun({ status: 'success' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('recordLlmCall', () => {
    it('records an LLM_CALL step', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ step_id: 'llm-1' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-123';

      const stepId = await recorder.recordLlmCall({
        prompt: 'Hi',
        response: 'Hello',
        model: 'gpt-4',
        duration: 200,
      });

      expect(stepId).toBe('llm-1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('LLM_CALL');
      expect(body.payload.prompt).toBe('Hi');
    });
  });

  describe('recordToolCall', () => {
    it('records a TOOL_CALL step', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ step_id: 'tool-1' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-123';

      const stepId = await recorder.recordToolCall({
        name: 'calculator',
        args: { x: 1 },
        result: 42,
        duration: 10,
      });

      expect(stepId).toBe('tool-1');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('TOOL_CALL');
      expect(body.payload.name).toBe('calculator');
    });
  });

  describe('withRun', () => {
    it('starts and finishes a run on success', async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ run_id: 'wr-run' })) // startRun
        .mockReturnValueOnce(mockFetchResponse({})); // finishRun

      const recorder = new FlightRecorder('http://localhost:3001/api');
      const result = await recorder.withRun({ name: 'WithRun' }, async (rec) => {
        return 42;
      });

      expect(result).toBe(42);
      expect(recorder.runId).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('marks run as error on exception', async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ run_id: 'wr-err' })) // startRun
        .mockReturnValueOnce(mockFetchResponse({})); // finishRun

      const recorder = new FlightRecorder('http://localhost:3001/api');

      await expect(
        recorder.withRun({ name: 'ErrorRun' }, async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      // Check finish was called with error status
      const finishBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(finishBody.status).toBe('error');
      expect(finishBody.metadata.error).toContain('boom');
    });
  });

  describe('wrap', () => {
    it('wraps a function and records its execution', async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ step_id: 'wrap-1' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-wrap';

      const myTool = recorder.wrap('TOOL_CALL', 'add', async (a: number, b: number) => {
        return a + b;
      });

      const result = await myTool(2, 3);
      expect(result).toBe(5);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('TOOL_CALL');
      expect(body.payload.name).toBe('add');
      expect(body.payload.result).toBe(5);
    });

    it('records error when wrapped function throws', async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ step_id: 'wrap-err' }));

      const recorder = new FlightRecorder('http://localhost:3001/api');
      (recorder as any).currentRunId = 'run-wrap';

      const failing = recorder.wrap('TOOL_CALL', 'fail', async () => {
        throw new Error('oops');
      });

      await expect(failing()).rejects.toThrow('oops');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload.error).toContain('oops');
    });
  });

  describe('API key auth', () => {
    it('includes Authorization header when API key is set', async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ run_id: 'key-run' }));

      const recorder = new FlightRecorder('http://localhost:3001/api', 'my-secret');
      await recorder.startRun({ name: 'Auth Test' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-secret');
    });
  });
});

describe('wrapOpenAI', () => {
  it('patches chat.completions.create and records calls', async () => {
    mockFetch.mockReturnValue(mockFetchResponse({ step_id: 'oai-step' }));

    const recorder = new FlightRecorder('http://localhost:3001/api');
    (recorder as any).currentRunId = 'run-oai';

    const mockCompletion = {
      choices: [
        {
          message: { content: 'Hi there!', role: 'assistant' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(mockCompletion),
        },
      },
    };

    wrapOpenAI(mockClient, recorder);

    const result = await mockClient.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result).toEqual(mockCompletion);
    // Should have recorded via recordStep (which calls fetch)
    expect(mockFetch).toHaveBeenCalled();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.type).toBe('LLM_CALL');
    expect(body.payload.model).toBe('gpt-4');
  });

  it('handles missing chat.completions gracefully', () => {
    const recorder = new FlightRecorder('http://localhost:3001/api');
    const mockClient = {};
    // Should not throw
    wrapOpenAI(mockClient, recorder);
  });
});

describe('wrapFetch', () => {
  it('intercepts LLM API calls', async () => {
    const recorder = new FlightRecorder('http://localhost:3001/api');
    (recorder as any).currentRunId = 'run-fetch';

    // Save and restore the original mock since wrapFetch replaces globalThis.fetch
    const recordStepSpy = vi.spyOn(recorder, 'recordStep').mockResolvedValue('s1');

    // We need to set up the real response for the LLM call
    const llmResponse = {
      choices: [{ message: { content: 'Hello' } }],
    };

    const originalFetch = globalThis.fetch;
    // Replace with a fetch that returns our LLM response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({
        json: () => Promise.resolve(llmResponse),
        text: () => Promise.resolve(JSON.stringify(llmResponse)),
      }),
    });

    const cleanup = wrapFetch(recorder);

    await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(recordStepSpy).toHaveBeenCalled();
    const stepCall = recordStepSpy.mock.calls[0][0];
    expect(stepCall.type).toBe('LLM_CALL');
    expect(stepCall.payload.model).toBe('gpt-4');

    cleanup();
    recordStepSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it('passes through non-LLM calls unchanged', async () => {
    const recorder = new FlightRecorder('http://localhost:3001/api');
    (recorder as any).currentRunId = 'run-fetch';
    const recordStepSpy = vi.spyOn(recorder, 'recordStep').mockResolvedValue('s1');

    const originalFetch = globalThis.fetch;
    const innerFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    globalThis.fetch = innerFetch;

    const cleanup = wrapFetch(recorder);

    await globalThis.fetch('https://example.com/api/data');

    // recordStep should NOT be called for non-LLM URLs
    expect(recordStepSpy).not.toHaveBeenCalled();
    // But the underlying fetch should still be called
    expect(innerFetch).toHaveBeenCalled();

    cleanup();
    recordStepSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });
});
