/**
 * ToxiCN import: stratified splits + manifest.
 *
 * Modes:
 * - Single CSV (default): 60/20/20 stratified, fixed seed. Use when no official split (ToxiCN repo).
 * - Official train/test: --train-csv + --test-csv. Val is carved ONLY from official train (never re-mix with test).
 *
 * Env: TOXICN_CSV default data/ToxiCN-repo/ToxiCN_1.0.csv
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { getDb } from '../db/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DATASETS_DIR = join(REPO_ROOT, 'data', 'datasets');

export type ToxicSample = {
  sample_id: string;
  content: string;
  content_norm: string;
  label: 0 | 1;
  meta: { source_file: string; source_row: number };
};

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function toHalfWidth(s: string): string {
  return s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

function normalizeContent(raw: string): string {
  return toHalfWidth(raw.trim()).toLowerCase();
}

function parseToxic(v: string | undefined): 0 | 1 {
  if (v === undefined || v === '') return 0;
  const n = Number(String(v).trim());
  if (n === 1) return 1;
  if (n === 0) return 0;
  const low = String(v).trim().toLowerCase();
  if (low === 'true' || low === 'toxic') return 1;
  return 0;
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashSampleId(sourceFile: string, sourceRow: number, text: string): string {
  const h = createHash('sha256')
    .update(`${sourceFile}|${sourceRow}|${text.slice(0, 2000)}`)
    .digest('hex')
    .slice(0, 32);
  return `toxicn:v1:${h}`;
}

function loadCsvSamples(csvPath: string): ToxicSample[] {
  const buf = readFileSync(csvPath);
  const records = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  }) as Record<string, string>[];
  const base = csvPath.replace(/\\/g, '/');
  const out: ToxicSample[] = [];
  let row = 0;
  for (const rec of records) {
    row++;
    const text = rec.text ?? rec.Text ?? rec.content ?? '';
    if (typeof text !== 'string' || !text.trim()) continue;
    const toxic = rec.toxic ?? rec.Toxic;
    const label = parseToxic(toxic as string);
    out.push({
      sample_id: hashSampleId(base, row, text),
      content: text,
      content_norm: normalizeContent(text),
      label,
      meta: { source_file: base, source_row: row },
    });
  }
  return out;
}

function stratifiedSplitThreeWay(
  samples: ToxicSample[],
  seed: number,
  trainRatio: number,
  valRatio: number,
): { train: ToxicSample[]; val: ToxicSample[]; test: ToxicSample[] } {
  if (trainRatio + valRatio >= 1) throw new Error('train+val must be < 1');
  const byLabel: ToxicSample[][] = [[], []];
  for (const s of samples) byLabel[s.label].push(s);
  const rand = mulberry32(seed);
  const train: ToxicSample[] = [];
  const val: ToxicSample[] = [];
  const test: ToxicSample[] = [];
  for (const group of byLabel) {
    const g = [...group];
    shuffleInPlace(g, rand);
    const n = g.length;
    if (n === 0) continue;
    const nTrain = Math.max(0, Math.floor(n * trainRatio));
    const nVal = Math.max(0, Math.floor(n * valRatio));
    const nTest = n - nTrain - nVal;
    train.push(...g.slice(0, nTrain));
    val.push(...g.slice(nTrain, nTrain + nVal));
    test.push(...g.slice(nTrain + nVal));
  }
  return { train, val, test };
}

/** Split one pool into train + val only (for official-train branch). */
function stratifiedSplitTrainVal(
  samples: ToxicSample[],
  seed: number,
  trainFractionOfPool: number,
): { train: ToxicSample[]; val: ToxicSample[] } {
  const byLabel: ToxicSample[][] = [[], []];
  for (const s of samples) byLabel[s.label].push(s);
  const rand = mulberry32(seed);
  const train: ToxicSample[] = [];
  const val: ToxicSample[] = [];
  for (const group of byLabel) {
    const g = [...group];
    shuffleInPlace(g, rand);
    const n = g.length;
    const nTrain = Math.max(1, Math.floor(n * trainFractionOfPool));
    train.push(...g.slice(0, nTrain));
    val.push(...g.slice(nTrain));
  }
  return { train, val };
}

function writeSplitJson(path: string, samples: ToxicSample[]): string {
  writeFileSync(path, JSON.stringify(samples, null, 0), 'utf-8');
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main(): void {
  const args = process.argv.slice(2);
  let trainCsv = process.env.TOXICN_TRAIN_CSV;
  let testCsv = process.env.TOXICN_TEST_CSV;
  let singleCsv = process.env.TOXICN_CSV ?? join(REPO_ROOT, 'data', 'ToxiCN-repo', 'ToxiCN_1.0.csv');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--train-csv' && args[i + 1]) trainCsv = args[++i];
    else if (args[i] === '--test-csv' && args[i + 1]) testCsv = args[++i];
    else if (args[i] === '--csv' && args[i + 1]) singleCsv = args[++i];
  }

  const seed = 42;
  mkdirSync(DATASETS_DIR, { recursive: true });

  let train: ToxicSample[];
  let val: ToxicSample[];
  let test: ToxicSample[];
  let splitMode: string;
  let sourceHashes: Record<string, string>;

  if (trainCsv && testCsv) {
    if (!existsSync(trainCsv) || !existsSync(testCsv)) {
      console.error('Official mode: provide existing --train-csv and --test-csv');
      process.exit(1);
    }
    splitMode = 'official_train_test_val_from_train';
    const officialTrain = loadCsvSamples(trainCsv);
    test = loadCsvSamples(testCsv);
    sourceHashes = {
      official_train_sha256: fileSha256(trainCsv),
      official_test_sha256: fileSha256(testCsv),
    };
    const sub = stratifiedSplitTrainVal(officialTrain, seed, 0.8);
    train = sub.train;
    val = sub.val;
  } else {
    if (!existsSync(singleCsv)) {
      console.error(`CSV not found: ${singleCsv}`);
      console.error('Clone ToxiCN: git clone https://github.com/DUT-lujunyu/ToxiCN.git data/ToxiCN-repo');
      process.exit(1);
    }
    splitMode = 'single_csv_stratified_60_20_20';
    const all = loadCsvSamples(singleCsv);
    sourceHashes = { csv_sha256: fileSha256(singleCsv) };
    const sp = stratifiedSplitThreeWay(all, seed, 0.6, 0.2);
    train = sp.train;
    val = sp.val;
    test = sp.test;
  }

  const trainPath = join(DATASETS_DIR, 'toxicn_train.json');
  const valPath = join(DATASETS_DIR, 'toxicn_val.json');
  const testPath = join(DATASETS_DIR, 'toxicn_test.json');

  const hTrain = writeSplitJson(trainPath, train);
  const hVal = writeSplitJson(valPath, val);
  const hTest = writeSplitJson(testPath, test);

  const manifest = {
    dataset: 'ToxiCN',
    dsl_version: 'import_v1',
    split_mode: splitMode,
    seed,
    source_hashes: sourceHashes,
    split_file_hashes: { train: hTrain, val: hVal, test: hTest },
    counts: { train: train.length, val: val.length, test: test.length },
    label_mapping: 'toxic 1 -> label 1 (non_compliant), else 0',
    gold_definition: 'binary compliance vs ToxiCN toxic flag',
    note:
      'ToxiCN GitHub has no official train/test files; default is single-CSV stratified 60/20/20. Official mode: val only from official train.',
  };
  const manifestPath = join(DATASETS_DIR, 'toxicn_split_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const db = getDb();
  const datasetId = 'dataset_toxicn_v1';
  const csvHash = sourceHashes.csv_sha256 ?? sourceHashes.official_train_sha256 ?? '';

  db.prepare(
    `INSERT OR REPLACE INTO datasets (id, name, source, task_type, file_path, file_hash, label_schema_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    datasetId,
    'ToxiCN v1',
    'DUT-lujunyu/ToxiCN',
    'binary_compliance',
    manifestPath,
    createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
    JSON.stringify({ 0: 'compliant', 1: 'non_compliant', source: 'toxic column' }),
  );

  const upsertSplit = db.prepare(
    `INSERT INTO dataset_splits (id, dataset_id, split_name, split_path, file_hash, sample_count, split_seed)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dataset_id, split_name) DO UPDATE SET
       split_path = excluded.split_path,
       file_hash = excluded.file_hash,
       sample_count = excluded.sample_count,
       split_seed = excluded.split_seed`,
  );
  for (const [name, path, hash, cnt] of [
    ['train', trainPath, hTrain, train.length],
    ['val', valPath, hVal, val.length],
    ['test', testPath, hTest, test.length],
  ] as const) {
    const existing = db
      .prepare('SELECT id FROM dataset_splits WHERE dataset_id = ? AND split_name = ?')
      .get(datasetId, name) as { id: string } | undefined;
    const sid = existing?.id ?? `${datasetId}_${name}`;
    upsertSplit.run(sid, datasetId, name, path, hash, cnt, String(seed));
  }

  console.log(JSON.stringify(manifest, null, 2));
}

main();
