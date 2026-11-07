/**
 * Open a downloaded local file (PDF / CSV) in another app.
 *
 * Android: a file:// URI cannot be handed to other apps, and Linking.openURL
 * with a content:// URI sends an ACTION_VIEW intent with no MIME type and no
 * read grant, so most viewers fail. Use an explicit VIEW intent with the MIME
 * type and FLAG_GRANT_READ_URI_PERMISSION; fall back to the share sheet when no
 * viewer is installed.
 * iOS: Linking cannot open sandbox file:// URLs; the share sheet (which offers
 * Quick Look / "Save to Files") is the supported path.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

const UTI_BY_MIME: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'text/csv':        'public.comma-separated-values-text',
};

export async function openLocalFile(localUri: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(localUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data:  contentUri,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
        type:  mimeType,
      });
      return;
    } catch {
      // No app can view this type — fall through to the share sheet.
    }
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No app available to open this file');
  }
  await Sharing.shareAsync(localUri, { mimeType, UTI: UTI_BY_MIME[mimeType] });
}
