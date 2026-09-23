/**
 * WebView is a native module, so TurboModuleRegistry.getEnforcing throws
 * ('RNCWebViewModule' could not be found) the moment anything importing it is
 * loaded under Jest. RootNavigator reaches it through RazorpayCheckoutScreen.
 *
 * The navigator tests only care that the route renders, so a stand-in is
 * enough — anything asserting on payment behaviour should drive the real
 * screen in an e2e run instead.
 */
import { View } from 'react-native';

export const WebView = View;
export default WebView;
