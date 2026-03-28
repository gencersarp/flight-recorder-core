import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, server } from '../index';

// Close server after all tests
afterAll(() => {
  if (server && server.close) {
    server.close();
  }
});

describe('Health Check', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('1.0.0');
    expect(typeof res.body.runs_count).toBe('number');
  });
});

describe('Run Lifecycle', () => {
  let runId: string;

  it('POST /api/runs/start creates a run', async () => {
    const res = await request(app)
      .post('/api/runs/start')
      .send({
        name: 'Test Run',
        model: 'gpt-4',
        temperature: 0.7,
        tags: ['test', 'unit'],
        metadata: { env: 'test' },
      });
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeDefined();
    runId = res.body.run_id;
  });

  it('POST /api/runs/start with invalid body returns 400', async () => {
    const res = await request(app)
      .post('/api/runs/start')
      .send({ temperature: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('POST /api/runs/:id/step records a step', async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/step`)
      .send({
        type: 'LLM_CALL',
        payload: { prompt: 'Hello', response: 'Hi' },
        duration: 100,
      });
    expect(res.status).toBe(200);
    expect(res.body.step_id).toBeDefined();
  });

  it('POST /api/runs/:id/step with non-existent run returns 404', async () => {
    const res = await request(app)
      .post('/api/runs/non-existent-id/step')
      .send({
        type: 'LLM_CALL',
        payload: { prompt: 'Hello' },
      });
    expect(res.status).toBe(404);
  });

  it('POST /api/runs/:id/step with invalid body returns 400', async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/step`)
      .send({ type: 'INVALID_TYPE', payload: {} });
    expect(res.status).toBe(400);
  });

  it('POST /api/runs/:id/step adds a second step', async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/step`)
      .send({
        type: 'TOOL_CALL',
        payload: { name: 'calculator', args: { x: 1 }, result: 2 },
        duration: 50,
      });
    expect(res.status).toBe(200);
    expect(res.body.step_id).toBeDefined();
  });

  it('GET /api/runs/:id returns the run', async () => {
    const res = await request(app).get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(runId);
    expect(res.body.name).toBe('Test Run');
    expect(res.body.model).toBe('gpt-4');
    expect(res.body.status).toBe('running');
    expect(res.body.tags).toEqual(['test', 'unit']);
    expect(res.body.metadata).toEqual({ env: 'test' });
  });

  it('GET /api/runs/:id with non-existent id returns 404', async () => {
    const res = await request(app).get('/api/runs/non-existent-id');
    expect(res.status).toBe(404);
  });

  it('GET /api/runs/:id/steps returns steps', async () => {
    const res = await request(app).get(`/api/runs/${runId}/steps`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].type).toBe('LLM_CALL');
    expect(res.body[1].type).toBe('TOOL_CALL');
  });

  it('POST /api/runs/:id/finish finishes the run', async () => {
    const res = await request(app)
      .post(`/api/runs/${runId}/finish`)
      .send({ status: 'success', metadata: { total_tokens: 150 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/runs/:id/finish with non-existent run returns 404', async () => {
    const res = await request(app)
      .post('/api/runs/non-existent-id/finish')
      .send({ status: 'success' });
    expect(res.status).toBe(404);
  });

  it('GET /api/runs/:id after finish has merged metadata', async () => {
    const res = await request(app).get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.metadata).toEqual({ env: 'test', total_tokens: 150 });
  });
});

describe('Pagination and Filtering', () => {
  let runIds: string[] = [];

  beforeAll(async () => {
    // Create multiple runs for pagination testing
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/runs/start')
        .send({
          name: `Pagination Run ${i}`,
          model: i % 2 === 0 ? 'gpt-4' : 'claude-3',
          tags: [`batch-${i}`],
        });
      runIds.push(res.body.run_id);
    }

    // Finish some runs with different statuses
    await request(app)
      .post(`/api/runs/${runIds[0]}/finish`)
      .send({ status: 'success' });
    await request(app)
      .post(`/api/runs/${runIds[1]}/finish`)
      .send({ status: 'error' });
  });

  it('GET /api/runs returns paginated response', async () => {
    const res = await request(app).get('/api/runs?page=1&limit=3');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(3);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(typeof res.body.total).toBe('number');
  });

  it('GET /api/runs page 2 returns different results', async () => {
    const page1 = await request(app).get('/api/runs?page=1&limit=2');
    const page2 = await request(app).get('/api/runs?page=2&limit=2');
    expect(page1.body.data[0].id).not.toBe(page2.body.data[0]?.id);
  });

  it('GET /api/runs?status= filters by status', async () => {
    const res = await request(app).get('/api/runs?status=error');
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: any) => r.status === 'error')).toBe(true);
  });

  it('GET /api/runs?model= filters by model', async () => {
    const res = await request(app).get('/api/runs?model=claude-3');
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: any) => r.model === 'claude-3')).toBe(true);
  });

  it('GET /api/runs?search= searches name/tags/metadata', async () => {
    const res = await request(app).get('/api/runs?search=Pagination');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: any) => r.name.includes('Pagination'))).toBe(true);
  });

  it('GET /api/runs?created_after= filters by date', async () => {
    const longAgo = '2020-01-01T00:00:00.000Z';
    const res = await request(app).get(`/api/runs?created_after=${longAgo}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /api/runs?created_before= filters by date', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const res = await request(app).get(`/api/runs?created_before=${future}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('Replay', () => {
  let originalRunId: string;
  let replayRunId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/runs/start')
      .send({ name: 'Original Run', model: 'gpt-4', tags: ['replay-test'] });
    originalRunId = res.body.run_id;

    await request(app)
      .post(`/api/runs/${originalRunId}/step`)
      .send({ type: 'LLM_CALL', payload: { prompt: 'test', response: 'ok' }, duration: 100 });

    await request(app)
      .post(`/api/runs/${originalRunId}/step`)
      .send({ type: 'TOOL_CALL', payload: { name: 'calc', args: {}, result: 42 }, duration: 50 });

    await request(app)
      .post(`/api/runs/${originalRunId}/finish`)
      .send({ status: 'success' });
  });

  it('POST /api/runs/:id/replay creates a new run with copied steps', async () => {
    const res = await request(app).post(`/api/runs/${originalRunId}/replay`);
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeDefined();
    expect(res.body.original_run_id).toBe(originalRunId);
    expect(res.body.steps_copied).toBe(2);
    replayRunId = res.body.run_id;
  });

  it('Replay run has status "replaying" and original_run_id in metadata', async () => {
    const res = await request(app).get(`/api/runs/${replayRunId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('replaying');
    expect(res.body.name).toContain('[Replay]');
    expect(res.body.metadata.original_run_id).toBe(originalRunId);
  });

  it('Replay run has the same number of steps', async () => {
    const res = await request(app).get(`/api/runs/${replayRunId}/steps`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('POST /api/runs/:id/replay with non-existent run returns 404', async () => {
    const res = await request(app).post('/api/runs/non-existent-id/replay');
    expect(res.status).toBe(404);
  });
});

describe('Compare', () => {
  let runA: string;
  let runB: string;

  beforeAll(async () => {
    const resA = await request(app)
      .post('/api/runs/start')
      .send({ name: 'Compare A', model: 'gpt-4' });
    runA = resA.body.run_id;

    await request(app)
      .post(`/api/runs/${runA}/step`)
      .send({ type: 'LLM_CALL', payload: { prompt: 'hello', response: 'world' } });
    await request(app)
      .post(`/api/runs/${runA}/finish`)
      .send({ status: 'success' });

    const resB = await request(app)
      .post('/api/runs/start')
      .send({ name: 'Compare B', model: 'claude-3' });
    runB = resB.body.run_id;

    await request(app)
      .post(`/api/runs/${runB}/step`)
      .send({ type: 'LLM_CALL', payload: { prompt: 'hello', response: 'universe' } });
    await request(app)
      .post(`/api/runs/${runB}/step`)
      .send({ type: 'TOOL_CALL', payload: { name: 'extra', args: {}, result: {} } });
    await request(app)
      .post(`/api/runs/${runB}/finish`)
      .send({ status: 'success' });
  });

  it('GET /api/runs/compare returns both runs with diff', async () => {
    const res = await request(app).get(`/api/runs/compare?left=${runA}&right=${runB}`);
    expect(res.status).toBe(200);
    expect(res.body.left.run.id).toBe(runA);
    expect(res.body.right.run.id).toBe(runB);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.left_steps_count).toBe(1);
    expect(res.body.summary.right_steps_count).toBe(2);
    expect(res.body.step_diffs).toBeDefined();
    expect(res.body.step_diffs.length).toBe(2); // max of both
  });

  it('GET /api/runs/compare without params returns 400', async () => {
    const res = await request(app).get('/api/runs/compare');
    expect(res.status).toBe(400);
  });

  it('GET /api/runs/compare with invalid id returns 404', async () => {
    const res = await request(app).get(`/api/runs/compare?left=bad-id&right=${runB}`);
    expect(res.status).toBe(404);
  });

  it('Compare step_diffs have correct statuses', async () => {
    const res = await request(app).get(`/api/runs/compare?left=${runA}&right=${runB}`);
    const diffs = res.body.step_diffs;
    // First step: both exist, payloads differ -> changed
    expect(diffs[0].status).toBe('changed');
    // Second step: only right has it -> added
    expect(diffs[1].status).toBe('added');
  });
});
