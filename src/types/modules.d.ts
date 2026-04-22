declare module 'react-native-razorpay' {
  interface RazorpayOptions {
    [key: string]: unknown;
  }
  const RazorpayCheckout: {
    open: (options: RazorpayOptions) => Promise<Record<string, string>>;
  };
  export default RazorpayCheckout;
}
