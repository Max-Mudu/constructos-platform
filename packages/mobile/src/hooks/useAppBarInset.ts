import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Top padding the custom app bars were designed with (status bar + 12). */
const DESIGN_TOP_PADDING = 56;
const GAP_BELOW_STATUS_BAR = 12;

/**
 * Style override for the screens' custom app bars, which draw under the
 * status bar. Keeps the designed 56 pt where that already clears the status
 * bar, and grows it on devices whose top inset is taller (Dynamic Island
 * iPhones, tall Android status bars / cutouts).
 */
export function useAppBarInset(): { paddingTop: number } {
  const { top } = useSafeAreaInsets();
  return { paddingTop: Math.max(DESIGN_TOP_PADDING, top + GAP_BELOW_STATUS_BAR) };
}
