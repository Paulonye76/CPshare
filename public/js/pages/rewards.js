// Reward, wallet, withdrawal and history views.
// Phase 1: there is NO wallet, ledger, ad integration or payment provider. These
// views are clearly labelled and never show invented balances. All money amounts
// will be computed and validated by the backend, never by this frontend.
import { esc, fmtBytes } from '../lib/format.js';
import { $, notice, planned, getJSON } from '../ui.js';
import { getHistory, clearHistory } from '../store.js';
import { formatNGN, estimateIn, SUPPORTED_ESTIMATE_CURRENCIES } from '../currency.js';

const DASH = '—';

export const claim = {
  title: 'Claim Reward', nav: 'wallet',
  render: () => `<h1>Claim reward</h1>
  <div class="stack">
    ${notice('dev', '<b>Development build.</b> Rewards and advertising are not integrated, so no real reward can be claimed. This page shows how claiming will work.')}
    <div class="card stack"><div id="elig" class="muted">Checking with the server…</div>
      <button class="btn primary lg" type="button" disabled aria-disabled="true">CLAIM REWARD</button>
      <p class="small muted">The button stays off until the server confirms that your finished transfer is eligible.</p></div>
    <div class="card"><h2>How claiming will work</h2>
      <ol class="muted"><li>You finish an eligible transfer and the receiver confirms it.</li><li>The server validates the transfer.</li><li>You tap CLAIM REWARD.</li><li>The server checks your eligibility and limits.</li><li>An approved rewarded-ad session is requested.</li><li>The ad provider shows the ad and verifies completion.</li><li>The server validates the provider's event.</li><li>The reward is written to your ledger once.</li><li>Your wallet shows the verified reward.</li></ol>
      <p class="small muted">Before cash rewards go live, the ad provider must explicitly allow this incentive model. See <a href="#/rewards-info">Reward and Payment Instructions</a>.</p></div>
  </div>`,
  mount(root) {
    getJSON('/api/rewards/eligibility').then(({ body }) => { $(root, '#elig').textContent = body?.message || 'Eligibility could not be checked.'; }).catch(() => { $(root, '#elig').textContent = 'Eligibility could not be checked right now.'; });
  },
};

export const wallet = {
  title: 'Wallet', nav: 'wallet',
  render: () => `<h1>Wallet</h1>
  <div class="stack">
    ${notice('dev', '<b>Preview only.</b> There are no accounts or wallets yet. Balances below show a dash because real balances will come only from the CP Share server after you sign in.')}
    <div class="grid g3">
      ${[['Available balance', 'Rewards you can use or withdraw once approved.'], ['Pending rewards', 'Verified activity still being checked. Not yet spendable.'], ['Approved rewards', 'Checked and added to your ledger.'], ['Withdrawable balance', 'Approved rewards not reserved by a withdrawal request.'], ['Total rewards earned', 'Everything credited to you, ever.']].map(([t, d]) => `<div class="card"><div class="muted small">${t}</div><div style="font-size:1.7rem;font-weight:800">${DASH}</div><p class="small muted" style="margin:6px 0 0">${d}</p></div>`).join('')}
    </div>
    <div class="card"><h3>Progress to minimum withdrawal</h3>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward minimum withdrawal"><i></i></div>
      <div class="stat"><span id="min">Minimum withdrawal: ${DASH}</span><b>${DASH}</b></div>
      <p class="small muted">When accounts exist this shows, for example, a ₦6,000 balance against a ₦15,000 minimum as 40%. The server calculates every figure.</p></div>
    <div class="card"><h3>Estimated value in other currencies</h3><p class="muted small" id="fx">${planned('Planned')} Needs a live exchange-rate source. Estimates will show the update time and will be labelled as estimates. Withdrawals will only be offered in currencies and countries with a supported payment method.</p></div>
    <div class="row"><a class="btn" href="#/withdraw">Withdrawal</a><a class="btn" href="#/history">Transaction History</a><a class="btn" href="#/rewards-info">Reward rules</a></div>
  </div>`,
  mount(root) {
    getJSON('/api/wallet').then(({ status }) => { if (status === 401) { /* expected until auth exists */ } });
    getJSON('/api/rewards/rules').then(({ body }) => { if (body?.minWithdrawal) $(root, '#min').textContent = `Proposed minimum withdrawal: ${formatNGN(body.minWithdrawal)}`; }).catch(() => {});
    void estimateIn; void SUPPORTED_ESTIMATE_CURRENCIES;
  },
};

export const rewardsInfo = {
  title: 'Reward and Payment Instructions', nav: 'wallet',
  render: () => `<h1>Reward and payment instructions</h1>
  <div class="stack">
    ${notice('dev', '<b>Proposed rules. Not active.</b> No reward is paid in this build. Real rewards will not start until these rules are tested and approved, and until the advertising provider confirms cash incentives are allowed.')}
    <div class="card"><h2>Proposed reward schedule</h2><div id="rules" class="muted">Loading rules from the server…</div>
      <p class="small muted" style="margin-top:12px">Each activity earns its amount once in total, not per file. For example, sending 100 eligible photos earns ₦30 in total, not ₦30 per photo. Eligibility is decided by the server.</p></div>
    <div class="card"><h2>Withdrawals</h2><ul class="checks"><li>Proposed minimum withdrawal: <b id="minw">—</b>.</li><li>Withdrawals will go through supported Nigerian payment providers (not chosen yet).</li><li>Each request gets a unique reference and moves through: pending, processing, paid, failed or reversed.</li><li>Requested funds are reserved so they cannot be withdrawn twice.</li></ul></div>
    <div class="card"><h2>Conditions that will apply</h2><ul class="checks"><li>The receiving device must confirm the transfer and pass integrity checks.</li><li>Daily and monthly limits, file-size limits and repeat-claim limits.</li><li>Account eligibility and fraud checks. Suspicious activity can be held for review.</li><li>Rewards may expire if the rules say so.</li></ul></div>
  </div>`,
  mount(root) {
    getJSON('/api/rewards/rules').then(({ body }) => {
      if (!body?.rules) throw new Error('no rules');
      $(root, '#rules').innerHTML = `<table><thead><tr><th>Activity</th><th class="num">Reward</th></tr></thead><tbody>${body.rules.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(formatNGN(r.reward))}</td></tr>`).join('')}</tbody></table>`;
      $(root, '#minw').textContent = formatNGN(body.minWithdrawal);
    }).catch(() => { $(root, '#rules').textContent = 'Could not load the rules. Start the CP Share server and refresh.'; });
  },
};

export const withdraw = {
  title: 'Withdrawal', nav: 'wallet',
  render: () => `<h1>Withdrawal</h1>
  <div class="stack">
    ${notice('dev', '<b>Planned feature.</b> Withdrawals need accounts, a verified ledger and a payment provider. This form is switched off so nothing can look like it paid out.')}
    <div class="card stack"><div class="field"><label for="w-amt">Amount (NGN)</label><input id="w-amt" type="number" disabled placeholder="Minimum applies"></div>
      <div class="field"><label for="w-method">Payment method</label><select id="w-method" disabled><option>Bank transfer (NGN). Provider not selected yet</option></select></div>
      <button class="btn primary" type="button" disabled aria-disabled="true">Request withdrawal</button>
      <p class="small muted">When live, the server will check the minimum, check your balance, reserve the funds, create a unique reference and wait for the provider's verified confirmation before showing "paid".</p></div>
    <div class="card"><h3>Withdrawal statuses</h3><ul class="checks"><li><b>Pending</b>: received, funds reserved.</li><li><b>Processing</b>: sent to the payment provider.</li><li><b>Paid</b>: confirmed by a verified provider event.</li><li><b>Failed</b>: provider could not pay. Funds return after reconciliation.</li><li><b>Reversed</b>: payment was reversed. Ledger adjusted.</li></ul></div>
  </div>`,
};

export const history = {
  title: 'Transaction History', nav: 'wallet',
  render: () => `<h1>Transaction history</h1>
  <div class="stack">
    <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Transfers on this device</h2><button class="btn ghost" id="clear" type="button">Clear</button></div><div id="tlist" style="margin-top:12px"></div>
      <p class="small muted" style="margin:12px 0 0">Stored only in this browser. Names of files are not saved.</p></div>
    <div class="card"><h2>Rewards and withdrawals</h2><div class="empty">No reward or withdrawal transactions. A server-side ledger needs an account (planned).</div></div>
  </div>`,
  mount(root) {
    const paint = () => {
      const list = getHistory();
      $(root, '#tlist').innerHTML = list.length
        ? `<table><thead><tr><th>When</th><th>Direction</th><th>Files</th><th class="num">Size</th><th>Result</th></tr></thead><tbody>${list.map((h) => `<tr><td>${esc(new Date(h.at).toLocaleString())}</td><td>${h.dir === 'sent' ? 'Sent' : 'Received'}</td><td>${h.count}</td><td class="num">${fmtBytes(h.bytes)}</td><td><span class="badge ${h.status === 'completed' ? 'ok' : h.status === 'failed' ? 'bad' : 'warn'}">${esc(h.status)}</span></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">No transfers yet. Send or receive files to see them here.</div>';
    };
    paint();
    $(root, '#clear').addEventListener('click', () => { clearHistory(); paint(); });
  },
};
