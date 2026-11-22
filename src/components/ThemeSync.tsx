import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { isDarkTheme } from '@/lib/theme';

/** next-themes 只管 data-theme 属性；tailwind 的 dark: 变体与系统原生控件 color-scheme 在此同步 */
export function ThemeSync() {
  const { theme } = useTheme();
  useEffect(() => {
    const dark = isDarkTheme(theme);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [theme]);
  return null;
}
