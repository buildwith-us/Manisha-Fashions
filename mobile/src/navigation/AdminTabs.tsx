import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen';
import { AdminProductsScreen } from '../screens/admin/AdminProductsScreen';
import { AdminOrdersScreen } from '../screens/admin/AdminOrdersScreen';
import { AdminWholesaleScreen } from '../screens/admin/AdminWholesaleScreen';
import { AccountScreen } from '../screens/shared/AccountScreen';
import { PERMISSIONS, usePermission } from '../store/hooks';
import { TabIcon } from './TabIcon';
import { tabBarScreenOptions } from './tabBarOptions';
import type { AdminTabParamList } from './types';

const Tab = createBottomTabNavigator<AdminTabParamList>();

/**
 * PRD 4.7 / 8.9 — the admin shell. The Wholesale tab is mounted only for
 * accounts that actually hold the approval permission, so a staff account never
 * sees a tab it would be refused at.
 */
export function AdminTabs() {
  const canApproveWholesale = usePermission(PERMISSIONS.WHOLESALE_APPROVE);

  return (
    <Tab.Navigator screenOptions={tabBarScreenOptions}>
      <Tab.Screen
        name="Dashboard"
        component={AdminDashboardScreen}
        options={{
          title: 'Today',
          tabBarIcon: ({ focused }) => <TabIcon name="calendar" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Manage"
        component={AdminProductsScreen}
        options={{
          title: 'Products',
          tabBarIcon: ({ focused }) => <TabIcon name="package" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="AdminOrders"
        component={AdminOrdersScreen}
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused }) => <TabIcon name="clipboard" focused={focused} />,
        }}
      />
      {canApproveWholesale ? (
        <Tab.Screen
          name="Wholesale"
          component={AdminWholesaleScreen}
          options={{
            title: 'Wholesale',
            tabBarIcon: ({ focused }) => <TabIcon name="users" focused={focused} />,
          }}
        />
      ) : null}
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: 'Account',
          tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}
