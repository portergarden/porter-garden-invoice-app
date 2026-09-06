/* PG Base のサービスワーカー。
   役割はプッシュ通知の受け取りだけで、ページやJS/CSSのキャッシュは一切しない。
   （index.html が ?v=ハッシュ で版を管理しているため、ここで横からキャッシュすると
     「直したはずのJSが古いまま動く」事故のもとになる。fetchハンドラは意図的に置かない） */

// 新しいSWを即座に有効化する。古いSWが残っていると通知の仕様変更が反映されないため
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// サーバ（Edge Function web-push）から届いた通知を端末に表示する
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'PG Base';
  /* ホーム画面アイコンの件数を、アプリを開いていなくても更新する。
     アプリ側(setAppBadgeCount)は開いている間しか動かないため、閉じている間はここが担当する。
     件数はサーバが受信者ごとに数えて badge に入れてくる。 */
  if (typeof d.badge === 'number' && self.navigator) {
    try {
      if (d.badge > 0) self.navigator.setAppBadge?.(d.badge);
      else self.navigator.clearAppBadge?.();
    } catch (e) {}
  }
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // 同じ会話の通知は積み上げずに置き換える（連投で通知欄が埋まらないように）
    tag: d.tag || 'pgbase',
    renotify: true,
    data: { url: d.url || './' }
  }));
});

// 通知をタップしたら、既に開いているタブがあればそれを前面に出す。無ければ新しく開く
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (!w.url.startsWith(self.registration.scope)) continue;
      await w.focus();
      // ハッシュだけの移動でも画面を切り替えられるようページ側に伝える
      try { w.postMessage({ type: 'push-open', url: target }); } catch (e) {}
      return;
    }
    await self.clients.openWindow(target);
  })());
});
