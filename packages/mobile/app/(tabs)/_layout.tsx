import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/auth.store';
import { UserRole } from '../../src/types';

const commonOptions = {
  tabBarStyle: {
    backgroundColor: '#1e293b',
    borderTopColor:  '#334155',
    height:          60,
    paddingBottom:   8,
  },
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
  attendance:    'checkmark-circle-outline',
  invoices:      'receipt-outline',
  instructions:  'document-text-outline',
  reports:       'bar-chart-outline',
  notifications: 'notifications-outline',
  profile:       'person-outline',
};

// All possible tab screen names
const ALL_TABS = [
  'index', 'dashboard', 'projects', 'labour', 'deliveries',
  'attendance', 'invoices', 'instructions', 'reports', 'notifications', 'profile',
] as const;

type TabName = typeof ALL_TABS[number];
type TabConfig = { name: TabName; title: string };

function getTabsForRole(role: UserRole, canViewFinance: boolean): TabConfig[] {
  switch (role) {
    case 'worker':
      return [
        { name: 'index',         title: 'My Day'     },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'site_supervisor':
      return [
        { name: 'index',         title: 'Home'       },
        { name: 'labour',        title: 'Labour'     },
        { name: 'deliveries',    title: 'Deliveries' },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'project_manager':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'labour',        title: 'Labour'     },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'company_admin':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'invoices',      title: 'Invoices'   },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'finance_officer':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'invoices',      title: 'Invoices'   },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'consultant':
      return [
        { name: 'dashboard',      title: 'Dashboard'     },
        { name: 'projects',       title: 'Projects'      },
        { name: 'instructions',   title: 'Instructions'  },
        { name: 'notifications',  title: 'Alerts'        },
        { name: 'profile',        title: 'Profile'       },
      ];

    default: // contractor, viewer
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];
  }
}

export default function TabLayout() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const visibleTabs = getTabsForRole(user.role, user.canViewFinance);
  const visibleNames = new Set(visibleTabs.map((t) => t.name));

  return (
    <Tabs screenOptions={commonOptions}>
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
                        color={color}
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
