// Web shim — Razorpay's RN SDK doesn't support web. Reject so calling
// code can roll back any provisional state instead of silently
// continuing as if payment succeeded. Customer-facing screens should
// preemptively block payment buttons on web; this is the last-line
// safety net.
const RazorpayCheckout = {
  open: async (_options: Record<string, unknown>): Promise<never> => {
    throw new Error('Razorpay payments are only supported on the mobile app.');
  },
};

export default RazorpayCheckout;
