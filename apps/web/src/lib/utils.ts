import { appConfig } from '@/lib/env';

export function getBaseUrl() {
  return appConfig.appBaseUrl;
}

export function formatAppTitle(pageTitle?: string) {
  return pageTitle ? `${pageTitle} | ${appConfig.appName}` : appConfig.appName;
}
