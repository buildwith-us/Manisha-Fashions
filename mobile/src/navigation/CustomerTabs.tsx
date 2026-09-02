import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CatalogScreen } from '../screens/customer/CatalogScreen';
import { WishlistScreen } from '../screens/customer/WishlistScreen';
import { CartScreen } from '../screens/customer/CartScreen';
import { OrdersScreen } from '../screens/customer/OrdersScreen';
import { AccountScreen } from '../screens/shared/AccountScreen';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPendingIntent } from '../store/slices/authSlice';
import { TabIcon } from './TabIcon';
import { navigationRef } from './navigationRef';
import { tabBarScreenOptions } from './tabBarOptions';
import type { CustomerTabParamList } from './types';

type GatedTab = 'Wishlist' | 'Cart' | 'Orders' | 'Account';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

export function CustomerTabs() {
  const dispatch = useAppDispatch();
  const cartCount = useAppSelector((state) => state.cart.cart?.itemCount ?? 0);
  const isSignedIn = useAppSelector((state) => state.auth.status === 'signedIn');

  /**
   * Shop is open to everyone; the other four are account-bound. A guest tapping
   * one never sees the screen — the press is cancelled and sign-in opens over
   * the top, with the tab recorded so they land on it afterwards.
   */
  const gate = (tab: GatedTab) => ({
    tabPress: (event: { preventDefault: () => void }) => {
      if (isSignedIn) return;
      event.preventDefault();
      dispatch(setPendingIntent({ type: 'openTab', tab }));
      if (navigationRef.isReady()) navigationRef.navigate('Login');
    },
  });

  return (
    <Tab.Navigator screenOptions={tabBarScreenOptions}>
      <Tab.Screen
        name="Catalog"
        component={CatalogScreen}
        options={{
          title: 'Shop',
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Wishlist"
        component={WishlistScreen}
        listeners={gate('Wishlist')}
        options={{
          title: 'Saved',
          tabBarIcon: ({ focused }) => <TabIcon name="heart" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Cart"
        component={CartScreen}
        listeners={gate('Cart')}
        options={{
          title: 'Cart',
          tabBarIcon: ({ focused }) => (
            <TabIcon name="cart" focused={focused} badge={isSignedIn ? cartCount : 0} />
          ),
        }}
      />
      <Tab.Screen
        name="Orders"
        component={OrdersScreen}
        listeners={gate('Orders')}
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused }) => <TabIcon name="package" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        listeners={gate('Account')}
        options={{
          title: 'Account',
          tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}
