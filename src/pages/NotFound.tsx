import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  useI18n();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{tr("页面不存在")}</p>
        <a href="/" className="text-primary underline hover:text-primary/90">{tr("返回首页")}</a>
      </div>
    </div>
  );
};

export default NotFound;
