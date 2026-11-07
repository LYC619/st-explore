import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

// Explicit local opt-in. Only newly invented, non-personal scenarios leave the machine.
if (process.env.STE_REAL_MODEL_TEST !== '1') throw new Error('Enable STE_REAL_MODEL_TEST for the configured service');
const out = process.env.STE_REAL_OUTPUT || '.cache/play-world-b25-real'; await mkdir(out, { recursive: true });
const server = await createServer({ configFile:false, plugins:[react()], resolve:{alias:{'@':path.resolve('src')}},
  cacheDir:'node_modules/.vite-world-real', server:{host:'127.0.0.1',port:4243,strictPort:true,watch:null,hmr:false} }); await server.listen();
const configPath = 'C:/Users/yicha/AppData/Roaming/com.ste.explorer/config.json';
const original = await readFile(configPath), config = JSON.parse(original.toString('utf8').replace(/^\uFEFF/, ''));
const profiles = typeof config.apiProfiles === 'string' ? JSON.parse(config.apiProfiles) : config.apiProfiles;
const profile = profiles.find(p => p.id === config.apiActiveProfile);
if (!profile?.apiKey) throw new Error('No configured active connection');
const hash = b => createHash('sha256').update(b).digest('hex');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage(); const results = [], envelopes = [];
try {
  await page.goto('http://127.0.0.1:4243/worlds');
  // Forward the exact browser request to the real endpoint; avoid provider CORS requirements.
  await page.route(profile.apiUrl, async route => {
    try { const response = await route.fetch({ timeout: 35000, maxRetries: 0 });
      const body = await response.json().catch(() => ({}));
      envelopes.push({ status:response.status(), maxTokens:route.request().postDataJSON().max_tokens, finishReason:body.choices?.[0]?.finish_reason, usage:body.usage });
      await route.fulfill({ response }); }
    catch { await route.abort('failed'); }
  });
  await page.evaluate(async profile => {
    const { persistProfiles } = await import('/src/components/ai-tools/api-profiles.ts'); persistProfiles([profile], profile.id);
  }, profile);
  for (const persona of [
    { name: '守成者', temperament: '谨慎守成，优先休整备粮，不愿冒险。', ambition: '保存体力，避免探索未知地区。' },
    { name: '探路者', temperament: '好奇、勇敢，以发现未知为乐。', ambition: '此刻希望探索周围而非坐下休息。' },
    { name: '修行者', temperament: '自律专注，珍惜修行机会。', ambition: '物资充足时立即修行，追求境界突破。' },
  ]) for (let repetition = 0; repetition < 3; repetition++) {
    const result = await page.evaluate(async ({ profileId, model, persona, repetition }) => {
      const { createWorld } = await import('/src/play/world/simulation.ts');
      const { withIntelligence, intelligence } = await import('/src/play/agents/state.ts');
      const { beginBudget } = await import('/src/play/agents/budget.ts');
      const { actorObservation } = await import('/src/play/agents/context-projector.ts');
      const { WorldModelGateway } = await import('/src/play/agents/model-gateway.ts');
      const { currentWorldRepo } = await import('/src/play/storage/world-repo.ts');
      const state = withIntelligence(createWorld(73));
      Object.assign(state.actors[0], { name: '测试旅人', energy: 65, bag: { food: 8, herb: 8, ore: 8 } });
      state.intelligence.settings = { ...state.intelligence.settings, profileId, model, mode: 'ai', maxCalls: 1, maxTokens: 6000 };
      state.intelligence.personas.a0 = { identity: '虚构世界中的旅人。', ...persona, privateNotes: '' };
      delete state.intelligence.personas.a0.name;
      state.intelligence = beginBudget(state.intelligence);
      const repo = currentWorldRepo(); let current = await repo.create('虚构人设抽样', state);
      const gateway = new WorldModelGateway(() => intelligence(current.state), async data => {
        const next = structuredClone(current.state); next.intelligence = data;
        current = await repo.append(current, { state: next, events: [] }, 'request');
      });
      const context = actorObservation(current.state, 'a0'); const started = performance.now();
      let actionId, error;
      try {
        const response = await gateway.request({ purpose: 'plan', actorId: 'a0', tick: 0,
          system: '你是世界中的一个人物。只能使用提供的自身人设、所见与已知记忆，不知道远处人物的秘密。从 legalActions 中选择一个 id。不得发明行动、数值或改变规则。只返回 JSON：{"actionId":"合法id"}。', context }, new AbortController().signal);
        actionId = response.value?.actionId;
      } catch (e) { error = String(e.message).slice(0, 240); }
      const receipt = current.state.intelligence.receipts.at(-1);
      return { persona: persona.name, repetition, actionId, legal: context.legalActions.some(a => a.id === actionId), error,
        elapsedMs: Math.round(performance.now() - started), charged: receipt?.charged, estimated: receipt?.estimated, status: receipt?.status };
    }, { profileId: profile.id, model: profile.model, persona, repetition });
    results.push({ ...result, envelope: envelopes.at(-1) }); console.log(JSON.stringify(results.at(-1)));
    await writeFile(`${out}/progress.json`, JSON.stringify({ model: profile.model, results }, null, 2));
    if (result.error) break; // No automated retry of failed paid requests.
  }
  if (hash(await readFile(configPath)) !== hash(original)) throw new Error('Original config changed');
  await writeFile(`${out}/result.json`, JSON.stringify({ model: profile.model, fictionalInputsOnly: true, originalConfigUnchanged: true, results,
    calls: results.length, charged: results.reduce((n, r) => n + (r.charged || 0), 0) }, null, 2));
} finally { await browser.close(); await server.close(); }
