import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { Component, Fragment, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useNavigate, useRouteError } from 'react-router-dom';
import { BUILD_INFO, formatBuildInfo } from '@/lib/build-info';
import { openLogDirectory, reportError } from '@/lib/diagnostics';
import { isTauri } from '@/lib/runtime';

function CrashFallback({error,retry,home}:{error:unknown;retry:()=>void;home:()=>void}) {
  useI18n();
  const [logError,setLogError]=useState(false);
  const message=error instanceof Error ? error.message : '';
  const chunkFailure=/dynamically imported module|loading chunk|chunkloaderror|importing a module script/i.test(message);
  const name=error instanceof Error && ['Error','TypeError','SyntaxError','RangeError','ReferenceError'].includes(error.name) ? error.name : 'Error';
  const buttonClass='min-h-11 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted';
  return <section role="alert" data-app-error className="mx-auto my-8 w-full max-w-xl space-y-4 rounded-xl border border-border bg-background p-6 text-foreground">
    <h1 className="text-lg font-semibold">{chunkFailure?tr("页面资源加载失败"):tr("当前页面暂时无法显示")}</h1>
    <p className="text-sm text-muted-foreground">{chunkFailure?tr("请重新加载，获取完整的页面资源。"):tr("请重试，或返回首页继续操作。")}</p>
    <div className="flex flex-wrap gap-2">
      {!chunkFailure&&<button className={buttonClass} onClick={retry}>{tr("重试")}</button>}
      <button className={buttonClass} onClick={home}>{tr("返回首页")}</button>
      <button className={buttonClass} onClick={()=>window.location.reload()}>{tr("重新加载")}</button>
      {isTauri()&&<button className={buttonClass} onClick={()=>{void openLogDirectory().catch(()=>setLogError(true));}}>{tr("打开日志文件夹")}</button>}
    </div>
    {logError&&<p className="text-sm text-muted-foreground">{tr("无法打开日志文件夹，请稍后重试。")}</p>}
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{tr("技术细节")}</summary>
      <p className="mt-2">{tr("错误类型：")}{name}</p>
      <p className="break-words">{tr("构建：")}{formatBuildInfo(BUILD_INFO)}</p>
    </details>
  </section>;
}

export class AppErrorBoundary extends Component<{children:ReactNode},{error:unknown;hasError:boolean;attempt:number}> {
  state:{error:unknown;hasError:boolean;attempt:number}={error:null,hasError:false,attempt:0};
  static getDerivedStateFromError(error:unknown){return {error,hasError:true};}
  componentDidCatch(error:Error,info:ErrorInfo){reportError(error,'render',info.componentStack??undefined);}
  render(){
    if(this.state.hasError) return <CrashFallback error={this.state.error}
      retry={()=>this.setState(state=>({error:null,hasError:false,attempt:state.attempt+1}))}
      home={()=>window.location.assign('/')} />;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export function RouteErrorBoundary(){
  const error=useRouteError(),navigate=useNavigate(),location=useLocation();
  useEffect(()=>{reportError(error,'route');},[error]);
  // A fresh location key resets render errors even for routes with no loader to revalidate.
  return <CrashFallback error={error} retry={()=>navigate(location.pathname+location.search+location.hash,{replace:true,state:location.state})} home={()=>navigate('/',{replace:true})}/>;
}
