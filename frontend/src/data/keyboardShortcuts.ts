export interface KeyboardShortcut {
  description: string
  keys: string[]
}

/** Matches global handlers in App, Sidebar, CommandPalette, ChatInput, and SettingsPage. */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { description: 'Send message', keys: ['Enter'] },
  { description: 'New line in message', keys: ['Shift', 'Enter'] },
  { description: 'Open command palette', keys: ['Ctrl', 'K'] },
  { description: 'Open command palette (alternate)', keys: ['Ctrl', '/'] },
  { description: 'New chat', keys: ['Alt', 'N'] },
  { description: 'Toggle sidebar', keys: ['Ctrl', '\\'] },
  { description: 'Toggle sidebar (alternate)', keys: ['Alt', 'S'] },
  {
    description: 'Show keyboard shortcuts',
    keys: ['Shift', '?'],
  },
  { description: 'Close panels, dialogs, and popups', keys: ['Esc'] },
  { description: 'Focus chat search in sidebar', keys: ['Ctrl', 'F'] },
]
