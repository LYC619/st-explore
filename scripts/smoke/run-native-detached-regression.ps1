param(
  [Parameter(Mandatory=$true)][ValidatePattern('^com\.ste\.explorer\.[a-z0-9-]+$')][string]$Identifier,
  [Parameter(Mandatory=$true)][string]$Receipt,
  [string]$OutputDirectory = '.cache/verify/native-detached-regression'
)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$runnerPath = Join-Path $PSScriptRoot 'native-detached-regression.mjs'
$outputPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
$allowedRoot = Join-Path $taskRoot '.cache\verify\'
if (-not $outputPath.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay under .cache/verify/' }
$receiptPath = (Resolve-Path -LiteralPath $Receipt).Path
$nodePath = (Get-Command node).Source
$env:STE_NATIVE_TEST_RECEIPT = $receiptPath
& $nodePath (Join-Path $PSScriptRoot 'verify-native-artifact.mjs') $Identifier
if ($LASTEXITCODE -ne 0) { throw 'Isolated artifact verification failed' }
$null = New-Item -ItemType Directory -Force -Path $outputPath
$logPath = Join-Path $outputPath ('native-' + [guid]::NewGuid().ToString('N') + '.log')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PrivateDesktopRun {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved, desktop, title; public int x,y,w,h,xchars,ychars,fill,flags;
    public short show, reserved2; public IntPtr reservedPtr, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, uint flags, uint access, IntPtr attributes);
  [DllImport("user32.dll",SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string path,uint access,uint share,ref SA attrs,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint time);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Run(string node,string runner,string log,string cwd) {
    string name="STE-R1R9-"+Guid.NewGuid().ToString("N");
    IntPtr desktop=CreateDesktop(name,IntPtr.Zero,IntPtr.Zero,0,0x01FF,IntPtr.Zero);
    if(desktop==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    IntPtr output=IntPtr.Zero; PI pi=new PI();
    try {
      SA sa=new SA{length=Marshal.SizeOf(typeof(SA)),inherit=1};
      output=CreateFile(log,0x40000000,3,ref sa,2,0x80,IntPtr.Zero);
      if(output==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
      SI si=new SI{cb=Marshal.SizeOf(typeof(SI)),desktop=name,flags=0x100,stdout=output,stderr=output};
      if(!CreateProcess(node,new StringBuilder("\""+node+"\" \""+runner+"\""),IntPtr.Zero,IntPtr.Zero,true,0x08000000,IntPtr.Zero,cwd,ref si,out pi)) throw new System.ComponentModel.Win32Exception();
      Console.WriteLine("Private desktop: "+name+"; runner PID="+pi.pid+"; current desktop is never switched.");
      WaitForSingleObject(pi.process,0xFFFFFFFF);uint code;GetExitCodeProcess(pi.process,out code);return (int)code;
    } finally { if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);if(output!=IntPtr.Zero)CloseHandle(output);CloseDesktop(desktop); }
  }
}
'@
$env:STE_NATIVE_TEST_RECEIPT = $receiptPath
$env:STE_NATIVE_TEST_IDENTIFIER = $Identifier
$env:STE_NATIVE_TEST_OUTPUT = $outputPath
$env:STE_TEST_PRIVATE_DESKTOP = '1'
Write-Output "Native test log: $logPath"
exit [PrivateDesktopRun]::Run($nodePath,$runnerPath,$logPath,$taskRoot)
