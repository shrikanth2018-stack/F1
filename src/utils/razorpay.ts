const RazorpayCheckout = {
  open: async (_options: Record<string, unknown>): Promise<void> => {
    alert('Online payments are only available on the mobile app.');
  },
};

export default RazorpayCheckout;
