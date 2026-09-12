# STE 角色扮演运行时 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Execution and delegation must follow the user's authorization for that execution session.

**Goal:** 建立可验证的生成身份、记忆来源与冻结回合契约，防止旧任务错写和动态资料破坏已保存的上下文。

**Architecture:** 新增独立纯函数模块。P0 不接网络、文件系统或 UI；后续聊天控制器在实际提交前调用守卫，Provider 组装器使用不可变回合片段。记忆来源包含当前回复与依赖历史两个摘要，前文改变也会使旧提取失效。

**Tech Stack:** 现有 TypeScript 与 Vitest，不新增依赖。

---

状态：计划已编写，下面代码仅存在于此文档，尚未创建应用文件或运行测试。

设计依据：[总体设计](../specs/2026-09-12-ste-roleplay-runtime-design.md)。整体范围：[实施路线](./2026-09-12-ste-roleplay-runtime-roadmap.md)。

## 执行范围

本包只完成纯契约与守卫，不代表聊天、Agent、文件记忆或插件兼容已实现。执行前读取当前工作区指令和 Git 状态，保留用户变更；如需隔离工作区，在用户已授权实现后按 using-git-worktrees 技能处理。

P1 负责产生和持久化 branchRevision；P3 负责从真实消息内容产生 bodyDigest/historyDigest。P0 接受这些值并验证一致性，不使用时间戳冒充内容版本。摘要应使用稳定序列化和 SHA-256 等抗碰撞摘要；不能用正文长度或粗略 token 数代替。

## 文件职责

| 操作 | 路径 | 职责 |
| --- | --- | --- |
| Create | src/lib/roleplay/types.ts | 纯数据契约 |
| Create | src/lib/roleplay/commit-guard.ts | 任务与来源版本检查 |
| Create | src/lib/roleplay/frozen-prompt.ts | 初始资料、采纳回合与请求组装 |
| Create | src/test/roleplay-commit-guard.test.ts | 切库、分支、候选和前文变化 |
| Create | src/test/roleplay-frozen-prompt.test.ts | 前缀保留、不可变性和周期边界 |

现有 vitest.config.ts 已包含 src 下的测试并配置 @ 别名；无需修改测试配置。当前包无需修改 src/types/chat.ts 或 ArchiveStory。

### Task 1：定义契约

**Files:** Create src/lib/roleplay/types.ts。

- [ ] **Step 1：创建完整类型文件。**

~~~typescript
export type RoleplayMode = 'classic' | 'agent';

export interface GenerationFence {
  readonly vaultSessionId: string;
  readonly storyId: string;
  readonly branchId: string | null;
  readonly branchRevision: number;
}

export interface MemorySourceRef {
  readonly messageId: string;
  readonly variantId: string;
  readonly bodyDigest: string;
  readonly historyDigest: string;
}

export interface PromptMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ContextEpoch {
  readonly id: string;
  readonly profileId: string;
  readonly configurationKey: string;
  readonly prefix: readonly PromptMessage[];
}

export interface FrozenTurn {
  readonly id: string;
  readonly epochId: string;
  readonly input: readonly PromptMessage[];
  readonly output: PromptMessage;
}
~~~

- [ ] **Step 2：运行类型检查。**

~~~powershell
npx tsc -p tsconfig.app.json --noEmit
~~~

预期：新增类型无错误。若已有基线错误，记录真实来源，不通过关闭 strict 或扩大 any 掩盖。

### Task 2：验证提交身份与记忆来源

**Files:** Create src/test/roleplay-commit-guard.test.ts；Create src/lib/roleplay/commit-guard.ts。

- [ ] **Step 1：先创建行为测试。**

~~~typescript
import { describe, expect, it } from 'vitest';
import {
  assertCommitFence,
  assertSourcesCurrent,
} from '@/lib/roleplay/commit-guard';
import type {
  GenerationFence,
  MemorySourceRef,
} from '@/lib/roleplay/types';

const fence: GenerationFence = {
  vaultSessionId: 'activation-A',
  storyId: 'story-1',
  branchId: null,
  branchRevision: 7,
};

const source: MemorySourceRef = {
  messageId: 'reply-12',
  variantId: 'candidate-A',
  bodyDigest: 'body-A',
  historyDigest: 'history-through-reply-12-A',
};

describe('roleplay commit guards', () => {
  it('accepts the captured story version and adopted source', () => {
    expect(() => {
      assertCommitFence(fence, { ...fence });
      assertSourcesCurrent([source], [{ ...source }]);
    }).not.toThrow();
  });

  it('rejects a late result after switching away and back to the same vault', () => {
    expect(() => assertCommitFence(fence, {
      ...fence,
      vaultSessionId: 'activation-B',
    })).toThrow('stale-generation');
  });

  it('rejects another branch even when its revision number is identical', () => {
    expect(() => assertCommitFence(fence, {
      ...fence,
      branchId: 'alternate-ending',
    })).toThrow('stale-generation');
  });

  it('rejects a reply computed before a prompt-affecting edit', () => {
    expect(() => assertCommitFence(fence, {
      ...fence,
      branchRevision: 8,
    })).toThrow('stale-generation');
  });

  it('rejects memory from a candidate that is no longer selected', () => {
    expect(() => assertSourcesCurrent([source], [{
      ...source,
      variantId: 'candidate-B',
    }])).toThrow('stale-memory-source');
  });

  it('rejects memory after an earlier edit even if this reply text is unchanged', () => {
    expect(() => assertSourcesCurrent([source], [{
      ...source,
      historyDigest: 'history-through-reply-12-B',
    }])).toThrow('stale-memory-source');
  });

  it('rejects a deleted source or an edited selected reply', () => {
    expect(() => assertSourcesCurrent([source], []))
      .toThrow('stale-memory-source');
    expect(() => assertSourcesCurrent([source], [{
      ...source,
      bodyDigest: 'edited-body',
    }])).toThrow('stale-memory-source');
  });
});
~~~

- [ ] **Step 2：运行测试，确认失败来自尚未存在的守卫模块。**

~~~powershell
npm test -- src/test/roleplay-commit-guard.test.ts --reporter=dot
~~~

预期：无法解析 @/lib/roleplay/commit-guard；不是环境或其他测试文件导致的失败。

- [ ] **Step 3：创建完整守卫实现。**

~~~typescript
import type {
  GenerationFence,
  MemorySourceRef,
} from './types';

export function assertCommitFence(
  captured: GenerationFence,
  current: GenerationFence,
): void {
  if (
    captured.vaultSessionId !== current.vaultSessionId
    || captured.storyId !== current.storyId
    || captured.branchId !== current.branchId
    || captured.branchRevision !== current.branchRevision
  ) {
    throw new Error('stale-generation');
  }
}

function sourceKey(source: MemorySourceRef): string {
  return JSON.stringify([source.messageId, source.variantId]);
}

export function assertSourcesCurrent(
  expected: readonly MemorySourceRef[],
  active: readonly MemorySourceRef[],
): void {
  const currentByKey = new Map<string, MemorySourceRef>();
  for (const source of active) {
    const key = sourceKey(source);
    if (currentByKey.has(key)) {
      throw new Error('ambiguous-memory-source');
    }
    currentByKey.set(key, source);
  }

  for (const source of expected) {
    const current = currentByKey.get(sourceKey(source));
    if (
      !current
      || current.bodyDigest !== source.bodyDigest
      || current.historyDigest !== source.historyDigest
    ) {
      throw new Error('stale-memory-source');
    }
  }
}
~~~

调用约束：实际写入必须在已捕获的源故事队列内重新读取 current 后调用守卫，随后完成写入；不能在队列外检查后隔很久再写。MemorySourceRef 的 active 集合只包含当前采纳候选，不能把所有 swipes 同时视为有效。

- [ ] **Step 4：运行相同测试，确认以上场景通过。**

~~~powershell
npm test -- src/test/roleplay-commit-guard.test.ts --reporter=dot
~~~

- [ ] **Step 5：提交本任务文件。**

~~~powershell
git add src/lib/roleplay/types.ts src/lib/roleplay/commit-guard.ts src/test/roleplay-commit-guard.test.ts
git commit -m "feat(roleplay): add generation and memory source guards"
~~~

### Task 3：冻结资料与回合，保持下一轮前缀

**Files:** Create src/test/roleplay-frozen-prompt.test.ts；Create src/lib/roleplay/frozen-prompt.ts。

- [ ] **Step 1：先创建行为测试。**

~~~typescript
import { describe, expect, it } from 'vitest';
import {
  buildAgentPrompt,
  freezeEpoch,
  freezeTurn,
} from '@/lib/roleplay/frozen-prompt';
import type { PromptMessage } from '@/lib/roleplay/types';

function epoch() {
  return freezeEpoch({
    id: 'epoch-1',
    profileId: 'main-profile',
    configurationKey: 'preset-v1-provider-v1',
    prefix: [{ role: 'system', content: '稳定角色设定与蓝灯资料' }],
  });
}

describe('frozen roleplay prompt', () => {
  it('retains the complete earlier request when the next turn adds new state', () => {
    const currentEpoch = epoch();
    const firstInput: PromptMessage[] = [
      { role: 'user', content: '[本轮背景资料]地点：客栈。旧约定尚未兑现。' },
      { role: 'user', content: '我推门进去。' },
    ];
    const firstRequest = buildAgentPrompt(currentEpoch, [], firstInput);
    const savedFirst = freezeTurn({
      id: 'turn-1',
      epochId: currentEpoch.id,
      input: firstInput,
      output: { role: 'assistant', content: '掌柜抬起头，认出了你。' },
    });
    const nextRequest = buildAgentPrompt(currentEpoch, [savedFirst], [
      { role: 'user', content: '[本轮背景资料]掌柜已认出你；约定仍未兑现。' },
      { role: 'user', content: '我提起那封信。' },
    ]);

    expect(nextRequest.slice(0, firstRequest.length)).toEqual(firstRequest);
    expect(nextRequest[firstRequest.length]).toEqual(savedFirst.output);
    expect(nextRequest.at(-1)?.content).toBe('我提起那封信。');
  });

  it('copies caller input before freezing so later edits cannot rewrite old context', () => {
    const prefix = [{ role: 'system' as const, content: '设定 v1' }];
    const input = [{ role: 'user' as const, content: '资料 v1' }];
    const currentEpoch = freezeEpoch({
      id: 'epoch-1',
      profileId: 'main-profile',
      configurationKey: 'layout-v1',
      prefix,
    });
    const saved = freezeTurn({
      id: 'turn-1',
      epochId: 'epoch-1',
      input,
      output: { role: 'assistant', content: '已采纳正文' },
    });
    prefix[0].content = '设定 v2';
    input[0].content = '资料 v2';

    expect(currentEpoch.prefix[0].content).toBe('设定 v1');
    expect(saved.input[0].content).toBe('资料 v1');
    expect(Object.isFrozen(saved.input[0])).toBe(true);
    expect(Object.isFrozen(saved.input)).toBe(true);
  });

  it('rejects a turn from another context epoch', () => {
    const old = freezeTurn({
      id: 'turn-old',
      epochId: 'another-epoch',
      input: [{ role: 'user', content: '旧请求' }],
      output: { role: 'assistant', content: '旧回复' },
    });
    expect(() => buildAgentPrompt(epoch(), [old], [
      { role: 'user', content: '新输入' },
    ])).toThrow('context-epoch-mismatch');
  });

  it('rejects duplicate adopted turns instead of sending history twice', () => {
    const saved = freezeTurn({
      id: 'turn-1',
      epochId: 'epoch-1',
      input: [{ role: 'user', content: '输入' }],
      output: { role: 'assistant', content: '正文' },
    });
    expect(() => buildAgentPrompt(epoch(), [saved, saved], [
      { role: 'user', content: '下一轮' },
    ])).toThrow('duplicate-turn');
  });
});
~~~

测试中的 user 角色背景块是 P0 纯文本载体样本，不是对所有 Provider 的角色布局承诺。P3 必须按设计固定实际映射，并在映射之后再次比较请求。当前测试不证明服务端缓存命中。

- [ ] **Step 2：运行测试，确认缺少冻结模块导致失败。**

~~~powershell
npm test -- src/test/roleplay-frozen-prompt.test.ts --reporter=dot
~~~

- [ ] **Step 3：创建完整冻结实现。**

~~~typescript
import type {
  ContextEpoch,
  FrozenTurn,
  PromptMessage,
} from './types';

function copyMessage(message: PromptMessage): PromptMessage {
  return Object.freeze({
    role: message.role,
    content: message.content,
  });
}

function copyMessages(
  messages: readonly PromptMessage[],
): readonly PromptMessage[] {
  return Object.freeze(messages.map(copyMessage));
}

export function freezeEpoch(epoch: ContextEpoch): ContextEpoch {
  return Object.freeze({
    id: epoch.id,
    profileId: epoch.profileId,
    configurationKey: epoch.configurationKey,
    prefix: copyMessages(epoch.prefix),
  });
}

export function freezeTurn(turn: FrozenTurn): FrozenTurn {
  if (turn.output.role !== 'assistant') {
    throw new Error('turn-output-must-be-assistant');
  }
  if (turn.input.length === 0) {
    throw new Error('turn-input-required');
  }
  return Object.freeze({
    id: turn.id,
    epochId: turn.epochId,
    input: copyMessages(turn.input),
    output: copyMessage(turn.output),
  });
}

export function buildAgentPrompt(
  epoch: ContextEpoch,
  adoptedTurns: readonly FrozenTurn[],
  pendingInput: readonly PromptMessage[],
): readonly PromptMessage[] {
  if (pendingInput.length === 0) {
    throw new Error('pending-input-required');
  }
  const result: PromptMessage[] = [...epoch.prefix];
  const seen = new Set<string>();
  for (const turn of adoptedTurns) {
    if (turn.epochId !== epoch.id) {
      throw new Error('context-epoch-mismatch');
    }
    if (seen.has(turn.id)) {
      throw new Error('duplicate-turn');
    }
    seen.add(turn.id);
    result.push(...turn.input, turn.output);
  }
  result.push(...copyMessages(pendingInput));
  return Object.freeze(result);
}
~~~

调用约束：传入的 epoch 和 adoptedTurns 必须来自 freezeEpoch/freezeTurn，包括从持久化读取之后；按真实采纳顺序传入，不能混入其他分支或失效候选。配置、角色映射和布局变化产生新 epoch ID。运行记录保存增量 turn，buildAgentPrompt 只在发请求时形成完整数组。

- [ ] **Step 4：运行前缀测试，确认通过。**

~~~powershell
npm test -- src/test/roleplay-frozen-prompt.test.ts --reporter=dot
~~~

- [ ] **Step 5：提交本任务文件。**

~~~powershell
git add src/lib/roleplay/frozen-prompt.ts src/test/roleplay-frozen-prompt.test.ts
git commit -m "feat(roleplay): preserve frozen context turns"
~~~

### Task 4：完成包内验证与交接

- [ ] **Step 1：运行包内测试和类型检查。**

~~~powershell
npm test -- src/test/roleplay-commit-guard.test.ts src/test/roleplay-frozen-prompt.test.ts --reporter=dot
npx tsc -p tsconfig.app.json --noEmit
git diff --check
~~~

预期：两组测试通过、新增代码无类型错误、无空白错误。包内未改 UI、网络、Rust 或仓储，不要求为此单独构建所有客户端。执行者只报告实际运行的检查。

- [ ] **Step 2：对照 P1/P3 接入条件审查。**

必须明确后续调用方负责：生成前后的 branchRevision、当前库激活标识、稳定候选 ID、真实内容/历史摘要、队列内检查与写入、Provider 最终序列化。P0 没有实现或宣称实现这些外部行为。

- [ ] **Step 3：在本计划记录提交 ID 和实际检查结果。**

执行记录目前为空，因为本包尚未获执行指令；不得预填通过、提交哈希或模型调用效果。

## 完成定义

五个文件有独立职责，来源守卫和冻结前缀的行为测试通过，并能被 P1/P3 直接引用。完成 P0 后进入聊天子项目的详细执行包；不会因 P0 通过就宣布角色扮演、Agent 或插件支持完成。
