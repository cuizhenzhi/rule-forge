import express from 'express';
import cors from 'cors';
import { getDb } from './db/init.js';
import { seedDatabase } from './db/seed.js';
import { rulesRouter } from './routes/rules.js';
import { dslRouter } from './routes/dsl.js';
import { experimentsRouter } from './routes/experiments.js';
import { casesRouter } from './routes/cases.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Initialize DB + seed on startup
const db = getDb();
seedDatabase(db);

// Routes
app.use('/api/rules', rulesRouter);
app.use('/api/dsl', dslRouter);
app.use('/api/experiments', experimentsRouter);
app.use('/api/cases', casesRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});
