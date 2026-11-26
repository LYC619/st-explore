import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./lib/register-sw";
import { installGlobalDiagnostics } from './lib/diagnostics';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { syncDocumentLanguage } from './lib/i18n';

// PWA：注册 Service Worker，并在有新版本时提示刷新（详见 register-sw.ts）
installGlobalDiagnostics();
syncDocumentLanguage();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
