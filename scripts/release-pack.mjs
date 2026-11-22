// Build-only delivery command. Never launches an installer or application.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectBuildInfo } from './build-info.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
function localDate(now) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
async function execute(command, args, { cwd, env, logPath } = {}) {
  const log = logPath ? await open(logPath, 'w') : null;
  let output = '';
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: log ? ['ignore', log.fd, log.fd] : ['ignore', 'pipe', 'pipe'] });
      if (!log) for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-65536); });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`构建命令退出 ${code}；日志：${logPath ?? output.trim()}`)));
    });
  } finally { await log?.close(); }
  return output.trim();
}

export async function packRelease(tag, { root = projectRoot, now = new Date(), collect = collectBuildInfo, execute: run = execute, portableOnly = false } = {}) {
  if (typeof tag !== 'string' || tag.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error('标签只允许小写字母、数字及中间的短横线，最多48字符');
  root = path.resolve(root);
  const releaseRoot = path.join(root, 'release');
  await mkdir(releaseRoot, { recursive: true });
  if ((await lstat(releaseRoot)).isSymbolicLink()) throw new Error('发布目录不能是目录链接');
  const label = `${localDate(now)}-${tag}`, directory = path.join(releaseRoot, label);
  try { await mkdir(directory); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`目标目录已存在，拒绝覆盖：${directory}`);
    throw error;
  }
  const startedAt = now.toISOString();
  const executionPath = path.join(directory, 'build-execution.json');
  await writeFile(executionPath, json({ status: 'building', startedAt }));
  try {
    const buildInfo = collect(root, { now });
    if (!buildInfo.commit || buildInfo.dirty === null) throw new Error('无法确认源码提交，停止打包');
    const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    if (config.identifier !== 'com.ste.explorer' || config.mainBinaryName !== 'STE') throw new Error('正式打包配置不匹配');
    const receiptPath = path.join(directory, 'build-info.json');
    await writeFile(receiptPath, json(buildInfo), { flag: 'wx' });
    const target = path.join(root, 'src-tauri/target');
    const env = { ...process.env, STE_BUILD_INFO_FILE: receiptPath, CARGO_TARGET_DIR: target, CARGO_PROFILE_RELEASE_CODEGEN_UNITS: '256' };
    // Release output must not inherit a separate build target from a test shell.
    delete env.CARGO_BUILD_TARGET;
    const commandOptions = { cwd: root, env };
    const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const tauriCli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
    const toolchains = {};
    for (const [name, command, args] of [
      ['node', process.execPath, ['--version']], ['npm', process.execPath, [npmCli, '--version']],
      ['cargo', 'cargo', ['--version']], ['rustc', 'rustc', ['--version']], ['tauri', process.execPath, [tauriCli, '--version']],
    ]) toolchains[name] = await run(command, args, commandOptions);
    console.log(`正在打包 ${label}，构建日志：${path.join(directory, 'build.log')}`);
    const buildArgs = portableOnly ? [tauriCli, 'build', '--no-bundle'] : [tauriCli, 'build', '--bundles', 'nsis'];
    await run(process.execPath, buildArgs, { ...commandOptions, logPath: path.join(directory, 'build.log') });

    const frontendText = await readFile(path.join(root, 'dist/build-info.json'), 'utf8');
    if (json(JSON.parse(frontendText)) !== json(buildInfo)) throw new Error('前端构建清单与冻结清单不一致');
    const executable = path.join(target, 'release/STE.exe');
    const binary = await readFile(executable);
    // build.rs embeds the same JSON after stripping its newlines.
    if (!binary.includes(Buffer.from(frontendText.replace(/[\r\n]/g, '')))) throw new Error('原生程序未包含同一份构建清单');
    const after = collect(root, { now });
    if (after.commit !== buildInfo.commit || json(after.dirtyFiles) !== json(buildInfo.dirtyFiles)) throw new Error('打包期间源码提交或改动清单变化，请保留证据后换标签重试');
    const artifacts = [];
    const targets = [
      ...(!portableOnly ? [['installer', path.join(target, `release/bundle/nsis/${config.productName}_${buildInfo.version}_x64-setup.exe`), `ST-Explorer-${buildInfo.version}-${label}-setup.exe`]] : []),
      ['portable', executable, `STE-${buildInfo.version}-${label}-portable.exe`],
    ];
    for (const [kind, source, file] of targets) {
      const destination = path.join(directory, file);
      await copyFile(source, destination);
      const bytes = await readFile(destination);
      artifacts.push({ kind, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await writeFile(path.join(directory, '使用与体验更新.md'), [
      `# ST Explorer ${buildInfo.version} · ${label}`, '',
      `构建：${buildInfo.commit}；${buildInfo.dirty ? '含未提交的构建输入，详见清单' : '构建输入已提交'}。`, '',
      '## 如何使用', '', '安装版用于安装；免安装版可直接运行，电脑需有 WebView2 Runtime。两者共用正式配置。',
      '本次仅完成构建，未安装或运行正式程序；请按最终报告进行用户桌面验收。', '',
      '## 本次体验更新', '', '<待填写本批次用户可感知的变化。>', '',
      '## 验证与待验收', '', '<待填写自动检查、独立原生检查及用户验收状态；关于页构建号须与 build-info.json 一致。>', '',
    ].join('\n'));
    const completedAt = new Date().toISOString();
    const manifest = { schema: 1, status: 'packaged-not-run', label, startedAt, completedAt, buildInfo,
      dirtyScope: 'Only shipped source and build inputs listed in buildInfo.inputPaths; documentation, tests and reference files excluded.',
      toolchains, buildSettings: { identifier: config.identifier, platform: 'windows-x64', codegenUnits: 256, bundle: portableOnly ? 'none' : 'nsis' }, artifacts };
    await writeFile(path.join(directory, 'build-manifest.json'), json(manifest), { flag: 'wx' });
    await writeFile(executionPath, json({ status: 'packaged-not-run', startedAt, completedAt }));
    console.log(`${portableOnly ? '免安装版' : '双包'}及构建清单已生成：${directory}`);
    return { directory, manifest };
  } catch (error) {
    await writeFile(executionPath, json({ status: 'failed', startedAt, failedAt: new Date().toISOString(), reason: error.message }));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('此打包入口目前仅支持 Windows x64');
  const cliArgs = process.argv.slice(2);
  const portableOnly = cliArgs.includes('--portable-only');
  const positional = cliArgs.filter(arg => arg !== '--portable-only');
  if (positional.length !== 1) throw new Error('Usage: npm run release:pack -- <标签> [--portable-only]');
  await packRelease(positional[0], { portableOnly });
}
