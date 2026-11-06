/**
 * Company data the app keeps on the device outside the API, and its cleanup.
 * No imports from api/ or store/ so the auth store can call it without cycles.
 */
import * as FileSystem from 'expo-file-system/legacy';

export const DRAWINGS_CACHE_PREFIX = 'drawings_cache_';
const INSTALL_MARKER = 'constructos_install_marker';

async function deleteMatching(dir: string | null, match: (name: string) => boolean): Promise<void> {
  if (!dir) return;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      names.filter(match).map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true })),
    );
  } catch {
    // Best effort — a missing directory or locked file must not block sign-out.
  }
}

/**
 * Removes cached drawing lists and downloaded report / drawing files so the
 * next person to sign in on this device cannot open them.
 */
export async function clearLocalCompanyData(): Promise<void> {
  await Promise.all([
    deleteMatching(FileSystem.documentDirectory, (n) => n.startsWith(DRAWINGS_CACHE_PREFIX)),
    deleteMatching(FileSystem.cacheDirectory, (n) => /\.(pdf|csv)$/i.test(n)),
  ]);
}

/**
 * iOS keeps Keychain items (our tokens) after the app is deleted, so a
 * reinstall would silently restore the old session. The app sandbox IS wiped
 * on uninstall, so a missing marker file means "first launch of this install".
 * Returns true exactly once per install, after creating the marker.
 */
export async function isFirstLaunchOfInstall(): Promise<boolean> {
  const dir = FileSystem.documentDirectory;
  if (!dir) return false;
  const path = dir + INSTALL_MARKER;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) return false;
    await FileSystem.writeAsStringAsync(path, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}
