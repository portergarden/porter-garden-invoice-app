/* js/06-schedules.js
   支払スケジュールと入金スケジュール

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ===== 支払スケジュール Supabase移行版 ===== */
let schedData = [];
let receiptSchedData = [];

// 対象月(work month)にpay_month_offset分を加算し、pay_day（'end'または日付数値）に合わせた支払予定日を算出する
function computeDueDate(workMonth, offsetMonths, payDay) {
  const [y, m] = workMonth.split('-').map(Number);
  let ty = y, tm = m + (offsetMonths||0);
  while (tm > 12) { tm -= 12; ty++; }
  if (payDay === 'end' || !payDay) {
    const last = new Date(ty, tm, 0).getDate();
    return `${ty}-${String(tm).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  }
  return `${ty}-${String(tm).padStart(2,'0')}-${String(+payDay).padStart(2,'0')}`;
}

// ドライバー（または所属する協力会社）の支払日設定から、支払実行日の表示ラベル（例:2026/08/末日）を算出する。
// 所属会社に支払日設定があればそちらを優先し、
// なければドライバー個別の支払日設定、どちらも未設定なら翌々月末日にフォールバックする
// （autoGenPaySchedule()の支払予定生成と同じ優先順位ルール）
// ドライバーが協力会社に紐づいている場合、本人側が未入力の支払関連項目
// （振込先口座・インボイス登録番号・業務手数料率）は協力会社側の値をフォールバックとして使う。
// 支払日設定（computePayExecDateLabel/autoGenPaySchedule）と同じ「協力会社優先」ルールの拡張で、
// 協力会社経由の支払時に同じ情報をドライバー全員へ二重入力しなくて済むようにする
function drvPay(d) {
  if (!d || !d.company_client_id) return d;
  const p = lkCli(d.company_client_id);
  if (!p) return d;
  return {
    ...d,
    bank: d.bank || p.bank || null,
    invoice_no: d.invoice_no || p.invoice_no || null,
    // 手数料率: ドライバー個別が0（未設定扱い）のときのみ協力会社の支払手数料率を使う。
    // 協力会社側は%単位（例:-5）、ドライバー側は割合（例:-0.05）のため換算する
    fee_rate: (!d.fee_rate && p.pay_out_fee_rate) ? p.pay_out_fee_rate / 100 : d.fee_rate,
  };
}
function computePayExecDateLabel(drv, basisDate) {
  const workMonth = (basisDate || fmtLocalDate(new Date())).slice(0,7);
  const partner = lkCli(drv?.company_client_id);
  const offset = partner ? (partner.pay_out_month_offset ?? 2) : (drv?.pay_month_offset ?? 2);
  const payDay = partner ? (partner.pay_out_day || 'end') : (drv?.pay_day || 'end');
  const due = computeDueDate(workMonth, offset, payDay);
  const [y,m,dd] = due.split('-');
  const dayLabel = (!payDay || payDay === 'end') ? '末日' : `${+dd}日`;
  return `${y}/${m}/${dayLabel}`;
}
// 複数ドライバー分をまとめる鑑ページ用：全ドライバーの支払実行日が一致すればその日付を、
// 支払日設定が異なるドライバーが混在していれば誤解を招く単一日付を出さず「各明細参照」とする
function computeGroupPayExecDateLabel(rowGroups) {
  const labels = [...new Set(rowGroups.map(rows => {
    const sorted = rows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    return computePayExecDateLabel(recDrv(sorted[0]), sorted[sorted.length-1]?.date);
  }))];
  return labels.length === 1 ? labels[0] : '各明細参照';
}

// 対象月の請求データと各ドライバーの支払日設定から、支払予定を自動同期する。
// 受注入力の登録・修正・削除のたびに自動実行され、ボタンを押さなくても常に最新の状態に保たれる。
// 消込済み（done=true）の予定は金額・日付を変更せず維持し、明細が無くなったドライバーの
// 未消込の予定だけ自動削除する（消したら自動で消える、が実現できるよう都度アップサートする）
// 同期の直列化ガード。同じ月の同期が実行中に再度呼ばれた場合は「あとで1回だけ再実行」の印を付けて
// すぐ戻る（連続登録などで同期が重なると、両方が「予定なし」と判定して二重に予定を作ってしまうため）
const _schedSyncState = { pay: {}, receipt: {} };
function _serializeSchedSync(kind, month, runFn) {
  const st = _schedSyncState[kind];
  if (st[month]) { st[month].rerun = true; return st[month].promise; }
  st[month] = { rerun: false };
  const loop = () => runFn().then(() => {
    if (st[month] && st[month].rerun) { st[month].rerun = false; return loop(); }
  });
  st[month].promise = loop().finally(() => { delete st[month]; });
  return st[month].promise;
}
function syncPaySchedule(month) {
  if (!month || !sb) return Promise.resolve();
  return _serializeSchedSync('pay', month, () => _doSyncPaySchedule(month));
}
async function _doSyncPaySchedule(month) {
  try {
    const byDrv = {};
    recs.filter(r => r.date && r.date.startsWith(month)).forEach(r => {
      const d = recDrv(r);
      if (!d) return;
      if (!byDrv[d.id]) byDrv[d.id] = { drv: d, rows: [] };
      byDrv[d.id].rows.push(r);
    });
    const { data: existing, error: exErr } = await sb.from('payment_schedules').select('id,drv_id,done,date,amt,note').eq('month', month).eq('source','auto');
    if (exErr) throw exErr;
    const existingByDrv = {};
    (existing||[]).forEach(e => { existingByDrv[e.drv_id] = e; });

    const currentDrvIds = new Set(Object.keys(byDrv).map(Number));
    const toDelete = (existing||[]).filter(e => !e.done && !currentDrvIds.has(e.drv_id)).map(e=>e.id);
    if (toDelete.length) {
      const { error: delErr } = await sb.from('payment_schedules').delete().in('id', toDelete);
      if (delErr) throw delErr;
    }

    const inserts = [];
    let changed = toDelete.length > 0;
    for (const drvIdStr of Object.keys(byDrv)) {
      const { drv, rows } = byDrv[drvIdStr];
      const existingEntry = existingByDrv[+drvIdStr];
      if (existingEntry && existingEntry.done) continue; // 消込済みの予定は上書きしない
      const data = buildStatementSheetData('payment', rows);
      // 協力会社に所属するドライバーは、その会社に登録した支払日を優先。
      // 未登録・自社所属の場合はドライバー個別の支払日設定にフォールバックする
      const partner = lkCli(drv.company_client_id);
      const offset = partner ? (partner.pay_out_month_offset ?? 2) : (drv.pay_month_offset ?? 2);
      const payDay = partner ? (partner.pay_out_day || 'end') : (drv.pay_day || 'end');
      const date = computeDueDate(month, offset, payDay);
      const note = partner?`自動生成（${partner.name}支払日）`:'自動生成';
      if (existingEntry) {
        // 変化がない予定は書き込みを省略（登録のたびに全ドライバー分を更新しない）
        if (existingEntry.date === date && existingEntry.amt === data.summary.grand && existingEntry.note === note) continue;
        const { error } = await sb.from('payment_schedules').update({ date, amt: data.summary.grand, note }).eq('id', existingEntry.id);
        if (error) throw error;
        changed = true;
      } else {
        inserts.push({ drv_id: drv.id, drv_name: drv.name, date, amt: data.summary.grand, month, note, done: false, source: 'auto' });
      }
    }
    if (inserts.length) {
      const { error } = await sb.from('payment_schedules').insert(inserts);
      if (error) throw error;
      changed = true;
    }
    if (changed) {
      await loadSched();
      if (!document.getElementById('pg9')?.classList.contains('hide')) renderSched();
    }
  } catch(e) { console.warn('支払予定自動同期エラー:', e.message); }
}
// 手動の「再同期」ボタン用（通常はsyncPaySchedule()が入力操作のたびに自動実行されるため不要だが、
// CSV一括取込など個別に同期を挟んでいない操作の後に手動で揃えたい場合に使う）
async function autoGenPaySchedule() {
  const workMonth = document.getElementById('schedGenMonth')?.value;
  if (!workMonth) { alert('対象月を選択してください'); return; }
  showLoad(true);
  await syncPaySchedule(workMonth);
  showLoad(false);
  showT('支払予定を同期しました');
}

async function loadSched() {
  if (!sb) return;
  try {
    schedData = await scheduleLoadAll('payment_schedules');
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) {
      const local = JSON.parse(localStorage.getItem('pg_sched_bak')||'[]');
      if (local.length) { schedData = local; showT('⚠ payment_schedulesテーブルが未作成です','twa'); }
      return;
    }
    console.warn('loadSched:', e.message);
  }
}

async function migrateSchedFromLocal(localData) {
  try {
    const rows = localData.map(s=>({drv_id:s.drvId||null,drv_name:s.drvName||'',date:s.date,amt:s.amt||0,month:s.month||'',note:s.note||'',done:s.done||false}));
    const {data,error} = await sb.from('payment_schedules').insert(rows).select();
    if (!error) { schedData=data||[]; localStorage.removeItem('pg_sched'); showT(`旧データ${rows.length}件をSupabaseに移行しました`); }
  } catch(e) {}
}

async function saveSched() {
  const drvId = document.getElementById('scDrv').value;
  const date = document.getElementById('scDate').value;
  const amt = parseInt(document.getElementById('scAmt').value)||0;
  if (!drvId||!date) { alert('ドライバーと日付は必須です'); return; }
  const drv = drvs.find(d=>d.id==drvId);
  showLoad(true);
  try {
    const row = {drv_id:+drvId,drv_name:drv?.name||'',date,amt,month:document.getElementById('scMonth').value,note:document.getElementById('scNote').value.trim(),done:false};
    const {data,error} = await sb.from('payment_schedules').insert(row).select().single();
    if (error) throw error;
    schedData.push(data);
    closeM('mSched');
    renderSched();
    addLog('支払予定追加',`${drv?.name} ${date} ${yen(amt)}`);
    showT('支払予定を追加しました');
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) showSchedSql();
    else showT('エラー: '+e.message,'ter');
  }
  showLoad(false);
}

async function markSchedDone(id) {
  const item = schedData.find(s=>s.id===id);
  if (!item) return;
  try {
    await scheduleSetDone('payment_schedules', id, true);
    item.done = true;
    renderSched();
    addLog('支払済マーク',(item.drv_name||item.drvName||'')+' '+item.date);
    showT('支払済にしました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

// 支払済ボタンを誤って押した場合の取消（未済に戻す）
async function unmarkSchedDone(id) {
  const item = schedData.find(s=>s.id===id);
  if (!item) return;
  try {
    await scheduleSetDone('payment_schedules', id, false);
    item.done = false;
    renderSched();
    addLog('支払済取消',(item.drv_name||item.drvName||'')+' '+item.date);
    showT('支払済を取り消しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

async function deleteSchedItem(id) {
  if (!confirm('削除しますか？')) return;
  try {
    await scheduleDelete('payment_schedules', id);
    schedData = schedData.filter(s=>s.id!==id);
    renderSched();
    addLog('支払予定削除','id:'+id);
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

/* ===== payment_schedules / receipt_schedules 共通CRUDヘルパー =====
   入金側はdone切替時にpayment_inへの自動反映という追加の副作用を持つため、
   このヘルパーはDB更新の共通部分だけを担い、副作用は呼び出し側にそのまま残す */
async function scheduleSetDone(table, ids, done) {
  const { error } = await sb.from(table).update({done}).in('id', Array.isArray(ids)?ids:[ids]);
  if (error) throw error;
}
async function scheduleDelete(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
}
async function scheduleLoadAll(table) {
  const { data, error } = await sb.from(table).select('*').order('date');
  if (error) throw error;
  return data || [];
}

/* ===== 入金スケジュール（支払スケジュールと同構造・取引先向け） ===== */
function openReceiptSchedM() {
  const sel = document.getElementById('rscCli');
  sel.innerHTML = '<option value="">選択</option>' + clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  enhanceSelectSearchable('rscCli');
  const now = new Date();
  document.getElementById('rscDate').value = '';
  document.getElementById('rscAmt').value = '';
  document.getElementById('rscNote').value = '';
  document.getElementById('rscMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('mReceiptSched').classList.add('on');
}

async function loadReceiptSched() {
  if (!sb) return;
  try {
    receiptSchedData = await scheduleLoadAll('receipt_schedules');
  } catch(e) { console.warn('loadReceiptSched:', e.message); }
}

let receiptSchedSelIds = new Set();
function renderReceiptSched() {
  const list = document.getElementById('receiptSchedList');
  if (!list) return;
  renderScheduleSummary(receiptSchedData, 'receiptSchedSummary', '入金', s => s.cli_name || '');
  receiptSchedSelIds = new Set([...receiptSchedSelIds].filter(id=>receiptSchedData.some(s=>s.id===id)));
  updateReceiptSchedBulkBar();
  if (!receiptSchedData.length) {
    list.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">入金予定がありません</div>`;
    return;
  }
  renderScheduleGrouped(receiptSchedData, 'receiptSchedList', {
    getName: s => s.cli_name || '',
    doneLabel: '入金済',
    markDoneFn: 'markReceiptSchedDone',
    unmarkDoneFn: 'unmarkReceiptSchedDone',
    deleteFn: 'deleteReceiptSchedItem',
    selSet: receiptSchedSelIds,
    toggleSelFn: 'toggleReceiptSchedSel',
    toggleGroupFn: 'toggleReceiptSchedDateGroup',
  });
}
function toggleReceiptSchedSel(id,v){ if(v)receiptSchedSelIds.add(id); else receiptSchedSelIds.delete(id); updateReceiptSchedBulkBar(); }
function toggleReceiptSchedDateGroup(date,v){
  receiptSchedData.filter(s=>s.date===date).forEach(s=>v?receiptSchedSelIds.add(s.id):receiptSchedSelIds.delete(s.id));
  document.querySelectorAll(`#receiptSchedList .sched-date-group[data-date="${date}"] input[data-schedid]`).forEach(cb=>cb.checked=v);
  updateReceiptSchedBulkBar();
}
function toggleReceiptSchedSelAll(v){ receiptSchedSelIds = v ? new Set(receiptSchedData.map(s=>s.id)) : new Set(); renderReceiptSched(); }
function updateReceiptSchedBulkBar(){
  const el=document.getElementById('receiptSchedBulkCount');
  if(el)el.textContent=receiptSchedSelIds.size?`${receiptSchedSelIds.size}件選択中`:'';
}
async function bulkMarkReceiptSchedDone(){
  const ids=[...receiptSchedSelIds].filter(id=>{const it=receiptSchedData.find(s=>s.id===id);return it&&!it.done;});
  if(!ids.length){showT('未済の予定を選択してください','twa');return;}
  if(!confirm(`${ids.length}件を入金済にしますか？`))return;
  showLoad(true);
  try{
    await scheduleSetDone('receipt_schedules', ids, true);
    const items=ids.map(id=>receiptSchedData.find(s=>s.id===id)).filter(Boolean);
    items.forEach(it=>it.done=true);
    try{
      const inserts=items.map(item=>({
        date:item.date,amt:item.amt,cli_id:item.cli_id||null,
        target_month:item.month,type:'transfer',
        note:`${RECEIPT_SCHED_AUTO_TAG}${item.cli_name||''}`,
      }));
      const{data,error:piErr}=await sb.from('payment_in').insert(inserts).select();
      if(!piErr&&data){paymentIns=[...data,...paymentIns];if(typeof renderPaymentIn==='function')renderPaymentIn();}
      else if(piErr){console.warn('入金管理への自動反映エラー:',piErr.message);showT('入金済にしましたが、入金管理への自動記録に失敗しました: '+piErr.message,'twa');}
    }catch(e2){console.warn('入金管理への自動反映エラー:',e2.message);}
    receiptSchedSelIds.clear();renderReceiptSched();
    addLog('入金済一括マーク',`${ids.length}件`);showT(`${ids.length}件を入金済にしました（入金管理にも記録しました）`);
  }catch(e){showT('エラー: '+e.message,'ter');}
  showLoad(false);
}
async function bulkUnmarkReceiptSchedDone(){
  const ids=[...receiptSchedSelIds].filter(id=>{const it=receiptSchedData.find(s=>s.id===id);return it&&it.done;});
  if(!ids.length){showT('入金済の予定を選択してください','twa');return;}
  if(!confirm(`${ids.length}件の入金済を取り消しますか？`))return;
  showLoad(true);
  try{
    await scheduleSetDone('receipt_schedules', ids, false);
    const items=ids.map(id=>receiptSchedData.find(s=>s.id===id)).filter(Boolean);
    items.forEach(it=>it.done=false);
    try{
      for(const item of items){
        const autoNote=`${RECEIPT_SCHED_AUTO_TAG}${item.cli_name||''}`;
        const{data:matches}=await sb.from('payment_in').select('id').eq('date',item.date).eq('amt',item.amt).eq('note',autoNote);
        if(matches&&matches.length){
          await sb.from('payment_in').delete().in('id',matches.map(m=>m.id));
          paymentIns=paymentIns.filter(p=>!matches.some(m=>m.id===p.id));
        }
      }
      if(typeof renderPaymentIn==='function')renderPaymentIn();
    }catch(e2){console.warn('入金記録の取消エラー:',e2.message);}
    receiptSchedSelIds.clear();renderReceiptSched();
    addLog('入金済一括取消',`${ids.length}件`);showT(`${ids.length}件の入金済を取り消しました`);
  }catch(e){showT('エラー: '+e.message,'ter');}
  showLoad(false);
}

async function saveReceiptSched() {
  const cliId = document.getElementById('rscCli').value;
  const date = document.getElementById('rscDate').value;
  const amt = parseInt(document.getElementById('rscAmt').value)||0;
  if (!cliId||!date) { alert('取引先と日付は必須です'); return; }
  const cli = clients.find(c=>c.id==cliId);
  showLoad(true);
  try {
    const row = {cli_id:+cliId,cli_name:cli?.name||'',date,amt,month:document.getElementById('rscMonth').value,note:document.getElementById('rscNote').value.trim(),done:false};
    const {data,error} = await sb.from('receipt_schedules').insert(row).select().single();
    if (error) throw error;
    receiptSchedData.push(data);
    closeM('mReceiptSched');
    renderReceiptSched();
    addLog('入金予定追加',`${cli?.name} ${date} ${yen(amt)}`);
    showT('入金予定を追加しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

// 自動記録した入金管理データと入金スケジュールを対応付けるための目印（noteに埋め込む）
const RECEIPT_SCHED_AUTO_TAG = '【入金スケジュール自動記録】';
async function markReceiptSchedDone(id) {
  const item = receiptSchedData.find(s=>s.id===id);
  if (!item) return;
  try {
    await scheduleSetDone('receipt_schedules', id, true);
    item.done = true;
    // 入金管理（実績台帳）にも自動反映し、二重に手入力しなくて済むようにする
    try {
      const {data,error:piErr} = await sb.from('payment_in').insert({
        date: item.date, amt: item.amt, cli_id: item.cli_id||null,
        target_month: item.month, type: 'transfer',
        note: `${RECEIPT_SCHED_AUTO_TAG}${item.cli_name||''}`,
      }).select().single();
      if (!piErr && data) { paymentIns.unshift(data); if (typeof renderPaymentIn==='function') renderPaymentIn(); }
      else if (piErr) { console.warn('入金管理への自動反映エラー:', piErr.message); showT('入金済にしましたが、入金管理への自動記録に失敗しました: '+piErr.message, 'twa'); }
    } catch(e2) { console.warn('入金管理への自動反映エラー:', e2.message); showT('入金済にしましたが、入金管理への自動記録に失敗しました: '+e2.message, 'twa'); }
    renderReceiptSched();
    addLog('入金済マーク',(item.cli_name||'')+' '+item.date);
    showT('入金済にしました（入金管理にも記録しました）');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

// 入金済ボタンを誤って押した場合の取消（未済に戻す）
async function unmarkReceiptSchedDone(id) {
  const item = receiptSchedData.find(s=>s.id===id);
  if (!item) return;
  try {
    await scheduleSetDone('receipt_schedules', id, false);
    item.done = false;
    // 済みにした際に自動作成した入金記録があれば一緒に取り消す（手動追加分は残す）
    try {
      const autoNote = `${RECEIPT_SCHED_AUTO_TAG}${item.cli_name||''}`;
      const {data: matches} = await sb.from('payment_in').select('id').eq('date', item.date).eq('amt', item.amt).eq('note', autoNote);
      if (matches && matches.length) {
        await sb.from('payment_in').delete().in('id', matches.map(m=>m.id));
        paymentIns = paymentIns.filter(p => !matches.some(m=>m.id===p.id));
        if (typeof renderPaymentIn==='function') renderPaymentIn();
      }
    } catch(e2) { console.warn('入金記録の取消エラー:', e2.message); }
    renderReceiptSched();
    addLog('入金済取消',(item.cli_name||'')+' '+item.date);
    showT('入金済を取り消しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

async function deleteReceiptSchedItem(id) {
  if (!confirm('削除しますか？')) return;
  try {
    await scheduleDelete('receipt_schedules', id);
    receiptSchedData = receiptSchedData.filter(s=>s.id!==id);
    renderReceiptSched();
    addLog('入金予定削除','id:'+id);
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

// 対象月の請求データと各取引先の入金日設定から、入金予定を自動生成（再実行時は自動生成分のみ入れ替え）
// 対象月の請求データと各取引先の入金日設定から、入金予定を自動同期する。
// 受注入力の登録・修正・削除のたびに自動実行され、ボタンを押さなくても常に最新の状態に保たれる。
// 消込済み（done=true）の予定は金額・日付を変更せず維持し、明細が無くなった取引先の
// 未消込の予定だけ自動削除する
function syncReceiptSchedule(month) {
  if (!month || !sb) return Promise.resolve();
  return _serializeSchedSync('receipt', month, () => _doSyncReceiptSchedule(month));
}
async function _doSyncReceiptSchedule(month) {
  try {
    const byCli = {};
    recs.filter(r => r.date && r.date.startsWith(month) && r.cli).forEach(r => {
      const c = lkC(r.cli);
      if (!c) return;
      if (!byCli[c.id]) byCli[c.id] = { cli: c, rows: [] };
      byCli[c.id].rows.push(r);
    });
    const { data: existing, error: exErr } = await sb.from('receipt_schedules').select('id,cli_id,done,date,amt,note').eq('month', month).eq('source','auto');
    if (exErr) throw exErr;
    const existingByCli = {};
    (existing||[]).forEach(e => { existingByCli[e.cli_id] = e; });

    const currentCliIds = new Set(Object.keys(byCli).map(Number));
    const toDelete = (existing||[]).filter(e => !e.done && !currentCliIds.has(e.cli_id)).map(e=>e.id);
    if (toDelete.length) {
      const { error: delErr } = await sb.from('receipt_schedules').delete().in('id', toDelete);
      if (delErr) throw delErr;
    }

    const inserts = [];
    let changed = toDelete.length > 0;
    for (const cliIdStr of Object.keys(byCli)) {
      const { cli, rows } = byCli[cliIdStr];
      const existingEntry = existingByCli[+cliIdStr];
      if (existingEntry && existingEntry.done) continue; // 消込済みの予定は上書きしない
      const data = buildStatementSheetData('billing', rows);
      const offset = cli.pay_month_offset ?? 1;
      const payDay = cli.pay_day || 'end';
      const date = computeDueDate(month, offset, payDay);
      if (existingEntry) {
        // 変化がない予定は書き込みを省略（登録のたびに全取引先分を更新しない）
        if (existingEntry.date === date && existingEntry.amt === data.summary.grand) continue;
        const { error } = await sb.from('receipt_schedules').update({ date, amt: data.summary.grand, note: '自動生成' }).eq('id', existingEntry.id);
        if (error) throw error;
        changed = true;
      } else {
        inserts.push({ cli_id: cli.id, cli_name: cli.name, date, amt: data.summary.grand, month, note: '自動生成', done: false, source: 'auto' });
      }
    }
    if (inserts.length) {
      const { error } = await sb.from('receipt_schedules').insert(inserts);
      if (error) throw error;
      changed = true;
    }
    if (changed) {
      await loadReceiptSched();
      if (!document.getElementById('pg22')?.classList.contains('hide')) renderReceiptSched();
    }
  } catch(e) { console.warn('入金予定自動同期エラー:', e.message); }
}
// 手動の「再同期」ボタン用（通常はsyncReceiptSchedule()が入力操作のたびに自動実行されるため不要だが、
// CSV一括取込など個別に同期を挟んでいない操作の後に手動で揃えたい場合に使う）
async function autoGenReceiptSchedule() {
  const workMonth = document.getElementById('receiptGenMonth')?.value;
  if (!workMonth) { alert('対象月を選択してください'); return; }
  showLoad(true);
  await syncReceiptSchedule(workMonth);
  showLoad(false);
  showT('入金予定を同期しました');
}
