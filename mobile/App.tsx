import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ConnectionBanner } from './src/components/ConnectionBanner';
import { store } from './src/store';
import { bootstrapSession } from './src/store/slices/authSlice';
import { configureGoogle } from './src/services/googleAuth';

// Once, before anything can ask for a sign-in.
configureGoogle();

function AppBootstrap() {
  useEffect(() => {
    // PRD 8.10 — decide between login and dashboard before the first paint.
    void store.dispatch(bootstrapSession());
  }, []);

  return <RootNavigator />;
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppBootstrap />
        {/* Over every screen: shown only while the API is waking or unreachable. */}
        <ConnectionBanner />
      </SafeAreaProvider>
    </Provider>
  );
}
