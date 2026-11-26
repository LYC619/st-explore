import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CJK_CHAR = /[\u3400-\u9fff]/;
const CJK_JSX_PUNCT = /[，。！？、“”‘’「」『』【】（）]/;
const TRANSLATED_DICTS = new Set([
  'EDITOR_TOOL_COPY', 'RUNTIME_LABEL', 'SEARCH_KIND_LABEL', 'SORT_LABELS',
  'PAGE_SIZE_LABELS', 'TOOL_TYPE_LABELS', 'ST_IMPORT_PHASE_LABEL',
  'PROMPT_ROLE_LABELS', 'MARKER_LABELS', 'NODE_TYPE_LABELS',
  'SUMMARY_KIND_LABELS', 'POSITION_LABELS', 'ROLE_LABELS',
  'PRESET_STATUS_LABELS', 'PACKAGE_KIND_LABELS', 'LLM_MESSAGES',
]);

export const placeholders = text => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].sort();

export function checkCatalog(catalog) {
  const errors = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`Empty translation: ${key}`);
    } else if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) {
      errors.push(`Placeholder mismatch: ${key}`);
    } else if (CJK_CHAR.test(value)) {
      errors.push(`Untranslated CJK in English value for key: ${key}`);
    }
  }
  return errors;
}

function isInsideCallable(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionLike(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

function collectRawCjkInArg(expr, ast, out) {
  if (!expr) return;
  if (ts.isCallExpression(expr) && (expr.expression.getText(ast) === 'tr' || expr.expression.getText(ast) === 'translate')) {
    return;
  }
  if (ts.isStringLiteralLike(expr) && CJK_CHAR.test(expr.text)) {
    out.push(expr.text);
    return;
  }
  if (ts.isTemplateExpression(expr)) {
    if (CJK_CHAR.test(expr.head.text)) out.push(expr.head.text);
    for (const span of expr.templateSpans) {
      collectRawCjkInArg(span.expression, ast, out);
      if (CJK_CHAR.test(span.literal.text)) out.push(span.literal.text);
    }
    return;
  }
  ts.forEachChild(expr, child => collectRawCjkInArg(child, ast, out));
}

export function checkSourceText(relFile, source, catalog) {
  const errors = [];
  let calls = 0;
  const ast = ts.createSourceFile(
    relFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    relFile.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'tr') {
      calls++;
      if (!isInsideCallable(node)) {
        errors.push(`${relFile}: module-scope tr() call freezes initial locale (${node.getText(ast)})`);
      }
      const key = node.arguments[0];
      if (key && ts.isStringLiteralLike(key) && CJK_CHAR.test(key.text) && !Object.hasOwn(catalog, key.text)) {
        errors.push(`${relFile}: missing ${key.text}`);
      }
      const valuesArg = node.arguments[1];
      if (valuesArg && ts.isObjectLiteralExpression(valuesArg)) {
        for (const prop of valuesArg.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const rawHits = [];
            collectRawCjkInArg(prop.initializer, ast, rawHits);
            if (rawHits.length) {
              errors.push(`${relFile}: raw Chinese interpolation value in tr() (${rawHits[0].trim()})`);
            }
          }
        }
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      TRANSLATED_DICTS.has(node.expression.getText(ast)) &&
      !isInsideCallable(node)
    ) {
      errors.push(`${relFile}: module-scope getter read freezes initial locale (${node.getText(ast)})`);
    }
    const nativeLanguageName = relFile.endsWith('LanguagePicker.tsx') && node.text?.trim() === '简体中文';
    if (ts.isJsxText(node) && !nativeLanguageName) {
      if (CJK_CHAR.test(node.text)) {
        errors.push(`${relFile}: untranslated JSX text ${node.text.trim()}`);
      } else if (CJK_JSX_PUNCT.test(node.text)) {
        errors.push(`${relFile}: raw CJK punctuation in JSX text ${node.text.trim()}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
  return { errors, calls };
}

export async function checkSources(root = process.cwd()) {
  const catalog = JSON.parse(await readFile(path.join(root, 'src/lib/i18n/locales/en.json'), 'utf8'));
  const errors = checkCatalog(catalog);
  let calls = 0;
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!['test', 'locales'].includes(entry.name)) await walk(file);
        continue;
      }
      if (!/\.tsx?$/.test(file) || /\.(test|spec)\.tsx?$/.test(file)) continue;
      const source = await readFile(file, 'utf8');
      const res = checkSourceText(path.relative(root, file), source, catalog);
      calls += res.calls;
      errors.push(...res.errors);
    }
  }
  await walk(path.join(root, 'src'));
  return { errors, calls, entries: Object.keys(catalog).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkSources();
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`i18n: ${result.entries} English messages; ${result.calls} translation calls; placeholders, args, and JSX checked.`);
  }
}
