export interface WpsApplication {
  ActiveDocument?: any;
  Selection?: any;
  Enum?: Record<string, Record<string, number>>;
  Env?: any;
  FileSystem?: any;
  CreateTaskPane?: (url: string, title?: string) => any;
  ShowDialog?: (
    url: string,
    appName?: string,
    width?: number,
    height?: number,
    modal?: boolean,
    hasCaption?: boolean,
    resizeEdge?: number,
    errorUrl?: string,
    loadingTimeout?: number,
    isChildWindow?: boolean,
    isUseCookie?: boolean,
    needRaise?: boolean,
  ) => boolean;
}

declare global {
  interface Window {
    wps?: WpsApplication;
    Application?: WpsApplication;
  }
}

export function resolveWpsApplication(): WpsApplication | undefined {
  if (typeof window === "undefined") return undefined;
  const application = window.wps ?? window.Application;
  return application?.ActiveDocument ? application : undefined;
}

export function isWpsHost(): boolean {
  return Boolean(resolveWpsApplication());
}
