/* ===== Webプッシュ通知（アプリを閉じていても端末に通知を出す） =====

   仕組み:
     ① sw.js（サービスワーカー）を登録する
     ② Edge Function web-push からVAPID公開鍵をもらう
     ③ ブラウザに購読を作り、その宛先を push_subscriptions に保存する
     ④ 管理側がメッセージを送るとき web-push を呼び、サーバから端末へ通知が飛ぶ

   注意（iPhone）:
     iOSはSafariで開いただけでは通知を出せない。「ホーム画面に追加」して
     そのアイコンから開いた場合のみ許可を求められる（iOS 16.4以降）。
     そのため、iOSでホーム画面から開いていない時は追加の手順を案内する。 */

let pushSwReg = null;          // 登録済みのサービスワーカー
let pushVapidKey = null;       // VAPID公開鍵（1セッション1回だけ取りに行く）
let pushBusy = false;          // 二重クリック防止

const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const pushIsIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ホーム画面から起動しているか（iOSで通知を出せるかの判定に使う）
const pushIsStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia?.('(display-mode: standalone)').matches === true;

function urlB64ToUint8Array(b64){
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
  const out = new Uint8Array(raw.length);
  for (let i=0; i<raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const pushKeyToB64 = buf => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i=0; i<b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};

async function pushEnsureSW(){
  if (!pushSupported()) return null;
  if (pushSwReg) return pushSwReg;
  pushSwReg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  return pushSwReg;
}
async function pushGetVapidKey(){
  if (pushVapidKey) return pushVapidKey;
  const { data, error } = await sb.functions.invoke('web-push', { body: { op: 'public_key' } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  pushVapidKey = data.public_key;
  return pushVapidKey;
}

/* 端末の購読をDBに保存する。endpointが同じなら上書きするので、何度呼んでも増えない。
   なお、同じブラウザを別の人が使うと同じendpointになるため、ログアウト時に購読ごと破棄している
   （そうしないと前の人あての通知が次の人の端末に届いてしまう）。 */
async function pushSaveSubscription(sub){
  const j = sub.toJSON ? sub.toJSON() : sub;
  const keys = j.keys || {};
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: me.id,
    drv_id: me.driver_id || null,
    endpoint: j.endpoint,
    p256dh: keys.p256dh || pushKeyToB64(sub.getKey('p256dh')),
    auth: keys.auth || pushKeyToB64(sub.getKey('auth')),
    ua: (navigator.userAgent || '').slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

// 通知を受け取れる状態にする（ボタンから呼ぶ。許可のダイアログは操作起点でないと出せない）
async function enablePush(){
  if (pushBusy) return;
  // iOSはホーム画面に追加するまで PushManager が無いため、対応判定より先に案内する
  if (pushIsIOS() && !pushIsStandalone()) {
    alert('iPhone・iPadでは、先に「ホーム画面に追加」が必要です。\n\n' +
          '① 画面下の共有ボタン（□に↑）を押す\n' +
          '② 「ホーム画面に追加」を選ぶ\n' +
          '③ 追加されたアイコンからこのアプリを開く\n' +
          '④ もう一度この画面で「通知を受け取る」を押す');
    return;
  }
  if (!pushSupported()) {
    showT('この端末・ブラウザは通知に対応していません（' + pushMissingReasons().join('・') + 'が使えません）', 'ter');
    return;
  }
  pushBusy = true;
  showLoad(true);
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showT(perm === 'denied'
        ? '通知が拒否されています。ブラウザの設定から許可してください'
        : '通知は許可されませんでした', 'ter');
      return;
    }
    const reg = await pushEnsureSW();
    const key = await pushGetVapidKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(key),
      });
    }
    await pushSaveSubscription(sub);
    showT('この端末で通知を受け取れるようになりました');
    addLog('プッシュ通知 登録', (navigator.userAgent||'').slice(0,120));
  } catch(e) {
    showT('通知の登録に失敗しました: ' + e.message, 'ter');
    console.warn('enablePush:', e);
  } finally {
    pushBusy = false;
    showLoad(false);
    renderPushSetting();
  }
}

async function disablePush(){
  if (pushBusy) return;
  pushBusy = true;
  showLoad(true);
  try {
    const reg = await pushEnsureSW();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
    showT('この端末への通知を停止しました');
  } catch(e) {
    showT('停止に失敗しました: ' + e.message, 'ter');
  } finally {
    pushBusy = false;
    showLoad(false);
    renderPushSetting();
  }
}

// 自分の端末にテスト通知を送る（届くかどうかをその場で確かめられるように）
async function sendPushTest(){
  showLoad(true);
  try {
    const { data, error } = await sb.functions.invoke('web-push', {
      body: { op: 'test', title: 'PG Base', body: 'テスト通知です。これが見えていれば設定は完了しています。' },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data.sent) {
      showT(data.note === 'no_subscriptions'
        ? 'この端末はまだ登録されていません' : `送信できませんでした（${data.failed}件失敗）`, 'ter');
    } else {
      showT(`${data.sent}台の端末に送りました`);
    }
  } catch(e) {
    showT('テスト送信に失敗しました: ' + e.message, 'ter');
  }
  showLoad(false);
}

/* ===== 通知の受け取り設定 =====
   「端末ごと全部オフ」だけだと、チャットは要るがお知らせは要らない、といった調整ができない。
   種類ごとのオフと、グループごとのミュートを本人が選べるようにする。
   絞り込みはサーバ（web-push関数）側で行う。複数人へ一度に送るとき、
   人ごとの設定を効かせる必要があるため。 */
const NOTIFY_PREF_DEFAULT = { chat: true, board: true, statement: true, muted_group_ids: [] };
let notifyPrefs = null;

async function loadNotifyPrefs(){
  if (!sb || !me) return;
  try {
    const { data } = await sb.from('notify_prefs').select('*').eq('user_id', me.id).maybeSingle();
    notifyPrefs = data || { ...NOTIFY_PREF_DEFAULT };
  } catch(e) {
    console.warn('loadNotifyPrefs:', e.message);
    notifyPrefs = { ...NOTIFY_PREF_DEFAULT };
  }
}
async function saveNotifyPrefs(patch){
  if (!sb || !me) return false;
  const next = { ...NOTIFY_PREF_DEFAULT, ...(notifyPrefs || {}), ...patch };
  try {
    const { error } = await sb.from('notify_prefs').upsert({
      user_id: me.id, chat: next.chat, board: next.board, statement: next.statement,
      muted_group_ids: next.muted_group_ids || [], updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    notifyPrefs = next;
    return true;
  } catch(e) { showT('設定を保存できませんでした: ' + e.message, 'ter'); return false; }
}
async function toggleNotifyKind(kind, el){
  const ok = await saveNotifyPrefs({ [kind]: !!el.checked });
  if (ok) showT('通知の設定を保存しました');
  else el.checked = !el.checked;   // 保存できなければ見た目を戻す
}
const isGroupMuted = id => ((notifyPrefs && notifyPrefs.muted_group_ids) || []).includes(id);
// グループごとの通知オンオフ（LINEのグループミュートと同じ動き）
async function toggleGroupMute(groupId, ev){
  if (ev) ev.stopPropagation();
  const cur = ((notifyPrefs && notifyPrefs.muted_group_ids) || []).slice();
  const muted = cur.includes(groupId);
  const next = muted ? cur.filter(x => x !== groupId) : [...cur, groupId];
  if (!await saveNotifyPrefs({ muted_group_ids: next })) return;
  showT(muted ? 'このグループの通知をオンにしました' : 'このグループの通知をオフにしました');
  try { renderMyChatGroupList(); } catch(e) {}
  try { renderMyChatGroupThreadHeader(); } catch(e) {}
}

/* 通知を送る。管理・編集者だけが呼べる（サーバ側でも権限を確認している）。
   失敗してもチャットの送信自体は成功させたいので、例外は握りつぶして記録だけ残す。 */
async function pushNotify({ drv_ids = [], user_ids = [], title, body = '', url = './', tag = 'pgbase', kind = 'chat', group_id = null }){
  if (!sb || (!drv_ids.length && !user_ids.length)) return;
  try {
    const { error } = await sb.functions.invoke('web-push', {
      body: { op: 'send', drv_ids, user_ids, title, body: String(body).slice(0, 300), url, tag, kind, group_id },
    });
    if (error) throw error;
  } catch(e) { console.warn('pushNotify:', e.message); }
}

/* ログイン直後に呼ぶ。既に許可済みの端末なら黙って購読を張り直す
   （購読の宛先(endpoint)はブラウザの都合で変わることがあるため、毎回保存し直す）。 */
async function pushSyncOnLogin(){
  if (!pushSupported() || !me) return;
  try {
    const reg = await pushEnsureSW();
    if (Notification.permission !== 'granted') return;
    const key = await pushGetVapidKey();
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
    await pushSaveSubscription(sub);
  } catch(e) { console.warn('pushSyncOnLogin:', e.message); }
}

/* ログアウト時に購読ごと破棄する。
   同じ端末を別の人が使ったときに、前の人あての通知が届いてしまうのを防ぐため。
   次にその人がログインすれば pushSyncOnLogin() が自動で張り直すので、再設定の手間はない。 */
async function pushClearOnLogout(){
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch(e) {}
    await sub.unsubscribe();
  } catch(e) { console.warn('pushClearOnLogout:', e.message); }
  pushSwReg = null;
  pushVapidKey = null;
}

// 通知が使えない理由を具体的に返す（「対応していません」だけだと原因が分からないため）
function pushMissingReasons(){
  const miss = [];
  if (!('serviceWorker' in navigator)) miss.push('サービスワーカー');
  if (!('PushManager' in window)) miss.push('プッシュ');
  if (!('Notification' in window)) miss.push('通知');
  return miss;
}
function pushStatusHtml(){
  /* iOS（iPhone・iPad）はホーム画面に追加するまで PushManager 自体が存在しない。
     そのため対応判定より先にこちらを出す。順番を逆にすると、Safariで開いた全員に
     「対応していません」と表示されてしまう。 */
  if (pushIsIOS() && !pushIsStandalone()) {
    return `<b>🔔 端末への通知を受け取るには</b><br>
      iPhone・iPadでは、先に<b>ホーム画面に追加</b>が必要です。<br>
      ① 画面下の共有ボタン（□に↑）を押す<br>
      ② 「ホーム画面に追加」を選ぶ<br>
      ③ 追加されたアイコンからこのアプリを開き、この画面で通知をオンにする<br>
      <span style="color:var(--text2)">※ Safariで開いたままでは通知を出せません（iOSの仕様）。iOS 16.4以降が必要です。</span>`;
  }
  if (!pushSupported()) {
    const miss = pushMissingReasons();
    const hints = [];
    if (!window.isSecureContext) hints.push('このページが https で開かれていません');
    // LINEやXなどアプリ内のブラウザで開くと、プッシュ通知が使えないことが多い
    if (/Line\/|FBAN|FBAV|Instagram|Twitter/i.test(navigator.userAgent)) {
      hints.push('LINEなどアプリ内のブラウザで開いています。SafariやChromeで開き直してください');
    }
    if (pushIsIOS()) hints.push('iOS 16.4より前のiPhone・iPadでは使えません');
    return `<b>🔔 端末への通知</b><br><span style="color:var(--text2)">
      この端末・ブラウザは対応していません（${escHtml(miss.join('・'))}が使えません）。<br>
      ${hints.map(h => '・' + escHtml(h)).join('<br>')}</span>`;
  }
  if (Notification.permission === 'denied') {
    return `<b>🔔 端末への通知</b><br><span style="color:var(--text2)">
      ブラウザ側で拒否されています。サイトの設定から通知を「許可」に変えてください。</span>`;
  }
  return null; // 通常のボタン表示へ
}
// 通知設定の表示。ドライバーポータルと管理画面の設定、両方に同じものを出す
async function renderPushSetting(){
  const els = ['drvPushBanner', 'adminPushSetting'].map(id => document.getElementById(id)).filter(Boolean);
  if (!els.length) return;
  const note = pushStatusHtml();
  let html;
  if (note) {
    html = `<div style="padding:10px 12px;background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--radius);font-size:12px;line-height:1.7">${note}</div>`;
  } else {
    const prefs = notifyPrefs || NOTIFY_PREF_DEFAULT;
    const mutedCount = (prefs.muted_group_ids || []).length;
    let on = false;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      on = !!(reg && await reg.pushManager.getSubscription()) && Notification.permission === 'granted';
    } catch(e) {}
    html = `<div style="padding:10px 12px;background:var(--bg2);border:0.5px solid var(--border2);border-radius:var(--radius);font-size:12px;line-height:1.7">
      <b>🔔 端末への通知</b>　${on
        ? '<span style="color:var(--green,#43a047)">この端末は登録済みです</span>'
        : '<span style="color:var(--text2)">この端末はまだ登録されていません</span>'}<br>
      <span style="color:var(--text2)">オンにすると、アプリを閉じていても新着メッセージが端末に届きます。</span>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        ${on
          ? `<button class="btn sml" onclick="disablePush()">通知を止める</button>
             <button class="btn sml" onclick="sendPushTest()">テスト通知を送る</button>`
          : `<button class="btn pri sml" onclick="enablePush()">🔔 通知を受け取る</button>`}
      </div>
      ${on ? `<div style="margin-top:8px;border-top:0.5px solid var(--border2);padding-top:6px">
        <div style="color:var(--text2);margin-bottom:3px">受け取る通知の種類</div>
        ${[['chat','チャット（個別・グループ）'],['board','会社からのお知らせ'],['statement','支払明細書の配信']].map(([k,label])=>
          `<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer">
            <input type="checkbox" ${prefs[k] === false ? '' : 'checked'} onchange="toggleNotifyKind('${k}', this)">
            <span>${escHtml(label)}</span>
          </label>`).join('')}
        ${mutedCount ? `<div style="color:var(--text2);margin-top:3px">👥 通知をオフにしているグループ: ${mutedCount}件（グループチャットの一覧から戻せます）</div>` : ''}
      </div>` : ''}
    </div>`;
  }
  els.forEach(el => { el.innerHTML = html; });
}

// 通知をタップして戻ってきたとき、サービスワーカーからの合図で一覧を読み直す
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener?.('message', ev => {
    if (ev.data?.type !== 'push-open') return;
    try { if (me?.role === 'driver') goDrvPage(5, document.getElementById('dnt3')); } catch(e) {}
  });
}
