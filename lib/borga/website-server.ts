import 'server-only';
import { fetchPublic } from './safe-url';
import { readSite, USER_AGENT, type Get, type WebsiteRead } from './website-read';

export { WebsiteError, type WebsiteRead } from './website-read';

const realGet: Get = (url, signal) => fetchPublic(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' }, signal });

/** Reads a company's website for onboarding, through the guard that keeps outbound fetches away from internal addresses. */
export const readWebsite = (input: string): Promise<WebsiteRead> => readSite(input, realGet);
