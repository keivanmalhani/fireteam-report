/**
 * Activity discovery.
 *
 * The list of raids and dungeons is derived from Bungie's live manifest rather
 * than hardcoded, so the day a new raid ships it appears here on its own. The
 * derived list is cached in localStorage against the manifest version string,
 * so the 11 MB definition file is downloaded once and then not again until
 * Bungie publishes a new manifest.
 *
 * The manifest endpoint itself works without an API key, but it answers with
 * ApiKeyMissingFromRequest often enough to matter, so requests are retried and
 * the key is attached when the user has one. If everything fails, the committed
 * fallback table is used and the caller is told the list is a snapshot.
 */

import { collapseActivities } from './activities';
import { getApiKey, STORAGE_KEY_MANIFEST } from './bungie';
import { FALLBACK_ACTIVITIES, FALLBACK_MANIFEST_VERSION } from './fallback-activities';
import type { ActivityGroup, RawActivityDef } from './types';

const BUNGIE_ROOT = 'https://www.bungie.net';
const MANIFEST_URL = BUNGIE_ROOT + '/Platform/Destiny2/Manifest/';
const MAX_ATTEMPTS = 4;

export type ActivitySource = 'network' | 'cache' | 'fallback';

export interface ActivityCatalog {
  groups: ActivityGroup[];
  version: string;
  source: ActivitySource;
  /** Set when the live fetch failed and the snapshot was used. */
  note?: string;
}

interface CachedCatalog {
  version: string;
  groups: ActivityGroup[];
}

interface ManifestResponse {
  Response?: {
    version?: string;
    jsonWorldComponentContentPaths?: Record<string, Record<string, string>>;
  };
  ErrorCode?: number;
  ErrorStatus?: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readCache(): CachedCatalog | null {
  const raw = storage()?.getItem(STORAGE_KEY_MANIFEST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (
      parsed &&
      typeof parsed.version === 'string' &&
      Array.isArray(parsed.groups) &&
      parsed.groups.length > 0
    ) {
      return parsed;
    }
  } catch {
    // Corrupt cache is not worth reporting, just refetch.
  }
  return null;
}

function writeCache(catalog: CachedCatalog): void {
  try {
    storage()?.setItem(STORAGE_KEY_MANIFEST, JSON.stringify(catalog));
  } catch {
    // Quota or private browsing. The app still works, just refetches next time.
  }
}

export function clearManifestCache(): void {
  storage()?.removeItem(STORAGE_KEY_MANIFEST);
}

async function fetchJson<T>(url: string, key: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['X-API-Key'] = key;

  let last: Error = new Error('Request failed');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      const body = (await response.json()) as T & { ErrorCode?: number; ErrorStatus?: string };
      const code = body?.ErrorCode;
      if (response.ok && (code === undefined || code === 1)) return body;
      last = new Error(code ? 'Bungie error ' + code + ' ' + (body.ErrorStatus ?? '') : 'HTTP ' + response.status);
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err));
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw last;
}

/**
 * Returns the current raid and dungeon list, preferring the cache, then the
 * network, then the committed snapshot. Never throws.
 */
export async function loadActivityCatalog(): Promise<ActivityCatalog> {
  const key = getApiKey();
  const cached = readCache();

  let version: string;
  let definitionPath: string;
  try {
    const manifest = await fetchJson<ManifestResponse>(MANIFEST_URL, key);
    const v = manifest.Response?.version;
    const path = manifest.Response?.jsonWorldComponentContentPaths?.en?.DestinyActivityDefinition;
    if (!v || !path) throw new Error('Manifest did not include an activity definition path.');
    version = v;
    definitionPath = path;
  } catch (err) {
    if (cached) {
      return { groups: cached.groups, version: cached.version, source: 'cache' };
    }
    return {
      groups: FALLBACK_ACTIVITIES,
      version: FALLBACK_MANIFEST_VERSION,
      source: 'fallback',
      note: 'Could not reach bungie.net, so this is the activity list bundled with the site. ' + describe(err)
    };
  }

  if (cached && cached.version === version) {
    return { groups: cached.groups, version, source: 'cache' };
  }

  try {
    const defs = await fetchJson<Record<string, RawActivityDef>>(BUNGIE_ROOT + definitionPath, key);
    const groups = collapseActivities(Object.values(defs));
    if (groups.length === 0) throw new Error('No raids or dungeons found in the manifest.');
    writeCache({ version, groups });
    return { groups, version, source: 'network' };
  } catch (err) {
    if (cached) {
      return {
        groups: cached.groups,
        version: cached.version,
        source: 'cache',
        note: 'Could not download the new manifest, so the previously cached activity list is being used.'
      };
    }
    return {
      groups: FALLBACK_ACTIVITIES,
      version: FALLBACK_MANIFEST_VERSION,
      source: 'fallback',
      note: 'Could not download the activity definitions, so this is the list bundled with the site. ' + describe(err)
    };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
