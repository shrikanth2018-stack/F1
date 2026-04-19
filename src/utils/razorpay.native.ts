import RNRazorpay from 'react-native-razorpay';
import { InteractionManager } from 'react-native';

// Wraps the native SDK so that it always fires after all navigation animations
// have settled. react-native-screens commits each screen's UIViewController
// asynchronously; calling open() mid-animation gives the SDK an incomplete
// view hierarchy, causing the checkout sheet to never present on iOS.
const RazorpayCheckout = {
  open: (options: Record<string, unknown>): Promise<any> =>
    new Promise((resolve, reject) => {
      InteractionManager.runAfterInteractions(() => {
        // Extra 150 ms buffer: react-native-screens finalises the
        // UIViewController after the JS animation frame, not before.
        setTimeout(() => {
          RNRazorpay.open(options).then(resolve).catch(reject);
        }, 150);
      });
    }),
};

export default RazorpayCheckout;
