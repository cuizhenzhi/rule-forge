import type Database from 'better-sqlite3';

export function seedDatabase(db: Database.Database): void {
  const existing = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (existing.cnt > 0) return;

  db.exec('BEGIN');
  try {
    seedUsers(db);
    seedDictSets(db);
    seedRules(db);
    db.exec('COMMIT');
    console.log('Database seeded successfully.');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seedUsers(db: Database.Database): void {
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run('u_admin', 'admin', 'admin');
  db.prepare("INSERT INTO users (id, username, role) VALUES (?, ?, ?)").run('u_reviewer', 'reviewer', 'reviewer');
}

function seedDictSets(db: Database.Database): void {
  const insertSet = db.prepare("INSERT INTO dict_sets (id, name, dict_type, language, version, description) VALUES (?, ?, ?, ?, ?, ?)");
  const insertItem = db.prepare("INSERT INTO dict_items (id, set_id, item_key, item_label, item_type, value_json, source) VALUES (?, ?, ?, ?, ?, ?, ?)");

  // Field Dictionary
  insertSet.run('fd_comment_v1', '评论字段字典 v1', 'field_dict', 'zh', 'v1', '中文评论审核场景的原始+预处理字段');
  const fields = [
    { key: 'content',      label: '原始文本',   type: 'string', source: 'raw' },
    { key: 'content_norm', label: '归一化文本', type: 'string', source: 'preprocessing' },
    { key: 'title',        label: '标题',       type: 'string', source: 'raw' },
    { key: 'author_id',    label: '作者ID',     type: 'string', source: 'raw' },
  ];
  fields.forEach((f, i) => {
    insertItem.run(`fdi_${i+1}`, 'fd_comment_v1', f.key, f.label, f.type, JSON.stringify({ type: f.type }), f.source);
  });

  // Operator Whitelist
  insertSet.run('op_whitelist_v1', '操作符白名单 v1', 'op_whitelist', 'zh', 'v1', 'v1 支持的 7 个操作符');
  const ops = [
    { key: 'contains_any', label: '包含任一', types: ['string'] },
    { key: 'regex',        label: '正则匹配', types: ['string'] },
    { key: 'len_gt',       label: '长度大于', types: ['string'] },
    { key: 'len_lt',       label: '长度小于', types: ['string'] },
    { key: 'in_set',       label: '在集合中', types: ['string', 'number', 'string[]'] },
    { key: 'not_in_set',   label: '不在集合中', types: ['string', 'number', 'string[]'] },
    { key: 'count_gt',     label: '次数大于', types: ['string'] },
  ];
  ops.forEach((op, i) => {
    insertItem.run(`opi_${i+1}`, 'op_whitelist_v1', op.key, op.label, 'operator', JSON.stringify({ field_types: op.types }), null);
  });

  // Insult Lexicon
  insertSet.run('insult_core_v1', '辱骂核心词表 v1', 'lexicon', 'zh', 'v1', '高确定性辱骂词');
  const insultTerms = [
    '傻逼', '脑残', '死全家', '废物', '智障', '白痴', '蠢货', '贱人',
    '滚蛋', '混蛋', '王八蛋', '去死', '垃圾', '人渣', '败类', '畜生',
    '猪头', '狗东西', '变态', '神经病',
  ];
  insultTerms.forEach((term, i) => {
    insertItem.run(`ins_${i+1}`, 'insult_core_v1', term, term, 'term', null, null);
  });

  // Threat Lexicon
  insertSet.run('threat_core_v1', '威胁核心词表 v1', 'lexicon', 'zh', 'v1', '明确威胁表达');
  const threatTerms = [
    '弄死你', '杀了你', '打死你', '砍死你', '让你消失',
    '灭了你', '整死你', '收拾你', '弄你', '揍死你',
  ];
  threatTerms.forEach((term, i) => {
    insertItem.run(`thr_${i+1}`, 'threat_core_v1', term, term, 'term', null, null);
  });
}

function seedRules(db: Database.Database): void {
  const insertRule = db.prepare("INSERT INTO rules (id, code, name, scope, owner_user_id) VALUES (?, ?, ?, ?, ?)");
  const insertVersion = db.prepare("INSERT INTO rule_versions (id, rule_id, version_no, nl_text, candidate_type, dsl_json, validation_status, is_published, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

  const rules = [
    {
      id: 'r_001', code: 'R001', name: '明确威胁表达拦截',
      nl_text: '文本若出现明确威胁表达，如"弄死你""杀了你""打死你"等，直接判不合规，高危。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R001', name: '明确威胁表达拦截',
        root: {
          node_type: 'predicate', id: 'c1', field: 'content',
          operator: 'regex', value: '(弄死你|杀了你|打死你|砍死你|让你消失|灭了你|整死你)',
        },
        action: { type: 'block', severity: 'high' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'strict', source: 'manual' },
      },
    },
    {
      id: 'r_002', code: 'R002', name: '高确定性辱骂词拦截',
      nl_text: '文本若包含高确定性辱骂词，如"傻逼""脑残""死全家"等，判不合规。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R002', name: '高确定性辱骂词拦截',
        root: {
          node_type: 'predicate', id: 'c1', field: 'content_norm',
          operator: 'contains_any', value: ['傻逼', '脑残', '死全家', '废物', '智障', '白痴', '蠢货', '贱人', '人渣', '败类', '畜生'],
        },
        action: { type: 'block', severity: 'high' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'strict', source: 'manual' },
      },
    },
    {
      id: 'r_003', code: 'R003', name: '辱骂变体/谐音拦截',
      nl_text: '文本若存在辱骂词的符号插入/谐音变体，如"傻*逼""沙比""脑c"等，判不合规。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R003', name: '辱骂变体/谐音拦截',
        root: {
          node_type: 'predicate', id: 'c1', field: 'content',
          operator: 'regex', value: '(傻.{0,2}逼|沙比|脑.?残|s[hb].{0,1}[比逼]|智.?障|白.?痴)',
        },
        action: { type: 'block', severity: 'high' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'synonyms', source: 'manual' },
      },
    },
    {
      id: 'r_004', code: 'R004', name: '辱骂词累计命中',
      nl_text: '文本中辱骂相关表达累计命中次数 ≥ 2，判不合规。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R004', name: '辱骂词累计命中',
        root: {
          node_type: 'predicate', id: 'c1', field: 'content_norm',
          operator: 'count_gt', value: { target: '垃圾', threshold: 1 },
        },
        action: { type: 'review', severity: 'medium' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'strict', source: 'manual' },
      },
    },
    {
      id: 'r_005', code: 'R005', name: '第二人称指向侮辱',
      nl_text: '文本若出现第二人称指向的侮辱表达，如"你+辱骂词"，判不合规。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R005', name: '第二人称指向侮辱',
        root: {
          node_type: 'predicate', id: 'c1', field: 'content',
          operator: 'regex', value: '你.{0,4}(傻逼|脑残|废物|智障|白痴|蠢货|垃圾|贱人|混蛋|畜生)',
        },
        action: { type: 'block', severity: 'high' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'strict', source: 'manual' },
      },
    },
    {
      id: 'r_006', code: 'R006', name: '威胁或辱骂综合拦截',
      nl_text: '文本出现明确威胁或高确定性辱骂时拦截，且排除白名单用户。',
      dsl: {
        dsl_version: '1.0', rule_id: 'R006', name: '威胁或辱骂综合拦截',
        root: {
          node_type: 'and', id: 'n_root',
          children: [
            {
              node_type: 'or', id: 'n_or',
              children: [
                { node_type: 'predicate', id: 'c1', field: 'content', operator: 'regex', value: '(弄死你|杀了你|打死你)' },
                { node_type: 'predicate', id: 'c2', field: 'content_norm', operator: 'contains_any', value: ['傻逼', '脑残', '死全家'] },
              ],
            },
            {
              node_type: 'not', id: 'n_not',
              child: { node_type: 'predicate', id: 'c3', field: 'author_id', operator: 'in_set', value: ['trusted_u1', 'trusted_u2'] },
            },
          ],
        },
        action: { type: 'block', severity: 'high' },
        semantics: { mode: 'boolean' },
        meta: { candidate_type: 'strict', source: 'manual' },
      },
    },
  ];

  for (const r of rules) {
    insertRule.run(r.id, r.code, r.name, 'content_moderation', 'u_admin');
    insertVersion.run(
      `rv_${r.code}_v1`, r.id, 1, r.nl_text, 'manual',
      JSON.stringify(r.dsl), 'validated', 1, 'u_admin',
    );
  }
}
