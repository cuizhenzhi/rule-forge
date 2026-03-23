import { Router } from 'express';
import { getDb } from '../db/init.js';

export const casesRouter = Router();

casesRouter.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const cases = db.prepare(
    "SELECT * FROM case_explanations ORDER BY rowid DESC LIMIT ? OFFSET ?"
  ).all(limit, offset);
  res.json({ cases, limit, offset });
});

casesRouter.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM case_explanations WHERE id = ?").get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json({ case_explanation: row });
});
