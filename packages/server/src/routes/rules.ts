import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/init.js';

export const rulesRouter = Router();

// List all rules with latest version info
rulesRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.code, r.name, r.scope, r.created_at, r.updated_at,
           rv.id as latest_version_id, rv.version_no, rv.candidate_type,
           rv.validation_status, rv.is_published, rv.nl_text
    FROM rules r
    LEFT JOIN rule_versions rv ON rv.rule_id = r.id
      AND rv.version_no = (SELECT MAX(rv2.version_no) FROM rule_versions rv2 WHERE rv2.rule_id = r.id)
    ORDER BY r.created_at DESC
  `).all();
  res.json({ rules: rows });
});

// Get rule detail with all versions
rulesRouter.get('/:id', (req, res) => {
  const db = getDb();
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  const versions = db.prepare(
    "SELECT * FROM rule_versions WHERE rule_id = ? ORDER BY version_no DESC"
  ).all(req.params.id);
  res.json({ rule, versions });
});

// Create rule
rulesRouter.post('/', (req, res) => {
  const db = getDb();
  const { code, name, scope, owner_user_id } = req.body;
  if (!code || !name) {
    res.status(400).json({ error: 'code and name are required' });
    return;
  }
  const id = `r_${uuid().slice(0, 8)}`;
  try {
    db.prepare(
      "INSERT INTO rules (id, code, name, scope, owner_user_id) VALUES (?, ?, ?, ?, ?)"
    ).run(id, code, name, scope ?? 'content_moderation', owner_user_id ?? 'u_admin');
    res.status(201).json({ rule_id: id });
  } catch (e) {
    res.status(409).json({ error: `Rule code "${code}" already exists` });
  }
});

// Create rule version
rulesRouter.post('/:id/versions', (req, res) => {
  const db = getDb();
  const ruleId = req.params.id;
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(ruleId);
  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const { nl_text, candidate_type, dsl_json, created_by } = req.body;
  if (!nl_text) {
    res.status(400).json({ error: 'nl_text is required' });
    return;
  }

  const maxVersion = db.prepare(
    "SELECT MAX(version_no) as max_v FROM rule_versions WHERE rule_id = ?"
  ).get(ruleId) as { max_v: number | null };

  const versionNo = (maxVersion.max_v ?? 0) + 1;
  const versionId = `rv_${uuid().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO rule_versions (id, rule_id, version_no, nl_text, candidate_type, dsl_json, validation_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, ruleId, versionNo, nl_text,
    candidate_type ?? 'manual',
    dsl_json ? (typeof dsl_json === 'string' ? dsl_json : JSON.stringify(dsl_json)) : null,
    dsl_json ? 'generated' : 'draft',
    created_by ?? 'u_admin',
  );

  // Update rule's updated_at
  db.prepare("UPDATE rules SET updated_at = datetime('now') WHERE id = ?").run(ruleId);

  res.status(201).json({ version_id: versionId, version_no: versionNo });
});

// Get dict sets (field dict, op whitelist, lexicons)
rulesRouter.get('/dicts/:type', (req, res) => {
  const db = getDb();
  const dictType = req.params.type;
  const sets = db.prepare("SELECT * FROM dict_sets WHERE dict_type = ? AND status = 'active'").all(dictType);
  const result = sets.map((s: any) => {
    const items = db.prepare("SELECT * FROM dict_items WHERE set_id = ? AND is_active = 1").all(s.id);
    return { ...s, items };
  });
  res.json({ dict_sets: result });
});
