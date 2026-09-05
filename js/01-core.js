/* js/01-core.js
   土台。Supabase初期化・ログイン・全体のデータ読み込み・共通ヘルパー・画面切替・請求明細一覧・ドライバー/取引先/利用者の管理・CSV入出力・PDF・ファイル取込

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ===== Supabase初期化 ===== */
let sb=null;
function initSupabase(){
  if(SUPABASE_URL.includes('xxxxxxxxx')||SUPABASE_ANON_KEY.includes('xxxxxxxxx')){
    document.getElementById('setupBanner').classList.remove('hide');
    setConnStatus(false,'未設定 — URLとAPIキーを設定してください');
    return false;
  }
  try{
    sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
    return true;
  }catch(e){
    setConnStatus(false,'接続エラー: '+e.message);
    return false;
  }
}
function setConnStatus(ok,msg){
  const dot=document.getElementById('connDot'),m=document.getElementById('connMsg');
  if(!dot||!m)return;
  dot.className='conn-dot '+(ok?'ok':'err');
  m.textContent=msg;
}
// システム名は「PG Base」で共通、会社名部分は company_settings.name（契約先ごとに異なる）を反映する
// company_settingsはRLSでSELECTも認証済みユーザーのみのため、反映はログイン後（loadCompanySettings内）に行う
function applyBrandName(name){
  const n=(name||'').trim();
  const tbEl=document.getElementById('tbCompanyName');
  if(tbEl)tbEl.textContent=n?` — ${n}`:' — ポーターガーデン';
  document.title=n?`PG Base — ${n}`:'PG Base';
}
async function testConn(){
  if(!sb)return;
  try{
    const{error}=await sb.from('users').select('id').limit(1);
    if(error)throw error;
    setConnStatus(true,'Supabase接続OK');
  }catch(e){
    setConnStatus(false,'接続失敗: '+e.message);
  }
}

/* ===== STATE ===== */
let me=null,taxMode='inc',sortMode='asc',eInvId=null,eDrvId=null,eCliId=null,eUsrId=null;
let pendTags=[],parsedPdf=[],parsedCsv=[],selIds=new Set(),expanded=new Set();
let yrDrvCliFilter=''; // 年報のドライバー別月次実績を取引先で絞り込む際の選択中取引先ID
let dashYearSpan=5; // 全体売上表の表示期間（年数）。'all'で全期間
let dashCompareYear=null;   // 全体売上表の年間合計比較の基準年（未選択時は現在表示中の年）。2020と2026のような任意の年同士を比較できるようにするための選択値
let anaCliCompareYear=null; // 取引先別月次実績の合計比較の基準年（未選択時は前年）
let anaDrvCompareYear=null; // ドライバー別月次実績の合計比較の基準年（未選択時は前年）
let pendOtherDeductions=[]; // ドライバー登録モーダルの「その他の控除項目」編集中リスト（{name, amount}の配列）
let sessionTimer=null,sessionLeft=900;
let users=[],clients=[],drvs=[],recs=[];


/* ===== SESSION ===== */
function startSess(){
  sessionLeft=900;clearInterval(sessionTimer);
  sessionTimer=setInterval(()=>{
    sessionLeft--;
    const el=document.getElementById('sprog');if(el)el.style.width=Math.round(sessionLeft/900*100)+'%';
    if(sessionLeft===60)showT('セッションが1分後に期限切れになります','twa');
    if(sessionLeft<=0){clearInterval(sessionTimer);logout(true);}
  },1000);
  ['click','keydown'].forEach(ev=>document.addEventListener(ev,()=>sessionLeft=900));
}
function stopSess(){clearInterval(sessionTimer);}

/* ===== AUTH ===== */
async function applyLogin(data) {
  me = data;
  // セッション永続化はSupabase Authクライアントが自動的に行う
  document.getElementById('pgLogin').classList.add('hide');
  // 管理画面(pgMain)はdriver以外のロールと確定した場合にのみ表示する。
  // ここで先に表示してしまうと、ドライバーポータル側の表示処理が何らかの理由で失敗した際に
  // 管理画面がそのまま見えてしまう（他ドライバー・他取引先のデータが見える致命的な事故につながる）ため、
  // ロール確定前は絶対に表示しない
  if (me.role !== 'driver') {
    const mp = document.getElementById('pgMain'); mp.classList.remove('hide'); mp.style.display = 'flex';
    document.getElementById('tbName').textContent = me.name;
    const rn = me.role==='admin'?'管理者':me.role==='editor'?'編集者':'閲覧者';
    const rc = me.role==='admin'?'ad':me.role==='editor'?'ed':'vi';
    document.getElementById('tbBdg').innerHTML = `<span class="bdg ${rc}">${rn}</span>`;
    if (me.role==='admin') { document.getElementById('nt4').classList.remove('hide'); document.getElementById('nt5').classList.remove('hide'); }
    const canEd = me.role !== 'viewer';
    ['bAdd','bAddD','bAddC','bCliParentDetect','bAddVehicle','bImportCars','bDrvInvite','bBulkChat','bpAddBtn'].forEach(bid => { const el=document.getElementById(bid); if(el) el.classList.toggle('hide',!canEd); });
  }
  startSess();
  await loadAll();
  // 初期パスワードのまま(must_change_password)の場合は、変更が完了するまでここで止める。
  // 変更完了後はsubmitForcePwChange()からproceedAfterLogin()を呼んで続きを行う
  if (me.must_change_password) {
    document.getElementById('mForcePw').classList.add('on');
    return;
  }
  proceedAfterLogin();
}

function proceedAfterLogin() {
  // ドライバーロールの場合はポータル画面に切替。ここで例外が起きた場合、
  // 以前は「フォールバックとして管理画面(pgMain)を表示する」実装になっていたが、
  // これだとドライバーに他ドライバー・他取引先のデータが見える管理画面がそのまま表示されてしまう
  // 致命的な事故になるため、絶対に管理画面は表示しない。失敗時は安全側に倒してログアウトする
  if (me.role === 'driver') {
    try {
      // usersテーブルのdriver_idからドライバー情報を解決（ポータルの日報・明細表示に使用）
      if (me.driver_id && !me.driver_data) me.driver_data = drvs.find(d => d.id === me.driver_id) || null;
      applyDriverPortal();
    } catch(e) {
      console.error('applyDriverPortal failed:', e);
      showT('画面の表示に失敗しました。お手数ですがもう一度ログインしてください: ' + e.message, 'ter');
      logout();
    }
    // 未配車・未確認請求書の通知は管理者向けのため、ドライバーには出さない
    // LINE連携案内バナー（友だち追加URLはcompany_settingsから取得するため、読み込み後に描画）
    loadCompanySettings().then(()=>renderDrvLineBanner()).catch(()=>{});
    return;
  }
  const savedPage = getSavedHistoryPage('ppage');
  const savedTab = savedPage !== null ? document.querySelector(`.ntab[onclick="goPage(${savedPage},this)"]`) : null;
  // 復元は「そのタブが現在の権限で表示されている」場合のみ行う。
  // 例: 前セッションが管理者でpg5(ユーザー管理)にいた後、同じブラウザで閲覧者がログインしても
  // 管理者専用タブの画面枠が復元されないよう、非表示タブへの復元は既定ページに倒す
  if (savedPage !== null && document.getElementById('pg'+savedPage) && savedTab && !savedTab.classList.contains('hide')) {
    _skipHistoryPush = true;
    try { goPage(savedPage, savedTab); }
    finally { _skipHistoryPush = false; }
  } else {
    goPage(1, document.getElementById('nt1'));
  }
  restoreStmtIssueDate();
  setTimeout(()=>{ checkDailyReportMissing().catch(()=>{}); }, 2000);
  setTimeout(()=>loadCompanySettings().catch(()=>{}), 2500);
  setTimeout(()=>ensureLineLinkCodes().catch(()=>{}), 3000); // 既存ドライバーのLINE連携コードを不足分だけ発行
}

// 初期パスワードのまま初回ログインした場合の強制変更モーダル。自分自身のパスワード変更なのでSupabase Authのupdateuserをそのまま使える（管理者権限は不要）
async function submitForcePwChange() {
  const pw1 = document.getElementById('fpwNew').value;
  const pw2 = document.getElementById('fpwConfirm').value;
  const errEl = document.getElementById('fpwErr');
  errEl.textContent = '';
  // 公開URLになり総当たりのリスクが上がったため8文字以上を必須にする
  if (pw1.length < 8) { errEl.textContent = '8文字以上で入力してください'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'パスワードが一致しません'; return; }
  showLoad(true);
  try {
    const { error } = await sb.auth.updateUser({ password: pw1 });
    if (error) throw error;
    // usersテーブルのUPDATEはRLSでadmin専用のため、直接updateすると0行更新で静かに失敗し
    // 毎回パスワード変更を強制され続けるバグになる。本人専用のSECURITY DEFINER RPCでフラグを消す
    const { error: uErr } = await sb.rpc('clear_own_password_flag');
    if (uErr) throw uErr;
    me.must_change_password = false;
    document.getElementById('mForcePw').classList.remove('on');
    document.getElementById('fpwNew').value = '';
    document.getElementById('fpwConfirm').value = '';
    showT('パスワードを変更しました');
    proceedAfterLogin();
  } catch(e) { errEl.textContent = '変更エラー: ' + e.message; }
  showLoad(false);
}

// 本人が任意のタイミングでパスワードを変更する（強制変更モーダルと異なり閉じてキャンセルできる）。
// 管理者以外（編集者・閲覧者・ドライバー）も含め全ロールが対象。ユーザー管理は自分の行の編集ボタンを
// あえて非表示にしているため（誤操作で自分のIDや権限を変えてしまう事故を防ぐ目的）、
// パスワードだけを変更する経路がユーザー管理タブ以外に無かった
function openChangePwM() {
  document.getElementById('cpwNew').value = '';
  document.getElementById('cpwConfirm').value = '';
  document.getElementById('cpwErr').textContent = '';
  document.getElementById('mChangePw').classList.add('on');
}
async function submitChangePw() {
  const pw1 = document.getElementById('cpwNew').value;
  const pw2 = document.getElementById('cpwConfirm').value;
  const errEl = document.getElementById('cpwErr');
  errEl.textContent = '';
  if (pw1.length < 8) { errEl.textContent = '8文字以上で入力してください'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'パスワードが一致しません'; return; }
  showLoad(true);
  try {
    const { error } = await sb.auth.updateUser({ password: pw1 });
    if (error) throw error;
    closeM('mChangePw');
    showT('パスワードを変更しました');
  } catch(e) { errEl.textContent = '変更エラー: ' + e.message; }
  showLoad(false);
}

// Supabaseが無料プランで自動バックアップが無いため、手動バックアップ（backupAllData）の実行間隔が
// 空きすぎていないかをブラウザのlocalStorageで簡易チェックする（この端末で行った最終バックアップ日時のみ把握）
const BACKUP_REMINDER_DAYS = 14;
function checkBackupReminder() {
  const lastAt = localStorage.getItem('pgbase_last_backup_at');
  if (!lastAt) return '💾 この端末からのバックアップ記録がありません（セットアップタブから作成できます）';
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000);
  if (days >= BACKUP_REMINDER_DAYS) return `💾 最終バックアップから${days}日経過しています（セットアップタブから作成してください）`;
  return null;
}

async function tryAutoLogin() {
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data, error } = await sb.from('users').select('*').eq('auth_uid', session.user.id).single();
    if (error || !data) return;
    await applyLogin(data);
    await addLog('自動ログイン', `${data.name}が自動ログイン`);
  } catch(e) {}
}

async function login(){
  const id=document.getElementById('lid').value.trim(),pw=document.getElementById('lpw').value;
  if(!id||!pw){document.getElementById('lerr').textContent='IDとパスワードを入力してください';return;}
  if(!sb){document.getElementById('lerr').textContent='Supabaseが未設定です';return;}
  showLoad(true);
  try{
    // ① Supabase Authで認証（IDを内部的にダミーメールへ変換して照合）
    const{data:authData,error:authErr}=await sb.auth.signInWithPassword({email:id+'@internal.local',password:pw});
    if(!authErr && authData?.user){
      const{data:uData,error:uErr}=await sb.from('users').select('*').eq('auth_uid',authData.user.id).single();
      if(!uErr && uData){
        document.getElementById('lerr').textContent='';
        await addLog('ログイン',`${uData.name}がログイン`);
        await applyLogin(uData);
        showLoad(false); return;
      }
    }
    // ドライバーもusersテーブル（role='driver'＋driver_id）で認証する。applyLogin側でポータルに振り分けられる
    document.getElementById('lerr').textContent='IDまたはパスワードが違います';
  }catch(e){document.getElementById('lerr').textContent='エラー: '+e.message;}
  showLoad(false);
}
async function logout(exp=false){
  if (!exp && !confirm('ログアウトしますか？')) return;
  stopSess();
  unsubscribeDrvChatRealtime();
  document.body.classList.remove('drv-lock');
  if(me)await addLog('ログアウト',exp?'セッション期限切れ':`${me.name}がログアウト`);
  me=null;selIds=new Set();recs=[];clients=[];drvs=[];users=[];invalidateDriverIndexes();
  // ドライバーポータル・管理画面のどちらも必ず非表示のままにする。
  // 以前はここで管理画面(pgMain)を一度表示してからsignOut後に隠す実装になっており、
  // signOut()中（ネットワーク遅延やエラー時）に管理画面が見えてしまう致命的な不具合があったため、
  // 管理画面は一切表示せずに非表示のまま維持する
  const portal=document.getElementById('pgDriver');
  if(portal){portal.classList.add('hide');portal.style.display='none';}
  const mainPg=document.getElementById('pgMain');
  if(mainPg){mainPg.classList.add('hide');mainPg.style.display='none';}
  try { await sb.auth.signOut(); } catch(e) { console.warn('signOut error:', e.message); }
  document.getElementById('pgLogin').classList.remove('hide');
  document.getElementById('lpw').value='';
  document.getElementById('nt4').classList.add('hide');document.getElementById('nt5').classList.add('hide');
  if(exp)showT('セッションが期限切れになりました','ter');
}

/* ===== DATA LOAD ===== */
/* PostgRESTは1回の応答を最大1000行に切る（Supabaseの既定値）。
   .select()の結果をそのまま使うと1001行目以降がエラーも出さずに落ち、
   件数が増えたある日から古い月のデータが画面に出なくなる。
   実際、請求データが1894件になった時点で新しい方の999件しか読めなくなっていた。
   1000件ずつ .range() で読み継いで全件そろえる。
   buildは呼ぶたびに新しいクエリを返すこと（PostgRESTのクエリは使い回せないため）。
   並べ替えのキーが重複しうるときは、ページの境目で行が重複・欠落しないよう
   呼び出し側でidなど一意なキーを第2キーに足しておく。 */
const PGRST_PAGE = 1000;
async function fetchAllRows(build) {
  let out = [], from = 0;
  for (;;) {
    const {data, error} = await build().range(from, from + PGRST_PAGE - 1);
    if (error) return {data: null, error};
    out = out.concat(data || []);
    if (!data || data.length < PGRST_PAGE) return {data: out, error: null};
    from += PGRST_PAGE;
  }
}
async function loadAll(){
  showLoad(true);
  // ドライバーは他ドライバーの請求・取引先・協力会社・銀行口座等の全社データを一切必要としない
  // （RLSでも自分の分しか読めない）。フル読み込み(recs/clients/users等の全件取得、
  // 計10回のSupabase往復)をそのまま流用するとログインのたびに無駄な通信が発生し体感速度が悪化するため、
  // ドライバーは自分の1件だけを取得して即座に終える
  if (me?.role === 'driver') {
    try {
      if (me.driver_id) {
        const {data, error} = await sb.from('drivers').select('*').eq('id', me.driver_id).single();
        if (error) throw error;
        drvs = data ? [data] : [];
      } else {
        drvs = [];
      }
      invalidateDriverIndexes();
    } catch(e) { showT('データ読み込みエラー: '+e.message,'ter'); }
    showLoad(false);
    return;
  }
  try{
    // 1000件を超えても全件読む。日付は同じ値が並ぶのでidを第2キーにして境目をずらさない
    const[invRes,drvRes,cliRes,usrRes]=await Promise.all([
      fetchAllRows(()=>sb.from('invoices').select('*').order('date',{ascending:false}).order('id',{ascending:false})),
      fetchAllRows(()=>sb.from('drivers').select('*').order('name').order('id')),
      fetchAllRows(()=>sb.from('clients').select('*').order('name').order('id')),
      fetchAllRows(()=>sb.from('users').select('*').order('id')),
    ]);
    if (invRes.error) throw invRes.error;
    recs=(invRes.data||[]).map(r=>({...r,hw:r.hw||0,oth:r.oth||0}));
    drvs=drvRes.data||[];
    invalidateDriverIndexes();
    clients=cliRes.data||[];
    users=usrRes.data||[];
    rebuildCliFilter();
  }catch(e){showT('データ読み込みエラー: '+e.message,'ter');}
  showLoad(false);
  // 個別読込（テーブル未作成でもloadAll全体を止めない）
  await Promise.all([loadSched(), loadTemplates(), loadMappings(), loadVehicleAssignments(), loadVehicles(), loadPayAdjustments()]);
}
let logRoleFilter = 'staff';
async function loadLogs(){
  const la=document.getElementById('logArea');if(!la)return;
  const kw = document.getElementById('logSearchKw')?.value.trim().toLowerCase() || '';
  const who = document.getElementById('logSearchWho')?.value.trim() || '';
  const from = document.getElementById('logSearchFrom')?.value || '';
  const to = document.getElementById('logSearchTo')?.value || '';
  const hasFilter = kw || who || from || to;
  const labelEl = document.getElementById('logAreaLabel');
  const roleLabel = logRoleFilter==='driver' ? 'ドライバー操作' : logRoleFilter==='staff' ? 'スタッフ操作' : '全操作';
  if (labelEl) labelEl.textContent = hasFilter ? `検索結果（${roleLabel}・最大500件）` : `${roleLabel}履歴（最新100件）`;
  try{
    let q = sb.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(hasFilter?500:100);
    if (who) q = q.ilike('who', `%${who}%`);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', to+'T23:59:59');
    if (logRoleFilter === 'driver') q = q.eq('role', 'driver');
    else if (logRoleFilter === 'staff') q = q.or('role.neq.driver,role.is.null');
    const{data,error}=await q;
    if (error) throw error;
    let rows = data||[];
    if (kw) rows = rows.filter(l=>(l.action||'').toLowerCase().includes(kw)||(l.detail||'').toLowerCase().includes(kw));
    if(!rows.length){la.innerHTML=`<div style="color:var(--text2);font-size:11px;padding:10px 0">${hasFilter?'該当するログがありません':'操作ログがありません'}</div>`;return;}
    la.innerHTML=rows.map(l=>`<div class="lrow"><div class="ltime">${escHtml(l.ts)}</div><div class="lwho">${escHtml(l.who||'—')}</div><div style="flex:1">${escHtml(l.action)}: <span style="color:var(--text2)">${escHtml(l.detail||'')}</span></div></div>`).join('');
  }catch(e){la.innerHTML='<div style="color:var(--text2);font-size:11px;padding:10px 0">ログ読み込みエラー</div>';}
}
function setLogRoleFilter(role){
  logRoleFilter = role;
  const map = {logRoleStaff:'staff', logRoleDriver:'driver', logRoleAll:''};
  Object.keys(map).forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const active = map[id] === role;
    el.style.background = active ? 'var(--blue)' : 'transparent';
    el.style.color = active ? '#fff' : 'var(--text)';
    el.style.fontWeight = active ? 'bold' : 'normal';
  });
  loadLogs();
}
function clearLogSearch(){
  ['logSearchKw','logSearchWho','logSearchFrom','logSearchTo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  loadLogs();
}
async function addLog(action,detail){
  if(!sb)return;
  // 操作者名(who)・役割(role)・時刻(ts)はサーバ側RPCが auth.uid() から確定する（クライアントからの偽装を防止）
  try{await sb.rpc('add_audit_log',{p_action:action,p_detail:detail??''});}catch(e){}
}

/* ===== HELPERS ===== */
// 受注種別（type列）: regular=定期集配・charter=チャーター・スポット便・それ以外はすべて「その他」扱い
const TYPE_META={
  regular:{label:'定期集配(個人・企業)',short:'定期集配',badge:'re'},
  charter:{label:'チャーター・スポット便',short:'チャーター',badge:'ch'},
  other:{label:'その他',short:'その他',badge:'ot'},
};
const typeLabel=t=>(TYPE_META[t]||TYPE_META.other).label;
const typeShort=t=>(TYPE_META[t]||TYPE_META.other).short;
const typeBadge=t=>(TYPE_META[t]||TYPE_META.other).badge;
const nm=s=>(s||'').replace(/\s/g,'').replace(/[０-９Ａ-Ｚａ-ｚ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
// 車番→ドライバー・ID→ドライバーの索引（drvsが変わるたびinvalidateDriverIndexes()でnullに戻し、
// 次回lkD/recDrv呼び出し時に再構築する）。件数が多いページ（明細一覧・ドライバー一覧等）で
// 行ごとにdrvs.find()の線形探索を繰り返す(O(件数×ドライバー数))のを避け、体感速度を上げるため
let _carDriverIndex = null, _idDriverIndex = null, _tailDrvIndex = null, _tailCarIndex = null;
function invalidateDriverIndexes() { _carDriverIndex = null; _idDriverIndex = null; _tailDrvIndex = null; _tailCarIndex = null; }
// フル表記車番（例: 仙台480あ2224）の末尾の一連指定番号（1〜4桁）を取り出す。
// コムトラック等から取り込む実績は略式番号（2224）だけのことがあるため、突き合わせに使う
const carTailNumber = car => { const m = nm(car).match(/(\d{1,4})$/); return m ? m[1] : null; };
// 解約済みドライバーを除いた一覧。今後の選択・新規登録が不要な画面（月報・カレンダー・各種プルダウン等）で使う
function activeDrvs() { return drvs.filter(d => d.status !== 'terminated'); }
function driverIndexes() {
  if (!_carDriverIndex) {
    _carDriverIndex = new Map();
    _idDriverIndex = new Map();
    _tailDrvIndex = new Map();  // 末尾番号 → ドライバー（複数の車・人で重複する場合はnull＝特定不能）
    _tailCarIndex = new Map();  // 末尾番号 → フル表記車番（同上）
    drvs.forEach(d => {
      _idDriverIndex.set(d.id, d);
      (d.cars||[]).forEach(c => {
        const n = nm(c);
        if (!_carDriverIndex.has(n)) _carDriverIndex.set(n, d);
        // フル表記だけを登録している車を、略式番号の実績から引けるようにする。
        // ただし末尾番号が他の車と重複する場合は誤って紐づけないようnullにして「特定不能」にする
        if (!isFullPlateNumber(c)) return;
        const t = carTailNumber(c);
        if (!t) return;
        if (_tailDrvIndex.has(t)) {
          const pd = _tailDrvIndex.get(t), pc = _tailCarIndex.get(t);
          if (pd && pd.id !== d.id) _tailDrvIndex.set(t, null);
          if (pc && nm(pc) !== n) _tailCarIndex.set(t, null);
        } else {
          _tailDrvIndex.set(t, d);
          _tailCarIndex.set(t, c);
        }
      });
    });
  }
  return { car: _carDriverIndex, id: _idDriverIndex, tailDrv: _tailDrvIndex, tailCar: _tailCarIndex };
}
// 車番からドライバーを引く。完全一致で見つからず、かつ数字のみの略式番号なら、
// フル表記車番の末尾番号とも突き合わせる（フル表記だけ登録している場合に対応）
const lkD=car=>{
  const n=nm(car);
  const idx=driverIndexes();
  const hit=idx.car.get(n);
  if(hit) return hit;
  return /^\d+$/.test(n) ? (idx.tailDrv.get(n)||null) : null;
};
// 略式車番（数字のみ）を、紐づくドライバーのフル表記車番に変換する（表示・集計の見た目をフル表記に統一するため）。
// フル表記自体やフル表記が見つからない車（代車など）はそのまま返す
const canonicalCar=car=>{
  if(!car) return car;
  const n=nm(car);
  if(!/^\d+$/.test(n)) return car;
  // 末尾番号が一致するフル表記が一意に決まる場合だけ変換する。
  // （旧実装はドライバーの「最初のフル表記車番」を返していたため、複数台持つドライバーで別の車に化けていた）
  return driverIndexes().tailCar.get(n) || car;
};
const lkC=id=>clients.find(c=>c.id===id)||null;
// コムトラック等の「車番＋氏名」が1セルに入った値を車番と氏名に分ける。
// 帳票によって「8467 大沼凌」のようにスペース区切りのものと、「9117山本健太郎」のように
// 区切りが無いものが混在するため、スペースだけに頼らず車番の形からも切り出す。
// （スペース無しの場合に全体を車番とみなしてしまい、どのドライバーにも照合できず
//   仕入先IDが請求書Noにフォールバックしてしまう不具合があったため）
function splitCarInfoCell(carVal) {
  const s = String(carVal || '').trim();
  if (!s) return { carNum: '', drvName: '' };
  // ① スペース区切りがあればそれを優先（例:「8467 大沼凌」「仙台480り9567 佐藤」）
  const sp = s.match(/^([^\s　]+)[\s　]+(.*)$/);
  if (sp) return { carNum: sp[1], drvName: sp[2].trim() };
  // ② 区切り無しでフル表記車番が先頭にある場合（例:「仙台480り9117山本健太郎」）
  const full = s.match(/^(\D{1,5}\d{1,3}[ぁ-んァ-ヶ]\d{1,4})(.+)$/);
  if (full) return { carNum: full[1], drvName: full[2].trim() };
  // ③ 区切り無しで略式車番（数字）が先頭にある場合（例:「9117山本健太郎」）
  const lead = s.match(/^(\d{1,4})(\D.*)$/);
  if (lead) return { carNum: lead[1], drvName: lead[2].trim() };
  return { carNum: s, drvName: '' };
}
// 「車番＋氏名」セルの氏名部分からドライバーを特定する。
// 車番では引かない（コムトラックから引き継いだ車番は解約者分も残っていて同じ車番が複数人に
// 登録されているため、車番で引くと別人に紐づいてしまう）
function lkDByCarCellName(carVal) {
  const { drvName } = splitCarInfoCell(carVal);
  return drvName ? lkDByName(drvName) : null;
}
// 入力された車番が他のドライバーにも登録されていないか確認する（管理側のドライバー登録・編集用）。
// 同じ車番が複数人に付いていると車番からドライバーを特定できなくなるため注意を促すが、
// 1台を交代で使う運用が実在するので保存自体は止めず、続行するかを選べるようにする。
// 続行してよければtrueを返す
function confirmDuplicateCars(cars, selfId) {
  const hits = [];
  (cars || []).forEach(c => {
    const nc = nm(c);
    if (!nc || nc.includes('----')) return; // プレースホルダー車番は対象外
    drvs.forEach(d => {
      if (d.id === selfId) return;
      if ((d.cars || []).some(x => nm(x) === nc)) {
        hits.push(`・${c} → ${d.name}（ID:${d.supplier_id || '未設定'}${d.status === 'terminated' ? '・解約済み' : ''}）`);
      }
    });
  });
  if (!hits.length) return true;
  return confirm(
    `次の車番は既に他のドライバーに登録されています。\n\n${hits.join('\n')}\n\n` +
    `1台を交代で使用している場合はこのまま保存できます。\n` +
    `解約したドライバーの登録が残っている場合は、そちらの車番を外してください。\n\n` +
    `このまま保存しますか？`
  );
}
// 氏名の異体字を代表字に寄せる（北﨑→北崎、髙橋→高橋 など）。
// 支払明細書の宛名とドライバー登録名で異体字が食い違うことがあるため、氏名照合の最終手段に使う
const KANJI_VARIANTS = {'﨑':'崎','嵜':'崎','髙':'高','濵':'浜','濱':'浜','邊':'辺','邉':'辺','齋':'斎','齊':'斎','斉':'斎','冨':'富','廣':'広','惠':'恵','槇':'槙','瀨':'瀬','德':'徳','栁':'柳','眞':'真','曾':'曽'};
const nmv = s => nm(s).replace(/[﨑嵜髙濵濱邊邉齋齊斉冨廣惠槇瀨德栁眞曾]/g, c => KANJI_VARIANTS[c] || c);
const isCorpName = s => /株式会社|有限会社|合同会社|（株）|\(株\)/.test(s || '');
// 支払明細書の宛名からドライバーを特定する。
// 宛名は「大沼　凌」だけでなく「グリーンドライブ株式会社（中野　圭）」「D-FORS株式会社　工藤将真」
// 「杉浦　芙美子(岩手支社)Logi TreX」のように会社名・支社名が併記されることがあるため、
// 登録名が宛名に含まれるドライバーを探し、会社名より個人名を優先する。
// 車番は同じ番号が複数人に登録されていたり実際の乗務車両と食い違ったりするのに対し、
// 宛名は明細書1枚につき1人で確実なため、取込時のドライバー特定はこちらを最優先にする
function lkDByName(text) {
  if (!text) return null;
  for (const norm of [nm, nmv]) {
    const t = norm(text);
    if (!t) continue;
    const cands = [];
    drvs.forEach(d => {
      const n = norm(d.name);
      if (!n) return;
      const pos = t.indexOf(n);
      if (pos >= 0) cands.push({ d, n, pos });
    });
    if (!cands.length) continue;
    cands.sort((a, b) =>
      ((b.n === t) - (a.n === t))                                            // 宛名そのものと完全一致
      || ((isCorpName(a.d.name) ? 1 : 0) - (isCorpName(b.d.name) ? 1 : 0))   // 会社名より個人名
      || (a.pos - b.pos)                                                     // 宛名の先頭に近い方
      || (b.n.length - a.n.length)                                           // 長い（＝具体的な）名前
      || ((a.d.status === 'terminated') - (b.d.status === 'terminated'))     // 稼働中を優先
      || (a.d.id - b.d.id)
    );
    return cands[0].d;
  }
  return null;
}

/* ===== 車両乗務履歴（vehicle_assignments）による日付つきのドライバー判定 =====
   代車や車両の乗り換えのように「同じ車番でも時期によって乗務者が変わる」ケースに対応する。
   drivers.cars（静的な登録車番）だけで判定すると、代車の売上が車両の本来の持ち主に付いたり、
   どのドライバーにも紐づかず「未配車」になったりするため、車両管理タブの乗務履歴を優先して引く。 */
let _vaCarIndex = null;
function invalidateVehicleAssignIndex() { _vaCarIndex = null; }
function vehicleAssignIndex() {
  if (!_vaCarIndex) {
    _vaCarIndex = new Map();
    const push = (k, v) => { if (!_vaCarIndex.has(k)) _vaCarIndex.set(k, []); _vaCarIndex.get(k).push(v); };
    (vehicleAssignments||[]).forEach(v => {
      if (!v.car || v.driver_id == null) return;
      const k = nm(v.car);
      push(k, v);
      // 履歴をフル表記で登録し、実績が略式番号（またはその逆）のケースでも引けるようにする
      const t = carTailNumber(v.car);
      if (t && t !== k) push(t, v);
    });
    // 期間が重なって登録されていた場合に備え、開始日が新しいものから評価する
    _vaCarIndex.forEach(list => list.sort((a,b)=>(b.start_date||'').localeCompare(a.start_date||'')));
  }
  return _vaCarIndex;
}
// その車番に、その日付時点で乗務していたドライバーを引く（end_date未設定＝現在も使用中）
function lkDByAssign(car, date) {
  if (!car || !date) return null;
  const idx = vehicleAssignIndex();
  const n = nm(car);
  let list = idx.get(n);
  if (!list) { const t = carTailNumber(car); if (t) list = idx.get(t); }
  if (!list) return null;
  const d = String(date).slice(0,10);
  const hits = list.filter(v => (v.start_date||'') <= d && (!v.end_date || d <= v.end_date));
  if (!hits.length) return null;
  // 末尾番号の重複などで複数のドライバーが該当する場合は、誤判定を避けて特定しない
  if (new Set(hits.map(h=>h.driver_id)).size > 1) return null;
  return driverIndexes().id.get(hits[0].driver_id) || null;
}
// 同じ車両を複数人で稼働することがあるため、次の優先順位で判定する:
// ① レコードのdrv_id（受注入力での手動選択）② 車両乗務履歴（代車・乗り換え）③ drivers.carsの登録車番
const recDrv=r=>(r.drv_id!=null && driverIndexes().id.get(r.drv_id)) || lkDByAssign(r.car, r.date) || lkD(r.car);
// 取引先ID・ドライバーIDの新規登録時の自動採番（既存の最大値+1。数値以外は無視）
function nextIdFor(list, field) {
  // 「147-3」のような枝番つきIDは本体の147として数える（枝番ぶんで採番が飛ばないように）
  const nums = list.map(x => parseInt(String(x[field]||'').split('-')[0], 10)).filter(n => !isNaN(n));
  return nums.length ? String(Math.max(...nums) + 1) : '1';
}
// 四捨五入（JSのMath.roundは負数の.5をゼロ側に丸めてしまうため、絶対値で丸めてから符号を戻す本来の四捨五入に統一）
function roundHalfUp(n) {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}
// 消費税額の端数処理。既定は四捨五入だが、取込元（取引先）が切り捨てで計算している場合はr.tax_round='floor'を
// レコードに保存しておくことで、その明細だけ切り捨てに切り替えられる（他の取引先・手入力分の四捨五入は変わらない）
const applyTaxRound = (n, r) => (r && r.tax_round === 'floor') ? Math.floor(n) : roundHalfUp(n);
const sub=r=>(r.fare||0)+(r.hw||0)+(r.oth||0);
// 取込元（取引先）の明細書に記載されている消費税額をそのまま採用する（tax_amount）。
// 自前で再計算すると相手側の端数処理方式（インボイス単位でまとめて丸める等）と一致しないことがあるため、
// 記載値がある場合はそれを優先し、無い場合のみ運賃等から自前で計算する。
const rtax=r=>(r.tax_amount!=null) ? r.tax_amount : applyTaxRound(sub(r)*((r.tax??10))/100, r);
const totR=(r,m)=>m==='inc'?sub(r)+rtax(r):sub(r);
const yen=n=>'¥'+Math.round(n).toLocaleString();
// innerHTML/document.writeに埋め込む前にユーザー入力（乗務員の自由記入欄など）をエスケープする共通ヘルパー。
// 低権限（ドライバー）が入力した文字列が高権限（管理者）セッションのDOM/印刷ウィンドウで実行されるのを防ぐ
const escHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* onclick="f('${...}')" のように、HTML属性の中に置いたJS文字列リテラルへ値を入れるとき用。
   HTMLパーサは属性値の文字参照をJSへ渡す前に復号するため、順序が重要になる。
   先にJS用（バックスラッシュ・アポストロフィ・改行）を潰し、そのうえでHTML属性用にエスケープする。
   escHtml(x).replace(/'/g,"\\'") と書くと、escHtmlが先に ' を &#39; へ変えるので
   replaceの対象が1文字も残らず何も起きない。復号時に ' が戻ってJS文字列を脱出できてしまう。
   属性値そのもの（title= や data-= など）に入れるだけなら escHtml で足りる。 */
const escAttrJs=s=>escHtml(String(s??'').replace(/[\\'\r\n]/g,c=>({'\\':'\\\\',"'":"\\'",'\r':'\\r','\n':'\\n'}[c])));
/* CSVのセルをExcelの数式として解釈させないための保険。
   = + - @ タブ 復帰 で始まるセルはExcelが数式として評価する。
   ドライバーが日報の特記事項に =HYPERLINK("https://…"&A1,"クリック") と書いておくと、
   管理者がCSVを開いてリンクを踏んだ時点で行データが外部へ送られる。
   ダブルクォートで囲っても評価前に引用符が剥がされるため、先頭に ' を足して文字列に固定する。
   -1000 のような数値まで壊さないよう、数値として読める文字列は素通しする。 */
const csvSafe = v => {
  if (typeof v === 'number') return String(v);
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
};
// 社印画像の傾き（度）。会社設定で調整可能。未設定時は従来の見た目に合わせた既定値-4度
const hankoStampRotationDeg=()=>{const v=(companySettings||{}).stamp_rotation_deg;return (v===null||v===undefined)?-4:v;};
// 社印画像の大きさ（px）。会社設定で調整可能。未設定時は従来の見た目に合わせた既定値64px
const hankoStampSizePx=()=>{const v=(companySettings||{}).stamp_size_px;return (v===null||v===undefined)?64:v;};
// 検索・絞り込み欄は1文字打つたびに一覧全体を再描画すると入力がカクつくため、
// 入力が止まってから短い間隔をおいて再描画する（連続入力中の再描画回数を減らす）
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
/* ===== 選択肢の多いプルダウンを「入力して絞り込み」できるようにする =====
   ドライバー・取引先・協力会社など数十〜数百件になりうるselectだけを対象にする
   （ステータスや税区分など数択の固定項目は素のselectのままにする）。
   既存のselect要素はDOM上に残したまま非表示にし、その場で見た目そっくりの
   検索入力欄を重ねて表示する。既存コードのonchangeハンドラ・.value取得/設定は
   一切変更せずそのまま動く（selが「本体」であることは変えていないため）。
   selのoptionsが後から動的に書き換えられる（populate関数の再実行）ケースが
   ほとんどのため、呼び出し側は再描画のたびにこの関数を呼び直せばよい
   （dataset.searchEnhancedで二重ラップを防いでいるので、既にラップ済みなら
   何もしない）。 */
function enhanceSelectSearchable(selectId) {
  const sel = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
  if (!sel || sel.tagName !== 'SELECT' || sel.multiple) return;
  if (sel.dataset.searchEnhanced) { sel._syncSearchInput?.(); return; }
  sel.dataset.searchEnhanced = '1';

  // 幅はCSSのcascade任せにせず、置き換え前のselectの実測幅(px)をそのまま引き継ぐ。
  // flexコンテナ内など「100%」が意図通りに解決しない文脈が多く、% 指定だと極端に潰れることがあるため
  const measuredWidth = sel.offsetWidth || parseInt(sel.style.width, 10) || 140;
  // display:noneにする前に元のstyle文字列を保持しておく（後でinputへコピーするため。
  // 先に非表示にしてからコピーすると「display: none」ごとinputに引き継がれ、
  // inputまで一緒に消えてしまう不具合があった）
  const selStyle = sel.getAttribute('style') || '';
  const wrap = document.createElement('span');
  wrap.style.cssText = `position:relative;display:inline-block;vertical-align:middle;width:${measuredWidth}px`;
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = '入力して絞り込み…';
  // 元のselectと見た目を揃える（枠線・余白・背景など既存のCSSクラス/styleをそのまま流用）。
  // display:を末尾で明示的に上書きし、コピー元に何が入っていても必ず表示されるようにする
  input.className = sel.className;
  input.setAttribute('style', selStyle + ';width:100%;box-sizing:border-box;cursor:text;display:inline-block');
  wrap.appendChild(input);

  const list = document.createElement('div');
  list.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:60;background:var(--bg);border:0.5px solid var(--border2);border-radius:var(--radius);max-height:240px;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,0.18);margin-top:2px';
  wrap.appendChild(list);

  const optData = () => [...sel.options].map((o,i) => ({value:o.value, text:o.textContent, disabled:o.disabled, idx:i}));
  const syncInput = () => { const o = sel.options[sel.selectedIndex]; input.value = o ? o.textContent : ''; };
  sel._syncSearchInput = syncInput;

  function renderList(filterText) {
    const q = nm(filterText || '');
    const items = optData().filter(o => !o.disabled && (!q || nm(o.text).includes(q)));
    if (!items.length) { list.innerHTML = '<div style="padding:6px 8px;font-size:12px;color:var(--text2)">該当なし</div>'; list.style.display = 'block'; return; }
    // 候補が多すぎると描画が重いので表示は絞るが、切ったことを最後に伝える（黙って消さない）
    const shown = items.slice(0, 300);
    list.innerHTML = shown.map(o =>
      `<div data-idx="${o.idx}" style="padding:6px 8px;font-size:12px;cursor:pointer;${o.idx===sel.selectedIndex?'background:var(--blue-bg)':''}">${escHtml(o.text)}</div>`
    ).join('')
      + (items.length > shown.length
          ? `<div style="padding:6px 8px;font-size:11px;color:var(--amber-text);background:var(--amber-bg)">ほか${items.length - shown.length}件。文字を入力して絞り込んでください</div>`
          : '');
    list.style.display = 'block';
  }
  function choose(idx) {
    sel.selectedIndex = idx;
    syncInput();
    list.style.display = 'none';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }
  input.addEventListener('focus', () => { input.select(); renderList(''); });
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { list.style.display = 'none'; syncInput(); input.blur(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('[data-idx]');
      if (first) choose(+first.dataset.idx);
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; syncInput(); }, 150));
  list.addEventListener('mousedown', (e) => {
    const item = e.target.closest('[data-idx]');
    if (!item) return;
    e.preventDefault();
    choose(+item.dataset.idx);
  });
  // 元のselectに対して他コードがsel.value='x'のように直接代入した場合も表示に反映させる
  const nativeDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return nativeDesc.get.call(sel); },
    set(v) { nativeDesc.set.call(sel, v); syncInput(); }
  });
  syncInput();
}
const renderInvDebounced = debounce(() => renderInv(), 200);
const renderPayTableDebounced = debounce(() => renderPayTable(), 200);
const renderDrvDebounced = debounce(() => renderDrv(), 200);
const renderCliDebounced = debounce(() => renderCli(), 200);
const renderVehiclesDebounced = debounce(() => renderVehicles(), 200);
const renderChatTabDrvListDebounced = debounce(() => renderChatTabDrvList(), 200);
// 支払明細書（side='payment'）では pay_fare/pay_hw/pay_oth が設定されていればそれを優先する
// （受注入力で請求額と別に支払額を個別調整できるため。0/未設定なら請求側の値にフォールバック）
const payOr=(r,payField,rawField)=>(r[payField]!=null && r[payField]!==0) ? r[payField] : (r[rawField]||0);
const fareBySide=(r,side)=>side==='payment' ? payOr(r,'pay_fare','fare') : (r.fare||0);
// 高速代を支払側で立替（advance）に振り替え済みの行は、支払側の基本高速代を0として扱う
// （payOrは pay_hw===0 を「未設定」とみなし請求側hwへフォールバックしてしまうため、
//  0を代入するのではなくextra_feesの replaces:'hw' マーカーで明示的に判定する）
const hwReplacedBySide=(r,side)=>side==='payment' && (r.extra_fees||[]).some(f=>f.applies===side&&f.replaces==='hw');
const hwRawBySide=(r,side)=>hwReplacedBySide(r,side) ? 0 : (side==='payment' ? payOr(r,'pay_hw','hw') : (r.hw||0));
const othRawBySide=(r,side)=>side==='payment' ? payOr(r,'pay_oth','oth') : (r.oth||0);
const subBySide=(r,side)=>fareBySide(r,side)+hwRawBySide(r,side)+othRawBySide(r,side);
// 支払側の運賃等が請求側と異なる（手動調整済み）場合は記載税額を流用せず自前で計算し直す
const rtaxBySide=(r,side)=>(r.tax_amount!=null && subBySide(r,side)===sub(r)) ? r.tax_amount : applyTaxRound(subBySide(r,side)*((r.tax??10))/100, r);
// 業務手数料の計算方式：単価（税別金額）から業務手数料を引いた「合計」に消費税(10%・四捨五入)を掛け直す（合計＋消費税）。
// 単価と業務手数料それぞれに個別で消費税をかけて合算する旧方式は、端数処理のタイミングが2箇所に分かれるため
// 数円の丸め誤差が生じることがあった。まとめて1回だけ、合計に対して四捨五入することでこれを解消する。
function calcBizFeeWithTax(gross, taxAmt, feeRate) {
  const bizFee = roundHalfUp(gross * feeRate); // 業務手数料＝単価×手数料率
  const netSubtotal = gross + bizFee; // 合計＝単価－業務手数料
  const netTax = roundHalfUp(netSubtotal * 0.1); // 合計に対する消費税（10%・四捨五入）
  return { bizFee, netSubtotal, netTax, bizFeeWithTax: bizFee + (netTax - taxAmt) };
}
// 受注入力の「追加料金」を集計・PDFへ反映するための合算ヘルパー
// side: 'billing'（請求）| 'payment'（支払）。applies が'both'の行は両方に加算対象
function sumRecsExtraFees(rows, side, taxRatePct){
  const rate = taxRatePct || 10;
  let sum = 0;
  (rows||[]).forEach(r => {
    (r.extra_fees||[]).forEach(f => {
      if (f.applies === side || f.applies === 'both') {
        sum += f.tax === 'excl' ? Math.round((f.amount||0) * (1 + rate/100)) : (f.amount||0);
      }
    });
  });
  return sum;
}
// 追加料金を「高速」「立替代」「その他」に振り分けて集計するヘルパー
// （受注入力の高速代・立替入力欄は廃止され、名称・税区分ベースの「追加料金」に一本化されたため、
//   従来のr.hw/r.othだけを見る集計・PDF・一覧表示だと入力した金額が0のまま反映されなくなる問題への対応）
// 振り分けルール: 名称に「高速」「通行料」を含むものは高速代へ、それ以外で税区分が「立替」のものは立替代へ、残りはその他
// （CSV取込の高速代→立替変換は旧名称「通行料（立替）」で保存されたデータが残っているため、通行料も高速代扱いにする）
function feeBreakdown(r, side, taxRatePct){
  const rate = taxRatePct || 10;
  let hw = hwRawBySide(r, side), oth = othRawBySide(r, side), other = 0, nonTax = 0;
  (r.extra_fees||[]).forEach(f => {
    if (f.applies !== side && f.applies !== 'both') return;
    const amt = f.tax === 'excl' ? Math.round((f.amount||0) * (1 + rate/100)) : (f.amount||0);
    // 非課税指定の追加料金は、名称に関わらず非課税額として扱う（そうしないと税込金額欄に
    // 紛れ込んでしまい、非課税額欄に反映されず金額の内訳が分からなくなる）
    if (f.tax === 'none') nonTax += amt;
    else if ((f.name||'').includes('高速') || (f.name||'').includes('通行料')) hw += amt;
    else if (f.tax === 'advance') oth += amt;
    else other += amt;
  });
  return { hw, oth, other, nonTax, total: hw+oth+other+nonTax };
}

/* ===== 明細フル画面（pg20）: 集計取引先別／集計ドライバー別の「明細」から遷移。表示項目を選択可能 =====
   既定の並び順（左から）: 売計上日・ドライバー/車番(2段)・取引先・引取先・配送先・作業名・距/時・単価・数量・高速代・立替代(2段)・追加料金(他)(2段)・金額
   それ以外の項目は表示項目パネルから任意に追加できる（既定は非表示） */
const AGG_DETAIL_COLS = [
  {key:'salesDate', label:'売計上日', default:true, get:r=>r.sales_date||r.date||''},
  {key:'driverCar', label:'ドライバー/車番', default:true, twoLine:true, equalLines:true, get:r=>({top:escHtml((recDrv(r)?.name)||'—'), bottom:escHtml(r.car||'')})},
  {key:'cli', label:'取引先', default:true, get:r=>{const c=lkC(r.cli);return c?`<span style="cursor:pointer;color:var(--blue);text-decoration:underline dotted" onclick="event.stopPropagation();editCli(${c.id})" title="取引先管理で開く">${escHtml(c.name)}</span>`:'';}},
  {key:'pickupLoc', label:'引取先', default:true, get:r=>escHtml(r.pickup_location||'')},
  {key:'deliveryLoc', label:'配送先', default:true, get:r=>escHtml(r.delivery_location||'')},
  {key:'taskName', label:'作業名', default:true, get:r=>escHtml(r.task_name||'')},
  {key:'distTime', label:'距/時', default:true, get:r=>escHtml(r.distance_time||'')},
  {key:'unitPrice', label:'単価', default:true, num:true, get:(r,side)=>{const q=r.qty||1;const fare=fareBySide(r,side),oth=othRawBySide(r,side);const base=fare>0?fare:oth;return Math.round(base/q);}},
  {key:'qty', label:'数量', default:true, right:true, get:r=>r.qty!=null?r.qty:1},
  {key:'hw', label:'高速代', default:true, num:true, get:(r,side)=>feeBreakdown(r,side).hw},
  {key:'oth', label:'立替代', default:true, twoLine:true, right:true, get:(r,side)=>{
    const fb = feeBreakdown(r,side);
    const names = (r.extra_fees||[]).filter(f=>(f.applies===side||f.applies==='both')&&f.tax==='advance'&&!(f.name||'').includes('高速')).map(f=>f.name);
    return { top: escHtml(names.join('、'))||'—', bottom: yen(fb.oth) };
  }},
  {key:'other', label:'追加料金(他)', default:true, twoLine:true, right:true, get:(r,side)=>{
    const fb = feeBreakdown(r,side);
    const names = (r.extra_fees||[]).filter(f=>(f.applies===side||f.applies==='both')&&f.tax!=='advance'&&!(f.name||'').includes('高速')).map(f=>f.name);
    return { top: escHtml(names.join('、'))||'—', bottom: yen(fb.other) };
  }},
  {key:'total', label:'金額', default:true, num:true, get:(r,side)=>{const fb=feeBreakdown(r,side);return fareBySide(r,side)+fb.total+rtaxBySide(r,side);}},
  {key:'date', label:'配送日', default:false, get:r=>r.date||''},
  {key:'car', label:'車番', default:false, get:r=>escHtml(r.car||'')},
  {key:'driver', label:'ドライバー', default:false, get:r=>{const d=recDrv(r);return d?escHtml(d.name):'';}},
  {key:'type', label:'種別', default:false, get:r=>typeShort(r.type)},
  {key:'fare', label:'運賃', default:false, num:true, get:(r,side)=>fareBySide(r,side)},
  {key:'feeList', label:'追加料金内訳', default:false, get:(r,side)=>(r.extra_fees||[]).filter(f=>f.applies===side||f.applies==='both').map(f=>`${escHtml(f.name)} ${yen(f.amount||0)}`).join('、')},
  {key:'tax', label:'消費税', default:false, num:true, get:(r,side)=>rtaxBySide(r,side)},
  {key:'pickupDate', label:'引取日', default:false, get:r=>r.pickup_date||''},
  {key:'pickupTime', label:'引取時間', default:false, get:r=>escHtml(r.pickup_time||'')},
  {key:'pickupDone', label:'引取済', default:false, get:r=>r.pickup_done?'済':''},
  {key:'deliveryTime', label:'配送時間', default:false, get:r=>escHtml(r.delivery_time||'')},
  {key:'deliveryDone', label:'配送済', default:false, get:r=>r.delivery_done?'済':''},
  {key:'driverNote', label:'Dr連絡', default:false, get:r=>escHtml(r.driver_note||'')},
  {key:'invPayDate', label:'支払日', default:false, get:r=>r.invoice_payment_date||''},
  {key:'status', label:'ステータス', default:true, get:r=>stLbl(r.st)?`<span class="bdg ${stCls(r.st)}">${stLbl(r.st)}</span>`:''},
  {key:'note', label:'備考', default:false, get:r=>escHtml(r.note||'')},
];

function loadAggDetailCols() {
  const obj = {};
  AGG_DETAIL_COLS.forEach(c=>obj[c.key]=c.default);
  try {
    const saved = JSON.parse(localStorage.getItem('aggDetailCols')||'null');
    if (saved) Object.keys(saved).forEach(k=>{ if (k in obj) obj[k] = saved[k]; });
  } catch(e){}
  return obj;
}
let aggDetailCols = loadAggDetailCols();
function saveAggDetailCols() {
  try { localStorage.setItem('aggDetailCols', JSON.stringify(aggDetailCols)); } catch(e){}
}

// 表示順（キーの配列）。保存済みの並びに、後から追加された項目は末尾へ補完する
function loadAggDetailColOrder() {
  const allKeys = AGG_DETAIL_COLS.map(c=>c.key);
  try {
    const saved = JSON.parse(localStorage.getItem('aggDetailColOrder')||'null');
    if (Array.isArray(saved)) {
      const known = new Set(saved);
      return [...saved.filter(k=>allKeys.includes(k)), ...allKeys.filter(k=>!known.has(k))];
    }
  } catch(e){}
  return allKeys;
}
let aggDetailColOrder = loadAggDetailColOrder();
function saveAggDetailColOrder() {
  try { localStorage.setItem('aggDetailColOrder', JSON.stringify(aggDetailColOrder)); } catch(e){}
}
// 表示順に並べた列定義を返す（表示/非表示はここでは絞り込まない）
function getOrderedAggDetailCols() {
  const map = {};
  AGG_DETAIL_COLS.forEach(c=>map[c.key]=c);
  return aggDetailColOrder.map(k=>map[k]).filter(Boolean);
}
function moveAggDetailCol(key, dir) {
  const idx = aggDetailColOrder.indexOf(key);
  const newIdx = idx + dir;
  if (idx < 0 || newIdx < 0 || newIdx >= aggDetailColOrder.length) return;
  [aggDetailColOrder[idx], aggDetailColOrder[newIdx]] = [aggDetailColOrder[newIdx], aggDetailColOrder[idx]];
  saveAggDetailColOrder();
  renderAggDetailColCheckboxes();
  renderAggDetailFull();
}

// 現在の表示/非表示・並び順を「自分の既定」として保存（次回以降「既定に戻す」で復元される）
function saveAggDetailColsAsDefault() {
  try {
    localStorage.setItem('aggDetailColsUserDefault', JSON.stringify(aggDetailCols));
    localStorage.setItem('aggDetailColOrderUserDefault', JSON.stringify(aggDetailColOrder));
    showT('現在の表示項目・並び順を既定として保存しました');
  } catch(e){}
}

let _aggDetailSide = 'billing';
let _aggDetailRows = [];
let _aggDetailReturnPage = 0;
let _aggDetailSelected = new Set(); // レ点で選択中のレコードid（1件ずつ選択可能）

function toggleAggDetailRowSel(id, checked) {
  if (checked) _aggDetailSelected.add(id); else _aggDetailSelected.delete(id);
}
function toggleAggDetailSelAll(checked) {
  _aggDetailSelected = new Set(checked ? _aggDetailRows.map(r=>r.id) : []);
  renderAggDetailFull();
}

let _aggDetailGroupId = null; // billing側: 取引先id / payment側: ドライバーid
let _aggDetailGroupLabel = '';
let _aggDetailFrom = '', _aggDetailTo = ''; // 明細フル画面の表示期間（◀▶での月移動用）

function updateAggDetailPeriodLabel() {
  const el = document.getElementById('aggDetailPeriod');
  if (el) el.textContent = _aggDetailFrom ? `${_aggDetailFrom} 〜 ${_aggDetailTo}` : '';
}
// 明細フル画面のまま、同じ取引先／ドライバーの前月・翌月の明細に切り替える
// （集計タブに戻らなくても月をまたいで確認・発行できるように。移動後は月初〜月末の丸め期間になる）
function shiftAggDetailMonth(dir) {
  if (!_aggDetailFrom || _aggDetailGroupId == null) return;
  const [y, m] = _aggDetailFrom.slice(0,7).split('-').map(Number);
  const nf = new Date(y, m-1+dir, 1);
  _aggDetailFrom = fmtLocalDate(nf);
  _aggDetailTo = fmtLocalDate(new Date(nf.getFullYear(), nf.getMonth()+1, 0));
  _aggDetailRows = recs.filter(r => {
    if (!r.date || r.date < _aggDetailFrom || r.date > _aggDetailTo) return false;
    return _aggDetailSide === 'billing' ? r.cli === _aggDetailGroupId : recDrv(r)?.id === _aggDetailGroupId;
  }).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  _aggDetailSelected = new Set();
  updateAggDetailPeriodLabel();
  renderAggDetailFull();
}

function openAggDetailFull(side, key) {
  const groups = side === 'billing' ? window._aggInvGroups : window._aggPayGroups;
  const g = groups?.[key];
  if (!g) return;
  _aggDetailSide = side;
  _aggDetailRows = g.rows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  _aggDetailSelected = new Set();
  // 月移動用の表示期間：集計タブの集計期間を初期値に（未設定なら明細の実日付範囲）
  _aggDetailFrom = document.getElementById(side==='billing'?'aggInvFrom':'aggPayFrom')?.value || (_aggDetailRows[0]?.date || '');
  _aggDetailTo = document.getElementById(side==='billing'?'aggInvTo':'aggPayTo')?.value || (_aggDetailRows[_aggDetailRows.length-1]?.date || '');
  updateAggDetailPeriodLabel();
  _aggDetailReturnPage = side === 'billing' ? 0 : 6;
  const title = side === 'billing'
    ? (clients.find(c=>c.id===g.cli)?.name || '（未設定）')
    : (g.drv?.name || '');
  _aggDetailGroupId = side === 'billing' ? g.cli : g.drv?.id;
  _aggDetailGroupLabel = title;
  document.getElementById('aggDetailTitle').textContent = `📋 明細　${title}`;
  document.getElementById('aggDetailColPanel').style.display = 'none';
  const createBtn = document.getElementById('aggDetailCreateBtn');
  if (createBtn) createBtn.textContent = side === 'billing' ? '📄 請求明細書作成' : '💰 支払明細書作成';
  const invSaveBtn = document.getElementById('aggDetailInvSaveBtn');
  const invLoadBtn = document.getElementById('aggDetailInvLoadBtn');
  if (invSaveBtn) invSaveBtn.classList.toggle('hide', side !== 'billing');
  if (invLoadBtn) invLoadBtn.classList.toggle('hide', side !== 'billing');
  goPage(20);
  renderAggDetailColCheckboxes();
  renderAggDetailFull();
}

// 選択中（レ点）の明細のみでExcel形式の請求/支払明細書を作成
/* ===== 統一デザインの明細書（Excel帳票＋PDF共通のレイアウト定義） ===== */
// 発行日：ツールバーの発行日欄（#stmtIssueDate系）で指定されていればそれを使用し、未指定なら本日の日付にする
window.statementIssueDateOverride = '';
function getStatementIssueDate() {
  return (window.statementIssueDateOverride ? new Date(window.statementIssueDateOverride+'T00:00:00') : new Date())
    .toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'});
}
// 請求・支払どちらのツールバーで発行日を変更しても、もう片方の入力欄にも反映する。
// 次回ログイン時にも同じ発行日を初期表示できるよう、入力された値をlocalStorageに記憶しておく
function updateStmtIssueDate(val) {
  window.statementIssueDateOverride = val || '';
  if (val) localStorage.setItem('pgbase_last_issue_date', val);
  ['stmtIssueDateInput0','stmtIssueDateInput1'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  });
}
// 前回入力した発行日をlocalStorageから復元する（保存値が無ければ何もせず、従来どおり空欄＝当日扱いになる）
function restoreStmtIssueDate() {
  if (window.statementIssueDateOverride) return; // 今回のセッションで既に入力済みなら上書きしない
  const saved = localStorage.getItem('pgbase_last_issue_date');
  if (saved) updateStmtIssueDate(saved);
}
// 自社情報の郵便番号・住所を表示用に行分割する：①郵便番号は住所とは別の行にする、
// ②住所は番地までを1行に収め、それより後ろ（建物名など。半角/全角スペース区切りを想定）は改行する
function formatCompanyAddressLines(c) {
  c = c || {};
  const lines = [];
  if (c.zip) lines.push(c.zip.startsWith('〒') ? c.zip : '〒'+c.zip);
  const addr = c.address || '';
  if (addr) {
    const sp = Math.max(addr.lastIndexOf('　'), addr.lastIndexOf(' '));
    if (sp >= 0) { lines.push(addr.slice(0, sp)); lines.push(addr.slice(sp+1)); }
    else lines.push(addr);
  }
  return lines;
}
// Excel帳票のセルスタイル生成ヘルパー（xlsx-js-styleのs（style）プロパティ形式）
function stStyle(o){
  o = o||{};
  const st = {
    font: { name:'MS Mincho', sz:o.sz||10, bold:!!o.bold },
    alignment: { horizontal:o.h||'left', vertical:o.v||'center', wrapText:!!o.wrap }
  };
  if (o.fill) st.fill = { patternType:'solid', fgColor:{rgb:o.fill} };
  if (o.border !== false) {
    const b = { style:'thin', color:{rgb:'000000'} };
    st.border = { top:b, bottom:b, left:b, right:b };
  }
  return st;
}
function stCell(ws, addr, value, style, numFmt){
  const cell = { v: value==null?'':value, t: typeof value==='number' ? 'n' : 's' };
  if (style) cell.s = style;
  if (numFmt) cell.z = numFmt;
  ws[addr] = cell;
}
const ST_COLS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];
const ST_HEAD_FILL = 'FFE7E6E6';

// 複数列（・複数行）にまたがる結合セルを罫線が途切れないように書き込む。
// SheetJSは結合範囲内で値・スタイルが未設定のセルの罫線を正しく描画しない（アンカーセル以外が
// 白紙のまま残ると、その部分だけ格子線が途切れて見える）ため、結合セルは必ずこの関数を通して
// 書き込み、範囲内の全セルに同じ罫線スタイルを敷く
function stCellMerge(ws, merge, r0, c0, r1, c1, value, style, numFmt) {
  stCell(ws, `${ST_COLS[c0]}${r0}`, value, style, numFmt);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (r === r0 && c === c0) continue;
      stCell(ws, `${ST_COLS[c]}${r}`, '', style);
    }
  }
  if (r1 > r0 || c1 > c0) merge.push({s:{r:r0-1,c:c0},e:{r:r1-1,c:c1}});
}

// side: 'billing'|'payment'。rows: 対象レコード配列（明細画面でレ点選択したもの）
function buildStatementSheetData(side, rows) {
  const sortedRows = rows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const cAll = companySettings || {};
  let recipientLines, headLabel, docPrefix, breakdownRows, groupId, dateLabel, dateValue;

  if (side === 'billing') {
    const cli = clients.find(c=>c.id===sortedRows[0].cli);
    groupId = cli?.id;
    headLabel = '請求明細書';
    docPrefix = 'IV';
    dateLabel = 'お支払い期限';
    dateValue = closingDayLabel(cli?.closing_day);
    recipientLines = [
      `${cli?cli.name:'（未設定）'}　御中`,
      [cli?.zip?`〒${cli.zip}`:'', cli?.address||''].filter(Boolean).join(' '),
      [cli?.person?`ご担当: ${cli.person}`:'', cli?.tel?`TEL ${cli.tel}`:''].filter(Boolean).join('　'),
      cli?.invoice_no?`登録番号: ${cli.invoice_no}`:'',
    ];
    const subtotal = sortedRows.reduce((a,r)=>a+(r.fare||0),0);
    const taxAmt = sortedRows.reduce((a,r)=>a+(rtax(r)||0),0);
    const fbAll = sortedRows.reduce((a,r)=>{const b=feeBreakdown(r,'billing');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other,nonTax:a.nonTax+b.nonTax};},{hw:0,oth:0,other:0,nonTax:0});
    // 追加料金で非課税指定した分も非課税額に含める（合計自体は元々合っていたが、この額がどこに
    // 計上されているか分からなかったため、非課税額欄に明示的に反映する）
    const nonTax = sortedRows.filter(r=>(r.tax||0)===0).reduce((a,r)=>a+sub(r),0) + fbAll.nonTax;
    const taxedTotal = subtotal + taxAmt + fbAll.hw + fbAll.oth + fbAll.other + fbAll.nonTax;
    const feeRate = cli?.fee_rate || 0;
    const feeAmt = Math.round(taxedTotal * feeRate / 100);
    const grandTotal = taxedTotal + feeAmt;
    breakdownRows = [
      ['手数料など'+(feeRate?`（${feeRate}%）`:''), feeAmt],
      ['請求合計金額', grandTotal],
    ];
    var summary = { taxed: taxedTotal, taxOnly: taxAmt, nonTax, oth: fbAll.oth, advHw: fbAll.hw + fbAll.oth, grand: grandTotal };
  } else {
    const d = drvPay(recDrv(sortedRows[0])); // 協力会社フォールバック（振込先・登録番号・手数料率）を適用
    groupId = d?.id;
    headLabel = '支払明細書';
    docPrefix = 'PS';
    recipientLines = [`${d?d.name:'（未設定）'}${d?.is_company?'　御中':'　様'}`, d?.company?`協力会社: ${d.company}`:'', d?.tel?`(TEL ${d.tel})`:'', d?.invoice_no?`登録番号: ${d.invoice_no}`:'', d?.bank?`振込先: ${d.bank}`:''];
    dateLabel = '支払実行日';
    // ドライバー（協力会社優先）の支払日設定を反映した支払実行日
    dateValue = computePayExecDateLabel(d, sortedRows[sortedRows.length-1]?.date);
    const grossAll = sortedRows.reduce((a,r)=>a+subBySide(r,'payment'),0); // 全明細の税別ベース額（非課税分を含む）
    const grossTax = sortedRows.reduce((a,r)=>a+subBySide(r,'payment')+rtaxBySide(r,'payment'),0);
    const nonTaxRows = sortedRows.filter(r=>(r.tax||0)===0).reduce((a,r)=>a+subBySide(r,'payment'),0); // 税率0%明細の合計
    const gross = grossAll - nonTaxRows; // 税別金額（課税対象分のみ。非課税分は業務手数料の対象外）
    const taxAmt = grossTax - grossAll;
    const fbAll = sortedRows.reduce((a,r)=>{const b=feeBreakdown(r,'payment');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other,nonTax:a.nonTax+b.nonTax};},{hw:0,oth:0,other:0,nonTax:0});
    const feeRate = d?.fee_rate ?? -0.15;
    const adminFee = d?.admin_fee ?? -10000;
    const vehRental = d?.vehicle_rental ?? -30000;
    const { bizFee, netSubtotal, netTax } = calcBizFeeWithTax(gross, taxAmt, feeRate);
    // 車両管理の乗務履歴（日額設定のある代車）から、この明細書の対象期間に重なる日数分のリース料を自動計算する。
    // 対象期間は支払集計タブの集計期間ピッカーを使い、未設定なら選択した明細の実日付範囲にフォールバックする
    const vhPeriodFrom = document.getElementById('aggPayFrom')?.value || sortedRows[0]?.date || '';
    const vhPeriodTo = document.getElementById('aggPayTo')?.value || sortedRows[sortedRows.length-1]?.date || '';
    const othItems = otherItemsForPeriod(d, vhPeriodFrom, vhPeriodTo);
    const otherTotal = othItems.total;
    // 追加料金（高速代・立替・その他）。集計タブ(runAggPay)の支払合計と同じ計上方法で合計へ加算する
    const extraFeeTotal = sumRecsExtraFees(sortedRows, 'payment');
    const takeHome = netSubtotal+netTax+adminFee+vehRental+extraFeeTotal+otherTotal+nonTaxRows;
    // 非課税額＝消費税の対象外となる金額の合計（税率0%明細分＋事務手数料・車両リース代・その他の控除＋
    // 追加料金で非課税指定した分）。コムトラの帳票でも「非課税額」欄は登録/事務手数料など
    // （消費税がかからない控除）の合計になっている
    const nonTax = nonTaxRows + adminFee + vehRental + otherTotal + fbAll.nonTax;
    // 税込金額＝コムトラと同じ計算（外税対象小計－業務手数料）＋消費税＋高速代など（立替）の合計
    const taxedSummary = netSubtotal + netTax + extraFeeTotal;
    breakdownRows = [
      ['単価（外税対象小計）', gross],
      ...(nonTaxRows ? [['非課税額（業務手数料対象外）', nonTaxRows]] : []),
      [`業務手数料（率${(feeRate*100).toFixed(1)}%）`, bizFee],
      ['合計（単価－業務手数料）', netSubtotal],
      ['消費税（10%）', netTax],
      ...(extraFeeTotal ? [['追加料金（高速代・立替など）', extraFeeTotal]] : []),
      ['事務手数料', adminFee],
      [d?.lease_company ? `車両リース代（${d.lease_company}）` : '車両リース代', vehRental],
      ...othItems.items.map(it=>[it.name, it.amount]),
      ['支払合計金額', takeHome],
    ];
    // taxOnlyは「税込金額(taxedSummary)に含まれる消費税」＝手数料差引後の合計に対する消費税(netTax)。
    // 立替・高速代などの追加料金は非課税のため税額を持たない
    var summary = { taxed: taxedSummary, taxOnly: netTax, nonTax, oth: fbAll.oth, advHw: fbAll.oth + fbAll.hw, grand: takeHome };
  }

  const companyLines = [
    cAll.name || '株式会社ポーターガーデン',
    ...formatCompanyAddressLines(cAll),
    `${cAll.tel?'TEL '+cAll.tel:''}`,
    `${cAll.reg_no?'登録番号 '+cAll.reg_no:''}`,
  ];

  const items = sortedRows.map((r,i)=>{
    const fb = feeBreakdown(r, side);
    const d = recDrv(r);
    return {
      no: i+1, date: r.date, car: r.car||'', driverName: d?d.name:'',
      // 高速・立替代＝その明細（日付）で発生した高速代・立替の合計。集計欄でまとめず、使用日ごとに正確に表示する
      task: r.task_name || r.note || '', hw: fb.hw + fb.oth, distTime: r.distance_time || '',
      qty: r.qty!=null?r.qty:1, unitPrice: r.qty ? Math.round((fareBySide(r,side)>0?fareBySide(r,side):othRawBySide(r,side))/r.qty) : fareBySide(r,side),
      // 金額＝単価（税・追加料金は含めない。集計は消費税額欄・追加料金の内訳行で別途表示）
      amount: fareBySide(r,side)>0 ? fareBySide(r,side) : othRawBySide(r,side),
    };
  });
  // 追加料金のうち明細書上に現れない区分（非課税・その他）を、明細表の下段に行として表示する。
  // 高速代・立替区分の追加料金は各行の「高速・立替代」列に既に表示されるため二重表示を避けて対象外。
  // 単価なし・非課税の追加入力のみ行った場合でも「何の料金か」が明細書上で分かるようにするのが目的で、
  // 合計金額は従来どおり集計側で計上済みのため、この行は表示のみで合計計算には影響しない
  const taxLabel = {excl:'外税', incl:'内税', none:'非課税', advance:'立替'};
  sortedRows.forEach(r => {
    (r.extra_fees||[]).forEach(f => {
      if (f.applies !== side && f.applies !== 'both') return;
      const name = f.name || '';
      if (f.tax === 'advance' || name.includes('高速') || name.includes('通行料')) return; // 高速・立替代列に表示済み
      const amt = f.tax === 'excl' ? Math.round((f.amount||0) * 1.10) : (f.amount||0);
      const d = recDrv(r);
      items.push({
        no: items.length+1, date: r.date, car: r.car||'', driverName: d?d.name:'',
        task: `【追加料金】${name}${taxLabel[f.tax]?`（${taxLabel[f.tax]}）`:''}`,
        hw: 0, distTime: '', qty: 1, unitPrice: amt, amount: amt,
      });
    });
  });

  // 備考欄：取引先／ドライバー登録の備考（常時表示）＋task_nameが別途設定されている行のnote（作業明細列と重複表示しないため）
  const masterNote = side === 'billing' ? (clients.find(c=>c.id===sortedRows[0].cli)?.note || '') : (recDrv(sortedRows[0])?.note || '');
  const recordNotes = sortedRows.filter(r=>r.task_name).map(r=>r.note).filter(Boolean).join('、');
  const notes = [masterNote, recordNotes].filter(Boolean).join('\n');

  const month = (sortedRows[0].date||'').slice(0,7);
  const docNo = `${docPrefix}-${month.replace('-','')}-${String(groupId||0).padStart(3,'0')}`;
  const issueDate = getStatementIssueDate();
  const periodLabel = `集計期間: ${sortedRows[0].date} ～ ${sortedRows[sortedRows.length-1].date}`;

  return { headLabel, docNo, issueDate, recipientLines, companyLines, periodLabel, dateLabel, dateValue, summary, items, notes, breakdownRows, isCompanyPayee: side==='billing' || !!recDrv(sortedRows[0])?.is_company, groupLabel: recipientLines[0].replace('　御中','').replace('　様','') };
}

// 1件分の明細書ブロックをwsの指定行から書き込み、書き込み終えた次の行番号を返す
// （1シートに複数件を積み上げて「鑑」形式でまとめて発行する場合と、単票の場合の両方で共有）
// ===== Excel印刷設定（用紙の向き・改ページ）をXML直接パッチで反映するためのユーティリティ =====
// 読み込んでいるxlsxライブラリ(0.18.5)は!pageSetup/!rowBreaksの書き込みに対応していない（検証済み：
// 出力XMLに<pageSetup>要素が一切生成されない）ため、生成後のZIPを一度「格納（無圧縮）」方式で
// 展開・再構築し、対象シートのXMLへ<pageSetup>・<rowBreaks>要素を直接注入する。
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ZIPを展開し、patches[エントリ名](xmlText)=>新xmlText で指定エントリだけ書き換えたうえで、
// 全エントリを格納方式（無圧縮）で新規ZIPとして再構築する
async function rezipXlsxStored(arrayBuffer, patches) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('ZIP EOCDが見つかりません');
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  const cdEntries = dv.getUint16(eocdOffset + 10, true);

  const files = [];
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('中央ディレクトリの署名が不正です');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lp = localHeaderOffset;
    if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('ローカルヘッダーの署名が不正です: ' + name);
    const lNameLen = dv.getUint16(lp + 26, true);
    const lExtraLen = dv.getUint16(lp + 28, true);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    const rawData = bytes.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = rawData;
    else if (method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawData); writer.close();
      data = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } else throw new Error('未対応の圧縮方式です: ' + method + ' (' + name + ')');
    files.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }

  for (const f of files) {
    if (patches[f.name]) {
      const text = new TextDecoder('utf-8').decode(f.data);
      f.data = new TextEncoder().encode(patches[f.name](text));
    }
  }

  const encoder = new TextEncoder();
  const localParts = []; const centralParts = []; const localOffsets = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);
    const header = new Uint8Array(30 + nameBytes.length);
    const hdv = new DataView(header.buffer);
    hdv.setUint32(0, 0x04034b50, true); hdv.setUint16(4, 20, true); hdv.setUint16(6, 0, true);
    hdv.setUint16(8, 0, true); hdv.setUint16(10, 0, true); hdv.setUint16(12, 0x21, true);
    hdv.setUint32(14, crc, true); hdv.setUint32(18, f.data.length, true); hdv.setUint32(22, f.data.length, true);
    hdv.setUint16(26, nameBytes.length, true); hdv.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    localOffsets.push(offset);
    localParts.push(header, f.data);
    offset += header.length + f.data.length;
  }
  const cdStart = offset;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true); cdv.setUint16(12, 0, true); cdv.setUint16(14, 0x21, true);
    cdv.setUint32(16, crc, true); cdv.setUint32(20, f.data.length, true); cdv.setUint32(24, f.data.length, true);
    cdv.setUint16(28, nameBytes.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true); cdv.setUint32(38, 0, true);
    cdv.setUint32(42, localOffsets[i], true);
    ch.set(nameBytes, 46);
    centralParts.push(ch);
    offset += ch.length;
  }
  const cdSize = offset - cdStart;
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); edv.setUint16(4,0,true); edv.setUint16(6,0,true);
  edv.setUint16(8, files.length, true); edv.setUint16(10, files.length, true);
  edv.setUint32(12, cdSize, true); edv.setUint32(16, cdStart, true); edv.setUint16(20, 0, true);
  const result = new Uint8Array(offset + 22);
  let w = 0;
  for (const part of localParts) { result.set(part, w); w += part.length; }
  for (const part of centralParts) { result.set(part, w); w += part.length; }
  result.set(eocd, w);
  return result;
}

// シートXMLへ<pageSetup>（A4縦・横1ページ収まり）と<rowBreaks>（改ページ位置）を注入する。
// 固定のscale値を自前計算する方式は、実際のExcel環境（既定フォントの実体は環境依存）での
// 縮小率とズレて列がページ幅からはみ出す事故が起きたため廃止し、Excel自身に正しく
// 1ページ幅へ収めさせるfitToWidth（自動縮小）に戻した
function injectPageSetupXml(xmlText, rowBreaksRows) {
  const pageSetupTag = `<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>`;
  let rowBreaksTag = '';
  if (rowBreaksRows && rowBreaksRows.length) {
    const brks = rowBreaksRows.map(r=>`<brk id="${r}" max="16383" man="1"/>`).join('');
    rowBreaksTag = `<rowBreaks count="${rowBreaksRows.length}" manualBreakCount="${rowBreaksRows.length}">${brks}</rowBreaks>`;
  }
  let out = xmlText;
  if (out.includes('<pageMargins')) {
    out = out.replace(/(<pageMargins[^>]*\/>)/, `$1${pageSetupTag}${rowBreaksTag}`);
  } else {
    out = out.replace('</worksheet>', `${pageSetupTag}${rowBreaksTag}</worksheet>`);
  }
  if (!out.includes('<sheetPr')) {
    out = out.replace(/(<worksheet[^>]*>)/, `$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  }
  return out;
}

// ワークブックをA4縦・指定の改ページ位置で書き出し、ダウンロードする（全ての明細書Excel出力の共通経路）
// rowBreaksBySheetIndex: シート順（wb.SheetNamesの並び）に対応する改ページ行番号の配列の配列
async function downloadXlsxWithPageSetup(wb, filename, rowBreaksBySheetIndex) {
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  const patches = {};
  wb.SheetNames.forEach((name, i) => {
    const breaks = (rowBreaksBySheetIndex && rowBreaksBySheetIndex[i]) || [];
    patches[`xl/worksheets/sheet${i+1}.xml`] = (xml) => injectPageSetupXml(xml, breaks);
  });
  const patched = await rezipXlsxStored(buf, patches);
  const blob = new Blob([patched], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

const STATEMENT_COLS_WCH = [4,5,5,6,6,6,11,11,11,9,9,7,11,13];

// 列の合計幅がページ幅より広いため、印刷時はExcelのfitToWidth（自動縮小）で1ページ幅に収めている。
// 縮小率は環境（実際に使われるフォントの字幅）によって変わり、JS側で正確に予測することはできない
// （縮小率をこちらで計算してscale固定にしていた時期があったが、実際のExcel環境で想定より縮小率が
// 小さく列がページ幅からはみ出す不具合が起きたため、fitToWidthの自動計算に戻した）。
// 行の高さ(hpt)ベースの改ページ予算は、A4縦1ページの高さ(約770pt)に対し、印刷時にある程度縮小される
// （＝縮小前の行高さでは1ページにもっと多く収まる）ことを見込みつつ、縮小率を読み違えても
// 内訳・備考の箱がページの途中で分断されないよう安全側に倒した目安値にしている
const STATEMENT_PAGE_BUDGET_PT = 830;

function writeStatementBlock(ws, side, rows, startRow, merge, rowBreaksOut) {
  const d = buildStatementSheetData(side, rows);
  let r = startRow;
  if (!ws['!rows']) ws['!rows'] = [];

  // 行高(pt)を明示的に設定しつつ、使用済みの高さを累積してページ収まりを追跡する。
  // ブロックは常にページ先頭（改ページ直後）から始まる前提で used=0 から開始
  let used = 0;
  const setH = (row, h) => { ws['!rows'][row-1] = { hpt: h }; used += h; };

  stCellMerge(ws, merge, r, 0, r, 13, d.docNo, stStyle({h:'right', border:false, sz:9}));
  setH(r, 14); r++;
  stCellMerge(ws, merge, r, 0, r, 13, d.headLabel, stStyle({h:'center', border:false, sz:20, bold:true}));
  setH(r, 30); r++;
  stCellMerge(ws, merge, r, 0, r, 13, d.issueDate, stStyle({h:'center', border:false, sz:11}));
  setH(r, 16); r++;
  setH(r, 8); r++;

  const recipRow = r;
  d.recipientLines.forEach((line, i) => {
    if (!line) return;
    stCellMerge(ws, merge, recipRow+i, 0, recipRow+i, 6, line, stStyle({border:false, sz: i===0?12:9.5}));
  });
  d.companyLines.forEach((line, i) => {
    if (!line) return;
    stCellMerge(ws, merge, recipRow+i, 7, recipRow+i, 13, line, stStyle({border:false, sz: i===0?12:9.5}));
  });
  const recipRowCount = Math.max(d.recipientLines.length, d.companyLines.length);
  for (let i=0; i<recipRowCount; i++) setH(recipRow+i, i===0?18:14);
  r = recipRow + recipRowCount;
  setH(r, 8); r++;

  stCellMerge(ws, merge, r, 0, r, 13, `${d.periodLabel}　　${d.dateLabel}: ${d.dateValue}`, stStyle({border:false, sz:10}));
  setH(r, 16); r++;

  const sumLabels = side==='billing' ? [
    ['税込金額', d.summary.taxed], ['内消費税額', d.summary.taxOnly],
    ['非課税額', d.summary.nonTax], ['高速・立替代', d.summary.advHw ?? d.summary.oth],
    ['請求金額', d.summary.grand],
  ] : [
    ['税込金額', d.summary.taxed], ['内消費税額', d.summary.taxOnly],
    ['非課税額', d.summary.nonTax], ['高速・立替代', d.summary.advHw ?? d.summary.oth],
    ['支払金額', d.summary.grand],
  ];
  // 5つの欄の見た目の幅（列幅wchの合計）がほぼ均等になるように列を割り当てる
  const sumSpans = [[0,3],[4,6],[7,8],[9,11],[12,13]];
  sumLabels.forEach(([label], i) => {
    const [c0,c1] = sumSpans[i];
    stCellMerge(ws, merge, r, c0, r, c1, label, stStyle({h:'center', fill:ST_HEAD_FILL, bold: i===4, sz: i===3?9:10, wrap:true}));
  });
  setH(r, 24); r++;
  sumLabels.forEach(([,val], i) => {
    const [c0,c1] = sumSpans[i];
    stCellMerge(ws, merge, r, c0, r, c1, val, stStyle({h:'right', bold: i===4}), '#,##0;-#,##0;0');
  });
  setH(r, 20); r++;
  setH(r, 8); r++;

  const ITEM_ROW_HPT = 28;
  const itemHeaderCols = [
    ['No',0,0], ['日付',1,2], ['車番・名前',3,5], ['作業明細',6,8],
    ['高速・立替代',9,9], ['距離・時間',10,10], ['数量',11,11], ['単価',12,12], ['金額',13,13],
  ];
  const writeItemHeader = (row) => {
    itemHeaderCols.forEach(([label,c0,c1]) => {
      stCellMerge(ws, merge, row, c0, row, c1, label, stStyle({h:'center', fill:ST_HEAD_FILL, sz: c1>c0?9:8, wrap:true}));
    });
    setH(row, 24);
  };
  writeItemHeader(r); r++;
  d.items.forEach(it => {
    // 明細行がページ予算を超える位置に来る場合は、行の途中で切れないよう直前で改ページし、
    // 新しいページの先頭に見出し行を再掲する
    if (rowBreaksOut && used + ITEM_ROW_HPT > STATEMENT_PAGE_BUDGET_PT) {
      rowBreaksOut.push(r - 1);
      used = 0;
      writeItemHeader(r); r++;
    }
    setH(r, ITEM_ROW_HPT);
    stCell(ws, `A${r}`, it.no, stStyle({h:'center', v:'center'}));
    stCellMerge(ws, merge, r, 1, r, 2, it.date, stStyle({h:'center', v:'center'}));
    stCellMerge(ws, merge, r, 3, r, 5, it.driverName ? `${it.car}\n${it.driverName}` : it.car, stStyle({h:'center', v:'center', wrap:true}));
    stCellMerge(ws, merge, r, 6, r, 8, it.task, stStyle({v:'center', wrap:true}));
    stCell(ws, `J${r}`, it.hw, stStyle({h:'right', v:'center'}), '#,##0;-#,##0;0');
    stCell(ws, `K${r}`, it.distTime, stStyle({h:'center', v:'center'}));
    stCell(ws, `L${r}`, it.qty, stStyle({h:'right', v:'center'}));
    stCell(ws, `M${r}`, it.unitPrice, stStyle({h:'right', v:'center'}), '#,##0');
    stCell(ws, `N${r}`, it.amount, stStyle({h:'right', v:'center'}), '#,##0');
    r++;
  });
  if (!d.items.length) {
    stCellMerge(ws, merge, r, 0, r, 13, '対象データがありません', stStyle({h:'center'}));
    setH(r, 18); r++;
  }
  setH(r, 8); r++;

  // 備考欄と内訳（業務手数料・控除など）を横並びの箱で表示（コムトラの帳票と同じレイアウト）。
  // 箱全体が現在のページの残り高さに収まらない場合は、箱の直前で改ページして
  // 新しいページの先頭から箱を開始する（箱が途中で分断されるのを防ぐ）
  const BOX_ROW_HPT = 20;
  const boxRowCount = Math.max(d.breakdownRows.length, 3);
  if (rowBreaksOut && used + boxRowCount * BOX_ROW_HPT > STATEMENT_PAGE_BUDGET_PT) {
    rowBreaksOut.push(r - 1);
    used = 0;
  }
  const boxStartRow = r;
  stCellMerge(ws, merge, r, 0, r+boxRowCount-1, 1, '(備考)', stStyle({h:'center', fill:ST_HEAD_FILL, sz:9}));
  stCellMerge(ws, merge, r, 2, r+boxRowCount-1, 8, d.notes || '', stStyle({wrap:true, v:'top'}));

  // 小計欄(J～L)・合計欄(M～N)は、上部サマリー表の「合計金額」欄(M～N)と縦位置が揃うようにする
  d.breakdownRows.forEach(([label,val], i) => {
    const rr = boxStartRow + i;
    stCellMerge(ws, merge, rr, 9, rr, 11, label, stStyle({h:'center', fill:ST_HEAD_FILL, sz:9}));
    stCellMerge(ws, merge, rr, 12, rr, 13, val, stStyle({h:'right', bold:true}), '#,##0;-#,##0;0');
    setH(rr, BOX_ROW_HPT);
  });
  for (let rr=boxStartRow+d.breakdownRows.length; rr<boxStartRow+boxRowCount; rr++) {
    stCellMerge(ws, merge, rr, 9, rr, 11, '', stStyle({}));
    stCellMerge(ws, merge, rr, 12, rr, 13, '', stStyle({}));
    setH(rr, BOX_ROW_HPT);
  }
  r = boxStartRow + boxRowCount;

  return { nextRow: r, groupLabel: d.groupLabel };
}

// 1シート分のワークシートオブジェクトを組み立てる（単票・複数件をまとめてブックにする場合の両方で共有）

function buildStatementSheet(side, rows) {
  const ws = {};
  const merge = [];
  const rowBreaks = [];
  const { nextRow, groupLabel } = writeStatementBlock(ws, side, rows, 1, merge, rowBreaks);
  ws['!ref'] = `A1:N${nextRow}`;
  ws['!merges'] = merge;
  ws['!cols'] = STATEMENT_COLS_WCH.map(w=>({wch:w}));
  ws['!margins'] = { left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.2, footer:0.2 };
  return { ws, groupLabel, rowBreaks };
}

// 「鑑」表紙ページ：選択した各ドライバー（または取引先）ごとの金額内訳（コムトラの集計欄と同じ
// 5項目：(10%)税込金額／(内消費税額)／非課税額／立替金額／合計金額）の一覧と総合計を作成する。
// addressee: {name, cli} 形式。cli（協力会社レコード）があれば住所・TELなどの詳細を自動記載
function writeCoverPage(ws, side, rowGroups, addressee, startRow, merge) {
  let r = startRow;
  const isBilling = side === 'billing';
  if (!ws['!rows']) ws['!rows'] = [];
  const setH = (row, h) => { ws['!rows'][row-1] = { hpt: h }; };
  const cAll = companySettings || {};

  stCellMerge(ws, merge, r, 0, r, 13, isBilling ? '請求明細書 発行一覧（鑑）' : '支払明細書 発行一覧（鑑）', stStyle({h:'center', border:false, sz:18, bold:true}));
  setH(r, 30); r++;
  stCellMerge(ws, merge, r, 0, r, 13, getStatementIssueDate(), stStyle({h:'center', border:false, sz:11}));
  setH(r, 16); r++;
  setH(r, 8); r++;

  // 左：宛先（リース会社。会社マスタに登録済みなら住所・TEL・担当者を自動記載）／右：自社情報（個別明細書と同じ内容）
  const addresseeLines = [];
  if (addressee && addressee.name) {
    addresseeLines.push([`${addressee.name}　御中`, 14, true]);
    const c = addressee.cli;
    if (c) {
      [ [c.zip?`〒${c.zip}`:'', c.address||''].filter(Boolean).join(' '),
        [c.person?`ご担当: ${c.person}`:'', c.tel?`TEL ${c.tel}`:''].filter(Boolean).join('　') ]
        .filter(Boolean).forEach(line => addresseeLines.push([line, 9.5, false]));
    }
  }
  const companyLines2 = [
    [cAll.name || '株式会社ポーターガーデン', 12, true],
    ...formatCompanyAddressLines(cAll).map(l => [l, 9.5, false]),
    [cAll.tel ? 'TEL '+cAll.tel : '', 9.5, false],
    [cAll.reg_no ? '登録番号 '+cAll.reg_no : '', 9.5, false],
  ].filter(([line])=>line);
  const blockRowCount = Math.max(addresseeLines.length, companyLines2.length, 1);
  for (let i=0; i<blockRowCount; i++) {
    if (addresseeLines[i]) stCellMerge(ws, merge, r+i, 0, r+i, 6, addresseeLines[i][0], stStyle({border:false, sz:addresseeLines[i][1], bold:addresseeLines[i][2]}));
    if (companyLines2[i]) stCellMerge(ws, merge, r+i, 7, r+i, 13, companyLines2[i][0], stStyle({h:'right', border:false, sz:companyLines2[i][1], bold:companyLines2[i][2]}));
    setH(r+i, i===0?20:14);
  }
  r += blockRowCount;
  setH(r, 8); r++;

  // 各行のデータを先に一括計算しておく（集計期間の下に表示する合計金額ボックスで使うため）
  const numFmt = '#,##0;-#,##0;0';
  const dataList = rowGroups.map(rows => buildStatementSheetData(side, rows));
  const grandTotal = dataList.reduce((a,d)=>a+d.summary.grand, 0);

  // 集計期間・支払実行日（全グループの明細日付から算出）
  const allDates = rowGroups.flat().map(x=>x.date).filter(Boolean).sort();
  if (allDates.length) {
    let line = `集計期間: ${allDates[0]} ～ ${allDates[allDates.length-1]}`;
    if (!isBilling) {
      line += `　　支払実行日: ${computeGroupPayExecDateLabel(rowGroups)}`;
    }
    stCellMerge(ws, merge, r, 0, r, 13, line, stStyle({border:false, sz:10}));
    setH(r, 16); r++;
  }
  setH(r, 6); r++;

  // コムトラと同様、合計金額を表とは独立した太字の大きな欄で、集計期間のすぐ下に記載する
  stCellMerge(ws, merge, r, 0, r, 2, isBilling ? '請求金額' : '支払金額', stStyle({h:'center', fill:ST_HEAD_FILL, sz:12, bold:true}));
  stCellMerge(ws, merge, r, 3, r, 5, grandTotal, stStyle({h:'right', sz:14, bold:true}), numFmt);
  setH(r, 28); r++;
  setH(r, 10); r++;

  // 一覧表（コムトラの集計欄と同じ金額5項目を各行に記載）。見出しは折り返し表示で列幅内に収める
  const headerCols = isBilling
    ? [['No',0,0], ['取引先ID',1,2], ['取引先名',3,6], ['(10%)\n税込金額',7,8], ['(内消費税額)',9,10], ['非課税額',11,11], ['高速・立替代',12,12], ['合計金額',13,13]]
    : [['No',0,0], ['ドライバーID',1,1], ['ドライバー名',2,3], ['協力会社',4,5], ['(10%)\n税込金額',6,7], ['(内消費税額)',8,9], ['非課税額',10,11], ['高速・立替代',12,12], ['合計金額',13,13]];
  headerCols.forEach(([label,c0,c1]) => {
    stCellMerge(ws, merge, r, c0, r, c1, label, stStyle({h:'center', fill:ST_HEAD_FILL, sz:8, wrap:true}));
  });
  setH(r, 28); r++;

  const [gT,gH,gN,gO,gG] = isBilling ? [[7,8],[9,10],[11,11],[12,12],[13,13]] : [[6,7],[8,9],[10,11],[12,12],[13,13]];
  rowGroups.forEach((rows, gi) => {
    const d = dataList[gi];
    const s = d.summary;
    stCell(ws, `A${r}`, gi+1, stStyle({h:'center', v:'center'}));
    if (isBilling) {
      const cli = clients.find(c=>c.id===rows[0].cli);
      stCellMerge(ws, merge, r, 1, r, 2, cli?.client_no||'—', stStyle({h:'center', v:'center'}));
      // どの明細書ページに対応するか一目でわかるよう、名称の下に支払明細番号（docNo）を併記する
      stCellMerge(ws, merge, r, 3, r, 6, `${cli?.name||'（未設定）'}\n${d.docNo}`, stStyle({v:'center', wrap:true, sz:9}));
    } else {
      const drv = recDrv(rows[0]);
      stCell(ws, `B${r}`, drv?.supplier_id||'—', stStyle({h:'center', v:'center'}));
      stCellMerge(ws, merge, r, 2, r, 3, `${drv?.name||'（未設定）'}\n${d.docNo}`, stStyle({v:'center', wrap:true, sz:9}));
      stCellMerge(ws, merge, r, 4, r, 5, drv?.company||'', stStyle({v:'center', sz:8.5, wrap:true}));
    }
    stCellMerge(ws, merge, r, gT[0], r, gT[1], s.taxed, stStyle({h:'right', v:'center'}), numFmt);
    stCellMerge(ws, merge, r, gH[0], r, gH[1], s.taxOnly, stStyle({h:'right', v:'center'}), numFmt);
    stCellMerge(ws, merge, r, gN[0], r, gN[1], s.nonTax, stStyle({h:'right', v:'center'}), numFmt);
    stCellMerge(ws, merge, r, gO[0], r, gO[1], s.advHw ?? s.oth, stStyle({h:'right', v:'center'}), numFmt);
    stCellMerge(ws, merge, r, gG[0], r, gG[1], s.grand, stStyle({h:'right', v:'center', bold:true}), numFmt);
    setH(r, 34); r++;
  });

  // 総合計行（表の締め）
  stCellMerge(ws, merge, r, 0, r, gG[0]-1, '合計金額', stStyle({h:'center', fill:ST_HEAD_FILL, bold:true}));
  stCellMerge(ws, merge, r, gG[0], r, gG[1], grandTotal, stStyle({h:'right', bold:true}), numFmt);
  setH(r, 24); r++;
  setH(r, 10); r++;

  return r;
}

// 複数件（複数ドライバー／取引先）を1シートにまとめて積み上げる一括発行用
// （コムトラの支払明細書Excelと同様、1シート内にブロックごとの改ページを入れて連続印刷できるようにする）
// opts.withCover: true の場合、先頭に各件の合計一覧（表紙・「鑑」）を作成してから各明細を並べる
// opts.addressee: 表紙の宛先。{name, cli}形式または文字列（文字列の場合は協力会社マスタから詳細を自動照合）
function buildStatementSheetStacked(side, rowGroups, opts) {
  const { withCover=false } = opts||{};
  let addressee = (opts||{}).addressee || null;
  if (typeof addressee === 'string') {
    addressee = { name: addressee, cli: clients.find(c=>nm(c.name)===nm(addressee)) || null };
  }
  const ws = {};
  const merge = [];
  const rowBreaks = [];
  let row = 1;
  if (withCover) {
    row = writeCoverPage(ws, side, rowGroups, addressee, row, merge);
    rowBreaks.push(row - 1); // 表紙の直後で改ページし、明細から新しいページで始める
  }
  rowGroups.forEach((rows, i) => {
    if (i > 0) rowBreaks.push(row - 1); // 直前のブロック最終行の後で改ページ
    const { nextRow } = writeStatementBlock(ws, side, rows, row, merge, rowBreaks);
    row = nextRow + 1; // ブロック間に1行の余白
  });
  const lastRow = row - 1;
  ws['!ref'] = `A1:N${lastRow}`;
  ws['!merges'] = merge;
  ws['!cols'] = STATEMENT_COLS_WCH.map(w=>({wch:w}));
  ws['!margins'] = { left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.2, footer:0.2 };
  return { ws, rowBreaks };
}

// シート名として使えない文字（[ ] : * ? / \）を除去し31文字以内に収める
function sanitizeSheetName(name) {
  return String(name||'').replace(/[\[\]:*?\/\\]/g, '').slice(0, 28) || 'Sheet1';
}

function buildStatementWorkbook(side, rows) {
  const { ws, groupLabel, rowBreaks } = buildStatementSheet(side, rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, side==='billing'?'請求明細書':'支払明細書');
  return { wb, groupLabel, rowBreaks };
}

async function aggDetailCreateExcel() {
  if (!_aggDetailSelected.size) { alert('作成する明細を選択してください（レ点でチェック）'); return; }
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  const side = _aggDetailSide;
  const sheetLabel = side === 'billing' ? '請求明細書' : '支払明細書';
  const { wb, groupLabel, rowBreaks } = buildStatementWorkbook(side, rows);
  await downloadXlsxWithPageSetup(wb, `${sheetLabel}_${groupLabel}_${fmtLocalDate(new Date())}.xlsx`, [rowBreaks]);
  addLog('Excel出力', `${sheetLabel} ${groupLabel} ${rows.length}件（選択分）`);
  showT(`${sheetLabel}（Excel）を作成しました`);
}

// 選択中（レ点）の明細のみでPDF形式の請求書/支払明細書を作成
function aggDetailCreatePdf() {
  if (!_aggDetailSelected.size) { alert('作成する明細を選択してください（レ点でチェック）'); return; }
  if (!_aggDetailGroupId) { alert('取引先またはドライバーが特定できません'); return; }
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  const month = rows[0].date.slice(0,7);
  if (_aggDetailSide === 'billing') printInvoicePdf(_aggDetailGroupId, month, rows);
  else printPnlPdf(_aggDetailGroupId, month, rows);
}

function closeAggDetailFull() {
  const el = document.getElementById(_aggDetailReturnPage===0 ? 'nt0' : 'nt6');
  goPage(_aggDetailReturnPage, el);
  if (_aggDetailReturnPage === 6) runAggPay();
  else runAggInv(); // 明細画面での修正・削除・コピーを集計行の合計に反映させる
}

function toggleAggDetailColPanel() {
  const el = document.getElementById('aggDetailColPanel');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

let _aggDetailDragKey = null;

// 長押し（ドラッグ）で表示項目パネルの並び順を入れ替える
function aggDetailDragStart(e, key) {
  _aggDetailDragKey = key;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}
function aggDetailDragEnd(e) {
  e.currentTarget.style.opacity = '';
  _aggDetailDragKey = null;
}
function aggDetailDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function aggDetailDrop(e, targetKey) {
  e.preventDefault();
  if (!_aggDetailDragKey || _aggDetailDragKey === targetKey) return;
  const from = aggDetailColOrder.indexOf(_aggDetailDragKey);
  const to = aggDetailColOrder.indexOf(targetKey);
  if (from < 0 || to < 0) return;
  aggDetailColOrder.splice(from, 1);
  aggDetailColOrder.splice(to, 0, _aggDetailDragKey);
  saveAggDetailColOrder();
  renderAggDetailColCheckboxes();
  renderAggDetailFull();
}

function renderAggDetailColCheckboxes() {
  const el = document.getElementById('aggDetailColCheckboxes');
  const ordered = getOrderedAggDetailCols();
  el.innerHTML = ordered.map((c,i)=>`<div draggable="true"
    ondragstart="aggDetailDragStart(event,'${c.key}')" ondragend="aggDetailDragEnd(event)"
    ondragover="aggDetailDragOver(event)" ondrop="aggDetailDrop(event,'${c.key}')"
    style="display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:4px" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
    <span style="cursor:grab;color:var(--text3);font-size:13px;user-select:none;padding:0 2px" title="長押しでドラッグして並び替え">≡</span>
    <button class="ibtn" style="font-size:11px;padding:1px 3px" ${i===0?'disabled':''} onclick="moveAggDetailCol('${c.key}',-1)">↑</button>
    <button class="ibtn" style="font-size:11px;padding:1px 3px" ${i===ordered.length-1?'disabled':''} onclick="moveAggDetailCol('${c.key}',1)">↓</button>
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;flex:1">
      <input type="checkbox" onchange="toggleAggDetailCol('${c.key}',this.checked)"${aggDetailCols[c.key]?' checked':''}>${c.label}
    </label>
  </div>`).join('');
}

function toggleAggDetailCol(key, checked) {
  aggDetailCols[key] = checked;
  saveAggDetailCols();
  renderAggDetailFull();
}

function setAggDetailColsAll(val) {
  AGG_DETAIL_COLS.forEach(c=>aggDetailCols[c.key]=val);
  saveAggDetailCols();
  renderAggDetailColCheckboxes();
  renderAggDetailFull();
}

// 「既定に戻す」: 自分で保存した既定があればそれを復元、なければアプリ初期値に戻す
function setAggDetailColsPreset() {
  try {
    const savedCols = JSON.parse(localStorage.getItem('aggDetailColsUserDefault')||'null');
    const savedOrder = JSON.parse(localStorage.getItem('aggDetailColOrderUserDefault')||'null');
    if (savedCols) {
      aggDetailCols = savedCols;
      if (Array.isArray(savedOrder)) aggDetailColOrder = savedOrder;
      saveAggDetailCols();
      saveAggDetailColOrder();
      renderAggDetailColCheckboxes();
      renderAggDetailFull();
      return;
    }
  } catch(e){}
  AGG_DETAIL_COLS.forEach(c=>aggDetailCols[c.key]=c.default);
  aggDetailColOrder = AGG_DETAIL_COLS.map(c=>c.key);
  saveAggDetailCols();
  saveAggDetailColOrder();
  renderAggDetailColCheckboxes();
  renderAggDetailFull();
}

function renderAggDetailFull() {
  const cols = getOrderedAggDetailCols().filter(c=>aggDetailCols[c.key]);
  const thead = document.getElementById('aggDetailThead');
  const tbody = document.getElementById('aggDetailTbody');
  if (!thead || !tbody) return;
  const allSelected = _aggDetailRows.length > 0 && _aggDetailRows.every(r=>_aggDetailSelected.has(r.id));
  const wrapCell = 'white-space:normal;word-break:break-word;overflow-wrap:break-word';
  thead.innerHTML = `<tr style="background:var(--bg2);border-bottom:0.5px solid var(--border);color:var(--text2);text-align:left">
    <th style="padding:8px;width:24px;border-right:0.5px solid var(--border);vertical-align:middle;font-size:13px;font-weight:600"><input type="checkbox" ${allSelected?'checked':''} onchange="toggleAggDetailSelAll(this.checked)"></th>
    ${cols.map(c=>`<th style="padding:8px;border-right:0.5px solid var(--border);vertical-align:middle;font-size:13px;font-weight:600;${wrapCell};${(c.num||c.right)?'text-align:right':''}">${c.label}</th>`).join('')}
    <th style="padding:8px;width:76px;vertical-align:middle;font-size:13px;font-weight:600">操作</th>
  </tr>`;
  document.getElementById('aggDetailSummary').textContent = `${_aggDetailRows.length}件${_aggDetailSelected.size?`（${_aggDetailSelected.size}件選択中）`:''}`;
  if (!_aggDetailRows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length+2||1}" style="padding:24px;text-align:center;color:var(--text3)">データがありません</td></tr>`;
    return;
  }
  tbody.innerHTML = _aggDetailRows.map(r=>`<tr style="border-bottom:0.5px solid var(--border);cursor:pointer" title="ダブルクリックで修正画面を開きます" ondblclick="openEditInvoice(${r.id})">
    <td style="padding:8px;border-right:0.5px solid var(--border);vertical-align:middle"><input type="checkbox" ${_aggDetailSelected.has(r.id)?'checked':''} onchange="toggleAggDetailRowSel(${r.id},this.checked)" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"></td>
    ${cols.map(c=>{
      const v = c.get(r, _aggDetailSide);
      const alignStyle = (c.num||c.right)?'text-align:right':'text-align:left';
      if (c.twoLine) {
        const valAlign = (c.num||c.right) ? 'text-align:right' : 'text-align:left';
        const topStyle = c.equalLines ? 'font-size:14px;color:var(--text)' : 'font-size:12px;color:var(--text2)';
        return `<td style="padding:7px 8px;border-right:0.5px solid var(--border);vertical-align:middle">
          <div style="${topStyle};text-align:left;border-bottom:0.5px solid var(--border);padding-bottom:3px;margin-bottom:3px;${wrapCell}">${v.top??''}</div>
          <div style="${valAlign};font-size:14px;${wrapCell}">${v.bottom??''}</div>
        </td>`;
      }
      return `<td style="padding:8px;border-right:0.5px solid var(--border);vertical-align:middle;font-size:14px;${alignStyle};${wrapCell}">${c.num?yen(v):(v??'')}</td>`;
    }).join('')}
    <td style="padding:5px 6px;vertical-align:middle" ondblclick="event.stopPropagation()">
      <div style="display:flex;flex-direction:column;gap:3px">
        <button class="btn sml" onclick="openEditInvoice(${r.id})">修正</button>
        <button class="btn sml" onclick="copyInvoiceRecord(${r.id})">コピー</button>
        <button class="btn sml" style="color:var(--red)" onclick="deleteInvoiceRecord(${r.id})">削除</button>
      </div>
    </td>
  </tr>`).join('');
}

const closingDayLabel=d=>!d||d==='end'?'末日':`${d}日`;
// 「確認」ステップは廃止済み。st=0/1/2（未確認・確認済・旧承認済）は表示上区別せず空欄とし、
// 実際に業務上意味のある請求済(3)・入金済(4)のみバッジ表示する
const stLbl=s=>({3:'請求済',4:'入金済'}[s]||'');
const stCls=s=>({3:'s3',4:'s4'}[s]||'');

/* ===== NAV ===== */
// ページ番号 → 所属グループの対応表
const PAGE_GROUP = {
  0:'biz', 6:'biz', 18:'biz', 9:'biz', 11:'biz', 22:'biz',
  1:'analysis', 8:'analysis', 23:'analysis', 24:'analysis', 28:'analysis', 29:'analysis',
  31:'analysis', 32:'analysis', 33:'analysis',
  10:'driver', 12:'driver', 14:'driver', 27:'driver', 30:'driver',
  2:'admin', 3:'admin', 25:'admin', 26:'admin', 15:'admin', 4:'admin', 5:'admin', 17:'admin',
};

function switchNavGroup(group, skipPageSwitch) {
  document.querySelectorAll('.gtab').forEach(t=>t.classList.toggle('on', t.id === 'gt-'+group));
  document.querySelectorAll('.nav[id^="nav-"]').forEach(n=>n.classList.toggle('hide', n.id !== 'nav-'+group));
  if (!skipPageSwitch) {
    // グループ内の最初の表示中タブを自動選択
    const navEl = document.getElementById('nav-'+group);
    if (navEl) {
      const firstTab = navEl.querySelector('.ntab:not(.hide)');
      if (firstTab) firstTab.click();
    }
  }
}

let _skipHistoryPush = false;
// リロード後の自動再ログイン時に、直前まで見ていたページへ復帰できるよう
// pushState済みのhistory.stateから復元する（file://再読込でもstateは維持される）
function getSavedHistoryPage(key) {
  const n = history.state ? history.state[key] : null;
  return (typeof n === 'number') ? n : null;
}
function goPage(n,el){
  if (n!==18 && document.body.classList.contains('entry-fullscreen')) toggleEntryFullscreen();
  if (n!==27) unsubscribeChatTabRealtime();
  if (n!==30) unsubscribeChatGroupRealtime();
  for(let i=0; i<=33; i++){ const p=document.getElementById('pg'+i); if(p) p.classList.add('hide'); }
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('on'));
  const target = document.getElementById('pg'+n);
  if(target) target.classList.remove('hide');
  if(el) el.classList.add('on');
  // 所属グループのナビに自動切替（ページ遷移は伴わない）
  const grp = PAGE_GROUP[n];
  if (grp) switchNavGroup(grp, true);
  if(n===0)renderInv();
  if(n===1){populateYearSelect('dashYear',true);renderDash();}
  if(n===23){populateYearSelect('anaCliYear',true);renderCliAnalysis();}
  if(n===24){populateYearSelect('anaDrvYear',true);renderDrvAnalysis();}
  if(n===2){renderDrv();const needDocs=!driverDocs.length;Promise.all([needDocs?loadDriverDocs():Promise.resolve(),loadDriverChatUnread()]).then(()=>renderDrv());}
  if(n===3)renderCli();
  if(n===26){renderVehicles();loadDailyReportVehicleMismatches().then(()=>renderVehicles());}
  if(n===4)loadLogs();
  if(n===5)renderUsr();
  if(n===6){initAggPay();runAggPay();}
  if(n===8){initCal();renderCal();}
  if(n===28){initStaffSched();loadStaffSchedules().then(()=>renderStaffSchedCal());}
  // タスク管理の4画面は1つのナビタブ配下のサブタブとして扱う
  if([29,31,32,33].includes(n)) renderTaskSubnav(n);
  if(n===29){initBillingProgress();loadBillingProgress().then(()=>renderBillingProgress());}
  if(n===31){initTaskTop();}
  if(n===32){initDriverProgress();loadDriverProgress().then(()=>renderDriverProgress());}
  if(n===33){initPersonalTasks();loadPersonalTasks().then(()=>renderPersonalTasks());}
  if(n===9){const el=document.getElementById('schedGenMonth');if(el&&!el.value)el.value=prevMonthStr();loadSched().then(()=>renderSched()).then(()=>syncPaySchedule(el?.value));}
  if(n===22){const el=document.getElementById('receiptGenMonth');if(el&&!el.value)el.value=prevMonthStr();loadReceiptSched().then(()=>renderReceiptSched()).then(()=>syncReceiptSchedule(el?.value));}
  if(n===10){_setDailyListMonth();initMob();}
  if(n===11){initClose();}
  if(n===12){initMonthlyReport();renderMonthlyReport();}
  if(n===14){loadBoard(true);}
  if(n===27){initChatTab();}
  if(n===30){initGroupChatTab();}
  if(n===15){initPaymentIn();}
  if(n===17){renderSetupPage();}
  if(n===18){switchEntryTab();}
  // ブラウザの「戻る」でシステム内の一つ前の画面に戻れるよう、画面遷移のたびに履歴を積む
  // （popstateからの復元時はpushStateし直さない）
  if (!_skipHistoryPush) {
    try { history.pushState({ppage:n}, '', location.href); } catch(e) {}
  }
}
window.addEventListener('popstate', (ev) => {
  if (document.getElementById('pgLogin') && !document.getElementById('pgLogin').classList.contains('hide')) return;
  // モーダルが開いている場合は、画面遷移よりも先に「戻る」でそのモーダルを閉じるだけにする
  // （スマホ利用者が閉じるボタンを毎回タップしなくても、戻る操作で閉じられるようにするため）
  const openModal = document.querySelector('.overlay.on');
  if (openModal) { openModal.classList.remove('on'); return; }
  const state = ev.state || {};
  _skipHistoryPush = true;
  try {
    if (state.dpage !== undefined && state.dpage !== null) goDrvPage(state.dpage);
    else if (state.ppage !== undefined && state.ppage !== null) goPage(state.ppage);
  } finally { _skipHistoryPush = false; }
});
// モーダルが開かれた瞬間（.overlayにonクラスが付いた瞬間）に履歴を1件積んでおく。
// 個々のモーダルを開く関数（openXxxM等）を1つずつ書き換えずに済むよう、DOM監視で共通対応する
document.querySelectorAll('.overlay').forEach(overlay => {
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.attributeName === 'class' && overlay.classList.contains('on') && !_skipHistoryPush) {
        try { history.pushState({modalOpen:true}, '', location.href); } catch(e) {}
        break;
      }
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
});

// ⚠️ ここにあった余分な if(n===6) や閉じ括弧 } はきれいに削除しました

function rebuildCliFilter(){
  const sel=document.getElementById('scli');
  if(sel){sel.innerHTML='<option value="">全取引先</option>'+clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');enhanceSelectSearchable('scli');}
  const fm=document.getElementById('fCli');
  if(fm){fm.innerHTML='<option value="">未設定</option>'+clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');enhanceSelectSearchable('fCli');}
}
/* ===== INVOICE LIST ===== */
// 締日フィルタの選択肢を、登録済み取引先の締日（重複なし）から再構築する
function populateClosingFilter() {
  const sel = document.getElementById('sClosing');
  if (!sel) return;
  const cur = sel.value;
  const days = [...new Set(clients.map(c => c.closing_day ?? 'end'))]
    .sort((a,b) => (a==='end'?32:+a) - (b==='end'?32:+b));
  sel.innerHTML = '<option value="">全締日</option>' + days.map(d => `<option value="${d}">${closingDayLabel(d)}締め</option>`).join('');
  sel.value = [...sel.options].some(o=>o.value===cur) ? cur : '';
}
function filt(){
  populateClosingFilter();
  const q=nm(document.getElementById('sq').value||'');
  const d1=document.getElementById('sd1').value,d2=document.getElementById('sd2').value;
  const tf=document.getElementById('stf').value,sf=document.getElementById('ssf').value,cf=document.getElementById('scli').value;
  const closingF=document.getElementById('sClosing')?.value||'';
  const filtered=recs.filter(r=>{
    const c=lkC(r.cli);
    if(q){if(!nm(r.car).includes(q)&&!(c&&nm(c.name).includes(q)))return false;}
    if(d1&&r.date<d1)return false;if(d2&&r.date>d2)return false;
    if(tf==='un'&&recDrv(r))return false;
    if(tf==='charter'&&r.type!=='charter')return false;if(tf==='regular'&&r.type!=='regular')return false;
    if(tf==='other'&&(r.type==='charter'||r.type==='regular'))return false;
    if(sf!==''&&String(r.st)!==sf)return false;
    if(cf!==''&&String(r.cli||'')!==cf)return false;
    if(closingF!==''&&String(c?.closing_day??'end')!==closingF)return false;
    return true;
  });
  // 日付ソート
  return filtered.sort((a,b)=>sortMode==='desc'?b.date.localeCompare(a.date):a.date.localeCompare(b.date));
}
// 「総件数」等のKPIカードは集計期間ピッカー（aggInvFrom/To・aggPayFrom/To）の選択範囲に連動させる。
// 両方とも未入力の場合のみ全期間（recs全体）にフォールバックする
function periodRecs(fromId, toId) {
  const from = document.getElementById(fromId)?.value || '';
  const to = document.getElementById(toId)?.value || '';
  if (!from && !to) return recs;
  return recs.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
}
// 月別内訳パネルはKPIカードと違い、期間に関わらず全期間の月ごとの内訳を見せる用途のためrecs全体を使う
function computeMonthlyTypeBreakdown() {
  const byMonth = {};
  recs.forEach(r => {
    const mo = (r.date||'').slice(0,7);
    if (!mo) return;
    if (!byMonth[mo]) byMonth[mo] = { total:0, regular:0, charter:0, other:0, un:0 };
    byMonth[mo].total++;
    if (r.type==='charter') byMonth[mo].charter++;
    else if (r.type==='regular') byMonth[mo].regular++;
    else byMonth[mo].other++;
    if (!recDrv(r)) byMonth[mo].un++;
  });
  return byMonth;
}
function toggleMonthlyBreakdown(containerId, btnId) {
  const el = document.getElementById(containerId);
  const btn = document.getElementById(btnId);
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? 'block' : 'none';
  if (btn) btn.textContent = show ? '📅 月別内訳を隠す' : '📅 月別内訳を表示';
  if (show) renderMonthlyBreakdownTable(containerId);
}
function renderMonthlyBreakdownTable(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const byMonth = computeMonthlyTypeBreakdown();
  const months = Object.keys(byMonth).sort();
  if (!months.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:6px 0">データがありません</div>'; return; }
  const cell = (v, warn) => `<td style="padding:5px 10px;text-align:right;border:0.5px solid var(--border);${warn&&v?'color:var(--red-text)':''}">${v}件</td>`;
  const sum = (key) => months.reduce((a,mo)=>a+byMonth[mo][key],0);
  el.innerHTML = `<table style="border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--bg2)">
      <th style="padding:5px 10px;text-align:left;border:0.5px solid var(--border)">対象月</th>
      <th style="padding:5px 10px;text-align:right;border:0.5px solid var(--border)">総件数</th>
      <th style="padding:5px 10px;text-align:right;border:0.5px solid var(--border)">定期集配</th>
      <th style="padding:5px 10px;text-align:right;border:0.5px solid var(--border)">チャーター</th>
      <th style="padding:5px 10px;text-align:right;border:0.5px solid var(--border)">その他</th>
      <th style="padding:5px 10px;text-align:right;border:0.5px solid var(--border)">未配車</th>
    </tr></thead>
    <tbody>${months.map(mo=>{
      const d = byMonth[mo];
      return `<tr><td style="padding:5px 10px;border:0.5px solid var(--border);font-weight:500">${mo}</td>${cell(d.total)}${cell(d.regular)}${cell(d.charter)}${cell(d.other)}${cell(d.un,true)}</tr>`;
    }).join('')}
    <tr style="font-weight:600;background:var(--bg2)"><td style="padding:5px 10px;border:0.5px solid var(--border)">合計</td>${cell(recs.length)}${cell(sum('regular'))}${cell(sum('charter'))}${cell(sum('other'))}${cell(sum('un'),true)}</tr>
    </tbody>
  </table>`;
}
// 請求合計（totbar）を更新する。KPIカード・集計エリアと同じ「集計期間」に連動させている
// （一覧の検索欄の日付(sd1/sd2)とは別軸。支払明細書作成タブの支払合計と同じ考え方に揃えている）。
// runAggInv()から集計期間変更のたびに呼ばれるほか、renderInv()の初回描画時にも呼ばれる
function renderInvTotalBar(){
  if (!document.getElementById('totLbl')) return;
  const totRows=aggInvFilteredRecs();
  const isF=totRows.length!==recs.length;
  document.getElementById('totLbl').textContent=isF?'請求合計（絞り込み中）':'請求合計（全件）';
  const tF=totRows.reduce((a,r)=>a+(r.fare||0),0);
  const bAll=totRows.reduce((a,r)=>{const b=feeBreakdown(r,'billing');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other};},{hw:0,oth:0,other:0});
  const tS=tF+totRows.reduce((a,r)=>a+(r.hw||0)+(r.oth||0),0),tT=totRows.reduce((a,r)=>a+rtax(r),0);
  const tExtra=sumRecsExtraFees(totRows,'billing'); // 受注入力の追加料金（請求／両方指定分、税込ベース）
  document.getElementById('tMain').textContent=yen(taxMode==='inc'?tS+tT+tExtra:tS);
  document.getElementById('tFare').textContent=yen(tF);document.getElementById('tHw').textContent=yen(bAll.hw);document.getElementById('tOth').textContent=yen(bAll.oth);
  document.getElementById('tExtraOther').textContent=yen(bAll.other);
  document.getElementById('tSub').textContent=yen(tS);document.getElementById('tTax').textContent=yen(tT);
  document.getElementById('thTot').textContent='合計('+(taxMode==='inc'?'税込':'税別')+')';
}
let _aggInvInitialized = false; // 集計期間の初回リセット制御（以前は削除済みのサブタブボタンのonクラスで判定していた）
function renderInv(){
  // pg0集計エリア初期化（受注入力はpg18に移動済みのため集計のみ）。
  // どちらの経路でもrunAggInv()が呼ばれ、その中でrenderInvTotalBar()も更新される
  if (!_aggInvInitialized && typeof switchP0Tab === 'function') {
    _aggInvInitialized = true;
    switchP0Tab(1); // 初回のみ：集計期間を前月にリセットして集計
  } else if (typeof runAggInv === 'function') {
    runAggInv(); // 2回目以降：期間は維持したまま最新のrecsで再集計（他タブでの編集直後の反映漏れを防止）
  }
  const rows=filt();
  updateInvMetCards();
  renderPayMets();
  const ua=document.getElementById('uAlert');
  const unCars=[...new Set(recs.filter(r=>!recDrv(r)).map(r=>r.car))];
  if(unCars.length){ua.classList.remove('hide');ua.innerHTML=`<div class="alert-bar">⚠ 未配車の車番: ${unCars.join('、')}</div>`;}else ua.classList.add('hide');
  const canEd=me&&me.role!=='viewer',hasSel=selIds.size>0;
  document.getElementById('bDup').classList.toggle('hide',!canEd||!hasSel);
  document.getElementById('bDel').classList.toggle('hide',!canEd||!hasSel);
  const tb=document.getElementById('tbody');
  if(!rows.length){tb.innerHTML=`<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--text2)">データがありません</td></tr>`;return;}
  tb.innerHTML=rows.map(r=>{
    const d=recDrv(r),c=lkC(r.cli),s=sub(r),t=rtax(r),extraR=sumRecsExtraFees([r],'billing'),tot_=taxMode==='inc'?s+t+extraR:s;
    const fb=feeBreakdown(r,'billing');
    const nz=v=>v?`<td class="r">${yen(v)}</td>`:`<td class="r dim">—</td>`;
    const chk=selIds.has(r.id);
    return`<tr${chk?' style="background:var(--blue-bg)"':''}>
      <td><input type="checkbox" class="chk"${chk?' checked':''} onchange="toggleSel(${r.id},this.checked)"></td>
      <td>${r.date}</td>
      <td style="font-weight:500;max-width:96px;overflow:hidden;text-overflow:ellipsis">${escHtml(canonicalCar(r.car))}</td>
      <td style="max-width:76px;overflow:hidden;text-overflow:ellipsis">${d?escHtml(d.name):`<span class="bdg un">未配車</span>`}</td>
      <td style="max-width:78px;overflow:hidden;text-overflow:ellipsis">${c?`<span style="font-size:11px;cursor:pointer;color:var(--blue);text-decoration:underline dotted" onclick="editCli(${c.id})" title="取引先管理で開く">${escHtml(c.short||c.name)}</span>`:'<span class="dim">—</span>'}</td>
      <td><span class="bdg ${typeBadge(r.type)}">${typeShort(r.type)}</span></td>
      ${nz(r.fare)}${nz(fb.hw)}${nz(fb.oth)}
      <td class="r" style="font-weight:500">${yen(tot_)}<div style="font-size:9px;color:var(--text2)">${r.tax===0?'非課税':r.tax+'%'}</div></td>
      <td>${stLbl(r.st)?`<span class="bdg ${stCls(r.st)}">${stLbl(r.st)}</span>`:''}</td>
      <td class="dim" style="max-width:54px;overflow:hidden;text-overflow:ellipsis">${escHtml(r.note)}</td>
      <td style="white-space:nowrap">${canEd?`<button class="ibtn" onclick="editInv(${r.id})">✎</button><button class="ibtn" onclick="delInv(${r.id})">🗑</button>`:''}</td>
    </tr>`;
  }).join('');
}
function setSort(mode){
  sortMode=mode;
  document.getElementById('bSortDesc').classList.toggle('on',mode==='desc');
  document.getElementById('bSortAsc').classList.toggle('on',mode==='asc');
  document.getElementById('sortIcon').textContent=mode==='desc'?'↓':'↑';
  renderInv();
}
function toggleSort(){setSort(sortMode==='desc'?'asc':'desc');}
function setTax(m){taxMode=m;document.getElementById('bInc').classList.toggle('on',m==='inc');document.getElementById('bExc').classList.toggle('on',m==='exc');document.getElementById('bIncP')?.classList.toggle('on',m==='inc');document.getElementById('bExcP')?.classList.toggle('on',m==='exc');renderInv();}
// 支払明細書作成タブ（pg6）用のKPIサマリー。請求側(renderInv)と同様、集計期間・種別・取引先・
// ドライバー検索の絞り込みを反映する（以前は絞り込みを無視してrecs全件を合計してしまっていた）
function renderPayMets(){
  if(!document.getElementById('mTotP'))return;
  updatePayMetCards();
  const rows=aggPayFilteredRecs();
  const isF=rows.length!==recs.length;
  document.getElementById('totLblP').textContent=isF?'支払合計（絞り込み中）':'支払合計（全件）';
  const tF=rows.reduce((a,r)=>a+fareBySide(r,'payment'),0);
  const bAll=rows.reduce((a,r)=>{const b=feeBreakdown(r,'payment');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other};},{hw:0,oth:0,other:0});
  const tS=tF+rows.reduce((a,r)=>a+hwRawBySide(r,'payment')+othRawBySide(r,'payment'),0);
  const tT=rows.reduce((a,r)=>a+rtaxBySide(r,'payment'),0);
  const tExtra=sumRecsExtraFees(rows,'payment');
  document.getElementById('tMainP').textContent=yen(taxMode==='inc'?tS+tT+tExtra:tS);
  document.getElementById('tFareP').textContent=yen(tF);
  document.getElementById('tHwP').textContent=yen(bAll.hw);
  document.getElementById('tOthP').textContent=yen(bAll.oth);
  document.getElementById('tExtraOtherP').textContent=yen(bAll.other);
  document.getElementById('tSubP').textContent=yen(tS);
  document.getElementById('tTaxP').textContent=yen(tT);
}
function clrF(){['sq','sd1','sd2'].forEach(id=>document.getElementById(id).value='');['stf','ssf','scli','sClosing'].forEach(id=>document.getElementById(id).value='');renderInv();}
function toggleSel(id,v){if(v)selIds.add(id);else selIds.delete(id);renderInv();}
function toggleAll(v){filt().forEach(r=>v?selIds.add(r.id):selIds.delete(r.id));renderInv();}

async function dupSel(){
  const today=fmtLocalDate(new Date());
  showLoad(true);
  try{
    const inserts=targets.map(r=>({date:today,car:r.car,type:r.type,fare:r.fare||0,hw:r.hw||0,oth:r.oth||0,tax:(r.tax??10),st:0,cli:r.cli||null,note:r.note||''}));
    const{data,error}=await sb.from('invoices').insert(inserts).select();
    if(error)throw error;
    recs=[...data,...recs];
    addLog('複製',`${targets.length}件を複製`);
    selIds=new Set();renderInv();showT(`${targets.length}件を複製しました`);
  }catch(e){showT('複製エラー: '+e.message,'ter');}
  showLoad(false);
}
async function delSel(){
  if(!confirm(`${selIds.size}件を削除しますか？`))return;
  showLoad(true);
  try{
    const ids=[...selIds];
    const{error}=await sb.from('invoices').delete().in('id',ids);
    if(error)throw error;
    addLog('一括削除',`${ids.length}件`);
    const affectedMonths=[...new Set(recs.filter(r=>selIds.has(r.id)).map(r=>(r.date||'').slice(0,7)).filter(Boolean))];
    recs=recs.filter(r=>!selIds.has(r.id));selIds=new Set();
    affectedMonths.forEach(m=>{syncPaySchedule(m);syncReceiptSchedule(m);});
    renderInv();showT('削除しました');
  }catch(e){showT('削除エラー: '+e.message,'ter');}
  showLoad(false);
}

function openInvM(){eInvId=null;clrInvF();populateDrvSel();document.getElementById('mInv').classList.add('on');}
// ドライバー手動選択欄（手入力検索用）の候補リストを最新のdrvsから再構築（値がまだあれば維持）
function populateDrvSel(){
  const dl=document.getElementById('fDrvSelList');
  if(!dl)return;
  dl.innerHTML=activeDrvs().map(d=>`<option value="${escHtml(q0DrvOverrideLabel(d))}">`).join('');
}
// ドライバー手入力検索欄: 候補と完全一致すればhidden項目(id)へ反映、一致しなければ自動判定に戻す
function onFDrvSelTextInput(){
  const val=document.getElementById('fDrvSelText').value.trim();
  const match=drvs.find(d=>q0DrvOverrideLabel(d)===val)||drvs.find(d=>d.name===val);
  document.getElementById('fDrvSel').value=match?match.id:'';
  prvDrv();
}
// id指定でドライバー手動選択欄の表示を合わせる（編集読み込み時など）
function setFDrvSelById(id){
  const d=id?drvs.find(x=>String(x.id)===String(id)):null;
  document.getElementById('fDrvSel').value=d?d.id:'';
  document.getElementById('fDrvSelText').value=d?q0DrvOverrideLabel(d):'';
}
function clrInvF(){['fD','fCa','fFa','fHw','fOt','fPayFa','fPayHw','fPayOt','fNo'].forEach(id=>document.getElementById(id).value='');document.getElementById('fTy').value='charter';document.getElementById('fTx').value='10';document.getElementById('fSt').value='0';document.getElementById('fCli').value='';document.getElementById('fDrvSel').value='';document.getElementById('fDrvSelText').value='';const el=document.getElementById('fDpv');el.textContent='—';el.style.color='var(--text2)';document.getElementById('mTotV').textContent='¥0';}
// 同じ車両を複数人で稼働することがあるため、fDrvSelで手動選択されていればそれを優先表示する
function prvDrv(){
  const c=document.getElementById('fCa').value,el=document.getElementById('fDpv'),sel=document.getElementById('fDrvSel');
  if(sel&&sel.value){const d=drvs.find(x=>x.id===+sel.value);el.textContent=d?'✓ 手動選択: '+d.name:'—';el.style.color='var(--blue)';return;}
  const d=lkD(c);
  if(d){el.textContent='自動判定: '+d.name;el.style.color='var(--text2)';}else if(c.trim()){el.innerHTML='<span style="color:var(--red)">⚠ 未配車（車番未登録、または手動選択してください）</span>';}else{el.textContent='—';el.style.color='var(--text2)';}
}
function calcMT(){const f=+document.getElementById('fFa').value||0,h=+document.getElementById('fHw').value||0,o=+document.getElementById('fOt').value||0,t=+document.getElementById('fTx').value||0;document.getElementById('mTotV').textContent=yen(f+h+o+Math.round((f+h+o)*t/100));}
function editInv(id){const r=recs.find(x=>x.id===id);if(!r)return;eInvId=id;populateDrvSel();document.getElementById('fD').value=r.date;document.getElementById('fCa').value=r.car;document.getElementById('fTy').value=r.type;document.getElementById('fFa').value=r.fare||0;document.getElementById('fHw').value=r.hw||0;document.getElementById('fOt').value=r.oth||0;document.getElementById('fPayFa').value=r.pay_fare||0;document.getElementById('fPayHw').value=r.pay_hw||0;document.getElementById('fPayOt').value=r.pay_oth||0;document.getElementById('fTx').value=(r.tax??10);document.getElementById('fSt').value=r.st||0;document.getElementById('fCli').value=r.cli||'';document.getElementById('fNo').value=r.note||'';setFDrvSelById(r.drv_id);prvDrv();calcMT();document.getElementById('mInv').classList.add('on');}
async function delInv(id){
  if(!confirm('削除しますか？'))return;
  try{const{error}=await sb.from('invoices').delete().eq('id',id);if(error)throw error;const r=recs.find(x=>x.id===id);addLog('削除',`${r?.car} ${r?.date}`);recs=recs.filter(r=>r.id!==id);if(r?.date){syncPaySchedule(r.date.slice(0,7));syncReceiptSchedule(r.date.slice(0,7));}renderInv();showT('削除しました');}
  catch(e){showT('削除エラー: '+e.message,'ter');}
}
async function saveInv(){
  const date=document.getElementById('fD').value,car=document.getElementById('fCa').value.trim();
  if(!date||!car){alert('日付・車番は必須です');return;}
  const obj={date,car,type:document.getElementById('fTy').value,fare:+document.getElementById('fFa').value||0,hw:+document.getElementById('fHw').value||0,oth:+document.getElementById('fOt').value||0,pay_fare:+document.getElementById('fPayFa').value||0,pay_hw:+document.getElementById('fPayHw').value||0,pay_oth:+document.getElementById('fPayOt').value||0,tax:+document.getElementById('fTx').value||10,st:+document.getElementById('fSt').value||0,cli:+document.getElementById('fCli').value||null,note:document.getElementById('fNo').value.trim(),drv_id:+document.getElementById('fDrvSel').value||null};
  showLoad(true);
  try{
    if(eInvId!==null){
      const{data,error}=await sb.from('invoices').update(obj).eq('id',eInvId).select().single();
      if(error)throw error;
      const idx=recs.findIndex(x=>x.id===eInvId);if(idx>=0)recs[idx]={...recs[idx],...data};
      addLog('編集',`${car} ${date}`);
    }else{
      const{data,error}=await sb.from('invoices').insert(obj).select().single();
      if(error)throw error;
      recs.unshift(data);addLog('追加',`${car} ${date}`);
    }
    closeM('mInv');renderInv();showT(eInvId!==null?'更新しました':'追加しました');
  }catch(e){
    if(e.message.includes('pay_fare')||e.message.includes('pay_hw')||e.message.includes('pay_oth')){
      showT('保存エラー: invoicesテーブルにpay_fare等のカラムが必要です。セットアップページのSQLを確認してください','ter');
    }else{
      showT('保存エラー: '+e.message,'ter');
    }
  }
  showLoad(false);
}

/* ===== DASHBOARD =====
   取引先別・ドライバー別の内訳は「取引先・ドライバー分析」タブ（pg23/renderAnalysis）に分離済み。
   ダッシュボードは全体の売上サマリーと警告だけに絞る。 */
function renderDash(){
  const da=document.getElementById('dashArea');
  // 年報タブと共通の年選択（空="全期間"）で対象レコードを絞り込む
  const dashYear=document.getElementById('dashYear')?.value||'';
  const dashRecs=dashYear?recs.filter(r=>r.date&&r.date.startsWith(dashYear)):recs;
  const byM={};dashRecs.forEach(r=>{const m=r.date.slice(0,7);if(!byM[m])byM[m]={s:0,cnt:0};byM[m].s+=totR(r,taxMode);byM[m].cnt++;});
  const months=Object.keys(byM).sort(),maxM=Math.max(1,...months.map(m=>byM[m].s));
  const ch=dashRecs.filter(r=>r.type==='charter').length,re=dashRecs.filter(r=>r.type==='regular').length,ot=dashRecs.length-ch-re,tot_=dashRecs.length||1;
  const invoicedCnt=dashRecs.filter(r=>r.st===3).length, paidCnt=dashRecs.filter(r=>r.st===4).length;
  const totAmt=dashRecs.reduce((a,r)=>a+sub(r),0),totTax=dashRecs.reduce((a,r)=>a+rtax(r),0);
  // 内訳・ステータスの中身（全期間時は単独で全幅表示、年選択時は月次推移と横並びにするため半幅でbuildYearReportHtmlに渡す）
  const statusInner = `
      <div class="ctitle">📊 内訳・ステータス</div>
      <div style="font-size:10px;color:var(--text2);margin-bottom:5px">税込合計: <b>${yen(totAmt+totTax)}</b>（消費税 ${yen(totTax)}）</div>
      <div style="margin-bottom:7px"><div style="font-size:10px;color:var(--text2);margin-bottom:3px">種別</div>
        <div class="pirow"><div class="dot" style="background:var(--green)"></div>定期集配(個人・企業)<span style="margin-left:auto;font-weight:500">${re}件 (${Math.round(re/tot_*100)}%)</span></div>
        <div class="pirow"><div class="dot" style="background:var(--blue)"></div>チャーター・スポット便<span style="margin-left:auto;font-weight:500">${ch}件 (${Math.round(ch/tot_*100)}%)</span></div>
        <div class="pirow"><div class="dot" style="background:#EF9F27"></div>その他<span style="margin-left:auto;font-weight:500">${ot}件 (${Math.round(ot/tot_*100)}%)</span></div>
      </div>
      <div><div style="font-size:10px;color:var(--text2);margin-bottom:3px">請求・入金ステータス</div>
        <div class="pirow"><div class="dot" style="background:#1D4ED8"></div>請求済<span style="margin-left:auto;font-weight:500">${invoicedCnt}件</span></div>
        <div class="pirow"><div class="dot" style="background:var(--green)"></div>入金済<span style="margin-left:auto;font-weight:500">${paidCnt}件</span></div>
      </div>`;
  // 年を選択している場合は、下部の年間サマリー（buildYearReportHtml）に同じ内容がより詳しく出るため、
  // 月別売上は全期間表示のときだけ出す（重複表示防止）。取引先別・ドライバー別の内訳は分析タブ側にのみ表示する。
  da.innerHTML=`
    <div class="cwrap" id="dashWarnings" style="grid-column:1/-1">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)"><span class="ctitle" style="margin-bottom:0">⚠ 警告</span>確認中…</div>
    </div>
    ${!dashYear?`<div class="cwrap" style="grid-column:1/-1">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div class="ctitle" style="margin-bottom:0">📅 月別売上（${taxMode==='inc'?'税込':'税別'}）</div>
        <div class="txtog"><button class="${taxMode==='inc'?'on':''}" onclick="setTaxDash('inc')">税込</button><button class="${taxMode==='exc'?'on':''}" onclick="setTaxDash('exc')">税別</button></div>
      </div>
      ${months.length?months.map(m=>{const p=Math.round(byM[m].s/maxM*100);return`<div class="brow"><div class="blbl">${m}</div><div class="btrack"><div class="bfill" style="width:${p}%;background:var(--blue)"></div></div><div class="bval">${yen(byM[m].s)} <span style="color:var(--text2)">${byM[m].cnt}件</span></div></div>`;}).join(''):'<div style="color:var(--text2);font-size:11px;padding:6px 0">データなし</div>'}
    </div>
    <div class="cwrap" style="grid-column:1/-1">${statusInner}</div>`:''}`;
  // 年を選択している場合のみ、年間サマリー（年間KPI＋月次推移＋内訳ステータス＋5年比較表）を末尾に追加表示する
  if (dashYear) da.insertAdjacentHTML('beforeend', buildYearReportHtml(dashYear, `<div class="cwrap">${statusInner}</div>`));
  renderKpiCards();
  renderDashWarnings();
}

// ダッシュボードの警告パネル：未確認請求・未配車・書類期限・日報未提出・支払入金遅延・掲示板新着・バックアップ状況をまとめて表示する
// （renderDashの末尾から呼ばれる非同期処理。以前はログイン直後のポップアップ通知(runLoginNotifications)で別々に出していたが、
//   このパネルと重複するため廃止しここに統合した）
async function renderDashWarnings(){
  const items=[]; // {sev:'red'|'amber', icon, text, btn, go, nt}

  const unC=recs.filter(r=>!recDrv(r)).length;
  if(unC)items.push({sev:'amber',icon:'🚚',text:`未配車の車番: ${unC}件`,btn:'請求明細一覧へ',go:0,nt:'nt0'});

  const backupMsg=checkBackupReminder();
  if(backupMsg)items.push({sev:'amber',icon:'💾',text:backupMsg.replace(/^💾\s*/,''),btn:'セットアップへ',go:17,nt:'nt17'});

  // 掲示板・ドライバー書類/チャット・日報・支払/入金予定の各チェックは互いに独立したSupabase問い合わせのため、
  // 直列にawaitすると往復回数分（ログイン直後は特に体感できるほど）待たされていた。まとめて並行実行する
  const checkBoard = async () => {
    try{
      const boardMsg=await checkBoardAlerts();
      if(boardMsg)items.push({sev:'amber',icon:'📢',text:boardMsg.replace(/^📢\s*/,''),btn:'掲示板へ',go:14,nt:'nt14'});
    }catch(e){console.warn('renderDashWarnings(掲示板):',e.message);}
  };

  const checkDrivers = async () => {
    if(!drvs.length)return;
    let nt2Warn=false;
    try{
      await loadDriverDocs();
      const issues=summarizeDocAlerts();
      const expired=issues.filter(i=>i.st.cls==='expired').length;
      const soon=issues.filter(i=>i.st.cls==='soon').length;
      if(expired){items.push({sev:'red',icon:'📄',text:`ドライバー書類の期限切れ: ${expired}件`,btn:'ドライバー管理へ',go:2,nt:'nt2'});nt2Warn=true;}
      if(soon){items.push({sev:'amber',icon:'📄',text:`ドライバー書類の期限間近: ${soon}件`,btn:'ドライバー管理へ',go:2,nt:'nt2'});nt2Warn=true;}
      // 本人にもLINE/メールで通知（同じ書類・同じ期限日については一度だけ。期限日が更新されたら再通知される）
      issues.forEach(i=>{
        const expiry = findDriverDoc(i.drv.id, i.t.key)?.expiry_date || '';
        const label = i.st.cls==='expired' ? '期限切れ' : '期限間近';
        notifyDrivers([i.drv.id], 'doc_expiry', `doc-${i.t.key}-${expiry}`, `書類の${label}: ${i.t.label}`, `${i.t.label}が${label}です（期限: ${expiry||'未登録'}）。ポータルの書類タブから更新してください。`, true);
      });
    }catch(e){console.warn('renderDashWarnings(書類):',e.message);}

    try{
      await loadDriverChatUnread();
      if(driverChatUnreadIds.size){items.push({sev:'amber',icon:'💬',text:`未読のドライバーチャット: ${driverChatUnreadIds.size}名`,btn:'ドライバー管理へ',go:2,nt:'nt2'});nt2Warn=true;}
      setNavWarnDot('nt27', driverChatUnreadIds.size>0); // チャット専用タブにも同じ未読を反映
    }catch(e){console.warn('renderDashWarnings(チャット):',e.message);}

    // ドライバー管理タブ(nt2)は書類期限・未読チャットのどちらかがあれば赤丸を出す（以前はログイン時の別処理が担っていたが、通知パネル統合時に呼び出しごと削除されていたため復旧）
    setNavWarnDot('nt2', nt2Warn);
  };

  const checkDailyReports = async () => {
    try{
      if(sb && recs.length){
        const now=new Date();
        const thisM=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const invDates=new Set(recs.filter(r=>r.date?.startsWith(thisM)).map(r=>r.date));
        if(invDates.size){
          const[y,m]=thisM.split('-');
          const{data,error}=await sb.from('daily_reports').select('date').gte('date',`${y}-${m}-01`).lte('date',fmtLocalDate(new Date(+y,+m,0)));
          if(!error){
            const drDates=new Set((data||[]).map(r=>r.date));
            const missing=[...invDates].filter(d=>!drDates.has(d));
            if(missing.length)items.push({sev:'amber',icon:'📱',text:`日報未提出の稼働日: ${missing.length}日（今月）`,btn:'日報管理へ',go:10,nt:'nt10'});
          }
        }
      }
    }catch(e){console.warn('renderDashWarnings(日報):',e.message);}
  };

  const checkSchedules = async () => {
    try{
      const today=fmtLocalDate(new Date());
      if(!receiptSchedData.length) await loadReceiptSched().catch(()=>{});
      const payOverdue=schedData.filter(s=>!s.done&&s.date<today).length;
      const recvOverdue=receiptSchedData.filter(s=>!s.done&&s.date<today).length;
      if(payOverdue)items.push({sev:'red',icon:'💳',text:`支払予定の期限超過: ${payOverdue}件`,btn:'支払スケジュールへ',go:9,nt:'nt9'});
      if(recvOverdue)items.push({sev:'red',icon:'💰',text:`入金予定の期限超過: ${recvOverdue}件`,btn:'入金スケジュールへ',go:22,nt:'nt22'});
    }catch(e){console.warn('renderDashWarnings(スケジュール):',e.message);}
  };

  // 他人から自分あてに来た個人タスクの依頼
  const checkMyRequests = async () => {
    try{
      if(!me) return;
      await loadPersonalTasks();
      // 受け取り側がレ点を付けた依頼は ptIncomingRequests() から外れるため、ここにも出なくなる
      const mine = ptIncomingRequests();
      if(!mine.length) return;
      const over  = mine.filter(ptIsOverdue).length;
      const uname = id => users.find(u=>String(u.id)===String(id))?.name || '';
      // 依頼者が1人ならその名前を出す（誰から来た依頼か分かるように）
      const froms = [...new Set(mine.map(t=>uname(t.requester_user_id)).filter(Boolean))];
      const fromLabel = froms.length === 1 ? `${froms[0]}さんから ` : '';
      items.push({
        sev: over ? 'red' : 'amber',
        icon: '🙋',
        text: `${fromLabel}未確認の依頼: ${mine.length}件${over?` / 期限超過${over}件`:''}`,
        btn: '個人タスクへ', go: 33, nt: 'nt31',
      });
    }catch(e){console.warn('renderDashWarnings(個人タスク):',e.message);}
  };

  const checkGroupChat = async () => {
    try{
      if(!me) return;
      const [{data:groups}, {data:msgs}, {data:reads}] = await Promise.all([
        sb.from('chat_groups').select('id'),
        sb.from('chat_group_messages').select('group_id,created_at').order('created_at',{ascending:false}).limit(500),
        sb.from('chat_group_reads').select('group_id,last_read_at').eq('member_key','staff:'+me.id)
      ]);
      const lastByGroup={}; (msgs||[]).forEach(m=>{if(!lastByGroup[m.group_id])lastByGroup[m.group_id]=m.created_at;});
      const readByGroup={}; (reads||[]).forEach(r=>{readByGroup[r.group_id]=r.last_read_at;});
      const unreadCount=(groups||[]).filter(g=>{
        const last=lastByGroup[g.id]; if(!last) return false;
        const read=readByGroup[g.id]; return !read||read<last;
      }).length;
      if(unreadCount)items.push({sev:'amber',icon:'👥',text:`未読のグループチャット: ${unreadCount}件`,btn:'グループチャットへ',go:30,nt:'nt30'});
    }catch(e){console.warn('renderDashWarnings(グループチャット):',e.message);}
  };

  await Promise.all([checkBoard(), checkDrivers(), checkDailyReports(), checkSchedules(), checkGroupChat(), checkMyRequests()]);

  // 各タブ固有の警告（未配車・掲示板・バックアップ・支払/入金予定の期限超過・日報未提出・グループチャット未読）も、
  // ダッシュボードの警告一覧に出す条件とタブの赤丸をズレなく揃えるためitemsから一括反映する
  ['nt0','nt9','nt10','nt14','nt17','nt22','nt30','nt31'].forEach(nt => setNavWarnDot(nt, items.some(it=>it.nt===nt)));
  setNavWarnDot('nt1', items.length>0);

  // renderDashが非同期処理の完了前に別の年へ切り替わっている場合、古い結果で上書きしないようにする
  const box=document.getElementById('dashWarnings');
  if(!box)return;
  if(!items.length){
    box.innerHTML=`<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--green-text)"><span class="ctitle" style="margin-bottom:0">⚠ 警告</span>✓ 現在、警告はありません</div>`;
    return;
  }
  // 1行で横並び表示（項目が多い場合は横スクロール）
  box.innerHTML=`<div style="display:flex;align-items:center;gap:8px;overflow-x:auto;padding-bottom:2px">
      <span class="ctitle" style="margin-bottom:0;flex-shrink:0">⚠ 警告（${items.length}）</span>
      ${items.map(it=>`<div onclick="goPage(${it.go},document.getElementById('${it.nt}'))" title="${it.btn}" style="display:flex;align-items:center;gap:5px;padding:5px 10px;background:var(--${it.sev==='red'?'red-bg':'amber-bg'});border:0.5px solid ${it.sev==='red'?'#F09595':'var(--amber-border)'};border-radius:99px;font-size:11px;color:var(--${it.sev==='red'?'red-text':'amber-text'});white-space:nowrap;flex-shrink:0;cursor:pointer">
        <span>${it.icon}</span><span>${it.text}</span>
      </div>`).join('')}
    </div>`;
}

function setTaxDash(m){taxMode=m;renderDash();}
function toggleExp(key){if(expanded.has(key))expanded.delete(key);else expanded.add(key);renderCliAnalysis();}
function setTaxAnaCli(m){taxMode=m;renderCliAnalysis();}
function setTaxAnaDrv(m){taxMode=m;renderDrvAnalysis();}

/* ===== 取引先分析（旧ダッシュボードの取引先別集計を分離） ===== */
function renderCliAnalysis(){
  const aa=document.getElementById('anaCliArea');
  if(!aa)return;
  const anaYear=document.getElementById('anaCliYear')?.value||'';
  const anaRecs=anaYear?recs.filter(r=>r.date&&r.date.startsWith(anaYear)):recs;
  const byCli={};anaRecs.forEach(r=>{const c=lkC(r.cli);const k=c?c.name:'未設定';if(!byCli[k])byCli[k]={s:0,cnt:0,ch:0,re:0,fare:0,hw:0,oth:0,tax:0};byCli[k].s+=totR(r,taxMode);byCli[k].cnt++;byCli[k].fare+=r.fare||0;byCli[k].hw+=r.hw||0;byCli[k].oth+=r.oth||0;byCli[k].tax+=rtax(r);if(r.type==='charter')byCli[k].ch++;else if(r.type==='regular')byCli[k].re++;});
  const cliEnt=Object.entries(byCli).sort((a,b)=>b[1].s-a[1].s);const maxC=cliEnt[0]?cliEnt[0][1].s:1;
  // 対象年を選んでも集計表は隠さず常に表示し、年別の月次実績マトリクスはその下に追加で表示する
  aa.innerHTML=`
    <div class="cwrap" style="grid-column:1/-1">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div class="ctitle" style="margin-bottom:0">🏢 取引先別 集計</div>
        <div class="txtog"><button class="${taxMode==='inc'?'on':''}" onclick="setTaxAnaCli('inc')">税込</button><button class="${taxMode==='exc'?'on':''}" onclick="setTaxAnaCli('exc')">税別</button></div>
      </div>
      <div style="overflow-x:auto"><table class="sumtbl"><thead><tr><th>取引先</th><th class="r">件数</th><th class="r">チャーター</th><th class="r">集配</th><th class="r">運賃計</th><th class="r">高速計</th><th class="r">立替計</th><th class="r">税額</th><th class="r">合計</th><th style="width:90px">割合</th><th style="width:22px"></th></tr></thead>
      <tbody>${cliEnt.map(([name,d])=>{const p=Math.round(d.s/maxC*100);const isE=expanded.has('c_'+name);return`<tr style="cursor:pointer" onclick="toggleExp('c_${escAttrJs(name)}')"><td style="font-weight:500">${escHtml(name)}</td><td class="r">${d.cnt}件</td><td class="r">${d.ch?d.ch+'件':'—'}</td><td class="r">${d.re?d.re+'件':'—'}</td><td class="r">${yen(d.fare)}</td><td class="r">${d.hw?yen(d.hw):'—'}</td><td class="r">${d.oth?yen(d.oth):'—'}</td><td class="r">${yen(d.tax)}</td><td class="r" style="font-weight:600">${yen(d.s)}</td><td><div style="display:flex;align-items:center;gap:4px"><div style="width:70px;background:var(--bg);border:0.5px solid var(--border);border-radius:2px;height:7px;overflow:hidden"><div style="width:${p}%;height:100%;background:var(--blue);border-radius:2px"></div></div><span style="font-size:10px;color:var(--text2)">${p}%</span></div></td><td style="color:var(--text2);font-size:12px">${isE?'▲':'▼'}</td></tr>${isE?anaRecs.filter(r=>{const c=lkC(r.cli);return(c?c.name:'未設定')===name;}).map(r=>`<tr class="det"><td style="padding-left:14px">${escHtml(r.date)}</td><td>${escHtml(r.car)}</td><td></td><td><span class="bdg ${typeBadge(r.type)}">${typeShort(r.type)}</span></td><td class="r">${yen(r.fare||0)}</td><td class="r">${r.hw?yen(r.hw):'—'}</td><td class="r">${r.oth?yen(r.oth):'—'}</td><td class="r">${yen(rtax(r))}</td><td class="r">${yen(totR(r,taxMode))}</td><td class="dim" colspan="2">${escHtml(r.note||'')}</td></tr>`).join(''):''}`;}).join('')}</tbody></table></div>
    </div>`;
  if(anaYear)aa.insertAdjacentHTML('beforeend', buildCliYearAnalysisHtml(anaYear));
}

/* ===== ドライバー分析（旧ダッシュボードのドライバー別売上を分離） ===== */
function renderDrvAnalysis(){
  const aa=document.getElementById('anaDrvArea');
  if(!aa)return;
  const anaYear=document.getElementById('anaDrvYear')?.value||'';
  const anaRecs=anaYear?recs.filter(r=>r.date&&r.date.startsWith(anaYear)):recs;
  const byDrv={};anaRecs.forEach(r=>{const d=recDrv(r);const k=d?d.name:'未配車';if(!byDrv[k])byDrv[k]={s:0,cnt:0,un:!d};byDrv[k].s+=totR(r,taxMode);byDrv[k].cnt++;});
  const drvEnt=Object.entries(byDrv).sort((a,b)=>b[1].s-a[1].s);const maxD=drvEnt[0]?drvEnt[0][1].s:1;
  // 対象年を選んでも売上一覧は隠さず常に表示し、年別の月次実績マトリクスはその下に追加で表示する
  aa.innerHTML=`
    <div class="cwrap" style="grid-column:1/-1">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div class="ctitle" style="margin-bottom:0">👥 ドライバー別 売上</div>
        <div class="txtog"><button class="${taxMode==='inc'?'on':''}" onclick="setTaxAnaDrv('inc')">税込</button><button class="${taxMode==='exc'?'on':''}" onclick="setTaxAnaDrv('exc')">税別</button></div>
      </div>
      ${drvEnt.map(([name,d])=>{const p=Math.round(d.s/maxD*100);return`<div class="brow"><div class="blbl" title="${escHtml(name)}">${escHtml(name)}</div><div class="btrack"><div class="bfill" style="width:${p}%;background:${d.un?'#F09595':'#1D9E75'}"></div></div><div class="bval">${yen(d.s)} <span style="color:var(--text2)">${d.cnt}件</span></div></div>`;}).join('')}
    </div>`;
  const csvBtn=document.getElementById('anaDrvYearCsvBtn');
  if(csvBtn)csvBtn.style.display=anaYear?'':'none';
  if(anaYear)aa.insertAdjacentHTML('beforeend', buildDrvYearAnalysisHtml(anaYear));
  const anaMonth=document.getElementById('anaDrvMonth')?.value||'';
  if(anaMonth)aa.insertAdjacentHTML('beforeend', buildDrvMonthBarHtml(anaMonth));
}
// 単月（YYYY-MM）だけを対象にしたドライバー別売上の棒グラフ。年間・全期間の一覧とは別に、
// 特定の月だけを素早く見比べたい場合に使う
function buildDrvMonthBarHtml(month){
  const monthRecs=recs.filter(r=>r.date&&r.date.startsWith(month));
  const byDrv={};
  monthRecs.forEach(r=>{const d=recDrv(r);const k=d?d.name:'未配車';if(!byDrv[k])byDrv[k]={s:0,cnt:0,un:!d};byDrv[k].s+=totR(r,taxMode);byDrv[k].cnt++;});
  const ent=Object.entries(byDrv).sort((a,b)=>b[1].s-a[1].s);
  const maxD=ent[0]?ent[0][1].s:1;
  if(!ent.length){
    return `<div class="cwrap" style="grid-column:1/-1"><div class="ctitle">📊 ${month} 単月 ドライバー別売上</div><div style="color:var(--text2);font-size:12px;padding:10px 0">この月のデータがありません</div></div>`;
  }
  return `<div class="cwrap" style="grid-column:1/-1">
    <div class="ctitle">📊 ${month} 単月 ドライバー別売上</div>
    ${ent.map(([name,d])=>{const p=Math.round(d.s/maxD*100);return`<div class="brow"><div class="blbl" title="${escHtml(name)}">${escHtml(name)}</div><div class="btrack"><div class="bfill" style="width:${p}%;background:${d.un?'#F09595':'#3B82F6'}"></div></div><div class="bval">${yen(d.s)} <span style="color:var(--text2)">${d.cnt}件</span></div></div>`;}).join('')}
  </div>`;
}

/* ===== DRIVERS ===== */
// モーダル内タブ切替（ドライバー登録・取引先登録で共通利用）
function switchModalTab(prefix, tab) {
  document.querySelectorAll(`#${prefix} .mtab-btn`).forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll(`#${prefix} .mtab-panel`).forEach(p => p.classList.toggle('on', p.dataset.tab === tab));
}
// 会社マスタ（取引先・協力会社）の会社を、ドライバー登録の所属会社欄のプルダウンに反映する。
/* リース会社を会社マスタに用意する。同名が既にあればリース会社フラグを立てるだけにして、
   同じ会社が2件できるのを防ぐ */
async function ensureLeaseClient(name) {
  const existing = clients.find(c => nm(c.name) === nm(name));
  if (existing) {
    if (existing.is_lease) return existing;
    const {data, error} = await sb.from('clients').update({is_lease:true}).eq('id', existing.id).select().single();
    if (error) throw error;
    const i = clients.findIndex(c => c.id === existing.id);
    if (i >= 0) clients[i] = data;
    return data;
  }
  const {data, error} = await sb.from('clients')
    .insert({name, kind:'lease', is_lease:true, client_no: nextIdFor(clients,'client_no'), name_kana: autoKana(name)||null})
    .select().single();
  if (error) throw error;
  clients.push(data);
  rebuildCliFilter();
  addLog('会社追加', `${name}（リース会社）`);
  return data;
}

// 自由入力ではなくIDで直接紐づけることで、表記ゆれによるリンク切れを防ぐ
function populatePartnerSel(selectedId){
  const sel = document.getElementById('dPartnerSel');
  if (!sel) return;
  // 候補は会社マスタ全件。取引先しかしていない会社からドライバーを出してもらう話も起きるため絞らない
  sel.innerHTML = '<option value="">（未設定・自社所属）</option>'
    + [...clients].sort((a,b)=>nm(a.name).localeCompare(nm(b.name),'ja'))
        .map(c=>`<option value="${c.id}">${escHtml(c.name)}${c.client_no?`（ID:${escHtml(c.client_no)}）`:''}</option>`).join('')
    + '<option value="__new__">＋ 新しい会社を追加...</option>';
  enhanceSelectSearchable('dPartnerSel');
  sel.value = selectedId ? String(selectedId) : '';
}
// プルダウンで「＋ 新しい協力会社を追加...」を選んだ場合、名前だけ入力してその場でpartner_companiesに登録する
// （住所や支払日など詳細は後から取引先・協力会社タブで編集できる）
async function onDrvPartnerSelChange(){
  const sel = document.getElementById('dPartnerSel');
  if (!sel || sel.value !== '__new__') return;
  const name = (prompt('新しい会社名を入力してください:')||'').trim();
  if (!name) { sel.value = ''; return; }
  const dup = clients.find(c => nm(c.name) === nm(name));
  if (dup) { populatePartnerSel(dup.id); showT(`「${dup.name}」は登録済みのため、その会社を選びました`); return; }
  try {
    const {data, error} = await sb.from('clients')
      .insert({name, kind:'supplier', client_no: nextIdFor(clients,'client_no'), name_kana: autoKana(name)||null})
      .select().single();
    if (error) throw error;
    clients.push(data);
    rebuildCliFilter();
    populatePartnerSel(data.id);
    addLog('会社追加', `${name}（協力会社）`);
  } catch(e) { showT('会社の追加に失敗しました: '+e.message, 'ter'); sel.value = ''; }
}
// リース会社をプルダウン化: 会社マスタで「車両リース会社」として登録した会社を候補に出す。
// 既存ドライバーの入力値（マスタ未登録の旧データ）も選択肢に残して互換を保つ。
// 一覧に無い会社は「＋ 新しいリース会社を追加...」から会社マスタへその場で登録する
function populateLeaseCompanyList(selected){
  const sel = document.getElementById('dLeaseCompany');
  if (!sel) return;
  const fromMaster = leaseClients().map(c=>c.name);
  const fromDrivers = drvs.map(d=>d.lease_company).filter(Boolean);
  const companies = [...new Set([...fromMaster, ...fromDrivers])].sort((a,b)=>nm(a).localeCompare(nm(b),'ja'));
  if (selected && !companies.includes(selected)) companies.push(selected);
  sel.innerHTML = '<option value="">（未設定）</option>'
    + companies.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
    + '<option value="__new__">＋ 新しいリース会社を追加...</option>';
  enhanceSelectSearchable('dLeaseCompany');
  sel.value = selected || '';
}
async function onLeaseCompanySelChange(){
  const sel = document.getElementById('dLeaseCompany');
  if (!sel || sel.value !== '__new__') return;
  const name = (prompt('新しいリース会社名を入力してください:')||'').trim();
  if (!name) { sel.value = ''; return; }
  try {
    await ensureLeaseClient(name);
    populateLeaseCompanyList(name);
  } catch(e) { showT('リース会社の追加に失敗しました: '+e.message, 'ter'); sel.value=''; }
}
function openDrvM(){populatePartnerSel();populateLeaseCompanyList();switchModalTab('mDrv','basic');eDrvId=null;pendTags=[];pendOtherDeductions=[];['dN','dTel','dBank','dNote','dCi','dSup','dEmail','dLoginId','dLoginPw','dInvoiceNo','dOtherName','dOtherAmt'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('dSup').value=nextIdFor(drvs,'supplier_id');document.getElementById('dStatus').value='active';document.getElementById('dFeeRate').value=-15;document.getElementById('dAdminFee').value=-10000;document.getElementById('dVehRental').value=-30000;document.getElementById('dHideStatement').checked=false;document.getElementById('dSubmitRuleType').value='none';document.getElementById('dSubmitRuleDay').value='';document.getElementById('dSendMemo').value='';onDrvSubmitRuleChange();document.getElementById('dClosingDay').value=dayInputDisplay('end');document.getElementById('dPayMonthOffset').value='2';document.getElementById('dPayDay').value=dayInputDisplay('end');document.getElementById('dLoginFld').style.display='';document.getElementById('dCreateLogin').checked=false;document.getElementById('dLoginIdWrap').style.display='none';renderTags();renderOtherDeductions();document.getElementById('mDrv').classList.add('on');}
// src='di'はドライバー自己登録ページ（#pgDriverInvite）用。管理側モーダル(#cTags/#dCi)とIDが重複しないよう入力欄を分けている
function addTag(src){const inp=document.getElementById(src==='di'?'diCi':'dCi');const v=inp.value.trim();if(!v)return;if(!pendTags.includes(v))pendTags.push(v);inp.value='';renderTags();}
function rmTag(i){pendTags.splice(i,1);renderTags();}
function renderTags(){const html=pendTags.map((c,i)=>`<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:1px 5px;background:var(--blue-bg);color:var(--blue-text);border-radius:99px">${c}<button onclick="rmTag(${i})" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:12px;line-height:1;padding:0">×</button></span>`).join('');['cTags','diTags'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=html;});}

// ドライバー登録の「その他の控除項目」（保険料・家賃など、名称＋金額を複数追加できる自由入力欄）
function addOtherDeduction(){
  const nameEl=document.getElementById('dOtherName'), amtEl=document.getElementById('dOtherAmt');
  const name=nameEl.value.trim(); const amount=+amtEl.value||0;
  if(!name){alert('名称を入力してください');return;}
  pendOtherDeductions.push({name, amount});
  nameEl.value=''; amtEl.value='';
  renderOtherDeductions();
}
function rmOtherDeduction(i){pendOtherDeductions.splice(i,1);renderOtherDeductions();}
function renderOtherDeductions(){
  const el=document.getElementById('dOtherDeductions');
  if(!el)return;
  if(!pendOtherDeductions.length){el.innerHTML='<div style="font-size:10px;color:var(--text3)">登録なし</div>';return;}
  el.innerHTML=pendOtherDeductions.map((d,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 6px;background:var(--bg2);border-radius:var(--radius)">
    <span style="flex:1">${escHtml(d.name)}</span><span style="color:${d.amount<0?'#e05b5b':'inherit'}">${yen(d.amount)}</span>
    <button class="ibtn" onclick="rmOtherDeduction(${i})" title="削除">🗑</button>
  </div>`).join('');
}
function editDrv(id){const d=drvs.find(x=>x.id===id);if(!d)return;populatePartnerSel(d.company_client_id);populateLeaseCompanyList(d.lease_company||'');switchModalTab('mDrv','basic');eDrvId=id;pendTags=[...(d.cars||[])];document.getElementById('dN').value=d.name;document.getElementById('dTel').value=d.tel||'';document.getElementById('dBank').value=d.bank||'';document.getElementById('dNote').value=d.note||'';document.getElementById('dCi').value='';document.getElementById('dSup').value=d.supplier_id||'';document.getElementById('dStatus').value=d.status||'active';const eEl=document.getElementById('dEmail');if(eEl)eEl.value=d.email||'';const lEl=document.getElementById('dLoginId');if(lEl)lEl.value=d.driver_login_id||'';const pEl=document.getElementById('dLoginPw');if(pEl)pEl.value='';document.getElementById('dFeeRate').value=(d.fee_rate!=null?d.fee_rate*100:-15);document.getElementById('dAdminFee').value=d.admin_fee??-10000;document.getElementById('dVehRental').value=d.vehicle_rental??-30000;document.getElementById('dHideStatement').checked=!!d.hide_statement;document.getElementById('dSubmitRuleType').value=d.submit_rule_type||'none';document.getElementById('dSubmitRuleDay').value=d.submit_rule_day??'';document.getElementById('dSendMemo').value=d.send_memo||'';onDrvSubmitRuleChange();document.getElementById('dClosingDay').value=dayInputDisplay(d.closing_day);document.getElementById('dPayMonthOffset').value=d.pay_month_offset??2;document.getElementById('dPayDay').value=dayInputDisplay(d.pay_day);document.getElementById('dInvoiceNo').value=d.invoice_no||'';pendOtherDeductions=[...(d.other_deductions||[])];renderTags();renderOtherDeductions();document.getElementById('dLoginFld').style.display='none';document.getElementById('mDrv').classList.add('on');}
async function delDrv(id){
  const d=drvs.find(x=>x.id===id);if(!d)return;
  const cnt=recs.filter(r=>(d.cars||[]).some(c=>nm(c)===nm(r.car))).length;
  const msg=cnt>0
    ? `「${d.name}」を削除しますか？\n\n⚠ このドライバーに紐づく請求明細書が ${cnt}件 あります。\nドライバーを削除しても請求明細書データは残ります（車番が未照合になります）。`
    : `「${d.name}」を削除しますか？`;
  if(!confirm(msg))return;
  try{
    const{error}=await sb.from('drivers').delete().eq('id',id);
    if(error)throw error;
    drvs=drvs.filter(d=>d.id!==id);
    invalidateDriverIndexes();
    addLog('ドライバー削除',`${d.name}（id:${id}）`);
    renderDrv();renderInv();
    showT(`「${d.name}」を削除しました`);
  }catch(e){showT('削除エラー: '+e.message,'ter');}
}
async function saveDrv(){
  const name=document.getElementById('dN').value.trim();if(!name){alert('名前は必須です');return;}
  const supId=document.getElementById('dSup').value.trim();
  if(supId){const dup=drvs.find(d=>d.supplier_id===supId&&d.id!==eDrvId);if(dup){alert(`ドライバーID「${supId}」は既に「${dup.name}」で登録されています。重複しないIDを入力してください。`);return;}}
  // 車番が他のドライバーにも登録されていないか確認する。
  // 同じ車番が複数人に登録されていると車番からドライバーを特定できなくなるため。
  // ただし1台を交代で使う運用が実在するので、保存は止めずに確認だけ行う
  if(!confirmDuplicateCars(pendTags, eDrvId)) return;
  // 所属会社はプルダウンで会社マスタ(clients)をIDで直接選ぶため表記ゆれは起きない。
  // companyテキストは各種表示・集計・グルーピング処理の互換のため、選択した会社名をそのまま複製して保持する
  const partnerIdVal = document.getElementById('dPartnerSel').value;
  const partnerId = (partnerIdVal && partnerIdVal !== '__new__') ? +partnerIdVal : null;
  const partnerName = partnerId ? (lkCli(partnerId)?.name || null) : null;
  // 新規登録時のみ「ログインアカウントも作成する」を選べる（編集時は対象外）
  const createLogin = eDrvId===null && document.getElementById('dCreateLogin')?.checked;
  let loginId = '';
  let createdInitialPw = null; // 自動作成したログインの初期パスワード（発行後に画面表示するため保持）
  if(createLogin){
    loginId = document.getElementById('dLoginId').value.trim();
    if(!loginId){alert('ログインIDを入力してください');return;}
    if(users.find(u=>u.id===loginId)){alert(`ログインID「${loginId}」は既に使用されています`);return;}
  }
  const obj={
    name,
    company:partnerName,
    company_client_id:partnerId,
    cars:pendTags,
    tel:document.getElementById('dTel').value.trim(),
    email:document.getElementById('dEmail')?.value.trim()||null,
    bank:document.getElementById('dBank').value.trim()||null,
    note:document.getElementById('dNote').value.trim()||null,
    supplier_id:supId||null,
    status:document.getElementById('dStatus').value||'active',
    fee_rate:(+document.getElementById('dFeeRate').value||0)/100,
    admin_fee:+document.getElementById('dAdminFee').value||0,
    vehicle_rental:+document.getElementById('dVehRental').value||0,
    lease_company:document.getElementById('dLeaseCompany').value.trim()||null,
    hide_statement:document.getElementById('dHideStatement').checked,
    submit_rule_type:document.getElementById('dSubmitRuleType').value||'none',
    submit_rule_day:(()=>{const t=document.getElementById('dSubmitRuleType').value;if(t!=='day'&&t!=='next_month_day')return null;const v=parseInt(document.getElementById('dSubmitRuleDay').value,10);return (v>=1&&v<=31)?v:null;})(),
    send_memo:document.getElementById('dSendMemo').value.trim()||null,
    closing_day:parseDayInput(document.getElementById('dClosingDay').value),
    pay_month_offset:+document.getElementById('dPayMonthOffset').value||0,
    pay_day:parseDayInput(document.getElementById('dPayDay').value),
    invoice_no:document.getElementById('dInvoiceNo').value.trim()||null,
    other_deductions:pendOtherDeductions,
  };
  showLoad(true);
  try{
    if(eDrvId!==null){const{data,error}=await sb.from('drivers').update(obj).eq('id',eDrvId).select().single();if(error)throw error;const idx=drvs.findIndex(x=>x.id===eDrvId);if(idx>=0)drvs[idx]=data;invalidateDriverIndexes();addLog('ドライバー編集',name);}
    else{
      obj.line_link_code=genDriverLinkCode(); // LINE通知の連携コードは新規登録時に発行
      const{data,error}=await sb.from('drivers').insert(obj).select().single();if(error)throw error;drvs.push(data);invalidateDriverIndexes();addLog('ドライバー追加',name);
      if(createLogin){
        try{
          // ログイン用のSupabase AuthアカウントをEdge Function（管理者権限）経由で作成。初期パスワードはランダム生成し、初回ログイン時に本人へ変更を求める
          createdInitialPw=genInitialPassword();
          const{data:fnData,error:fnErr}=await sb.functions.invoke('manage-login',{body:{action:'create',login_id:loginId,password:createdInitialPw}});
          if(fnErr||fnData?.error)throw new Error(fnData?.error||fnErr.message);
          const{data:uData,error:uErr}=await sb.from('users').insert({id:loginId,name,role:'driver',auth_uid:fnData.auth_uid,driver_id:data.id,must_change_password:true}).select().single();
          if(uErr)throw uErr;
          users.push(uData);
          addLog('ユーザー追加',`${name}（ドライバー登録から自動作成）`);
        }catch(e2){showT(`ドライバーは登録しましたが、ログイン作成に失敗しました: ${e2.message}（ユーザー管理から追加してください）`,'ter');}
      }
    }
    await syncVehiclesFromDriverCars(pendTags);  // 車両管理を車両の唯一の台帳に保つ
    closeM('mDrv');renderDrv();renderInv();
    refreshPayAggIfVisible(); // 支払明細書作成タブから開いた場合、その場で集計テーブルにも反映する
    if(createLogin && createdInitialPw && users.find(u=>u.id===loginId)){showT('ドライバーとログインを登録しました');showLoginCreatedInfo(loginId,createdInitialPw);}
    else showT('ドライバーを登録しました');
  }catch(e){showT(e.code==='23505'?`ドライバーID「${supId}」は既に使用されています`:'保存エラー: '+e.message,'ter');}
  showLoad(false);
}

/* ===== CLIENTS ===== */
let cliViewMode = 'list';
function setCliView(mode) {
  cliViewMode = mode;
  const bCard = document.getElementById('bCliViewCard');
  const bList = document.getElementById('bCliViewList');
  if (bCard && bList) {
    if (mode === 'card') {
      bCard.style.background = 'var(--blue)'; bCard.style.color = '#fff';
      bList.style.background = 'transparent'; bList.style.color = 'var(--text)';
    } else {
      bList.style.background = 'var(--blue)'; bList.style.color = '#fff';
      bCard.style.background = 'transparent'; bCard.style.color = 'var(--text)';
    }
  }
  renderCli();
}
// 協力会社支払日の表示ラベル（ドライバー登録の支払日表示と同じ形式）
// 締日・支払日・入金日の入力欄（自由入力＋末日/5〜25日のプリセット候補）を、
// 保存用の内部値（'end' / '27' のような数字文字列 / 未設定はnull）に変換する。
// 27日など想定外の日付や「未設定のまま」を許容するため、selectではなくdatalist付きテキスト欄にしている
function parseDayInput(raw) {
  const v = (raw||'').trim();
  if (!v) return null;
  if (v === '末日' || v.toLowerCase() === 'end') return 'end';
  const n = parseInt(v.replace(/日$/,''), 10);
  return (!isNaN(n) && n>=1 && n<=31) ? String(n) : null;
}
// 内部値を入力欄に表示するための文字列に戻す（parseDayInputの逆変換）
function dayInputDisplay(val) {
  if (!val) return '';
  return val==='end' ? '末日' : `${val}日`;
}
// 「当月」「翌月」「翌々月」「翌々翌月」…のような月ズレラベル（3管理タブ共通）
function monthOffsetLabel(offset) {
  const n = +offset || 0;
  const labels = ['当月','翌月','翌々月','翌々翌月'];
  return labels[n] !== undefined ? labels[n] : `${n}ヶ月後`;
}
// 「当月末日」「翌月15日」のような支払・入金サイクルの表示ラベル（3管理タブ共通）
function payCycleLabel(offset, day) {
  const d = day==='end'||!day?'末日':day+'日';
  return monthOffsetLabel(offset)+d;
}
function partnerPayOutLabel(p) { return payCycleLabel(p.pay_out_month_offset, p.pay_out_day); }
// この協力会社が仕事をくれる（請求先になる）場合の入金予定日ラベル
function partnerReceivableLabel(p) { return payCycleLabel(p.pay_month_offset, p.pay_day); }
// ドライバーの支払日ラベル。協力会社所属なら協力会社の支払日設定を優先（明細書・支払予定と同じルール）
function drvPayScheduleLabel(d) {
  const partner = lkCli(d.company_client_id);
  return partner ? partnerPayOutLabel(partner)+'(協)' : payCycleLabel(d.pay_month_offset, d.pay_day);
}
/* ===== 取引先の親子（本社⇄支店・営業所）の自動判定 =====
   「佐川急便株式会社　仙台南営業所」「第一貨物　仙台南支店」のように、支店ごとに1件ずつ
   登録されている取引先を、会社名の一致で親子にまとめる。
   判定は法人格（株式会社など）と空白・中黒を除いた「会社名キー」で行い、
   ひらがな→カタカナ・英字大文字化まで寄せて「タイへイ／タイヘイ」の表記ゆれも拾う。 */
const CLI_CORP_TOKENS = ['株式会社','有限会社','合同会社','合資会社','（株）','(株)','（有）','(有)','㈱','㈲'];
const CLI_SEP_RE = /[\s・･,，.。]/;
// 共通の頭がこの文字数以上あるものだけ同じ会社とみなす。
// 3文字だと「ティーユートラベル」と「ティーファクトリー」まで繋がってしまうため4文字にしている
const CLI_HEAD_MIN = 4;

/* 会社名キーを作る。あわせて
   idx : キーのn文字目が元の名称の何文字目から来たか（親会社名を元の表記のまま切り出すのに使う）
   cuts: 「ここで区切れる」キー位置（直前に空白・区切り記号・法人格があった位置）        */
function cliCorpKeyMap(name) {
  const raw = String(name || '');
  let key = '', idx = [], cuts = [], sep = true;
  for (let i = 0; i < raw.length; ) {
    const tok = CLI_CORP_TOKENS.find(t => raw.startsWith(t, i));
    if (tok) { i += tok.length; sep = true; continue; }        // 法人格は飛ばす
    const ch = raw[i];
    if (CLI_SEP_RE.test(ch)) { i++; sep = true; continue; }    // 空白・区切り記号も飛ばす
    let c = ch.toUpperCase();
    if (c >= '\u3041' && c <= '\u3096') c = String.fromCharCode(c.charCodeAt(0) + 0x60); // ひらがな→カタカナ
    if (sep) { cuts.push(key.length); sep = false; }
    key += c; idx.push(i); i++;
  }
  return { key, idx, cuts, raw };
}
function cliCorpKey(name) { return cliCorpKeyMap(name).key; }
function lcpLen(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

/* 親会社名の候補を、その取引先の元の表記から切り出す。
   「佐川急便株式会社　白石店」で頭が4文字（佐川急便）なら「佐川急便株式会社」を返す */
function cliParentNameGuess(c, headLen) {
  const m = cliCorpKeyMap(c.name);
  if (m.key.length <= headLen) return c.name;
  const guess = m.raw.slice(0, m.idx[headLen]).replace(/[\s・･,，.。]+$/, '').trim();
  return guess || m.raw.slice(0, headLen);
}

/* 共通の頭を、全員に共通する区切り位置まで短くする。
   「第一貨物　仙台東支店」「第一貨物　仙台南支店」は頭が「第一貨物仙台」まで伸びてしまうが、
   全員が「第一貨物」の後ろで区切れるため、そこまで戻して会社名として正しくする。
   区切り位置が取れない（K.ismのように区切りが無い）場合は共通部分をそのまま使う */
function cliShrinkHead(members, lcp) {
  let best = 0;
  const cutSets = members.map(c => new Set(cliCorpKeyMap(c.name).cuts));
  for (let n = lcp; n >= CLI_HEAD_MIN; n--) {
    if (cutSets.every(set => set.has(n))) { best = n; break; }
  }
  return best >= CLI_HEAD_MIN ? best : lcp;
}

/* 親子候補を洗い出す。
   会社名キーの共通の頭でまとめ、キーがちょうどその頭と一致する取引先があればそれを親にする
   （「タイヘイ株式会社」があるなら支店はその子）。無ければ親会社のレコードを新しく作る
   （「佐川急便株式会社」は未登録なので新規に作る）。既に親が付いている取引先は触らない。 */
function detectClientParentGroups() {
  const keyed = clients.filter(c => !c.parent_id)
    .map(c => ({c, key: cliCorpKey(c.name)}))
    .filter(x => x.key.length >= CLI_HEAD_MIN)
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

  const groups = [];
  let run = [], head = '';
  const flush = () => {
    if (run.length >= 2) {
      const members = run.map(x => x.c);
      const headLen = cliShrinkHead(members, head.length);
      const parent = members.find(c => cliCorpKey(c.name).length === headLen);
      const children = members.filter(c => c !== parent).sort(clientNoCompare);
      if (children.length) {
        const sorted = members.slice().sort(clientNoCompare);
        groups.push({
          parentId: parent ? parent.id : null,
          parentName: parent ? parent.name : cliParentNameGuess(sorted[0], headLen),
          headLen, children,
        });
      }
    }
    run = []; head = '';
  };
  keyed.forEach(x => {
    if (!run.length) { run = [x]; head = x.key; return; }
    const n = lcpLen(head, x.key);
    if (n >= CLI_HEAD_MIN) { run.push(x); head = head.slice(0, n); }
    else { flush(); run = [x]; head = x.key; }
  });
  flush();

  return groups.sort((a, b) => b.children.length - a.children.length
    || String(a.parentName).localeCompare(String(b.parentName), 'ja'));
}

/* --- 親子の自動判定モーダル --- */
let cliParentGroups = [];
function openCliParentM() {
  cliParentGroups = detectClientParentGroups();
  renderCliParentList();
  document.getElementById('mCliParent').classList.add('on');
}
function renderCliParentList() {
  const el = document.getElementById('cliParentList');
  if (!el) return;
  if (!cliParentGroups.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text2);font-size:12px">まとめられそうな組み合わせは見つかりませんでした</div>';
    document.getElementById('cliParentApplyBtn').classList.add('hide');
    return;
  }
  document.getElementById('cliParentApplyBtn').classList.remove('hide');
  el.innerHTML = cliParentGroups.map((g, gi) => `
    <div class="card" style="padding:9px 11px;margin-bottom:7px">
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;margin-bottom:6px">
        <input type="checkbox" class="cliPgChk" data-gi="${gi}" checked style="width:15px;height:15px;cursor:pointer">
        <span style="font-size:12px;font-weight:600">親会社</span>
        ${g.parentId
          ? `<span style="font-size:13px;font-weight:600">${escHtml(g.parentName)}</span>
             <span class="bdg" style="background:var(--green-bg);color:var(--green-text)">登録済み</span>`
          : `<input type="text" class="cliPgName" data-gi="${gi}" value="${escHtml(g.parentName)}" style="flex:1;min-width:180px;font-size:13px;font-weight:600">
             <span class="bdg" style="background:var(--amber-bg);color:var(--amber-text)">新しく作る</span>`}
      </label>
      <div style="padding-left:22px;display:flex;flex-direction:column;gap:2px">
        ${g.children.map((c, ci) => `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
            <input type="checkbox" class="cliPcChk" data-gi="${gi}" data-ci="${ci}" checked style="width:13px;height:13px;cursor:pointer">
            <span style="color:var(--text2)">└</span>
            <span>${escHtml(c.name)}</span>
            ${c.client_no?`<span style="font-size:10.5px;color:var(--text2)">ID:${escHtml(c.client_no)}</span>`:''}
          </label>`).join('')}
      </div>
    </div>`).join('');
}

async function applyCliParentGroups() {
  if (!sb) return;
  // 画面のチェック状態と、書き換えた親会社名を読み取る
  const plan = [];
  document.querySelectorAll('.cliPgChk').forEach(chk => {
    if (!chk.checked) return;
    const gi = +chk.dataset.gi;
    const g = cliParentGroups[gi];
    if (!g) return;
    const nameEl = document.querySelector(`.cliPgName[data-gi="${gi}"]`);
    const children = g.children.filter((c, ci) =>
      document.querySelector(`.cliPcChk[data-gi="${gi}"][data-ci="${ci}"]`)?.checked);
    if (!children.length) return;
    const parentName = (nameEl?.value || g.parentName).trim();
    if (!g.parentId && !parentName) return;
    plan.push({parentId: g.parentId, parentName, children});
  });
  if (!plan.length) { showT('適用する組み合わせが選ばれていません', 'ter'); return; }
  const newCnt = plan.filter(x => !x.parentId).length;
  const childCnt = plan.reduce((a, x) => a + x.children.length, 0);
  if (!confirm(`${plan.length}組・${childCnt}件の取引先に親会社を設定します。${newCnt?`\n（うち${newCnt}件は親会社の取引先を新しく作ります）`:''}\nよろしいですか？`)) return;
  showLoad(true);
  try {
    for (const g of plan) {
      let pid = g.parentId;
      if (!pid) {
        // 親会社が未登録なら、取引先IDを自動採番して作る
        const {data, error} = await sb.from('clients')
          .insert({name: g.parentName, client_no: nextIdFor(clients, 'client_no'),
                   name_kana: autoKana(g.parentName) || null})
          .select().single();
        if (error) throw error;
        clients.push(data);
        pid = data.id;
      }
      const ids = g.children.map(c => c.id);
      const {error} = await sb.from('clients').update({parent_id: pid}).in('id', ids);
      if (error) throw error;
      clients.forEach(c => { if (ids.includes(c.id)) c.parent_id = pid; });
    }
    addLog('取引先の親子を一括設定', `${plan.length}組 / ${childCnt}件`);
    closeM('mCliParent');
    rebuildCliFilter();
    renderCli();
    showT(`${childCnt}件に親会社を設定しました`);
  } catch(e) { showT('適用エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* 親会社→その支店・営業所の順に並べ替える。
   絞り込みで親が外れていても、子が残っていれば親を見出しとして出す（ghost）。
   親子は自動判定でも手動でも2階層で作られるが、孫がいてもcliRootId()で根までたどってまとめる */
function orderClientsByFamily(list) {
  const inList = new Set(list.map(c => c.id));
  const rootIds = [];
  list.forEach(c => { const r = cliRootId(c.id); if (!rootIds.includes(r)) rootIds.push(r); });
  const roots = rootIds.map(id => clients.find(x => x.id === id)).filter(Boolean).sort(clientNoCompare);
  const out = [];
  roots.forEach(root => {
    const kids = clients.filter(c => c.id !== root.id && cliRootId(c.id) === root.id)
                        .filter(c => inList.has(c.id) || inList.has(root.id))
                        .sort(clientNoCompare);
    out.push({c: root, depth: 0, childCnt: kids.length, ghost: !inList.has(root.id)});
    kids.forEach(k => out.push({c: k, depth: 1, childCnt: 0, ghost: false}));
  });
  return out;
}

/* ===== 会社マスタ(clients)の役割 =====
   取引先と協力会社は同じ会社であることが多く（統合前は24社中15社が二重登録だった）、
   住所や締日は取引先側、支払サイクルや振込先は協力会社側にしか無い状態だった。
   統合後は1社1レコードにし、「その会社が何なのか」を主区分(kind)で持つ。
   兼ねている役割（リースもする・ドライバーを出してくれる・請求実績がある）は
   フラグや他テーブルから導いてバッジで併記する。 */
const CLI_KINDS = [
  {id:'',         label:'すべて'},
  {id:'customer', label:'📄 取引先'},
  {id:'supplier', label:'🤝 協力会社'},
  {id:'lease',    label:'🚗 リース会社'},
  {id:'branch',   label:'🏢 自社支店'},
];
const CLI_KIND_LABEL = {customer:'取引先', supplier:'協力会社', lease:'リース会社', branch:'自社支店'};
const CLI_KIND_COLOR = {
  customer:['--blue-bg','--blue-text'], supplier:['--teal-bg','--teal-text'],
  lease:['--amber-bg','--amber-text'], branch:['--purple-bg','--purple-text'],
};
function cliKindOf(c) { return CLI_KIND_LABEL[c?.kind] ? c.kind : 'customer'; }
let cliKindFilter = '';
function setCliKindFilter(k) { cliKindFilter = k; renderCli(); }
function renderCliKindTabs(counts) {
  const el = document.getElementById('cliKindTabs');
  if (!el) return;
  el.innerHTML = CLI_KINDS.map(t =>
    `<div class="ntab${t.id===cliKindFilter?' on':''}" onclick="setCliKindFilter('${t.id}')">${t.label} <span style="color:var(--text2);font-weight:400">${counts[t.id]??0}</span></div>`).join('');
}
// この会社から供給を受けているドライバー
function cliSuppliedDrivers(c) { return c ? drvs.filter(d => d.company_client_id === c.id) : []; }
// 車両リース会社として使う会社（車両カルテ・ドライバー登録のリース会社プルダウン用）
function leaseClients() { return clients.filter(c => c.is_lease || cliKindOf(c) === 'lease'); }
// 会社を1件引く（idで）
function lkCli(id) { return clients.find(c => c.id === id) || null; }

function cliKindBadge(c) {
  const k = cliKindOf(c), col = CLI_KIND_COLOR[k];
  return `<span class="bdg" style="background:var(${col[0]});color:var(${col[1]})">${CLI_KIND_LABEL[k]}</span>`;
}
// 主区分と重ならない役割だけをバッジにする
function cliRoleBadges(c) {
  const k = cliKindOf(c);
  const out = [];
  if (c.is_lease && k !== 'lease') out.push('🚗 リースもする');
  const sup = cliSuppliedDrivers(c).length;
  if (sup && k !== 'supplier') out.push(`👤 ドライバー供給${sup}名`);
  if (k !== 'customer' && recs.some(r => r.cli === c.id)) out.push('📄 請求実績あり');
  return out.map(t => `<span class="bdg" style="background:var(--bg2);color:var(--text2);font-weight:500">${t}</span>`).join('');
}

function renderCli(){
  const grid=document.getElementById('cliGrid');
  if (!grid) return;
  const canE=me&&me.role!=='viewer';
  const cliKpiEl = document.getElementById('cliKpi');
  if (cliKpiEl) {
    const now = new Date();
    const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthCnt = recs.filter(r=>r.cli!=null && (r.date||'').startsWith(thisM)).length;
    const supCnt = drvs.filter(d=>d.company_client_id!=null).length;
    cliKpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">総登録数</div><div class="kpi-val">${clients.length}社</div></div>
      <div class="kpi-card"><div class="kpi-label">今月（${thisM}）の請求明細</div><div class="kpi-val">${monthCnt}件</div></div>
      <div class="kpi-card"><div class="kpi-label">供給を受けているドライバー</div><div class="kpi-val">${supCnt}名</div></div>
    `;
  }
  // 役割タブの件数（検索とは独立に、常に全件に対する内訳を出す）
  const kindCounts = {'':clients.length};
  CLI_KINDS.forEach(t => { if (t.id) kindCounts[t.id] = clients.filter(c=>cliKindOf(c)===t.id).length; });
  renderCliKindTabs(kindCounts);
  if(!clients.length){grid.innerHTML=`<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px;grid-column:1/-1">会社が登録されていません</div>`;return;}
  const q=nm(document.getElementById('cliSearch')?.value||'');
  let filteredCli = cliKindFilter ? clients.filter(c=>cliKindOf(c)===cliKindFilter) : clients;
  if(q) filteredCli = filteredCli.filter(c=>nm(c.name).includes(q)||nm(c.short||'').includes(q));
  if(!filteredCli.length){grid.innerHTML=`<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px;grid-column:1/-1">該当する会社が見つかりません</div>`;return;}

  const sortedCli = orderClientsByFamily(filteredCli);

  if (cliViewMode === 'card') {
    grid.className = 'cardgrid';
    grid.style.display = 'grid';
    grid.style.padding = '10px 14px';
    const leaseCarsByName = leaseCarsIndex();
    grid.innerHTML=sortedCli.map(({c,depth,childCnt,ghost})=>{
      const ini=(c.short||c.name||'?').slice(0,2);
      const supplied=cliSuppliedDrivers(c);
      const leaseCars=(c.is_lease||cliKindOf(c)==='lease') ? (leaseCarsByName.get(nm(c.name))||[]) : [];
      const cnt=recs.filter(r=>r.cli===c.id).length;
      const tot_=recs.filter(r=>r.cli===c.id).reduce((a,r)=>a+totR(r,taxMode),0);
      const closingLbl=closingDayLabel(c.closing_day);
      return`<div class="card" style="cursor:pointer;${depth?'border-left:3px solid var(--blue);margin-left:14px':''}${ghost?';opacity:.6':''}" title="ダブルクリックで編集" ondblclick="editCli(${c.id})">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px"><div class="av cli">${ini}</div>${canE?`<div style="display:flex;gap:1px" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><button class="ibtn" onclick="editCli(${c.id})">✎</button><button class="ibtn" onclick="delCli(${c.id})">🗑</button></div>`:''}</div>
        <div style="font-weight:600;font-size:13.5px;margin-bottom:3px">${depth?'<span style="color:var(--text2);font-weight:400">└ </span>':''}${escHtml(c.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:3px">${cliKindBadge(c)}${cliRoleBadges(c)}${childCnt?`<span class="bdg" style="background:var(--blue-bg);color:var(--blue-text)">🏢 支店・営業所 ${childCnt}件</span>`:''}</div>
        ${c.client_no?`<div style="font-size:11.5px;color:var(--text2);margin-bottom:2px">会社ID: ${escHtml(c.client_no)}</div>`:''}
        ${c.person?`<div style="font-size:11.5px;color:var(--text2)">担当: ${escHtml(c.person)}</div>`:''}
        ${c.tel?`<div style="font-size:11.5px;color:var(--text2);margin-bottom:5px">${escHtml(c.tel)}</div>`:'<div style="margin-bottom:5px"></div>'}
        <div style="font-size:11.5px;color:var(--text2)">請求明細書: ${cnt}件　締日: ${closingLbl}${c.fee_rate?`　手数料: ${c.fee_rate}%`:''}</div>
        <div style="font-size:11.5px;color:var(--text2)">入金日: ${payCycleLabel(c.pay_month_offset, c.pay_day)}</div>
        ${supplied.length?`<div style="font-size:11.5px;color:var(--text2);margin-top:2px">👤 供給ドライバー（${supplied.length}名）: ${escHtml(supplied.map(d=>d.name).join('、'))}</div>`:''}
        ${leaseCars.length?`<div style="font-size:11.5px;color:var(--text2);margin-top:2px;cursor:pointer" title="クリックで車両管理を開きます（この会社の車両で絞り込み）" onclick="event.stopPropagation();jumpToVehiclesByLease('${escAttrJs(c.name)}')" ondblclick="event.stopPropagation()">🚗 所属車両（${leaseCars.length}台）: ${escHtml(leaseCars.slice(0,6).join('、'))}${leaseCars.length>6?` 他${leaseCars.length-6}台`:''}</div>`:''}
        <div style="font-size:13px;font-weight:600;color:var(--blue);margin-top:4px">${yen(tot_)}</div>
        ${c.note?`<div style="font-size:11px;color:var(--text2);margin-top:4px">${escHtml(c.note)}</div>`:''}
      </div>`;
    }).join('');
  } else {
    grid.className = '';
    grid.style.display = 'block';
    grid.style.padding = '10px 14px';
    const cliHeaderRow = `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 12px 6px;gap:12px;font-size:10.5px;color:var(--text2);font-weight:600">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <div style="width:26px;flex-shrink:0;"></div>
        <div style="width:80px;flex-shrink:0;">ID</div>
        <div style="width:135px;flex-shrink:0;">会社名</div>
        <div style="width:150px;flex-shrink:0;">区分・役割</div>
        <div style="width:85px;flex-shrink:0;">締日</div>
        <div style="width:110px;flex-shrink:0;">入金日</div>
        <div style="width:90px;flex-shrink:0;">手数料</div>
        <div style="width:100px;flex-shrink:0;">電話番号</div>
        <div style="flex:1;min-width:110px;">供給ドライバー</div>
        <div style="width:65px;text-align:right;flex-shrink:0;">請求件数</div>
        <div style="width:95px;text-align:right;flex-shrink:0;">請求合計</div>
      </div>
      <div style="width:52px;flex-shrink:0;"></div>
    </div>`;
    grid.innerHTML=cliHeaderRow+sortedCli.map(({c,depth,childCnt,ghost})=>{
      const ini=(c.short||c.name||'?').slice(0,2);
      const supplied=cliSuppliedDrivers(c);
      const supId=`cliDrvList${c.id}`;
      const cnt=recs.filter(r=>r.cli===c.id).length;
      const tot_=recs.filter(r=>r.cli===c.id).reduce((a,r)=>a+totR(r,taxMode),0);
      const closingLbl=closingDayLabel(c.closing_day);
      return `<div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;padding:9px 12px;margin-bottom:${depth?'2px':'6px'};gap:12px;cursor:pointer;${depth?'margin-left:20px;border-left:3px solid var(--blue)':''}${ghost?';opacity:.6':''}" title="ダブルクリックで編集" ondblclick="editCli(${c.id})">
        <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;">
          <div class="av cli" style="width:26px;height:26px;font-size:11px;flex-shrink:0;">${ini}</div>
          <div style="width:80px;font-weight:700;color:var(--blue);font-size:12.5px;flex-shrink:0;">${escHtml(c.client_no ? 'ID: ' + c.client_no : 'ID: —')}</div>
          <div style="width:135px;font-weight:600;font-size:13.5px;flex-shrink:0;overflow-wrap:break-word;word-break:break-word;">${depth?'<span style="color:var(--text2);font-weight:400">└ </span>':''}${escHtml(c.name)}${childCnt?` <span class="bdg" style="background:var(--blue-bg);color:var(--blue-text)">🏢${childCnt}</span>`:''}</div>
          <div style="width:150px;flex-shrink:0;display:flex;flex-wrap:wrap;gap:2px;align-content:flex-start">${cliKindBadge(c)}${cliRoleBadges(c)}</div>
          <div style="width:85px;font-size:11.5px;color:var(--text2);flex-shrink:0;">締日:${closingLbl}</div>
          <div style="width:110px;font-size:11.5px;color:var(--text2);flex-shrink:0;">入金:${payCycleLabel(c.pay_month_offset, c.pay_day)}</div>
          <div style="width:90px;font-size:11.5px;color:var(--text2);flex-shrink:0;">${c.fee_rate?`手数料:${c.fee_rate}%`:'—'}</div>
          <div style="width:100px;color:var(--text2);font-size:12px;flex-shrink:0;">${escHtml(c.tel || '—')}</div>
          <div id="${supId}" style="flex:1;min-width:110px;font-size:11.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${supplied.length?'cursor:pointer':''}" title="${supplied.length?'クリックで全件表示':''}" ${supplied.length?`onclick="event.stopPropagation();toggleFullText('${supId}')" ondblclick="event.stopPropagation()"`:''}>${supplied.length?escHtml(supplied.map(d=>d.name).join('、')):'—'}</div>
          <div style="width:65px;font-size:11.5px;color:var(--text2);text-align:right;flex-shrink:0;">請求:${cnt}件</div>
          <div style="width:95px;font-size:12.5px;font-weight:600;color:var(--blue);text-align:right;flex-shrink:0;">${yen(tot_)}</div>
        </div>
        ${canE ? `<div style="display:flex;gap:1px;flex-shrink:0;" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><button class="ibtn" onclick="editCli(${c.id})">✎</button><button class="ibtn" onclick="delCli(${c.id})">🗑</button></div>` : ''}
      </div>`;
    }).join('');
  }
}
function openCliM(kind){switchModalTab('mCli','basic');eCliId=null;cliKanaEdited=false;['cName','cShort','cPerson','cTel2','cZip','cAddress','cNote','cInvoiceNo','cNameKana','cBank','cPayOutFeeRate'].forEach(id=>document.getElementById(id).value='');updateCliKanaHint();document.getElementById('cCode').value=nextIdFor(clients,'client_no');document.getElementById('cKind').value=kind||'customer';document.getElementById('cIsLease').checked=(kind==='lease');document.getElementById('cPayOutMonthOffset').value='2';document.getElementById('cPayOutDay').value=dayInputDisplay('end');renderCliSuppliedArea(null);document.getElementById('cDocsBtn').classList.add('hide');document.getElementById('cClosingDay').value=dayInputDisplay('end');document.getElementById('cFeeRate').value='';document.getElementById('cSendMethod').value='';document.getElementById('cSubmitRuleType').value='none';document.getElementById('cSubmitRuleDay').value='';document.getElementById('cSendMemo').value='';onCliSubmitRuleChange();populateCliParentSel(null,null);onCliParentChange();document.getElementById('cPayMonthOffset').value='1';document.getElementById('cPayDay').value=dayInputDisplay('end');document.getElementById('mCli').classList.add('on');}
// 「毎月N日」「翌月N日」のときだけ日にち入力欄を出す（ドライバー登録側）
function onDrvSubmitRuleChange(){
  const t=document.getElementById('dSubmitRuleType')?.value;
  const w=document.getElementById('dSubmitRuleDayWrap');
  if(w)w.style.display=(t==='day'||t==='next_month_day')?'':'none';
}
// 親会社の候補を並べる。自分自身と、自分を親にしている取引先（循環参照）は候補から外す
function populateCliParentSel(selfId, current){
  const sel=document.getElementById('cParent');
  if(!sel)return;
  // selfIdがnull（新規追加）のときに c.parent_id!==null で親会社を全部弾いてしまわないよう、
  // 循環参照の除外は編集中の会社があるときだけ行う
  const cand=clients.filter(c=>selfId==null || (c.id!==selfId && c.parent_id!==selfId)).sort(clientNoCompare);
  sel.innerHTML='<option value="">なし（親会社として扱う）</option>'
    +cand.map(c=>`<option value="${c.id}" ${String(c.id)===String(current||'')?'selected':''}>${escHtml(c.name)}${c.client_no?`（ID:${escHtml(c.client_no)}）`:''}</option>`).join('');
  enhanceSelectSearchable('cParent');
  sel.value=current?String(current):'';
}
/* 親会社を選んだら会社IDを「親ID-枝番」に振り直す案内を出す。
   勝手に書き換えず、押したときだけ入れ替える（既存のIDを紙で使っている場合に備えて） */
function onCliParentChange(){
  const hint = document.getElementById('cParentHint');
  const pid = +document.getElementById('cParent').value || null;
  if (!hint) return;
  if (!pid) { hint.innerHTML = ''; return; }
  const suggested = nextBranchNo(pid);
  const cur = document.getElementById('cCode').value.trim();
  if (!suggested || cur === suggested) { hint.innerHTML = ''; return; }
  hint.innerHTML = `会社IDを <b>${escHtml(suggested)}</b> にすると、一覧で親会社とまとめて並びます
    <button type="button" class="btn sml" style="margin-left:6px" onclick="applyCliBranchNo('${escHtml(suggested)}')">この番号にする</button>`;
}
function applyCliBranchNo(no){
  document.getElementById('cCode').value = no;
  document.getElementById('cParentHint').innerHTML = '';
}

// 「毎月N日」「翌月N日」のときだけ日にち入力欄を出す
function onCliSubmitRuleChange(){
  const t=document.getElementById('cSubmitRuleType').value;
  document.getElementById('cSubmitRuleDayWrap').style.display=(t==='day'||t==='next_month_day')?'':'none';
}
function editCli(id){const c=clients.find(x=>x.id===id);if(!c)return;switchModalTab('mCli','basic');eCliId=id;document.getElementById('cCode').value=c.client_no||'';document.getElementById('cName').value=c.name;document.getElementById('cNameKana').value=c.name_kana||autoKana(c.name);cliKanaEdited=!!c.name_kana;updateCliKanaHint();document.getElementById('cShort').value=c.short||'';document.getElementById('cPerson').value=c.person||'';document.getElementById('cTel2').value=c.tel||'';document.getElementById('cZip').value=c.zip||'';document.getElementById('cAddress').value=c.address||'';document.getElementById('cNote').value=c.note||'';document.getElementById('cClosingDay').value=dayInputDisplay(c.closing_day);document.getElementById('cFeeRate').value=c.fee_rate||'';document.getElementById('cSendMethod').value=c.send_method||'';document.getElementById('cSubmitRuleType').value=c.submit_rule_type||'none';document.getElementById('cSubmitRuleDay').value=c.submit_rule_day??'';document.getElementById('cSendMemo').value=c.send_memo||'';onCliSubmitRuleChange();populateCliParentSel(c.id,c.parent_id);onCliParentChange();document.getElementById('cPayMonthOffset').value=c.pay_month_offset??1;document.getElementById('cPayDay').value=dayInputDisplay(c.pay_day);document.getElementById('cInvoiceNo').value=c.invoice_no||'';document.getElementById('cKind').value=cliKindOf(c);document.getElementById('cIsLease').checked=!!c.is_lease;document.getElementById('cBank').value=c.bank||'';document.getElementById('cPayOutMonthOffset').value=c.pay_out_month_offset??2;document.getElementById('cPayOutDay').value=dayInputDisplay(c.pay_out_day);document.getElementById('cPayOutFeeRate').value=c.pay_out_fee_rate||'';renderCliSuppliedArea(c.id);document.getElementById('cDocsBtn').classList.remove('hide');document.getElementById('mCli').classList.add('on');}
async function delCli(id){
  if(!confirm('削除しますか？'))return;
  try{
    await sb.from('invoices').update({cli:null}).eq('cli',id);
    const{error}=await sb.from('clients').delete().eq('id',id);if(error)throw error;
    recs.forEach(r=>{if(r.cli===id)r.cli=null;});clients=clients.filter(c=>c.id!==id);
    addLog('取引先削除',`id:${id}`);rebuildCliFilter();renderCli();renderInv();showT('削除しました');
  }catch(e){showT('削除エラー: '+e.message,'ter');}
}
// カナ欄は「未編集なら取引先名に追従、手で直したらそれを尊重する」挙動にする
let cliKanaEdited = false;
function onCliNameInput(){
  if (cliKanaEdited) return;
  const kanaEl = document.getElementById('cNameKana');
  if (kanaEl) kanaEl.value = autoKana(document.getElementById('cName').value);
  updateCliKanaHint();
}
function onCliKanaEdited(){ cliKanaEdited = true; updateCliKanaHint(); }
function regenCliKana(){
  const kanaEl = document.getElementById('cNameKana');
  if (kanaEl) kanaEl.value = autoKana(document.getElementById('cName').value);
  cliKanaEdited = false;
  updateCliKanaHint();
}
function updateCliKanaHint(){
  const hint = document.getElementById('cNameKanaHint');
  if (!hint) return;
  const v = document.getElementById('cNameKana')?.value || '';
  if (kanaNeedsFix(v)) {
    hint.textContent = '⚠ 読みを判定できない漢字が残っています。正しい読みに直してください';
    hint.style.color = 'var(--amber-text)';
  } else {
    hint.textContent = '漢字の読みは推定のため、違っていればこの欄を直してください';
    hint.style.color = 'var(--text2)';
  }
}
async function saveCli(){
  const name=document.getElementById('cName').value.trim();if(!name){alert('取引先名は必須です');return;}
  const codeVal=document.getElementById('cCode').value.trim();
  if(codeVal){const dup=clients.find(c=>c.client_no===codeVal&&c.id!==eCliId);if(dup){alert(`取引先ID「${codeVal}」は既に「${dup.name}」で登録されています。重複しないIDを入力してください。`);return;}}
  const feeRateVal=document.getElementById('cFeeRate').value;
  const obj={name,client_no:codeVal||null,short:document.getElementById('cShort').value.trim(),person:document.getElementById('cPerson').value.trim(),tel:document.getElementById('cTel2').value.trim(),zip:document.getElementById('cZip').value.trim(),address:document.getElementById('cAddress').value.trim(),note:document.getElementById('cNote').value.trim(),closing_day:parseDayInput(document.getElementById('cClosingDay').value),fee_rate:feeRateVal===''?0:parseFloat(feeRateVal),send_method:document.getElementById('cSendMethod').value||null,submit_rule_type:document.getElementById('cSubmitRuleType').value||'none',submit_rule_day:(()=>{const t=document.getElementById('cSubmitRuleType').value;if(t!=='day'&&t!=='next_month_day')return null;const d=parseInt(document.getElementById('cSubmitRuleDay').value,10);return (d>=1&&d<=31)?d:null;})(),send_memo:document.getElementById('cSendMemo').value.trim()||null,parent_id:+document.getElementById('cParent').value||null,name_kana:document.getElementById('cNameKana').value.trim()||null,pay_month_offset:+document.getElementById('cPayMonthOffset').value||0,pay_day:parseDayInput(document.getElementById('cPayDay').value),invoice_no:document.getElementById('cInvoiceNo').value.trim()||null,
    kind:document.getElementById('cKind').value||'customer',
    // 区分をリース会社にしたら、リース会社プルダウンの候補にも自動で載せる
    is_lease:document.getElementById('cIsLease').checked||document.getElementById('cKind').value==='lease',
    bank:document.getElementById('cBank').value.trim()||null,
    pay_out_month_offset:+document.getElementById('cPayOutMonthOffset').value||0,
    pay_out_day:parseDayInput(document.getElementById('cPayOutDay').value),
    pay_out_fee_rate:(()=>{const v=document.getElementById('cPayOutFeeRate').value;return v===''?0:parseFloat(v);})()};
  showLoad(true);
  try{
    let data,error,msg='取引先を保存しました';
    if(eCliId!==null){({data,error}=await sb.from('clients').update(obj).eq('id',eCliId).select().single());}
    else{({data,error}=await sb.from('clients').insert(obj).select().single());}
    // closing_day/fee_rateカラムが未作成の場合はそれらを除いて再試行
    if(error && error.message && error.message.includes('does not exist') && (error.message.includes('closing_day')||error.message.includes('fee_rate'))){
      const{closing_day,fee_rate,...objFallback}=obj;
      if(eCliId!==null){({data,error}=await sb.from('clients').update(objFallback).eq('id',eCliId).select().single());}
      else{({data,error}=await sb.from('clients').insert(objFallback).select().single());}
      msg='取引先を保存しました（締日・手数料率は未保存: Supabaseにカラム追加が必要です）';
    }
    if(error)throw error;
    if(eCliId!==null){const idx=clients.findIndex(x=>x.id===eCliId);if(idx>=0)clients[idx]=data;addLog('取引先編集',name);}
    else{clients.push(data);addLog('取引先追加',name);}
    closeM('mCli');rebuildCliFilter();renderCli();renderInv();showT(msg);
  }catch(e){showT(e.code==='23505'?`取引先ID「${codeVal}」は既に使用されています`:'保存エラー: '+e.message,'ter');}
  showLoad(false);
}

// はみ出た「…」表示のセルをクリックで全文表示⇔省略表示に切り替える（一覧の供給ドライバー欄など）
function toggleFullText(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const expanded = el.dataset.expanded === '1';
  if (expanded) {
    el.style.whiteSpace = 'nowrap';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.dataset.expanded = '0';
  } else {
    el.style.whiteSpace = 'normal';
    el.style.overflow = 'visible';
    el.style.textOverflow = 'clip';
    el.dataset.expanded = '1';
  }
}
// この会社から供給を受けているドライバーの一覧（会社モーダルの支払設定タブに出す）
function renderCliSuppliedArea(clientId) {
  const el = document.getElementById('cSuppliedArea');
  if (!el) return;
  if (clientId === null) { el.innerHTML = '<div style="font-size:11px;color:var(--text2)">（保存後に表示されます）</div>'; return; }
  const list = cliSuppliedDrivers(lkCli(clientId)).sort((a,b)=>(a.supplier_id||'').localeCompare(b.supplier_id||'','ja',{numeric:true}));
  if (!list.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text2)">なし</div>'; return; }
  el.innerHTML = `<div style="font-size:11.5px;line-height:1.8">${list.map(d =>
    `<span style="cursor:pointer;color:var(--blue);text-decoration:underline dotted;margin-right:10px" onclick="closeM('mCli');goPage(2,document.getElementById('nt2'));setTimeout(()=>editDrv(${d.id}),80)">${escHtml(d.name)}${d.supplier_id?`(${escHtml(d.supplier_id)})`:''}</span>`).join('')}</div>`;
}

/* ===== 協力会社の添付書類 ===== */
async function loadPartnerDocs(partnerId){
  if (!sb) return;
  try {
    const {data, error} = await sb.from('partner_company_docs').select('*').eq('client_id', partnerId).order('created_at',{ascending:false});
    if (error) throw error;
    partnerDocs = data || [];
  } catch(e) { console.warn('loadPartnerDocs:', e.message); }
}
async function openPartnerDocsM(partnerId){
  const p = lkCli(partnerId); if (!p) return;
  document.getElementById('mPartnerDocsH').innerHTML = `📄 ${escHtml(p.name)} の添付書類 <button class="ibtn" onclick="closeM('mPartnerDocs')">✕</button>`;
  document.getElementById('mPartnerDocs').dataset.partnerId = partnerId;
  document.getElementById('partnerDocsList').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">読み込み中...</div>';
  document.getElementById('mPartnerDocs').classList.add('on');
  await loadPartnerDocs(partnerId);
  renderPartnerDocsMBody();
}
function renderPartnerDocsMBody(){
  const el = document.getElementById('partnerDocsList');
  if (!el) return;
  const canDel = me && (me.role==='admin'||me.role==='editor');
  if (!partnerDocs.length) { el.innerHTML = '<div style="font-size:11px;color:var(--text2)">登録済みの書類はありません</div>'; return; }
  const today = fmtLocalDate(new Date());
  el.innerHTML = partnerDocs.map(d => {
    const expired = d.expiry_date && d.expiry_date < today;
    return `<div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-weight:600;font-size:12.5px">${escHtml(d.title)}</span>
      ${d.expiry_date ? `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:${expired?'var(--red-bg)':'var(--green-bg)'};color:${expired?'var(--red-text)':'var(--green-text)'}">${expired?'期限切れ':'期限'} ${d.expiry_date}</span>` : ''}
      <div style="flex:1"></div>
      <button class="btn sml" onclick="viewPartnerDoc('${d.file_path}')">🔍 表示</button>
      ${canDel ? `<button class="ibtn" style="color:#e05b5b" onclick="deletePartnerDoc(${d.id})">🗑</button>` : ''}
    </div>`;
  }).join('');
}
async function addPartnerDoc(){
  const partnerId = +document.getElementById('mPartnerDocs').dataset.partnerId;
  const title = document.getElementById('pdTitle').value.trim();
  const fileEl = document.getElementById('pdFile');
  const file = fileEl?.files?.[0];
  const expiry = document.getElementById('pdExpiry').value || null;
  if (!title) { showT('書類名を入力してください', 'twa'); return; }
  if (!file) { showT('ファイルを選択してください', 'twa'); return; }
  showLoad(true);
  try {
    const origSize = file.size;
    const blob = await resizeImageToBlob(file, 1600);
    const filePath = `partner${partnerId}/${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from('partner-docs').upload(filePath, blob, { contentType: 'image/jpeg' });
    if (upErr) throw upErr;
    const row = { client_id: partnerId, title, file_path: filePath, expiry_date: expiry, uploaded_by: me?.name||'' };
    const { data, error } = await sb.from('partner_company_docs').insert(row).select().single();
    if (error) throw error;
    partnerDocs.unshift(data);
    document.getElementById('pdTitle').value=''; fileEl.value=''; document.getElementById('pdExpiry').value='';
    addLog('協力会社書類追加', `partner:${partnerId} ${title}（${fmtBytes(origSize)} → ${fmtBytes(blob.size)}）`);
    showT(`書類を追加しました（${fmtBytes(origSize)} → ${fmtBytes(blob.size)}）`);
    renderPartnerDocsMBody();
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
  showLoad(false);
}
async function viewPartnerDoc(filePath){
  // signedUrl取得(await)の後にwindow.open()すると、ブラウザがユーザー操作から切り離されたと
  // 判断してポップアップブロックする（特にSafari）ため、クリック時に空タブを先に開いておき、
  // 取得後にそのタブへ遷移させる
  const win = window.open('', '_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'twa'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  try {
    const {data, error} = await sb.storage.from('partner-docs').createSignedUrl(filePath, 3600);
    if (error) throw error;
    win.location.href = data.signedUrl;
  } catch(e) { win.close(); showT('表示エラー: '+e.message, 'ter'); }
}
async function deletePartnerDoc(id){
  const doc = partnerDocs.find(x=>x.id===id); if (!doc) return;
  if (!confirm('この書類を削除しますか？')) return;
  showLoad(true);
  try {
    const { error } = await sb.from('partner_company_docs').delete().eq('id', id);
    if (error) throw error;
    if (doc.file_path) await sb.storage.from('partner-docs').remove([doc.file_path]);
    partnerDocs = partnerDocs.filter(x=>x.id!==id);
    addLog('協力会社書類削除', doc.title);
    showT('削除しました');
    renderPartnerDocsMBody();
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* ===== USERS ===== */
function renderUsr(){
  document.getElementById('usrList').innerHTML=users.map(u=>{
    const rn=u.role==='admin'?'管理者':u.role==='editor'?'編集者':u.role==='driver'?'ドライバー':'閲覧者';
    const rc=u.role==='admin'?'ad':u.role==='editor'?'ed':u.role==='driver'?'drv':'vi';
    const isMe=me&&me.id===u.id;
    const drvName=u.role==='driver'&&u.driver_id?(drvs.find(d=>d.id===u.driver_id)?.name||''):'';
    return`<div class="urow"><div class="uav">${(u.name||'').slice(0,2)}</div><div style="flex:1"><div style="font-size:12px;font-weight:500">${u.name}${isMe?' <span style="font-size:10px;color:var(--blue)">（ログイン中）</span>':''}</div><div style="font-size:10px;color:var(--text2)">ID: ${u.id}${drvName?` ｜ 🚚 ${drvName}`:''}</div></div><span class="bdg ${rc}">${rn}</span>${!isMe?`<button class="ibtn" onclick="editUsr('${u.id}')">✎</button><button class="ibtn" onclick="delUsr('${u.id}')">🗑</button>`:''}</div>`;
  }).join('');
}
function onUsrRoleChange(){
  const role=document.getElementById('uRo').value;
  const isDrv=role==='driver';
  // 管理者アカウントにもドライバーを任意で紐づけられるようにする（本人も乗務する場合に、
  // 日報入力で自分の車両をすぐ選べるようにするため）。管理者権限はそのまま維持され、
  // ドライバーポータルには切り替わらない（proceedAfterLogin側のrole判定は変わらないため）
  const isAdmin=role==='admin';
  document.getElementById('uDrvFld').style.display=(isDrv||isAdmin)?'block':'none';
  document.getElementById('uDrvRequiredMark').style.display=isDrv?'inline':'none';
  document.getElementById('uDrvFldHint').textContent=isDrv
    ? 'このアカウントでログインすると、選択したドライバーのポータル（日報・月報・支払明細書・書類提出）が表示されます'
    : '任意：本人も乗務する場合に紐づけると、日報入力で自分の車両がすぐ選べるようになります（管理者としての画面表示は変わりません）';
  if(isDrv||isAdmin)populateUsrDrvSel();
  // 新規ドライバーアカウントは初期パスワードをランダム生成して欄に入れておく（管理者が確認・変更可能）。初回ログイン時の変更を促す
  const pwEl=document.getElementById('uPw');
  const isNew=eUsrId===null;
  if(isDrv&&isNew&&!pwEl.value)pwEl.value=genInitialPassword();
  document.getElementById('uPwHint').style.display=(isDrv&&isNew)?'block':'none';
}
function populateUsrDrvSel(cur){
  const sel=document.getElementById('uDrvSel');
  sel.innerHTML='<option value="">選択してください</option>'+[...drvs].sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999)).map(d=>`<option value="${d.id}">${escHtml(d.name)}${d.supplier_id?`（ID:${escHtml(d.supplier_id)}）`:''}</option>`).join('');
  enhanceSelectSearchable('uDrvSel');
  if(cur)sel.value=cur;
}
function openUsrM(){eUsrId=null;['uId','uNm','uPw'].forEach(id=>document.getElementById(id).value='');document.getElementById('uRo').value='editor';onUsrRoleChange();document.getElementById('mUsrH').innerHTML='ユーザー追加 <button class="ibtn" onclick="closeM(\'mUsr\')">✕</button>';document.getElementById('mUsr').classList.add('on');}
function editUsr(id){const u=users.find(x=>x.id===id);if(!u)return;eUsrId=id;document.getElementById('uId').value=u.id;document.getElementById('uNm').value=u.name;document.getElementById('uPw').value='';document.getElementById('uRo').value=u.role;onUsrRoleChange();if(u.role==='driver'||u.role==='admin')populateUsrDrvSel(u.driver_id);document.getElementById('mUsrH').innerHTML='ユーザー編集 <button class="ibtn" onclick="closeM(\'mUsr\')">✕</button>';document.getElementById('mUsr').classList.add('on');}
async function delUsr(id){
  if(id===me?.id){alert('自分自身は削除できません');return;}if(!confirm('削除しますか？'))return;
  try{
    const u=users.find(x=>x.id===id);
    const{error}=await sb.from('users').delete().eq('id',id);if(error)throw error;
    // ログインアカウント（Supabase Auth）も削除。失敗しても本体削除は成立させる
    if(u?.auth_uid){
      try{
        const{data:fnData,error:fnErr}=await sb.functions.invoke('manage-login',{body:{action:'delete',auth_uid:u.auth_uid}});
        if(fnErr||fnData?.error)console.warn('Authアカウント削除エラー:',fnData?.error||fnErr.message);
      }catch(e2){console.warn('Authアカウント削除エラー:',e2.message);}
    }
    users=users.filter(x=>x.id!==id);addLog('ユーザー削除',`id:${id}`);renderUsr();showT('削除しました');
  }
  catch(e){showT('削除エラー: '+e.message,'ter');}
}
async function saveUsr(){
  const id=document.getElementById('uId').value.trim(),n=document.getElementById('uNm').value.trim(),pw=document.getElementById('uPw').value,role=document.getElementById('uRo').value;
  if(!id||!n){alert('IDと名前は必須です');return;}
  // 編集時はパスワード空欄=変更なし、新規時は必須
  if(!eUsrId&&!pw){alert('パスワードを入力してください');return;}
  // 管理者は任意（本人も乗務する場合に日報入力を楽にするための紐づけ）、ドライバーは必須
  const driverId = (role==='driver'||role==='admin') ? (+document.getElementById('uDrvSel').value||null) : null;
  if(role==='driver'&&!driverId){alert('紐づけるドライバーを選択してください');return;}
  showLoad(true);
  try{
    // 認証はSupabase Auth（Edge Function経由）に一本化済みのため、独自のパスワードハッシュはもう保存しない
    if(eUsrId!==null){
      const cur=users.find(x=>x.id===eUsrId);
      // パスワード変更はEdge Function経由でSupabase Auth側を更新する（管理者のみ実行可）
      if(pw && cur?.auth_uid){
        const{data:fnData,error:fnErr}=await sb.functions.invoke('manage-login',{body:{action:'set_password',auth_uid:cur.auth_uid,password:pw}});
        if(fnErr||fnData?.error)throw new Error(fnData?.error||fnErr.message);
      }
      // パスワードを新しく設定した場合は、本人がまだ知らない/管理者が決めた値なので次回ログイン時に変更を求める
      const upd = {id,name:n,role,driver_id:driverId,...(pw?{must_change_password:true}:{})};
      const{data,error}=await sb.from('users').update(upd).eq('id',eUsrId).select().single();
      if(error)throw error;
      const idx=users.findIndex(x=>x.id===eUsrId);if(idx>=0)users[idx]=data;
      addLog('ユーザー編集',n+(pw?'（PW変更）':''));
    } else {
      if(users.find(x=>x.id===id)){alert('そのIDは既に使用されています');showLoad(false);return;}
      // ログイン用のSupabase AuthアカウントをEdge Function（管理者権限）経由で作成
      const{data:fnData,error:fnErr}=await sb.functions.invoke('manage-login',{body:{action:'create',login_id:id,password:pw}});
      if(fnErr||fnData?.error){showT('ログインアカウント作成エラー: '+(fnData?.error||fnErr.message),'ter');showLoad(false);return;}
      // 新規アカウントは管理者が決めたパスワードなので、初回ログイン時に本人へ変更を求める
      const{data,error}=await sb.from('users').insert({id,name:n,role,auth_uid:fnData.auth_uid,driver_id:driverId,must_change_password:true}).select().single();
      if(error)throw error;users.push(data);addLog('ユーザー追加',n);
      if(role==='driver'){closeM('mUsr');renderUsr();showT('ユーザーを保存しました');showLoginCreatedInfo(id,pw);showLoad(false);return;}
    }
    closeM('mUsr');renderUsr();showT('ユーザーを保存しました');
  }catch(e){showT('保存エラー: '+e.message,'ter');}
  showLoad(false);
}

// ドライバー管理から、そのドライバーのログインパスワードをランダムな初期値にワンクリックでリセットする
// （パスワードを忘れた等の際に、ユーザー管理タブまで行かなくても対応できるようにするショートカット）
// リセット後は新しい初期パスワードを画面に表示し、そのまま本人へ連絡できるようにする
async function resetDriverPassword(drvId){
  const d=drvs.find(x=>x.id===drvId);if(!d)return;
  const u=users.find(x=>x.driver_id===drvId&&x.role==='driver');
  if(!u){alert(`「${d.name}」にはログインアカウントがありません（ユーザー管理から作成してください）`);return;}
  if(!confirm(`「${d.name}」のパスワードを新しい初期パスワードにリセットしますか？\n新しいパスワードは次の画面に表示されます。次回ログイン時に本人へ変更を求めます。`))return;
  showLoad(true);
  try{
    const newPw=genInitialPassword();
    const{data:fnData,error:fnErr}=await sb.functions.invoke('manage-login',{body:{action:'set_password',auth_uid:u.auth_uid,password:newPw}});
    if(fnErr||fnData?.error)throw new Error(fnData?.error||fnErr.message);
    const{data,error}=await sb.from('users').update({must_change_password:true}).eq('id',u.id).select().single();
    if(error)throw error;
    const idx=users.findIndex(x=>x.id===u.id);if(idx>=0)users[idx]=data;
    addLog('パスワードリセット',`${d.name}（ドライバー管理から）`);
    showT(`「${d.name}」のパスワードをリセットしました`);
    showLoginCreatedInfo(u.id,newPw);
  }catch(e){showT('リセットエラー: '+e.message,'ter');}
  showLoad(false);
}

// 初期パスワードを毎回ランダム生成する。ログインID＝仕入先ID（連番で推測可能）のため、
// 固定値「1234」だと未ログインのアカウントを総当たりで乗っ取れてしまう。発行時に画面表示するので運用に支障はない。
// 紛らわしい文字(0,O,1,l,I)を除いた英数字8桁。must_change_passwordで初回ログイン時に必ず変更される一時値。
function genInitialPassword(){
  const chars='23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const arr=new Uint32Array(8);
  if(window.crypto?.getRandomValues) crypto.getRandomValues(arr);
  else for(let i=0;i<8;i++) arr[i]=Math.floor(Math.random()*4294967296);
  let s=''; for(let i=0;i<8;i++) s+=chars[arr[i]%chars.length];
  return s;
}
const DRIVER_INVITE_EXPIRY_DAYS = 7;
/* ランダムな招待トークンを生成する。
   Math.randomは予測されうるため使わない。使えない環境では発行を中止する
   （弱いトークンを発行するくらいなら発行しないほうが安全） */
function genInviteToken(){
  if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g,'');
  if (window.crypto?.getRandomValues) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2,'0')).join('');
  }
  throw new Error('このブラウザでは安全な招待URLを作れません。別のブラウザでお試しください');
}
// 招待の宛先候補を並べる。既にログインを持っている人はその旨を添える
function populateDriverInviteTargets(){
  const sel = document.getElementById('drvInviteTarget');
  if (!sel) return;
  const hasLogin = new Set((users||[]).filter(u=>u.role==='driver'&&u.driver_id!=null).map(u=>String(u.driver_id)));
  const opts = [...(drvs||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja'))
    .map(d=>`<option value="${d.id}">${escHtml(d.name||'')}${d.supplier_id?`（${escHtml(d.supplier_id)}）`:''}${hasLogin.has(String(d.id))?' ※ログイン発行済み':''}</option>`).join('');
  sel.innerHTML = '<option value="">新しく迎えるドライバー（台帳にまだいない方）</option>' + opts;
}
// 宛先の絞り込み。人数が多いと一覧から探すのが大変なので名前・仕入先IDで絞れるようにする
function filterDriverInviteTargets(){
  const q = nm(document.getElementById('drvInviteFilter')?.value || '');
  const sel = document.getElementById('drvInviteTarget');
  if (!sel) return;
  let firstVisible = null;
  [...sel.options].forEach(o => {
    const hit = !q || o.value === '' || nm(o.text).includes(q);
    o.hidden = !hit;
    if (hit && o.value !== '' && !firstVisible) firstVisible = o;
  });
  // 絞り込んだら、残った先頭の候補を選んでおく（既定の「新規」のままだと選び忘れる）
  const cur = sel.selectedOptions[0];
  if (q && firstVisible && (!cur || cur.hidden || cur.value === '')) sel.value = firstVisible.value;
  if (!q && cur && cur.hidden) sel.value = '';
}
// 宛先を選ぶところから始める
function openDriverInviteM(){
  populateDriverInviteTargets();
  const t = document.getElementById('drvInviteTarget'); if (t) t.value = '';
  const f = document.getElementById('drvInviteFilter'); if (f) f.value = '';
  filterDriverInviteTargets();
  document.getElementById('drvInviteSetup').style.display = 'block';
  document.getElementById('drvInviteResult').style.display = 'none';
  document.getElementById('mDrvInvite').classList.add('on');
}
/* ドライバー一覧の行から、その人宛の招待をその場で発行する。
   宛先を決める仕組みを入れた結果、毎回プルダウンから探すことになって手間が増えたため、
   普段はこちらを使う。プルダウンは新規の方や、一覧を開いていない時のための残り道。 */
async function createDriverInviteFor(drvId){
  const d = (drvs||[]).find(x => x.id === drvId);
  if (!d) { showT('ドライバーが見つかりません', 'ter'); return; }
  openDriverInviteM();
  const sel = document.getElementById('drvInviteTarget');
  if (sel) sel.value = String(drvId);
  await createDriverInvite();
}
/* 1回限りの招待URL/QRコードを発行する。
   target_driver_id を入れておくと、その招待では指定した1人にしか合流できなくなる。
   未指定（新規ドライバー向け）の招待で既存ドライバーに合流した場合は、
   なりすましの可能性が残るためログインの自動発行は行われない（管理者が画面から発行する）。 */
async function createDriverInvite(){
  const targetId = +document.getElementById('drvInviteTarget')?.value || null;
  const targetName = targetId ? ((drvs||[]).find(d=>d.id===targetId)?.name || '') : '';
  showLoad(true);
  try{
    const token = genInviteToken();
    const expiresAt = new Date(Date.now() + DRIVER_INVITE_EXPIRY_DAYS*86400000);
    const{error}=await sb.from('driver_invites').insert({token, created_by: me?.name||'', expires_at: expiresAt.toISOString(), target_driver_id: targetId});
    if(error)throw error;
    const url = `${location.origin}${location.pathname}?invite=${token}`;
    document.getElementById('drvInviteUrl').value = url;
    document.getElementById('drvInviteExpiry').textContent = `有効期限: ${expiresAt.toLocaleString('ja-JP')}まで`;
    const qrEl = document.getElementById('drvInviteQr');
    qrEl.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qrEl, {text: url, width: 200, height: 200});
    } else {
      qrEl.textContent = '（QRコードライブラリの読み込みに失敗しました。URLを直接お使いください）';
    }
    const forEl = document.getElementById('drvInviteFor');
    if (forEl) forEl.textContent = targetId ? `宛先: ${targetName} さん専用` : '宛先: 新しく迎えるドライバー';
    document.getElementById('drvInviteSetup').style.display = 'none';
    document.getElementById('drvInviteResult').style.display = 'block';
    addLog('ドライバー招待発行', targetId ? `${targetName}宛（${DRIVER_INVITE_EXPIRY_DAYS}日間有効）` : `新規ドライバー用（${DRIVER_INVITE_EXPIRY_DAYS}日間有効）`);
    document.getElementById('mDrvInvite').classList.add('on');
  }catch(e){showT('招待URL発行エラー: '+e.message,'ter');}
  showLoad(false);
}
function copyDriverInviteUrl(){
  const el = document.getElementById('drvInviteUrl');
  el.select();
  navigator.clipboard?.writeText(el.value).then(()=>showT('URLをコピーしました')).catch(()=>showT('コピーに失敗しました。手動で選択してコピーしてください','ter'));
}

// ログインを新規発行した直後、そのままLINE/SMS等に貼り付けて本人へ送れる文面を表示する
// （管理者がドライバーへの連絡手段を自分で選べるよう、自動送信ではなくコピー用の画面にとどめている）
function showLoginCreatedInfo(loginId, password=''){
  const url = location.origin + location.pathname;
  document.getElementById('loginInfoText').value =
    `ログインURL: ${url}\nログインID: ${loginId}\n初期パスワード: ${password}\n\n初回ログイン時にパスワードの変更が必要です。`;
  document.getElementById('mLoginInfo').classList.add('on');
}
function copyLoginInfoText(){
  const el = document.getElementById('loginInfoText');
  el.select();
  navigator.clipboard?.writeText(el.value).then(()=>showT('コピーしました')).catch(()=>showT('コピーに失敗しました。手動で選択してコピーしてください','ter'));
}

// ===== ドライバー自己登録（招待URL/QRコードで開いた場合。ログイン不要のためsb.rpc経由でトークンを検証する） =====
let currentInviteToken = null;
/* 協力会社の候補。
   以前は一覧をまとめて取ってきてJS側で絞り込んでいたが、それでは
   RPCを直接叩かれた時に全社名（取引先を含む）が漏れる。
   入力された文字を毎回サーバへ渡し、向こうで絞り込んだ分だけ受け取る。
   直前の問い合わせ結果だけを持っておき、同じ語なら問い合わせ直さない。 */
let invitePartnerCache = { q: null, names: [] };
async function fetchInvitePartnerNames(q) {
  const key = nm(q || '');
  if (key.length < 2) return [];
  if (invitePartnerCache.q === key) return invitePartnerCache.names;
  if (!sb || !currentInviteToken) return [];
  try {
    const { data } = await sb.rpc('list_partner_names_for_invite', { p_token: currentInviteToken, p_query: q });
    const names = (data || []).map(r => r.name).filter(Boolean);
    invitePartnerCache = { q: key, names };
    return names;
  } catch(e) { return []; }   // 候補が取れなくても手入力での登録は続けられる
}
// 2文字以上入力された時だけ候補を出す
async function onDiPartnerInput() {
  const box = document.getElementById('diPartnerSuggestions');
  const raw = document.getElementById('diPartner').value;
  const q = nm(raw);
  if (q.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const found = await fetchInvitePartnerNames(raw);
  // 問い合わせている間に入力が変わっていたら、古い結果は出さない
  if (nm(document.getElementById('diPartner').value) !== q) return;
  const matches = found.slice(0, 8);
  if (!matches.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.innerHTML = matches.map(name => `<div style="padding:6px 8px;font-size:12px;cursor:pointer" onmousedown="selectDiPartner('${escAttrJs(name)}')" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">${escHtml(name)}</div>`).join('');
  box.style.display = 'block';
}
function selectDiPartner(name) {
  document.getElementById('diPartner').value = name;
  hideDiPartnerSuggestions();
}
// 会社名の表記ゆれ比較用の正規化。空白・記号・法人格（株式会社/有限会社など）を落として比べる。
// 「〇〇運送」と「〇〇運送株式会社」を同じ会社として検出するために使う
function normalizePartnerName(s) {
  return nm(s || '')
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|（株）|\(株\)|（有）|\(有\))/g, '')
    .replace(/[・\-－ー_,.、。]/g, '');
}
// 入力された会社名と紛らわしい既存の協力会社を探す。
// 完全一致は既存に紐づくだけで二重登録にならないため対象外。
// 正規化して一致するもの、または一方が他方を含むものを「紛らわしい」とみなす
async function findSimilarPartners(input) {
  const raw = (input || '').trim();
  if (!raw) return [];
  const n = normalizePartnerName(raw);
  if (n.length < 2) return [];
  const candidates = await fetchInvitePartnerNames(raw);
  return candidates.filter(existing => {
    if (nm(existing) === nm(raw)) return false; // 完全一致は既存が使われるので問題ない
    const e = normalizePartnerName(existing);
    if (!e || e.length < 2) return false;
    return e === n || e.includes(n) || n.includes(e);
  });
}
function hideDiPartnerSuggestions() {
  const box = document.getElementById('diPartnerSuggestions');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}
const INVITE_REASON_MSG = { invalid:'このリンクは無効です。招待URLを再度ご確認ください。', used:'このリンクはすでに使用済みです。管理者に新しいリンクを発行してもらってください。', expired:'このリンクの有効期限が切れています。管理者に新しいリンクを発行してもらってください。' };
async function checkDriverInviteToken(token){
  currentInviteToken = token;
  const statusEl = document.getElementById('driverInviteStatus');
  try{
    const { data, error } = await sb.rpc('check_driver_invite', { p_token: token });
    if (error) throw error;
    const row = data?.[0];
    if (!row?.valid) {
      // 使用済み・期限切れの招待リンクを再度開いた場合、行き止まりにせず通常のログイン画面へ誘導する
      statusEl.innerHTML = `<div>${escHtml(INVITE_REASON_MSG[row?.reason] || 'このリンクは使用できません。')}</div>
        <button class="btn pri sml" style="margin-top:10px" onclick="location.href=location.origin+location.pathname">ログイン画面はこちら</button>`;
      return;
    }
    statusEl.style.display = 'none';
    pendTags = [];
    document.getElementById('diName').value = '';
    document.getElementById('diTel').value = '';
    document.getElementById('diCi').value = '';
    document.getElementById('diPartner').value = '';
    renderTags();
    document.getElementById('driverInviteForm').style.display = 'block';
    // 候補は一括では取らない。入力された文字ごとにサーバへ問い合わせる（fetchInvitePartnerNames）
    invitePartnerCache = { q: null, names: [] };
  }catch(e){
    statusEl.textContent = '確認中にエラーが発生しました: ' + e.message;
  }
}
// 自己登録の完了後、そのドライバーにログイン（users）がなければ発行し、画面に表示する
// （マッチした既存ドライバー・新規登録どちらの場合も対象。既にログインがある場合はIDのみ表示しパスワードは再表示しない）
async function ensureAndShowDriverLogin(driverId){
  try {
    const { data: infoRows } = await sb.rpc('get_driver_login_info', { p_token: currentInviteToken, p_driver_id: driverId });
    const existingLoginId = Array.isArray(infoRows) ? infoRows[0]?.login_id : infoRows?.login_id;
    if (existingLoginId) {
      return `<div style="margin-top:10px;padding:8px 10px;background:var(--bg2);border-radius:var(--radius);font-size:12px">ログインID: <b>${escHtml(existingLoginId)}</b><br>既に発行済みのため、パスワードは管理者にご確認ください。</div>`;
    }
    const { data, error } = await sb.functions.invoke('manage-login', { body: { action: 'self_register_create', token: currentInviteToken, driver_id: driverId } });
    if (error || data?.error) throw new Error(data?.error || error.message);
    return `<div style="margin-top:10px;padding:8px 10px;background:var(--bg2);border-radius:var(--radius);font-size:12px">
      ログインID: <b>${escHtml(data.login_id)}</b><br>初期パスワード: <b>${escHtml(data.password)}</b><br>このID・パスワードでログインし、初回ログイン時にパスワードを変更してください。</div>`;
  } catch(e) {
    console.warn('ensureAndShowDriverLogin:', e.message);
    return `<div style="margin-top:10px;font-size:11px;color:var(--text2)">ログイン情報の発行に失敗しました。お手数ですが管理者にお問い合わせください。</div>`;
  }
}
async function submitDriverSelfRegistration(){
  const name = document.getElementById('diName').value.trim();
  const tel = document.getElementById('diTel').value.trim();
  const partner = document.getElementById('diPartner').value.trim();
  const errEl = document.getElementById('diErr');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'お名前を入力してください'; return; }
  if (!tel) { errEl.textContent = '電話番号を入力してください'; return; }
  if (!pendTags.length) { errEl.textContent = '担当車番を1台以上追加してください'; return; }
  // 入力された車番が既に登録済みでないか確認する（入力ミス防止）。
  // 誰に登録されているかは本人には見せず、車番が使用済みであることだけを伝える。
  // 1台を交代で使う場合は正しい入力なので、続行できるようにする
  try {
    const { data: dupCars, error: dupErr } = await sb.rpc('check_cars_registered', { p_token: currentInviteToken, p_cars: pendTags });
    if (!dupErr && dupCars && dupCars.length) {
      const ok = confirm(
        `次の車番は既に登録されています。\n\n${dupCars.map(c => '・' + c).join('\n')}\n\n` +
        `1台を交代で使用している場合はこのまま進めてください。\n` +
        `入力間違いの場合は「キャンセル」を押して車番を修正してください。\n\n` +
        `このまま登録しますか？`
      );
      if (!ok) return;
    }
  } catch(e) { console.warn('check_cars_registered:', e.message); } // 確認に失敗しても登録自体は続行する
  // 協力会社名が既存と紛らわしい場合は確認する。
  // 完全一致なら既存に紐づくが、「〇〇運送」と「〇〇運送株式会社」のような表記ゆれだと
  // 別会社として二重に作られてしまうため、登録前に気づけるようにする
  const similar = await findSimilarPartners(partner);
  if (similar.length) {
    const ok = confirm(
      `入力された会社名「${partner}」に似た協力会社が既に登録されています。\n\n` +
      `${similar.map(s => '・' + s).join('\n')}\n\n` +
      `同じ会社の場合は「キャンセル」を押し、上の名前と同じになるように入力し直してください。\n` +
      `（入力欄に2文字以上入力すると候補が表示されます）\n\n` +
      `別の会社であれば、このまま登録して問題ありません。\n\n` +
      `このまま「${partner}」で登録しますか？`
    );
    if (!ok) return;
  }
  showLoad(true);
  try{
    const { data, error } = await sb.rpc('submit_driver_registration', { p_token: currentInviteToken, p_name: name, p_tel: tel, p_cars: pendTags, p_partner_name: partner||null });
    if (error) throw error;
    // 電話番号または氏名が既存ドライバーと一致した場合、新規登録せず車番だけ既存レコードに追記している（二重登録防止）
    const row = Array.isArray(data) ? data[0] : data;
    const merged = row?.merged;
    const driverId = row?.driver_id;
    document.getElementById('driverInviteForm').style.display = 'none';
    const statusEl = document.getElementById('driverInviteStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--green-text)';
    statusEl.innerHTML = merged
      ? 'すでに登録があるお名前・電話番号でしたので、車両情報を既存の登録に追加しました。'
      : '登録が完了しました。';
    if (driverId != null) {
      const loginHtml = await ensureAndShowDriverLogin(driverId);
      statusEl.innerHTML += loginHtml;
    }
  }catch(e){
    const reasonMsg = { invalid_token: INVITE_REASON_MSG.invalid, token_already_used: INVITE_REASON_MSG.used, token_expired: INVITE_REASON_MSG.expired, name_required: 'お名前を入力してください', tel_required: '電話番号を入力してください', car_required: '担当車番を1台以上追加してください' };
    errEl.textContent = reasonMsg[e.message] || ('登録エラー: ' + e.message);
  }
  showLoad(false);
}

/* ===== CSV EXPORT ===== */
const CSV_COLS_BILLING = ['日付','車番','ドライバー','取引先','種別','運賃','高速代','立替代','追加料金(他)','税率','税抜合計','消費税','税込合計','ステータス','備考'];
// 集計（取引先別）タブでチェックした取引先分だけをCSV出力する（Excel/PDFの「選択分」と同じ絞り込みに揃える。
// 以前は絞り込みを無視してrecs全件を出力していたため、選択と出力内容が食い違っていた）
function expCSV(){
  const checked = Array.from(document.querySelectorAll('.aggInvChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('取引先を選択してください'); return; }
  const groups = checked.map(cliId => Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId)?.rows).filter(rows=>rows && rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  window._expCsvRows = groups.flat();
  openCsvColsM('billing');
}
function doExpCSV(idxs){
  const sourceRows = window._expCsvRows || recs;
  const allRows=[CSV_COLS_BILLING,...sourceRows.map(r=>{const t=rtax(r);const fb=feeBreakdown(r,'billing');const s=(r.fare||0)+fb.total;const d=recDrv(r),c=lkC(r.cli);return[r.date,r.car,d?d.name:'未配車',c?c.name:'未設定',typeShort(r.type),r.fare||0,fb.hw,fb.oth,fb.other,((r.tax??10))+'%',s,t,s+t,stLbl(r.st),r.note||''];})];
  const rows = allRows.map(row => idxs.map(i=>row[i]));
  const csv=rows.map(r=>r.map(c=>`"${csvSafe(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='invoices.csv';a.click();
  addLog('CSV出力',`${sourceRows.length}件`);showT('CSVをダウンロードしました');
}

/* ===== CSV出力項目選択（共通モーダル：請求明細書CSV・支払明細書CSV） ===== */
let csvColsTarget = null;
function openCsvColsM(target){
  csvColsTarget = target;
  const cols = target==='billing' ? CSV_COLS_BILLING : CSV_COLS_PAYMENT;
  const key = 'csvCols_'+target;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key)||'null'); } catch(e) { saved = null; }
  document.getElementById('csvColsList').innerHTML = cols.map((c,i)=>`<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="csvColChk" value="${i}" ${(!saved||saved.includes(i))?'checked':''}> ${c}</label>`).join('');
  document.getElementById('mCsvCols').classList.add('on');
}
function toggleCsvColsAll(v){ document.querySelectorAll('.csvColChk').forEach(el=>el.checked=v); }
function executeCsvExport(){
  const idxs = Array.from(document.querySelectorAll('.csvColChk:checked')).map(el=>+el.value);
  if (!idxs.length) { alert('出力する項目を1つ以上選択してください'); return; }
  localStorage.setItem('csvCols_'+csvColsTarget, JSON.stringify(idxs));
  closeM('mCsvCols');
  if (csvColsTarget==='billing') doExpCSV(idxs); else doDownloadPayCsv(idxs);
}

/* ===== PDF ===== */
function openPdfM(){
  parsedPdf=[];document.getElementById('pPv').innerHTML='';document.getElementById('pSt').textContent='';document.getElementById('pImp').classList.add('hide');document.getElementById('pFi').value='';
  const sel=document.getElementById('pdfCli');
  if(sel){sel.innerHTML='<option value="">選択してください</option>'+clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');enhanceSelectSearchable('pdfCli');}
  document.getElementById('mPdf').classList.add('on');
}
async function handlePdf(file){
  if(!file)return;const st=document.getElementById('pSt');st.textContent='PDF読み込み中…';parsedPdf=[];
  try{
    const ab=await file.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:ab}).promise;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    for(let i=1;i<=Math.min(pdf.numPages,3);i++){
      const page=await pdf.getPage(i),vp=page.getViewport({scale:2.0});
      canvas.width=vp.width;canvas.height=vp.height;
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const b64=canvas.toDataURL('image/jpeg',0.85).split(',')[1];
      st.textContent=`${i}ページ目をAIで解析中…`;
      const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1500,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},{type:'text',text:`この作業料金明細書から各行のデータを抽出してください。手書き文字（ドライバー名らしき筆記体）は無視してください。JSONの配列のみ返してください:\n[{"date":"YYYY-MM-DD","car":"車両登録番号","type":"charter または regular","fare":本体金額数値,"hw":実費料金数値または0,"tax":10}]\n車番が読み取れない行は除外。`}]}]})});
      const data=await res.json();const raw=data.content.map(x=>x.text||'').join('').replace(/```json|```/g,'').trim();
      try{const r2=JSON.parse(raw);if(Array.isArray(r2))parsedPdf.push(...r2);}catch(e){}
    }
    parsedPdf=parsedPdf.filter(r=>r.car&&r.car.length>2);
    if(!parsedPdf.length){st.textContent='データを自動抽出できませんでした。';return;}
    st.textContent=`${parsedPdf.length}件のデータが見つかりました`;
    document.getElementById('pPv').innerHTML=mkPrev(parsedPdf,['日付','車番','種別','運賃'],r=>[r.date||'—',r.car,typeShort(r.type),yen(r.fare||0)]);
    document.getElementById('pImp').classList.remove('hide');
  }catch(e){st.textContent='エラー: '+e.message;}
}
async function importPdf(){
  const cliId=+document.getElementById('pdfCli').value||null;
  if(!cliId){alert('取込先の取引先を選択してください');return;}
  showLoad(true);
  try{
    const inserts=parsedPdf.map(r=>({date:r.date||'',car:r.car||'',type:r.type||'regular',fare:r.fare||0,hw:r.hw||0,oth:0,tax:(r.tax??10),st:0,cli:cliId,note:''}));
    const{data,error}=await sb.from('invoices').insert(inserts).select();
    if(error)throw error;
    recs=[...(data||[]),...recs];
    addLog('PDF取込',`${clients.find(c=>c.id===cliId)?.name||''} ${parsedPdf.length}件`);closeM('mPdf');renderInv();showT(`${parsedPdf.length}件を取り込みました`);
  }catch(e){showT('取込エラー: '+e.message,'ter');}
  showLoad(false);
}

/* ===== CSV IMPORT ===== */
function openCsvM(){
  parsedCsv=[];document.getElementById('cPv').innerHTML='';document.getElementById('cDups').innerHTML='';document.getElementById('cSt').textContent='';document.getElementById('cImp').classList.add('hide');document.getElementById('cFi').value='';
  const sel=document.getElementById('csvCli');
  if(sel){sel.innerHTML='<option value="">自動判定（通常CSVの取引先名列を使用）</option>'+clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');enhanceSelectSearchable('csvCli');}
  const taxRoundSel=document.getElementById('csvTaxRound');
  if(taxRoundSel) taxRoundSel.value='round';
  const hwAdvanceChk=document.getElementById('csvHwAsAdvance');
  if(hwAdvanceChk) hwAdvanceChk.checked=false;
  document.getElementById('mCsv').classList.add('on');
}

// CSV列をパース（カンマ区切り・ダブルクォート対応・外側スペース自動除去）
function parseCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  
  // 前後の不要な改行コード（\r や \n）だけをあらかじめ削る
  const cleanLine = line.replace(/[\r\n]+$/, '');

  for (let i = 0; i < cleanLine.length; i++) {
    const c = cleanLine[i];
    
    if (c === '"') {
      // "" の場合は1つのダブルクォートとしてパース
      if (inQ && cleanLine[i + 1] === '"') { 
        cur += '"'; 
        i++; 
      } else { 
        inQ = !inQ; 
      }
    } 
    else if (c === ',' && !inQ) { 
      // クォートの外側にあるカンマで区切る
      result.push(cur.trim()); // ★クォート外の余計なスペースをここでトリム
      cur = ''; 
    } 
    else { 
      cur += c; 
    }
  }
  
  result.push(cur.trim());
  return result;
}
// 全角英数→半角、スペース除去して車番を正規化
function normCar(s){
  return(s||'').replace(/[\uFF01-\uFF5E]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/[\s\u3000]/g,'');
}

// 支払予定明細書CSVかどうか判定
function isSeikyu(header){
  return header.includes('支払予定明細書番号')||header.includes('車両登録番号')||header.includes('発注区分');
}

function handleCsv(file){
  if(!file)return;
  const reader=new FileReader();
  // まずShift-JISで試みる
  reader.onload=e=>{
    processCsvText(e.target.result);
  };
  // Shift-JIS(cp932)として読み込み
  reader.readAsText(file,'Shift-JIS');
}

function processCsvText(text){
  parsedCsv=[];
  const lines=text.split('\n').filter(l=>l.trim());
  if(!lines.length){document.getElementById('cSt').textContent='ファイルが空です';return;}

  const firstRow=parseCsvLine(lines[0]);

  // ポーターガーデン 支払予定明細書フォーマット判定
  const seikyu = isSeikyu(firstRow.join(','))||isSeikyu(lines[1]||'');
  if(seikyu){
    parseSeikyuCsv(lines);
  } else {
    parseStandardCsv(lines);
  }

  // モーダルで取引先を手動選択している場合は、行ごとの自動判定より優先して全行に反映する
  const manualCliId = +document.getElementById('csvCli')?.value || 0;
  if (manualCliId) parsedCsv.forEach(r => r.cli = manualCliId);

  // 消費税の端数処理（取引先の明細書に合わせて切り捨てにする場合など）を全行に反映する
  const taxRound = document.getElementById('csvTaxRound')?.value || 'round';
  parsedCsv.forEach(r => r.tax_round = taxRound === 'floor' ? 'floor' : null);

  // 高速代を「ドライバーへの支払時のみ」立替（消費税込み・非課税扱い）として計上する場合：
  // 支払側の基本高速代はreplaces:'hw'マーカーにより0扱いにし（pay_hwへの0代入では請求側hwへフォールバックしてしまうため使わない）、
  // 代わりに消費税込みの金額を追加料金（立替）として計上する。取引先への請求側（hw）は税別のまま変更しない。
  if (document.getElementById('csvHwAsAdvance')?.checked) {
    parsedCsv.forEach(r => {
      if (r.hw > 0) {
        // 立替額は「行全体で数字が合う」よう逆算する：取引先CSVの消費税は行全体（運賃＋高速）に
        // 対して1回だけ丸められているため、高速代側を round(hw×1.1) と独立に丸めると
        // round(a+b)≠round(a)+round(b) の丸め差が行ごとに±1円出て、月合計で数円ずれる。
        // 記載の消費税額がある場合は「高速代＋（記載消費税−運賃のみの消費税）」とし、
        // 運賃(税込)＋立替 ＝ CSVの合計額 と厳密に一致させる
        const fareTax = roundHalfUp(r.fare * ((r.tax ?? 10) / 100));
        const amt = (r.tax_amount != null) ? (r.hw + r.tax_amount - fareTax) : roundHalfUp(r.hw * 1.10);
        r.extra_fees = [{ name: '高速代（立替）', amount: amt, applies: 'payment', tax: 'advance', replaces: 'hw' }];
      }
    });
  }

  const dups=parsedCsv.filter(r=>recs.some(x=>x.date===r.date&&normCar(x.car)===normCar(r.car)));
  document.getElementById('cDups').innerHTML=dups.map(d=>`<div class="duprow">⚠ ${escHtml(d.date)} / ${escHtml(d.car)} — 重複の可能性</div>`).join('');
  let statusMsg = `${parsedCsv.length}件を読み込みました${dups.length?`（重複疑い ${dups.length}件）`:''}`;
  if (seikyu && !manualCliId) statusMsg += ' ／ ⚠ この形式は行ごとの取引先名を含まないため、上の「反映先の取引先」で選択してください';
  document.getElementById('cSt').textContent = statusMsg;
  document.getElementById('cSt').style.color = (seikyu && !manualCliId) ? 'var(--red)' : 'var(--text2)';
  renderCsvPreview();
  if(parsedCsv.length)document.getElementById('cImp').classList.remove('hide');
}

// CSVインポートのプレビュー表示。種別は行ごとにプルダウンで個別に変更できる
function renderCsvPreview(){
  const typeOpts = (cur) => ['regular','charter','other'].map(v =>
    `<option value="${v}" ${cur===v?'selected':''}>${v==='regular'?'定期集配':v==='charter'?'チャーター':'その他'}</option>`
  ).join('');
  let html = `<div style="max-height:200px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);font-size:11px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--bg2)">
        <th style="padding:4px 7px;font-weight:500;text-align:left;white-space:nowrap">日付</th>
        <th style="padding:4px 7px;font-weight:500;text-align:left;white-space:nowrap">車番</th>
        <th style="padding:4px 7px;font-weight:500;text-align:left;white-space:nowrap">種別</th>
        <th style="padding:4px 7px;font-weight:500;text-align:right;white-space:nowrap">運賃</th>
        <th style="padding:4px 7px;font-weight:500;text-align:right;white-space:nowrap">高速</th>
      </tr></thead><tbody>`;
  parsedCsv.forEach((r,i) => {
    html += `<tr>
      <td style="padding:3px 7px;border-top:0.5px solid var(--border)">${escHtml(r.date)}</td>
      <td style="padding:3px 7px;border-top:0.5px solid var(--border)">${escHtml(r.car)}</td>
      <td style="padding:3px 7px;border-top:0.5px solid var(--border)"><select onchange="parsedCsv[${i}].type=this.value" style="font-size:11px;padding:2px 4px;border:0.5px solid var(--border2);border-radius:3px;background:var(--bg);color:var(--text)">${typeOpts(r.type)}</select></td>
      <td style="padding:3px 7px;border-top:0.5px solid var(--border);text-align:right">${yen(r.fare)}</td>
      <td style="padding:3px 7px;border-top:0.5px solid var(--border);text-align:right">${r.hw?yen(r.hw):'—'}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  document.getElementById('cPv').innerHTML = html;
}

// 支払予定明細書形式のパース
// 列定義（ヘッダー行=row2, データ行=row3以降）:
//   B(1)=発注区分, C(2)=取引日, T(19)=車両登録番号
//   U(20)=税区分, V(21)=運賃, AC(28)=実費料金等, AD(29)=本体金額
//   AJ(35)=料金体系名称, AM(38)=金額情報備考 ← 種別判定に使用
function parseSeikyuCsv(lines){
  // ヘッダー行を探す（「支払予定明細書番号」が含まれる行）
  let dataStart=3;
  for(let i=0;i<Math.min(lines.length,6);i++){
    if(lines[i].includes('支払予定明細書番号')&&lines[i].includes('発注区分')){
      dataStart=i+1;break;
    }
  }

  for(let i=dataStart;i<lines.length;i++){
    const cols=parseCsvLine(lines[i]);
    if(cols.length<20)continue;

    // 車番（全角→半角変換）
    const car=normCar(cols[19]||'');
    if(!car)continue;

    // 数字のみの車番はドライバー登録の車番と末尾照合して正式な車番に変換
    const resolvedCar=resolveCar(car);

    // 日付変換: 2026/5/1 → 2026-05-01
    const rawDate=(cols[2]||'').trim();
    let date=rawDate;
    if(/\d{4}\/\d{1,2}\/\d{1,2}/.test(rawDate)){
      const p=rawDate.split('/');
      date=`${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
    }

    // ★ 種別判定: AM列(index38)を最優先で参照
    // 「チャーター」「キャーター（誤字含む）」→ charter
    // 「集配」または空欄 → regular
    const amVal=normCar((cols[38]||'').trim()); // 念のため全角→半角
    const amRaw=(cols[38]||'').trim();
    let type='regular';
    if(amRaw.includes('チャーター')||amRaw.includes('キャーター')||
       amRaw.includes('チャータ')||amRaw.includes('charter')){
      type='charter';
    } else if(amRaw===''){
      // AM列が空の場合は料金体系名称(AJ=col35)で補完判定
      const aj=(cols[35]||'').trim();
      if(aj.includes('チャーター')||aj.includes('キャーター')){
        type='charter';
      }
    }

    // 金額:
    // AB(27)=基本料金等（運賃＋待機時間料などの合算）
    // AC(28)=実費料金等（高速代など）
    // AD(29)=本体金額（基本料金等＋実費料金等の合計）
    // 待機時間料などが含まれる場合があるためAB列を運賃として使用
    const kihon=parseInt((cols[27]||'0').replace(/[,，]/g,''))||0; // AB: 基本料金等
    const hw=parseInt((cols[28]||'0').replace(/[,，]/g,''))||0;    // AC: 実費料金等
    const hon=parseInt((cols[29]||'0').replace(/[,，]/g,''))||0;   // AD: 本体金額
    // 基本料金等があればそれを運賃に、なければ本体金額から実費を引いた値を使用
    const finalFare=kihon>0?kihon:(hon-hw>0?hon-hw:hon);

    // 税率: 課税10%→10, 課税8%→8, 非課税→0
    const taxStr=(cols[20]||'').trim();
    const tax=taxStr.includes('8%')?8:taxStr.includes('非課税')?0:10;

    // 消費税額: AE(30)=消費税額。取引先の明細書に記載の金額をそのまま採用し、自前で再計算しない
    // （インボイス単位でまとめて端数処理される等、行ごとの単純計算とは一致しないことがあるため）
    const taxAmountRaw=(cols[30]||'').trim().replace(/[,，]/g,'');
    const taxAmount=taxAmountRaw!==''?(parseInt(taxAmountRaw)||0):null;

    // 備考: 料金体系名称(AJ=col35)
    const note=(cols[35]||'').trim();

    // 取引先: このCSV形式には行ごとの取引先名が含まれないため自動判定はせず、
    // 呼び出し元（processCsvText）でモーダルの取引先選択欄の値を全行に反映する
    if(date&&resolvedCar&&(finalFare>0||hw>0)){
      parsedCsv.push({date,car:resolvedCar,type,fare:finalFare,hw,oth:0,tax,tax_amount:taxAmount,cli:null,note});
    }
  }
}
// 数字のみの車番をドライバー登録の車番と末尾照合して解決する
// 例: '1754' → ドライバーに '宮城1754' が登録されていれば '宮城1754' を返す
// 一致しなければそのまま返す
function resolveCar(car){
  // 数字のみかチェック
  if(!/^\d+$/.test(car))return car;
  // ドライバーに登録されている車番から末尾一致するものを探す
  for(const d of drvs){
    for(const c of (d.cars||[])){
      const nc=normCar(c);
      if(nc.endsWith(car)&&nc.length>car.length){
        return c; // 登録済みの正式な車番を返す
      }
    }
  }
  // 見つからなければそのまま
  return car;
}

// 標準フォーマット（アプリ独自CSV）のパース
function parseStandardCsv(lines){
  const start=lines[0]&&(lines[0].includes('日付')||lines[0].toLowerCase().includes('date'))?1:0;
  lines.slice(start).forEach(line=>{
    const cols=parseCsvLine(line);
    if(!cols[0]||!cols[1])return;
    const tp=(cols[2]||'').toLowerCase();
    const cn=cols[7]||'';
    const cli=clients.find(x=>x.name===cn||x.short===cn);
    parsedCsv.push({date:cols[0],car:cols[1],type:tp.includes('charter')||tp.includes('チャーター')?'charter':'regular',fare:parseInt(cols[3])||0,hw:parseInt(cols[4])||0,oth:parseInt(cols[5])||0,tax:parseInt(cols[6])||10,cli:cli?cli.id:null,note:cols[8]||''});
  });
}

async function importCsv(){
  const noCliCount = parsedCsv.filter(r=>!r.cli).length;
  if (noCliCount && !confirm(`${noCliCount}件は取引先が未設定のまま取り込まれます。よろしいですか？\n（先に「反映先の取引先」を選択すると全件に反映されます）`)) return;
  showLoad(true);
  try{
    const inserts=parsedCsv.map(r=>({...r,st:0}));
    const{data,error}=await sb.from('invoices').insert(inserts).select();
    if(error)throw error;
    recs=[...(data||[]),...recs];
    addLog('CSVインポート',`${parsedCsv.length}件`);closeM('mCsv');renderInv();showT(`${parsedCsv.length}件を取り込みました`);
  }catch(e){showT('取込エラー: '+e.message,'ter');}
  showLoad(false);
}

/* ===== UTILS ===== */
function mkPrev(rows,heads,fn){return`<div style="max-height:120px;overflow-y:auto;border:0.5px solid var(--border);border-radius:var(--radius);font-size:11px"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg2)">${heads.map(h=>`<th style="padding:4px 7px;font-weight:500;text-align:left;white-space:nowrap">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${fn(r).map((v,i)=>`<td style="padding:3px 7px;border-top:0.5px solid var(--border)${i>1?';text-align:right':''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function closeM(id){document.getElementById(id).classList.remove('on');}
function showT(msg,cls='tok'){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+cls;t.style.display='block';setTimeout(()=>t.style.display='none',2800);}
// タブに小さな赤丸を付け外しする（期限切れ等、開かなくても分かるようにする警告表示）。
// サブタブ（ntXX）の場合は、そのタブが属するグループタブ（gt-xxx＝大枠）にも同じ考え方で反映する
function setNavWarnDot(tabId, show) {
  applyWarnDot(document.getElementById(tabId), show);
  const m = tabId.match(/^nt(\d+)$/);
  const grp = m ? PAGE_GROUP[+m[1]] : null;
  if (!grp) return;
  const navEl = document.getElementById('nav-'+grp);
  const groupHasWarn = navEl ? !!navEl.querySelector('.nav-warn-dot') : show;
  applyWarnDot(document.getElementById('gt-'+grp), groupHasWarn);
}
function applyWarnDot(el, show) {
  if (!el) return;
  let dot = el.querySelector('.nav-warn-dot');
  if (show && !dot) { dot = document.createElement('span'); dot.className = 'nav-warn-dot'; el.appendChild(dot); }
  else if (!show && dot) { dot.remove(); }
}
function showLoad(v){const el=document.getElementById('loadOv');if(el)el.classList.toggle('on',v);}

/* ===== ダーク/ライトモード切替 =====
   既定はOS設定(prefers-color-scheme)に従う。ボタンで明示的に選ぶとlocalStorageに保存し、
   html[data-theme]でCSS変数を上書きする（次回起動時もその選択を維持） */
function currentEffectiveTheme(){
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function updateThemeToggleButtons(){
  const icon = currentEffectiveTheme() === 'dark' ? '☀️' : '🌙';
  ['themeToggleBtn','themeToggleBtnDrv'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent = icon; });
}
function toggleTheme(){
  const next = currentEffectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pgbase_theme', next); } catch(e) {}
  updateThemeToggleButtons();
}
updateThemeToggleButtons();

/* ===== 初期化 ===== */
(async()=>{
  const ok=initSupabase();
  const inviteToken = new URLSearchParams(location.search).get('invite');
  if (inviteToken) {
    // 招待URL経由で開いた場合はログイン画面を出さず、ドライバー自己登録フォームのみ表示する
    document.getElementById('pgLogin').classList.add('hide');
    document.getElementById('pgDriverInvite').classList.remove('hide');
    if (ok) await checkDriverInviteToken(inviteToken);
    else document.getElementById('driverInviteStatus').textContent = '接続に失敗しました。時間をおいて再度お試しください。';
    return;
  }
  if(ok){ await testConn(); await tryAutoLogin(); }
})();
