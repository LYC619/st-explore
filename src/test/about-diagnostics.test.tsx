import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
const platform=vi.hoisted(()=>({get:vi.fn(),open:vi.fn()}));
vi.mock('@/lib/runtime',()=>({isTauri:()=>true}));
vi.mock('@/lib/diagnostics',()=>({getEnvironmentInfo:platform.get,openLogDirectory:platform.open}));
import {AboutSettingsPanel} from '@/components/GlobalSettings';
let root: Root | undefined;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
async function renderPanel(){const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root!.render(<AboutSettingsPanel/>);});}
function logButton(){return [...document.querySelectorAll('button')].find(b=>b.textContent==='打开日志文件夹')!;}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';vi.clearAllMocks();});

describe('native diagnostics in the actual about panel',()=>{
  it('shows redirected configuration and opens only the dedicated log command',async()=>{
    platform.get.mockResolvedValue({status:'redirected',nominalPath:'C:/synthetic/config',resolvedPath:'C:/synthetic/Packages/Test/LocalCache/config',packageIdentity:'Synthetic.Test',logAvailable:true});
    platform.open.mockResolvedValue(undefined);
    await renderPanel();
    expect(document.body).toHaveTextContent('配置位置：被打包应用重定向');
    await act(async()=>{document.querySelector('summary')!.click();});
    expect(document.body).toHaveTextContent('实际位置：C:/synthetic/Packages');
    await act(async()=>{logButton().click();});
    expect(platform.open).toHaveBeenCalledWith();
  });
  it('does not present a failed environment lookup as normal',async()=>{
    platform.get.mockRejectedValue(new Error('synthetic failure'));
    await renderPanel();
    expect(document.body).toHaveTextContent('配置位置：无法确认');
    expect(logButton()).toBeDisabled();
  });
});
