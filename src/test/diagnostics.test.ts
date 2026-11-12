import {describe,expect,it,vi} from 'vitest';
import {createDiagnosticReporter,diagnosticForError,sanitizeDiagnostic} from '@/lib/diagnostics';

describe('private diagnostic fields',()=>{
  it('never forwards quoted or unquoted parse text, bearer keys or extra fields',()=>{
    const error=new SyntaxError('Unexpected token "synthetic-card" sk-SYNTHETIC Bearer secret in JSON');
    const result=diagnosticForError(error,'error','C:/synthetic-card/private-chat.json');
    const payload=JSON.stringify(sanitizeDiagnostic({...result,host:'sk-SYNTHETIC',model:'synthetic-card',...{message:error.message}}));
    expect(result.category).toBe('syntax');
    for(const value of ['synthetic-card','sk-SYNTHETIC','Bearer','private-chat','message'])expect(payload).not.toContain(value);
  });
  it('reports once, counts repeats, and starts a new window',()=>{
    let now=0;const sink=vi.fn();const reporter=createDiagnosticReporter(sink,()=>now);
    const event=diagnosticForError(new Error('synthetic'),'error','source:1');
    reporter.report(event);reporter.report(event);reporter.report(event);
    expect(sink).toHaveBeenCalledTimes(1);
    now=5001;reporter.report(event);
    expect(sink).toHaveBeenCalledTimes(3);expect(sink.mock.calls[1][0].count).toBe(2);
  });
  it('does not let a failing diagnostics sink break the product',async()=>{
    const reporter=createDiagnosticReporter(()=>Promise.reject(new Error('offline')));
    expect(()=>reporter.report({event:'vault',operation:'open'})).not.toThrow();
    await Promise.resolve();
  });
});
