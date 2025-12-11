// Global type declarations for Tauri
declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: any) => Promise<any>;
    };
    __TAURI_PLUGINS__?: {
      opener?: {
        open: (args: { path: string }) => Promise<void>;
      };
    };
    __TAURI__?: {
      invoke: <T = any>(command: string, args?: any) => Promise<T>;
    };
  }
}

export {};