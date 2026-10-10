// Currency display module. NGN is the launch currency. Estimates in other currencies
// need a live exchange-rate source, which is not integrated yet, so estimateIn()
// returns null instead of guessing. When a rates API is added, pass its result as `rates`
// ({ base:'NGN', updatedAt:<ISO>, rates:{USD:..} }) and always show updatedAt + "estimate".
export const SUPPORTED_ESTIMATE_CURRENCIES = ['USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD'];

export function formatNGN(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

export function estimateIn(currency, amountNGN, rates) {
  if (!rates || !SUPPORTED_ESTIMATE_CURRENCIES.includes(currency) || !rates.rates?.[currency]) return null;
  return {
    amount: amountNGN * rates.rates[currency], currency, updatedAt: rates.updatedAt, isEstimate: true,
    text: new Intl.NumberFormat('en', { style: 'currency', currency }).format(amountNGN * rates.rates[currency]) + ' (estimate)',
  };
}
