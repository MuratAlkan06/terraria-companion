import { create } from 'zustand'

/**
 * Shell chrome visibility (UX_SPEC §2: in `/lab`, a fullscreen toggle hides the shell chrome;
 * Esc restores). While `immersive` is set, AppShell renders no header, footer or tab bar, so their
 * links also leave the tab order. Only the Lab sets it, and it clears it when it unmounts.
 */
interface ShellChromeState {
  immersive: boolean
  setImmersive: (immersive: boolean) => void
}

export const useShellChrome = create<ShellChromeState>()((set) => ({
  immersive: false,
  setImmersive: (immersive) => set({ immersive }),
}))
