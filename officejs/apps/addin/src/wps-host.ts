export interface WpsApplication {
  ActiveDocument?: any;
  Selection?: any;
  Enum?: Record<string, Record<string, number>>;
  CreateTaskPane?: (url: string, title?: string) => any;
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
