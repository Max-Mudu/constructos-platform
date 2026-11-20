import { Platform } from 'react-native';
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

/**
 * Top padding for the full-screen form modals (New Delivery, New Labour
 * Entry, Mark Attendance, stock usage and level, schedule tasks). On Android
 * a React Native Modal is drawn edge to edge, so without this its header sits
 * under the status bar. On iOS these modals are page sheets that already start
 * below the status bar, so nothing is added there.
 * Apply it to the element that carries the modal's background colour.
 */
export function useModalTopInset(): { paddingTop: number } {
  const { top } = useSafeAreaInsets();
  return { paddingTop: Platform.OS === 'android' ? top : 0 };
}
