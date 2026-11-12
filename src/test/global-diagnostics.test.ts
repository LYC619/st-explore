import {expect,it,vi} from 'vitest';
const ipc=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core',()=>({invoke:ipc}));
vi.mock('@/lib/runtime',()=>({isTauri:()=>true}));
import {installGlobalDiagnostics} from '@/lib/diagnostics';

it('global error and rejection listeners report sanitized fields without cancelling events',()=>{
  const target=new EventTarget();
  const dispose=installGlobalDiagnostics(target as Window);
  const error=new ErrorEvent('error',{error:new SyntaxError('synthetic-private-json'),filename:'synthetic-private-file',lineno:1,colno:2,cancelable:true});
  target.dispatchEvent(error);target.dispatchEvent(error);
  expect(ipc).toHaveBeenCalledTimes(1);
  expect(error.defaultPrevented).toBe(false);
  const rejection=new Event('unhandledrejection',{cancelable:true});
  Object.defineProperty(rejection,'reason',{value:new Error('Bearer sk-SYNTHETIC')});
  target.dispatchEvent(rejection);
  expect(ipc).toHaveBeenCalledTimes(2);
  const output=JSON.stringify(ipc.mock.calls);
  for(const text of ['synthetic-private-json','synthetic-private-file','Bearer','sk-SYNTHETIC'])expect(output).not.toContain(text);
  expect(rejection.defaultPrevented).toBe(false);
  dispose();
  const count=ipc.mock.calls.length;target.dispatchEvent(error);expect(ipc).toHaveBeenCalledTimes(count);
});
