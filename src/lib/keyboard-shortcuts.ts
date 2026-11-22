const INTERACTIVE_SHORTCUT_SCOPE = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="alertdialog"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ');

// 按钮/链接的 Enter 与空格应留给控件本身；方向键和 Escape 仍可由阅读器处理。
const ACTIVATABLE_SHORTCUT_SCOPE = ['button', 'a[href]', 'summary', '[role="button"]'].join(', ');

export function shouldIgnoreGlobalShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  if (target.closest(INTERACTIVE_SHORTCUT_SCOPE)) return true;
  if (event.key === ' ' || event.key === 'Enter') {
    return target.closest(ACTIVATABLE_SHORTCUT_SCOPE) !== null;
  }
  return false;
}

/** 单键全局快捷键（如 /、J/K、[ / ]）：排除输入法合成态、修饰键组合（Ctrl/Cmd/Alt）与交互控件焦点 */
export function isPlainSingleKeyShortcut(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return !shouldIgnoreGlobalShortcut(event);
}
