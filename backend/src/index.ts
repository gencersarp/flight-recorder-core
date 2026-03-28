// Main entry point for the Flight Recorder backend API
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db from './db';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const port = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// API Key Auth Middleware (item 5)
// ---------------------------------------------------------------------------
const API_KEY = process.env.AFR_API_KEY;

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <key>' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== API_KEY) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

app.use('/api', authMiddleware);

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------
const StartRunSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
});

const StepSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['LLM_CALL', 'TOOL_CALL', 'TOOL_RESULT', 'SYSTEM_EVENT']),
  timestamp: z.string().optional(),
  duration: z.number().optional(),
  payload: z.record(z.any()),
});

const FinishRunSchema = z.object({
  status: z.string(),
  metadata: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseRun(r: any) {
  return {
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    tags: r.tags ? JSON.parse(r.tags) : null,
  };
}

function parseStep(s: any) {
  return {
    ...s,
    payload: s.payload ? JSON.parse(s.payload) : null,
  };
}

function findRunOrNull(id: string): any | null {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) || null;
}

// ---------------------------------------------------------------------------
// Health Check (item 6)
// ---------------------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM runs').get() as any;
    res.json({
      status: 'ok',
      version: '1.0.0',
      runs_count: row.count,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Health check failed', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/start
// ---------------------------------------------------------------------------
app.post('/api/runs/start', (req: Request, res: Response) => {
  const result = StartRunSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  try {
    const { name, model, temperature, metadata, tags } = result.data;
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO runs (id, name, created_at, updated_at, status, model, temperature, metadata, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name || 'Unnamed Run',
      now,
      now,
      'running',
      model || null,
      temperature ?? null,
      metadata ? JSON.stringify(metadata) : null,
      tags ? JSON.stringify(tags) : null
    );

    res.json({ run_id: id });
  } catch (err: any) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Failed to start run', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/step (items 1, 2)
// ---------------------------------------------------------------------------
app.post('/api/runs/:id/step', (req: Request, res: Response) => {
  const { id: run_id } = req.params;

  const result = StepSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  try {
    // Verify run exists (item 2)
    const run = findRunOrNull(run_id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const { id: step_id, type, timestamp, duration, payload } = result.data;
    const sid = step_id || uuidv4();
    const now = timestamp || new Date().toISOString();

    const insertStepAndUpdateRun = db.transaction(() => {
      db.prepare(`
        INSERT INTO steps (id, run_id, type, timestamp, duration, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sid, run_id, type, now, duration || null, JSON.stringify(payload));

      db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), run_id);
    });

    insertStepAndUpdateRun();

    res.json({ step_id: sid });
  } catch (err: any) {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Failed to record step', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/finish (items 1, 2)
// ---------------------------------------------------------------------------
app.post('/api/runs/:id/finish', (req: Request, res: Response) => {
  const { id } = req.params;

  const result = FinishRunSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  try {
    // Verify run exists (item 2)
    const run = findRunOrNull(id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const { status, metadata } = result.data;
    const now = new Date().toISOString();

    const finishTransaction = db.transaction(() => {
      if (metadata) {
        const existingMetadata = run.metadata ? JSON.parse(run.metadata) : {};
        const newMetadata = { ...existingMetadata, ...metadata };
        db.prepare('UPDATE runs SET status = ?, updated_at = ?, metadata = ? WHERE id = ?')
          .run(status, now, JSON.stringify(newMetadata), id);
      } else {
        db.prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?')
          .run(status, now, id);
      }
    });

    finishTransaction();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to finish run', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs (items 3, 4 — pagination + filtering)
// ---------------------------------------------------------------------------
app.get('/api/runs', (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    // Filter: status
    if (req.query.status && typeof req.query.status === 'string') {
      conditions.push('status = ?');
      params.push(req.query.status);
    }

    // Filter: model
    if (req.query.model && typeof req.query.model === 'string') {
      conditions.push('model = ?');
      params.push(req.query.model);
    }

    // Filter: search (name, tags, metadata)
    if (req.query.search && typeof req.query.search === 'string') {
      const searchTerm = `%${req.query.search}%`;
      conditions.push('(name LIKE ? OR tags LIKE ? OR metadata LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filter: created_after
    if (req.query.created_after && typeof req.query.created_after === 'string') {
      conditions.push('created_at >= ?');
      params.push(req.query.created_after);
    }

    // Filter: created_before
    if (req.query.created_before && typeof req.query.created_before === 'string') {
      conditions.push('created_at <= ?');
      params.push(req.query.created_before);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM runs ${whereClause}`).get(...params) as any;
    const total = countRow.total;

    const runs = db.prepare(
      `SELECT * FROM runs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      data: runs.map(parseRun),
      total,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch runs', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/compare (item 8 — must be before /api/runs/:id)
// ---------------------------------------------------------------------------
app.get('/api/runs/compare', (req: Request, res: Response) => {
  try {
    const leftId = req.query.left as string;
    const rightId = req.query.right as string;

    if (!leftId || !rightId) {
      res.status(400).json({ error: 'Both left and right run IDs are required' });
      return;
    }

    const leftRun = findRunOrNull(leftId);
    const rightRun = findRunOrNull(rightId);

    if (!leftRun) {
      res.status(404).json({ error: `Left run not found: ${leftId}` });
      return;
    }
    if (!rightRun) {
      res.status(404).json({ error: `Right run not found: ${rightId}` });
      return;
    }

    const leftSteps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY timestamp ASC').all(leftId);
    const rightSteps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY timestamp ASC').all(rightId);

    // Build diff summary
    const leftDuration = new Date(leftRun.updated_at).getTime() - new Date(leftRun.created_at).getTime();
    const rightDuration = new Date(rightRun.updated_at).getTime() - new Date(rightRun.created_at).getTime();

    const leftTypeCounts: Record<string, number> = {};
    const rightTypeCounts: Record<string, number> = {};
    leftSteps.forEach((s: any) => { leftTypeCounts[s.type] = (leftTypeCounts[s.type] || 0) + 1; });
    rightSteps.forEach((s: any) => { rightTypeCounts[s.type] = (rightTypeCounts[s.type] || 0) + 1; });

    // Compute step-by-step diff status
    const maxLen = Math.max(leftSteps.length, rightSteps.length);
    const stepDiffs: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      const l = leftSteps[i] as any | undefined;
      const r = rightSteps[i] as any | undefined;

      let status: 'same' | 'changed' | 'added' | 'removed';
      if (l && r) {
        const lPayload = l.payload || '';
        const rPayload = r.payload || '';
        status = (l.type === r.type && lPayload === rPayload) ? 'same' : 'changed';
      } else if (l && !r) {
        status = 'removed';
      } else {
        status = 'added';
      }

      stepDiffs.push({
        index: i,
        status,
        left: l ? parseStep(l) : null,
        right: r ? parseStep(r) : null,
      });
    }

    res.json({
      left: {
        run: parseRun(leftRun),
        steps: leftSteps.map(parseStep),
      },
      right: {
        run: parseRun(rightRun),
        steps: rightSteps.map(parseStep),
      },
      summary: {
        left_steps_count: leftSteps.length,
        right_steps_count: rightSteps.length,
        left_duration_ms: leftDuration,
        right_duration_ms: rightDuration,
        left_model: leftRun.model,
        right_model: rightRun.model,
        left_status: leftRun.status,
        right_status: rightRun.status,
        left_type_counts: leftTypeCounts,
        right_type_counts: rightTypeCounts,
        steps_same: stepDiffs.filter(d => d.status === 'same').length,
        steps_changed: stepDiffs.filter(d => d.status === 'changed').length,
        steps_added: stepDiffs.filter(d => d.status === 'added').length,
        steps_removed: stepDiffs.filter(d => d.status === 'removed').length,
      },
      step_diffs: stepDiffs,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to compare runs', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------
app.get('/api/runs/:id', (req: Request, res: Response) => {
  try {
    const run = findRunOrNull(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(parseRun(run));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch run', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id/steps
// ---------------------------------------------------------------------------
app.get('/api/runs/:id/steps', (req: Request, res: Response) => {
  try {
    const run = findRunOrNull(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const steps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY timestamp ASC').all(req.params.id);
    res.json(steps.map(parseStep));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch steps', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/replay (item 7)
// ---------------------------------------------------------------------------
app.post('/api/runs/:id/replay', (req: Request, res: Response) => {
  try {
    const originalId = req.params.id;
    const originalRun = findRunOrNull(originalId);
    if (!originalRun) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const originalSteps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY timestamp ASC').all(originalId);
    const newRunId = uuidv4();
    const now = new Date().toISOString();

    const existingMetadata = originalRun.metadata ? JSON.parse(originalRun.metadata) : {};
    const replayMetadata = {
      ...existingMetadata,
      original_run_id: originalId,
      replayed_at: now,
    };

    const replayTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO runs (id, name, created_at, updated_at, status, model, temperature, metadata, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newRunId,
        `[Replay] ${originalRun.name}`,
        now,
        now,
        'replaying',
        originalRun.model,
        originalRun.temperature,
        JSON.stringify(replayMetadata),
        originalRun.tags
      );

      const insertStep = db.prepare(`
        INSERT INTO steps (id, run_id, type, timestamp, duration, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const step of originalSteps as any[]) {
        insertStep.run(
          uuidv4(),
          newRunId,
          step.type,
          new Date().toISOString(),
          step.duration,
          step.payload
        );
      }
    });

    replayTransaction();

    res.json({ run_id: newRunId, original_run_id: originalId, steps_copied: (originalSteps as any[]).length });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to replay run', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});

export { app, server };
export default app;
