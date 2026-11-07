import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/auth.store';
import { TabName, tabsForRole } from '../../src/constants/roleTabs';

const TAB_BAR_HEIGHT         = 60;
const TAB_BAR_PADDING_BOTTOM = 8;

const commonOptions = {
  tabBarActiveTintColor:   '#3b82f6',
  tabBarInactiveTintColor: '#64748b',
  tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const },
  headerShown: false,
};

// Icon map — one Ionicons name per tab
const TAB_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  index:         'home-outline',
  dashboard:     'grid-outline',
  projects:      'folder-outline',
  labour:        'people-outline',
  deliveries:    'cube-outline',
  inventory:     'layers-outline',
  attendance:    'checkmark-circle-outline',
  schedule:      'calendar-outline',
  invoices:      'receipt-outline',
  instructions:  'document-text-outline',
  reports:       'bar-chart-outline',
  notifications: 'notifications-outline',
  profile:       'person-outline',
};

// All possible tab screen names
const ALL_TABS: readonly TabName[] = [
  'index', 'dashboard', 'projects', 'labour', 'deliveries', 'inventory',
  'attendance', 'schedule', 'invoices', 'instructions', 'reports', 'notifications', 'profile',
];

// Which tabs each role sees (and which the API would refuse) lives in
// src/constants/roleTabs.ts, next to the API route role lists it mirrors.

export default function TabLayout() {
  const user = useAuthStore((s) => s.user);
  // A fixed height puts the labels under the iOS home indicator / Android
  // gesture bar, so grow the bar by the bottom safe-area inset.
  const insets = useSafeAreaInsets();
  if (!user) return null;

  const screenOptions = {
    ...commonOptions,
    tabBarStyle: {
      backgroundColor: '#1e293b',
      borderTopColor:  '#334155',
      height:          TAB_BAR_HEIGHT + insets.bottom,
      paddingBottom:   TAB_BAR_PADDING_BOTTOM + insets.bottom,
    },
  };

  const visibleTabs = tabsForRole(user.role);
  const visibleNames = new Set(visibleTabs.map((t) => t.name));

  return (
    <Tabs screenOptions={screenOptions}>
      {ALL_TABS.map((name) => {
        const config = visibleTabs.find((t) => t.name === name);
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={
              visibleNames.has(name)
                ? {
                    title: config!.title,
                    tabBarIcon: ({ color, size }) => (
                      <Ionicons
                        name={TAB_ICONS[name] ?? 'ellipse-outline'}
                        size={size}
                        // The tint colours above are plain hex strings; the
                        // navigator types them as the wider ColorValue.
                        color={color as string}
                      />
                    ),
                  }
                : { href: null }
            }
          />
        );
      })}
    </Tabs>
  );
}
