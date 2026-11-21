import { describe, expect, it } from 'vitest';
import { helperScriptStatus } from '@/tavern/helper-status.ts';

describe('current helper execution status', () => {
  it('distinguishes enabled configuration from actual runtime readiness', () => {
    expect(helperScriptStatus({ id: 'a', enabled: false }, [])).toEqual({ state: 'disabled', label: '未启用' });
    expect(helperScriptStatus({ id: 'a', enabled: true }, [])).toEqual({ state: 'starting', label: '启动中' });
    expect(helperScriptStatus({ id: 'a', enabled: true }, [{ scriptId: 'a', ready: true }])).toEqual({ state: 'running', label: '运行中' });
    expect(helperScriptStatus({ id: 'a', enabled: true }, [{ scriptId: 'other', ready: true }]).state).toBe('starting');
  });
  it('shows script errors even after its bridge reported ready', () => {
    expect(helperScriptStatus({ id: 'a', enabled: true }, [{ scriptId: 'a', ready: true, error: '缺少读取权限' }])).toEqual({ state: 'error', label: '运行错误', error: '缺少读取权限' });
  });
});
