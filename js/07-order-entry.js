/* js/07-order-entry.js
   受注入力のサブタブ、手入力テンプレート、追加料金、取引先の複数選択、ファイル取込の列マッピング

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   v11: pg0強化 — サブタブ・手入力テンプレート・ファイル取込マッピング
   ============================================================ */

/* ===== 受注入力ページ（pg18）: 請求明細書ページの一覧／入力フォームDOMをそのまま移動して表示 =====
   1件の受注データ（recs）に請求運賃・支払運賃の両方を入力する統合フォームのため、
   支払明細書側には専用の入力フォームを設けず、この1本に集約しています。 */
// 明細一覧（p0area0）は廃止（PDF読込は「ファイル取込」タブへ移設、複製/削除はpg20明細画面に集約）。
// 入力フォーム（p0area1）のみを受注入力タブへ移動する。
(function relocateEntryForms(){
  const slot0 = document.getElementById('entrySlot0');
  const p0a1 = document.getElementById('p0area1');
  if (slot0 && p0a1) { slot0.appendChild(p0a1); }
})();

function switchEntryTab() {
  const p0area1 = document.getElementById('p0area1'); if (p0area1) p0area1.style.display = 'block';
  initQ0Form();
  // サブタブ（手入力/入力一覧）は前回の状態を維持。初回のみ「手入力」を表示
  const t1 = document.getElementById('p18t1'), t2 = document.getElementById('p18t2');
  if (!t1?.classList.contains('on') && !t2?.classList.contains('on')) switchEntryMainTab(1);
  else if (t2?.classList.contains('on')) initEntryListTab();
}

// 受注入力タブのサブタブ切替（1=手入力、2=入力一覧）
function switchEntryMainTab(n) {
  const a1 = document.getElementById('p18area1'), a2 = document.getElementById('p18area2');
  if (a1) a1.style.display = n===1 ? '' : 'none';
  if (a2) a2.style.display = n===2 ? '' : 'none';
  document.getElementById('p18t1')?.classList.toggle('on', n===1);
  document.getElementById('p18t2')?.classList.toggle('on', n===2);
  if (n===1) initQ0Form();
  if (n===2) { initEntryListTab(); if (document.body.classList.contains('entry-fullscreen')) toggleEntryFullscreen(); }
}

// 受注入力（手入力）の全画面表示切替：ヘッダー・ナビを隠して入力欄を広く使う（可能ならブラウザ自体の全画面表示も使用）
function toggleEntryFullscreen() {
  const on = !document.body.classList.contains('entry-fullscreen');
  document.body.classList.toggle('entry-fullscreen', on);
  const btn = document.getElementById('q0FullscreenBtn');
  if (btn) btn.textContent = on ? '⛶ 全画面を解除' : '⛶ 全画面表示';
  if (on && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(()=>{});
  } else if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(()=>{});
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('entry-fullscreen')) {
    document.body.classList.remove('entry-fullscreen');
    const btn = document.getElementById('q0FullscreenBtn');
    if (btn) btn.textContent = '⛶ 全画面表示';
  }
});

// 入力一覧サブタブの初期化（旧pg21の明細一覧＋外部データ取込）
function initEntryListTab() {
  renderPay();
  initF0Form();
  updatePayImportPreview();
}

// データ取込パネル内の各セクション（Excel/CSV）の開閉
function toggleImportSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const shownDisplay = el.dataset.shownDisplay || 'block';
  el.style.display = (el.style.display === 'none') ? shownDisplay : 'none';
}

// 請求明細書作成／支払明細書作成ページの「受注入力」ボタンから、受注入力タブ（pg18）へジャンプ
function jumpToEntryTab() {
  goPage(18, document.getElementById('ntEntry'));
}

/* ===== サブタブ切替 ===== */
// 受注入力（一覧・入力フォーム）は pg18 に移動したため、ここでは集計（取引先別）のみを扱う
function switchP0Tab(n) {
  const p0area2 = document.getElementById('p0area2');
  if (p0area2) p0area2.style.display = 'block';
  initAggInv();
}

/* ===== 手入力フォーム ===== */
let q0Templates = []; // Supabaseから読み込む

function initQ0Form() {
  // 日付デフォルト（配送日を基準に、引取日・支払日も同じ日をデフォルトにする）
  // システム全体の集計期間と同じく前月を既定値とする（前月分の受注をまとめて入力する運用のため）
  const dEl = document.getElementById('q0D');
  if (dEl && !dEl.value) { const now = new Date(); dEl.value = fmtLocalDate(new Date(now.getFullYear(), now.getMonth()-1, 1)); }
  const pickEl = document.getElementById('q0PickD');
  if (pickEl && !pickEl.value) pickEl.value = dEl.value;
  const payDateEl = document.getElementById('q0InvPayDate');
  if (payDateEl && !payDateEl.value) payDateEl.value = dEl.value;
  const qtyEl = document.getElementById('q0Qty');
  if (qtyEl && qtyEl.value === '') qtyEl.value = 1;

  // 取引先（手入力検索用の候補リスト）
  document.getElementById('q0CliList').innerHTML =
    clients.map(c=>`<option value="${escHtml(c.name)}">`).join('');

  // 車番・名前（フル表記「車番（ドライバー名）」の候補のみ表示。数字のみの略式車番は候補から除外）
  const allCars = drvs.flatMap(d=>(d.cars||[]).map(c=>({car:c,name:d.name})))
    .filter(x=>x.car && x.name && !/^\d+$/.test(x.car));
  document.getElementById('q0CarList').innerHTML =
    allCars.map(x=>`<option value="${x.car}（${x.name}）">`).join('');

  // 乗務ドライバー（同一車両を複数人で稼働する場合の手動選択用）
  populateQ0DrvSel();
  updateQ0DrvHint();

  // テンプレートプルダウン
  renderTemplateSelect();
  renderQ0History();
  renderQ0FeeList();
  calcQ0Total();
}

function renderTemplateSelect() {
  const sel = document.getElementById('p0tmpl');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">選択して自動入力…</option>' +
    q0Templates.map((t,i)=>`<option value="${i}">${t.name}</option>`).join('');
  if (cur) sel.value = cur;
}

function applyTemplate() {
  const idx = +document.getElementById('p0tmpl').value;
  if (isNaN(idx) || idx < 0 || idx >= q0Templates.length) return;
  const t = q0Templates[idx];
  if (t.cli) setQ0CliById(t.cli);
  if (t.car) setQ0CarByCode(t.car);
  if (t.type) document.getElementById('q0Type').value = t.type;
  if (t.fare != null) document.getElementById('q0Fare').value = t.fare;
  if (t.tax_class) document.getElementById('q0TaxClass').value = t.tax_class;
  if (t.note) document.getElementById('q0Note').value = t.note;
  calcQ0Total();
  showLastHint(t.cli, t.car);
}

async function saveAsTemplate() {
  const name = prompt('テンプレート名を入力してください（例: ヤマト定期_田中）:');
  if (!name) return;
  const t = {
    name,
    cli: document.getElementById('q0Cli').value || null,
    car: document.getElementById('q0Car').value || '',
    type: document.getElementById('q0Type').value || 'regular',
    fare: +document.getElementById('q0Fare').value||0,
    tax_class: document.getElementById('q0TaxClass').value||'excl',
    note: document.getElementById('q0Note').value.trim(),
    created_by: me?.name||'',
  };
  showLoad(true);
  try {
    let {data, error} = await sb.from('input_templates').insert(t).select().single();
    let msg = `テンプレート「${name}」を保存しました`, msgCls;
    // tax_classカラムが未作成の場合はそれを除いて再試行
    if (error && error.message && error.message.includes('does not exist') && error.message.includes('tax_class')) {
      const {tax_class, ...tFallback} = t;
      ({data, error} = await sb.from('input_templates').insert(tFallback).select().single());
      msg = `テンプレート「${name}」を保存しました（税区分は未保存: input_templatesにtax_classカラムの追加が必要です）`;
      msgCls = 'twa';
    }
    if (error) throw error;
    q0Templates.push(data);
    renderTemplateSelect();
    addLog('テンプレート保存', name);
    showT(msg, msgCls);
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) {
      showTemplateSql();
    } else { showT('エラー: '+e.message,'ter'); }
  }
  showLoad(false);
}

async function deleteTemplate() {
  const sel = document.getElementById('p0tmpl');
  const idx = +sel.value;
  if (isNaN(idx)||idx<0||idx>=q0Templates.length) { alert('削除するテンプレートを選択してください'); return; }
  const t = q0Templates[idx];
  if (!confirm(`「${t.name}」を削除しますか？`)) return;
  showLoad(true);
  try {
    const {error} = await sb.from('input_templates').delete().eq('id', t.id);
    if (error) throw error;
    q0Templates.splice(idx, 1);
    renderTemplateSelect();
    addLog('テンプレート削除', t.name);
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

function onQ0CliChange() {
  const cliId = document.getElementById('q0Cli').value;
  const car = document.getElementById('q0Car').value;
  showLastHint(cliId, car);
  if (cliId) showPriceSuggestions(cliId);
}

function onQ0CarChange() {
  const car = document.getElementById('q0Car').value;
  const cliId = document.getElementById('q0Cli').value;
  showLastHint(cliId, car);
  updateQ0DrvHint();
  calcQ0Total();
}

// 乗務ドライバー手動選択欄（手入力検索用）の候補リストを最新のdrvsから再構築
// ドライバー数が多く同姓同名もあり得るため、仕入先IDを付記して候補を一意に判別できるようにする
function q0DrvOverrideLabel(d) {
  return `${d.name}${d.supplier_id ? `（ID:${d.supplier_id}）` : ''}`;
}
function populateQ0DrvSel() {
  const dl = document.getElementById('q0DrvOverrideList');
  if (!dl) return;
  dl.innerHTML = activeDrvs().map(d=>`<option value="${escHtml(q0DrvOverrideLabel(d))}">`).join('');
}
// 乗務ドライバーの手入力検索欄: 候補と完全一致すればhidden項目(id)へ反映、一致しなければ自動判定に戻す
function onQ0DrvOverrideTextInput() {
  const val = document.getElementById('q0DrvOverrideText').value.trim();
  const match = drvs.find(d => q0DrvOverrideLabel(d) === val) || drvs.find(d => d.name === val);
  document.getElementById('q0DrvOverride').value = match ? match.id : '';
  updateQ0DrvHint();
}
// テンプレート適用・編集読み込み時に、id指定で乗務ドライバー欄の表示を合わせる
function setQ0DrvOverrideById(id) {
  const d = id ? drvs.find(x => String(x.id) === String(id)) : null;
  document.getElementById('q0DrvOverride').value = d ? d.id : '';
  document.getElementById('q0DrvOverrideText').value = d ? q0DrvOverrideLabel(d) : '';
}
// 同じ車両を複数人で稼働することがあるため、q0DrvOverrideで手動選択されていればそれを優先表示する
function updateQ0DrvHint() {
  const hint = document.getElementById('q0DrvHint');
  if (!hint) return;
  const sel = document.getElementById('q0DrvOverride');
  if (sel && sel.value) {
    const d = drvs.find(x => x.id === +sel.value);
    hint.textContent = d ? '✓ 手動選択中: ' + d.name : '—';
    hint.style.color = 'var(--blue)';
    return;
  }
  const car = document.getElementById('q0Car').value;
  const d = lkD(car);
  if (d) { hint.textContent = '自動判定: ' + d.name; hint.style.color = 'var(--text2)'; }
  else if (car) { hint.innerHTML = '<span style="color:var(--red)">⚠ 未配車（手動選択も可能です）</span>'; }
  else { hint.textContent = '—'; hint.style.color = 'var(--text2)'; }
}

// 取引先: 手入力された名称を候補と照合し、一致すればIDをhidden項目へ反映
function onQ0CliTextInput() {
  const val = document.getElementById('q0CliText').value.trim();
  const match = clients.find(c => c.name === val);
  document.getElementById('q0Cli').value = match ? match.id : '';
  onQ0CliChange();
}

// 車番・名前: 「車番（ドライバー名）」のフル表記、または車番のみの一致でhidden項目へ反映。
// 未登録の代車などは候補に一致しなくても入力したテキストをそのまま車番として使用する
function onQ0CarTextInput() {
  const val = document.getElementById('q0CarText').value.trim();
  const allCars = drvs.flatMap(d=>(d.cars||[]).map(c=>({car:c,name:d.name})))
    .filter(x=>x.car && x.name);
  const match = allCars.find(x => `${x.car}（${x.name}）` === val) || allCars.find(x => x.car === val);
  document.getElementById('q0Car').value = match ? match.car : val;
  onQ0CarChange();
}

// 取引先ID/車番からテキスト入力欄の表示を合わせる（テンプレート適用時など）
function setQ0CliById(id) {
  const c = clients.find(c => String(c.id) === String(id));
  document.getElementById('q0Cli').value = c ? c.id : '';
  document.getElementById('q0CliText').value = c ? c.name : '';
}
function setQ0CarByCode(car) {
  const d = drvs.find(d => (d.cars||[]).includes(car));
  document.getElementById('q0Car').value = car || '';
  document.getElementById('q0CarText').value = (car && d) ? `${car}（${d.name}）` : (car || '');
}

// 配送日を変更したら引取日も同じ日に揃える（デフォルト同期。引取日は個別に上書き可能）
function syncQ0Dates() {
  const d = document.getElementById('q0D').value;
  document.getElementById('q0PickD').value = d;
}

// 距離(km)・時間(h)の入力欄を「150km/3h」のような1本の文字列(q0DistTime)にまとめる
function syncQ0DistTime() {
  const dist = document.getElementById('q0Dist').value;
  const time = document.getElementById('q0Time').value;
  const parts = [];
  if (dist) parts.push(`${dist}km`);
  if (time) parts.push(`${time}h`);
  document.getElementById('q0DistTime').value = parts.join('/');
}
// 保存済みの距離・時間文字列を、編集時に距離(km)・時間(h)の入力欄へ戻す
function parseQ0DistTime(str) {
  str = str || '';
  const distMatch = str.match(/([\d.]+)\s*km/i);
  const timeMatch = str.match(/([\d.]+)\s*h/i);
  return { dist: distMatch ? distMatch[1] : '', time: timeMatch ? timeMatch[1] : '' };
}

// 単価設定を「チャーター便」に切り替えたら数量を1に揃える（チャーター便は数量=1が基本）
function onQ0FareMethodChange() {
  document.getElementById('q0PayMethod').value = document.getElementById('q0FareMethod').value;
  const isCharter = document.getElementById('q0FareMethod').value === 'charter';
  const qtyEl = document.getElementById('q0Qty');
  if (isCharter && qtyEl) qtyEl.value = 1;
  calcQ0Total();
}

// 「取引先と同じ」系コピー: 入力中の取引先名を対象フィールドへ
function copyQ0CliTo(targetId) {
  const cliName = document.getElementById('q0CliText').value.trim();
  const el = document.getElementById(targetId);
  if (el && cliName) el.value = cliName;
}

/* ===== 追加料金（複数行） ===== */
let q0ExtraFees = [];
let q0EditId = null; // nullなら新規登録、レコードidが入っていれば編集モード（明細フル画面の「修正」から遷移）
let _q0EditReturnToDetail = false; // 更新後に明細フル画面(pg20)へ戻るか

// 明細フル画面の「修正」ボタン: 既存レコードの値を受注入力フォームへ反映して編集モードに入る
function openEditInvoice(id) {
  const r = recs.find(x => x.id === id);
  if (!r) return;
  goPage(18);
  initQ0Form();
  q0EditId = id;
  _q0EditReturnToDetail = true;
  setQ0CliById(r.cli);
  setQ0CarByCode(r.car);
  populateQ0DrvSel();
  setQ0DrvOverrideById(r.drv_id);
  updateQ0DrvHint();
  document.getElementById('q0Type').value = r.type || 'regular';
  document.getElementById('q0D').value = r.date || '';
  document.getElementById('q0PickD').value = r.pickup_date || r.date || '';
  document.getElementById('q0PickT').value = r.pickup_time || '';
  document.getElementById('q0PickDone').checked = !!r.pickup_done;
  document.getElementById('q0PickLoc').value = r.pickup_location || '';
  document.getElementById('q0DeliT').value = r.delivery_time || '';
  document.getElementById('q0DeliDone').checked = !!r.delivery_done;
  document.getElementById('q0DeliLoc').value = r.delivery_location || '';
  document.getElementById('q0TaskName').value = r.task_name || '';
  const qty = r.qty != null ? r.qty : 1;
  document.getElementById('q0Qty').value = qty;
  document.getElementById('q0DistTime').value = r.distance_time || '';
  const dt = parseQ0DistTime(r.distance_time);
  document.getElementById('q0Dist').value = dt.dist;
  document.getElementById('q0Time').value = dt.time;
  document.getElementById('q0FareMethod').value = r.fare_calc_method || 'qty';
  document.getElementById('q0PayMethod').value = r.pay_calc_method || 'qty';
  const taxClass = r.fare_tax_class || (r.tax === 0 ? 'none' : 'excl');
  const payTaxClass = r.pay_tax_class || taxClass;
  document.getElementById('q0TaxClass').value = taxClass;
  document.getElementById('q0PayTaxClass').value = payTaxClass;
  document.getElementById('q0Fare').value = reconstructQ0UnitPrice(r.fare, r.oth, qty, taxClass);
  document.getElementById('q0PayFare').value = reconstructQ0UnitPrice(r.pay_fare, r.pay_oth, qty, payTaxClass);
  document.getElementById('q0Note').value = r.note || '';
  document.getElementById('q0InvPayDate').value = r.invoice_payment_date || '';
  q0ExtraFees = (r.extra_fees || []).slice();
  renderQ0FeeList();
  calcQ0Total();
  const banner = document.getElementById('q0EditBanner');
  banner.style.display = 'flex';
  document.getElementById('q0EditBannerText').textContent = `✏ 編集中: ${r.date} ${r.car} のレコードを修正しています（更新すると明細画面に戻ります）`;
  document.getElementById('q0SubmitBtn').textContent = '✔ 更新する';
  document.getElementById('q0ContRow').style.display = 'none';
  document.getElementById('q0ContBtn').style.display = 'none';
  document.getElementById('p0area1').scrollIntoView({behavior:'smooth'});
}

// 保存済みの税抜運賃（fare/oth）と数量・税区分から、フォームに戻すための単価を逆算する
function reconstructQ0UnitPrice(fareVal, othVal, qty, taxClass) {
  qty = qty || 1;
  let amt;
  if (taxClass === 'advance') amt = othVal || 0;
  else if (taxClass === 'incl') amt = Math.round((fareVal||0) * 1.10);
  else amt = fareVal || 0;
  return Math.round(amt / qty);
}

function cancelQ0Edit(skipFormReset) {
  q0EditId = null;
  _q0EditReturnToDetail = false;
  const banner = document.getElementById('q0EditBanner');
  if (banner) banner.style.display = 'none';
  document.getElementById('q0SubmitBtn').textContent = '✔ 登録する';
  document.getElementById('q0ContRow').style.display = '';
  document.getElementById('q0ContBtn').style.display = '';
  if (!skipFormReset) {
    ['q0Fare','q0PayFare','q0Note','q0PickT','q0PickLoc','q0DeliT','q0DeliLoc','q0TaskName',
     'q0DistTime','q0Dist','q0Time'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    ['q0PickDone','q0DeliDone'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
    document.getElementById('q0Qty').value = 1;
    q0ExtraFees = [];
    renderQ0FeeList();
    calcQ0Total();
  }
}

// 明細フル画面の「削除」ボタン
async function deleteInvoiceRecord(id) {
  const r = recs.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`${r.date} ${r.car} のレコードを削除しますか？この操作は取り消せません。`)) return;
  showLoad(true);
  try {
    const { error } = await sb.from('invoices').delete().eq('id', id);
    if (error) throw error;
    const recIdx = recs.findIndex(x => x.id === id);
    if (recIdx >= 0) recs.splice(recIdx, 1);
    const detIdx = _aggDetailRows.findIndex(x => x.id === id);
    if (detIdx >= 0) _aggDetailRows.splice(detIdx, 1);
    _aggDetailSelected.delete(id);
    // 支払・入金スケジュールを自動同期（明細が無くなったドライバー・取引先の未消込の予定は自動的に消える）
    if (r.date) { syncPaySchedule(r.date.slice(0,7)); syncReceiptSchedule(r.date.slice(0,7)); }
    addLog('受注入力削除', `${r.car} ${r.date}`);
    showT('削除しました');
    renderAggDetailFull();
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}

// 明細フル画面の「コピー」ボタン: 同内容の新規レコードを作成
async function copyInvoiceRecord(id) {
  const r = recs.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`${r.date} ${r.car} のレコードをコピーして新規登録しますか？`)) return;
  showLoad(true);
  try {
    const { id: _omit, created_at: _omit2, ...clone } = r;
    let { data, error } = await sb.from('invoices').insert(clone).select().single();
    if (error && error.message && (error.message.includes('does not exist') || error.message.includes('column'))) {
      const { extra_fees, task_name, pickup_date, pickup_time, pickup_done, pickup_location,
        delivery_time, delivery_done, delivery_location, qty, distance_time, pay_count_note,
        receiver, fare_calc_method, pay_calc_method, fare_tax_class, pay_tax_class, driver_note,
        sales_date, invoice_payment_date, ...coreOnly } = clone;
      ({data, error} = await sb.from('invoices').insert(coreOnly).select().single());
    }
    if (error) throw error;
    const merged = { ...clone, ...data };
    recs.unshift(merged);
    _aggDetailRows.unshift(merged);
    addLog('受注入力コピー', `${r.car} ${r.date}`);
    showT('コピーしました');
    renderAggDetailFull();
  } catch(e) { showT('コピーエラー: '+e.message, 'ter'); }
  showLoad(false);
}

// 明細フル画面の「選択複製」「選択削除」: レ点チェックした複数明細をまとめて複製・削除する
// （廃止した受注入力タブの明細一覧にあった複製/削除の一括操作を、pg20明細画面に集約したもの）
async function bulkDupAggDetail() {
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  if (!rows.length) { alert('複製する明細を選択してください（レ点でチェック）'); return; }
  if (!confirm(`${rows.length}件を複製しますか？`)) return;
  showLoad(true);
  try {
    const inserts = rows.map(r => { const { id, created_at, ...clone } = r; return clone; });
    const { data, error } = await sb.from('invoices').insert(inserts).select();
    if (error) throw error;
    recs = [...data, ...recs];
    _aggDetailRows = [...data, ..._aggDetailRows];
    addLog('明細一括複製', `${data.length}件`);
    showT(`${data.length}件を複製しました`);
    renderAggDetailFull();
  } catch(e) { showT('複製エラー: ' + e.message, 'ter'); }
  showLoad(false);
}

async function bulkDelAggDetail() {
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  if (!rows.length) { alert('削除する明細を選択してください（レ点でチェック）'); return; }
  if (!confirm(`${rows.length}件を削除しますか？この操作は取り消せません。`)) return;
  showLoad(true);
  try {
    const ids = rows.map(r=>r.id);
    const { error } = await sb.from('invoices').delete().in('id', ids);
    if (error) throw error;
    recs = recs.filter(r=>!ids.includes(r.id));
    _aggDetailRows = _aggDetailRows.filter(r=>!ids.includes(r.id));
    ids.forEach(id=>_aggDetailSelected.delete(id));
    addLog('明細一括削除', `${ids.length}件`);
    showT('削除しました');
    renderAggDetailFull();
  } catch(e) { showT('削除エラー: ' + e.message, 'ter'); }
  showLoad(false);
}

// 「高速代」ボタン: 名称・税区分をワンクリックで入力
function fillQ0FeeName(name, taxClass) {
  document.getElementById('q0FeeName').value = name;
  document.getElementById('q0FeeTax').value = taxClass;
  document.getElementById('q0FeeAmt').focus();
}

function addQ0ExtraFee() {
  const name = document.getElementById('q0FeeName').value.trim();
  const amt = +document.getElementById('q0FeeAmt').value || 0;
  if (!name || !amt) { alert('名称と金額を入力してください'); return; }
  const applies = document.getElementById('q0FeeApplies').value;
  const tax = document.getElementById('q0FeeTax').value;
  q0ExtraFees.push({ name, amount: amt, applies, tax });
  document.getElementById('q0FeeName').value = '';
  document.getElementById('q0FeeAmt').value = '';
  renderQ0FeeList();
  calcQ0Total();
}

function removeQ0ExtraFee(idx) {
  q0ExtraFees.splice(idx, 1);
  renderQ0FeeList();
  calcQ0Total();
}

const q0FeeAppliesLabel = { billing:'請求', payment:'支払', both:'請求・支払' };
const q0FeeTaxLabel = { excl:'外税', incl:'内税', none:'非課税', advance:'立替' };

function renderQ0FeeList() {
  const el = document.getElementById('q0FeeList');
  if (!el) return;
  if (!q0ExtraFees.length) { el.innerHTML = '<span style="color:var(--text3)">登録なし</span>'; return; }
  el.innerHTML = q0ExtraFees.map((f,i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:0.5px solid var(--border)">
    <span>${f.name} <span style="color:var(--text2)">（${q0FeeAppliesLabel[f.applies]}・${q0FeeTaxLabel[f.tax]}）</span></span>
    <span>${yen(f.amount)} <button class="ibtn" style="font-size:10px" onclick="removeQ0ExtraFee(${i})">✕</button></span>
  </div>`).join('');
}

function showLastHint(cliId, car) {
  const hintEl = document.getElementById('q0LastHint');
  if (!hintEl) return;
  if (!cliId) { hintEl.style.display='none'; return; }
  // 同じ取引先の直近レコードを参照
  const recent = recs.filter(r=>String(r.cli)===String(cliId))
    .sort((a,b)=>b.date?.localeCompare(a.date||'')||0)[0];
  if (!recent) { hintEl.style.display='none'; return; }
  hintEl.style.display = 'block';
  const fb = feeBreakdown(recent, 'billing');
  hintEl.innerHTML = `💡 前回実績（${recent.date}）: 運賃 ${yen(recent.fare||0)} / 高速 ${yen(fb.hw)} / 立替代 ${yen(fb.oth)}
    <button class="btn sml" style="margin-left:8px;font-size:10px" onclick="applyLastValues('${recent.fare||0}','${(recent.tax||0)===0?'none':'excl'}')">この値を使う</button>`;
}

function applyLastValues(fare, taxClass) {
  document.getElementById('q0Fare').value = fare;
  document.getElementById('q0TaxClass').value = taxClass;
  syncQ0PayFromFare();
  calcQ0Total();
}

// タイムゾーンの影響を受けないローカル日付フォーマッタ（YYYY-MM-DD）
// ※ toISOString()はUTC変換されるため、日本時間(UTC+9)では日付が1日ズレるバグの原因になる
function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
// 同上・月単位（YYYY-MM）
function fmtLocalMonth(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}
// 前月の「YYYY-MM」を返す（受注入力タブ以外の対象月ピッカーの既定値に使用）
function prevMonthStr() {
  const now = new Date();
  return fmtLocalMonth(new Date(now.getFullYear(), now.getMonth()-1, 1));
}
// type="month"の単一ピッカーを月単位で前後にシフト（支払・入金スケジュールの対象月ピッカー用）
function singleMonthShift(id, dir, cb) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.value) el.value = prevMonthStr();
  const [y, m] = el.value.split('-').map(Number);
  el.value = fmtLocalMonth(new Date(y, m-1+dir, 1));
  if (cb) cb();
}

// ===== 集計期間ピッカー共通ヘルパー（請求明細書作成の集計期間と同じ方式をシステム全体で採用） =====
// 値が未設定の場合のみ前月1日〜末日を既定値としてセット（受注入力タブ以外は前月分を扱うことが多いため）
function ensureMonthRangeDefault(fromId, toId) {
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);
  if (fromEl && toEl && !fromEl.value) {
    const now = new Date();
    fromEl.value = fmtLocalDate(new Date(now.getFullYear(), now.getMonth()-1, 1));
    toEl.value = fmtLocalDate(new Date(now.getFullYear(), now.getMonth(), 0));
  }
}
// 日付範囲ピッカーを月単位で前後にシフトし、任意でコールバックを実行
function monthRangeShift(fromId, toId, dir, cb) {
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);
  if (!fromEl.value) {
    ensureMonthRangeDefault(fromId, toId);
  } else {
    const [fy, fm] = fromEl.value.split('-').map(Number);
    fromEl.value = fmtLocalDate(new Date(fy, fm-1+dir, 1));
    toEl.value = fmtLocalDate(new Date(fy, fm-1+dir+1, 0));
  }
  if (cb) cb();
}
// 「YYYY-MM」文字列から月初・月末の日付(YYYY-MM-DD)範囲を求める（保存済み対象月の復元用）
function monthToRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { from: fmtLocalDate(new Date(y, m-1, 1)), to: fmtLocalDate(new Date(y, m, 0)) };
}

function initAggInv() {
  // 取引先複数選択ドロップダウンを埋める
  initMSelClients('aggInvCli');
  // 常に前月1日〜末日を自動セット（タブを開くたびに前月にリセット）
  const fromEl = document.getElementById('aggInvFrom');
  const toEl = document.getElementById('aggInvTo');
  if (fromEl && toEl) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    fromEl.value = fmtLocalDate(first);
    toEl.value = fmtLocalDate(last);
  }
  runAggInv();
}

function aggInvMonthShift(dir) {
  const fromEl = document.getElementById('aggInvFrom');
  const toEl = document.getElementById('aggInvTo');
  if (!fromEl.value) { initAggInv(); return; }
  // "YYYY-MM-DD"文字列を手動パースしてローカル日付として扱う（UTC変換によるズレを回避）
  const [fy, fm, fd] = fromEl.value.split('-').map(Number);
  const first = new Date(fy, fm-1+dir, 1);
  const last = new Date(fy, fm-1+dir+1, 0);
  fromEl.value = fmtLocalDate(first);
  toEl.value = fmtLocalDate(last);
  runAggInv();
}

// 支払明細書「集計（ドライバー別）」の集計期間初期化・月送り（請求明細書のinitAggInv/aggInvMonthShiftと同じ仕様）
function initAggPay() {
  // 取引先複数選択ドロップダウンを埋める
  initMSelClients('aggPayCli');
  const fromEl = document.getElementById('aggPayFrom');
  const toEl = document.getElementById('aggPayTo');
  if (fromEl && toEl) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    fromEl.value = fmtLocalDate(first);
    toEl.value = fmtLocalDate(last);
  }
}
function aggPayMonthShift(dir) {
  const fromEl = document.getElementById('aggPayFrom');
  const toEl = document.getElementById('aggPayTo');
  if (!fromEl.value) { initAggPay(); return; }
  const [fy, fm] = fromEl.value.split('-').map(Number);
  const first = new Date(fy, fm-1+dir, 1);
  const last = new Date(fy, fm-1+dir+1, 0);
  fromEl.value = fmtLocalDate(first);
  toEl.value = fmtLocalDate(last);
  runAggPay();
}

// KPIカード（総件数/定期集配/チャーター/その他/未配車）クリックによる種別絞り込み
let aggInvTypeFilter = '';
function matchesTypeFilter(r, f) {
  if (!f) return true;
  if (f === 'un') return !recDrv(r);
  if (f === 'other') return r.type !== 'charter' && r.type !== 'regular';
  return r.type === f;
}
function filterAggInvByType(type) {
  aggInvTypeFilter = (aggInvTypeFilter === type) ? '' : type;
  document.querySelectorAll('#pg0 .mets .met').forEach(el=>el.classList.remove('active'));
  const idMap = {'':'metTot','regular':'metRe','charter':'metCh','other':'metOt','un':'metUn'};
  document.getElementById(idMap[aggInvTypeFilter])?.classList.add('active');
  runAggInv();
}

// pg0のKPIカード（総件数/定期集配/チャーター/その他/未配車）を集計期間ピッカーに合わせて更新
function updateInvMetCards() {
  const metRecs=periodRecs('aggInvFrom','aggInvTo');
  document.getElementById('mTot').textContent=metRecs.length;
  document.getElementById('mCh').textContent=metRecs.filter(r=>r.type==='charter').length;
  document.getElementById('mRe').textContent=metRecs.filter(r=>r.type==='regular').length;
  document.getElementById('mOt').textContent=metRecs.filter(r=>r.type!=='charter'&&r.type!=='regular').length;
  document.getElementById('mUn').textContent=metRecs.filter(r=>!recDrv(r)).length;
  if (document.getElementById('invMonthlyBreakdown')?.style.display !== 'none') renderMonthlyBreakdownTable('invMonthlyBreakdown');
}
// pg0（請求明細書作成）の集計期間・種別・取引先・ドライバー検索の絞り込みを反映したrecsを返す。
// 上部の合計バー(renderInvの請求合計)と集計テーブル(runAggInv)で条件を一致させるための共通ロジック
// （検索欄の日付(sd1/sd2)など一覧表示側の絞り込みとは別軸。請求合計は集計エリアの期間に連動させる）
function aggInvFilteredRecs() {
  const from = document.getElementById('aggInvFrom')?.value || '';
  const to = document.getElementById('aggInvTo')?.value || '';
  const cliFilterArr = getMSelValues('aggInvCli');
  const drvSearch = nm(document.getElementById('aggInvDrvSearch')?.value||'');
  return recs.filter(r => (!from || r.date >= from) && (!to || r.date <= to))
    .filter(r => matchesTypeFilter(r, aggInvTypeFilter))
    .filter(r => !cliFilterArr.length || cliFilterArr.includes(r.cli))
    .filter(r => !drvSearch || nm(recDrv(r)?.name||'').includes(drvSearch));
}
function runAggInv() {
  updateInvMetCards();
  renderInvTotalBar(); // 集計期間などの変更のたびに、上部の請求合計もあわせて更新する
  const from = document.getElementById('aggInvFrom').value;
  const to = document.getElementById('aggInvTo').value;
  const cliFilterArr = getMSelValues('aggInvCli');
  const drvSearch = nm(document.getElementById('aggInvDrvSearch')?.value||'');
  const tbody = document.getElementById('aggInvTbody');
  const tfoot = document.getElementById('aggInvTfoot');
  const summary = document.getElementById('aggInvSummary');

  let list = recs.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  if (cliFilterArr.length) list = list.filter(r => cliFilterArr.includes(r.cli));
  if (drvSearch) list = list.filter(r => nm(recDrv(r)?.name||'').includes(drvSearch));
  list = list.filter(r => matchesTypeFilter(r, aggInvTypeFilter));

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" style="padding:30px;text-align:center;color:var(--text3)">対象データがありません</td></tr>';
    tfoot.innerHTML = '';
    summary.textContent = `0件見つかりました（集計期間:${from||'-'}〜${to||'-'}）`;
    return;
  }

  // 取引先ごとにグループ化
  const groups = {};
  list.forEach(r => {
    const key = r.cli || 'none';
    if (!groups[key]) groups[key] = { cli: r.cli, rows: [] };
    groups[key].rows.push(r);
  });

  let gTotalCnt=0, gTaxed=0, gTaxOnly=0, gOth=0, gHw=0, gNonTax=0, gFee=0, gGrand=0;
  const aggMonth = (from||'').slice(0,7);
  window._aggInvGroups = groups; // 詳細展開・Excel出力用に保持
  populateAggInvCliSel(groups);
  // 取引先IDが古い（数値の小さい）順に並べる。ID未登録は末尾にまとめる
  const sortedEntries = Object.entries(groups).sort(([,ga],[,gb]) => {
    const na = parseInt(clients.find(c=>c.id===ga.cli)?.client_no, 10);
    const nb = parseInt(clients.find(c=>c.id===gb.cli)?.client_no, 10);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });
  const rowsHtml = sortedEntries.map(([key,g]) => {
    const cliObj = clients.find(c=>c.id===g.cli);
    const cliName = cliObj ? cliObj.name : '（未設定）';
    const cnt = g.rows.length;
    const subTotalAll = g.rows.reduce((s,r)=>s+(r.fare||0)+(r.hw||0)+(r.oth||0), 0); // 全明細の税抜ベース額（非課税分を含む）
    const taxTotal = g.rows.reduce((s,r)=>s+rtax(r), 0); // 内消費税額
    const extraFeeTotal = sumRecsExtraFees(g.rows, 'billing'); // 受注入力の追加料金（請求／両方指定分）
    const taxedTotal = subTotalAll + taxTotal + extraFeeTotal; // 税込金額（追加料金を含む）
    const fb = g.rows.reduce((a,r)=>{const b=feeBreakdown(r,'billing');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other,nonTax:a.nonTax+b.nonTax};},{hw:0,oth:0,other:0,nonTax:0});
    const othTotal = fb.oth; // 立替金額（追加料金の「立替」名称分を含む）
    const hwTotal = fb.hw; // 高速代など（追加料金の「高速」名称分を含む）
    const nonTaxTotal = g.rows.filter(r=>(r.tax||0)===0).reduce((s,r)=>s+sub(r),0) + fb.nonTax; // 非課税額（税率0%の明細の合計＋追加料金の非課税分）
    const subTotal = subTotalAll - nonTaxTotal; // 税別金額（課税対象分のみ。非課税分は含まない）
    const feeRate = cliObj?.fee_rate || 0;
    const feeAmt = Math.round(taxedTotal * feeRate / 100); // 手数料など（取引先マスタの手数料率を税込金額に適用）
    const grandTotal = taxedTotal + feeAmt; // 請求合計金額（税込金額＋手数料）
    const dueLabel = cliObj ? closingDayLabel(cliObj.closing_day) : '-';
    gTotalCnt+=cnt; gTaxed+=taxedTotal; gTaxOnly+=taxTotal; gOth+=othTotal; gHw+=hwTotal; gNonTax+=nonTaxTotal; gFee+=feeAmt; gGrand+=grandTotal;
    return `<tr style="border-bottom:0.5px solid var(--border)">
      <td style="padding:6px 8px">${g.cli?`<input type="checkbox" class="aggInvChk" value="${g.cli}">`:''}</td>
      <td style="padding:6px 8px;color:var(--text2)">${cliObj?.client_no||'—'}</td>
      <td style="padding:6px 8px">${g.cli?`<span style="cursor:pointer;color:var(--blue);text-decoration:underline dotted" onclick="event.stopPropagation();editCli(${g.cli})" title="取引先管理で開く">${escHtml(cliName)}</span>`:escHtml(cliName)}</td>
      <td style="padding:6px 8px;color:var(--text2)">締日: ${dueLabel}</td>
      <td style="padding:6px 8px;text-align:right">${cnt}</td>
      <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(taxedTotal)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(taxTotal)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(subTotal)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(nonTaxTotal)}</td>
      <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(othTotal)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(hwTotal)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(feeAmt)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--blue);border-left:0.5px solid var(--border)">${yen(grandTotal)}</td>
      <td style="padding:6px 8px;white-space:nowrap">
        ${g.cli?`<button class="btn sml" onclick="openAggDetailFull('billing','${key}')">明細</button>`:''}
      </td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rowsHtml;
  tfoot.innerHTML = `<tr style="font-weight:600;border-top:1px solid var(--border)">
    <td></td>
    <td></td>
    <td style="padding:6px 8px">合計</td>
    <td style="padding:6px 8px"></td>
    <td style="padding:6px 8px;text-align:right">${gTotalCnt}</td>
    <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(gTaxed)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gTaxOnly)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gTaxed-gTaxOnly-gNonTax)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gNonTax)}</td>
    <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(gOth)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gHw)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gFee)}</td>
    <td style="padding:6px 8px;text-align:right;color:var(--blue);border-left:0.5px solid var(--border)">${yen(gGrand)}</td>
    <td></td>
  </tr>`;
  const invFilterLabel = cliFilterArr.length ? `（絞込中: ${cliFilterArr.length}社）` : '';
  summary.innerHTML = `${Object.keys(groups).length}取引先 / ${gTotalCnt}件見つかりました（集計期間:${from}〜${to}）${invFilterLabel} <span style="font-weight:600;color:var(--blue);margin-left:6px">合計 ${yen(gGrand)}</span>`;
}


// 「出力形式」セレクト（通常／鑑）に応じてExcel・PDFボタンの動作を振り分ける（ボタン数を増やさず集約するため）。
// onclickからは結果を待たれない（fire-and-forget）ため、内部の非同期処理を必ずawaitしてtry/catchで
// 包み、失敗時に例外が握りつぶされて「何も起きない」ように見えることがないようにする
// 集計結果に含まれる取引先を「取引先で鑑を発行」セレクトへ反映する
// （協力会社の一括発行とは異なりドライバーのような多対1のグループは無いため、
// 1社を選んでその場でチェックを入れ、鑑（表紙）付きで単独発行するショートカットとして機能する）
function populateAggInvCliSel(groups) {
  const sel = document.getElementById('aggInvCliSel');
  if (!sel) return;
  const cur = sel.value;
  const entries = Object.values(groups||{}).filter(g=>g.cli).map(g=>({id:g.cli, name: clients.find(c=>c.id===g.cli)?.name || `ID:${g.cli}`}));
  entries.sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  sel.innerHTML = entries.length
    ? entries.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')
    : '<option value="">（該当する取引先なし）</option>';
  if (entries.some(e=>String(e.id)===cur)) sel.value = cur;
}
// 選択した1取引先分を、鑑（表紙）付きでその場で発行する
async function exportInvCliCover(format) {
  const cliId = +document.getElementById('aggInvCliSel')?.value || 0;
  if (!cliId) { alert('取引先を選択してください'); return; }
  const group = Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId);
  if (!group || !group.rows.length) { alert('該当するデータが集計結果内に見つかりません'); return; }
  document.querySelectorAll('.aggInvChk').forEach(el => { el.checked = (+el.value === cliId); });
  try {
    if (format === 'excel') await bulkExportInvExcelStacked();
    else await bulkCreateInvoicePdfWithCover();
  } catch(e) { alert((format==='excel'?'Excel':'PDF')+'作成に失敗しました: ' + e.message); console.error(e); }
}
async function handleInvExcelOut() {
  const mode = document.getElementById('invOutMode')?.value;
  try {
    if (mode === 'cover') await bulkExportInvExcelStacked();
    else await bulkExportInvExcel();
  } catch(e) { alert('Excel作成に失敗しました: ' + e.message); console.error(e); }
}
async function handleInvPdfOut() {
  const mode = document.getElementById('invOutMode')?.value;
  try {
    if (mode === 'cover') await bulkCreateInvoicePdfWithCover();
    else await bulkCreateInvoicePdf();
  } catch(e) { alert('PDF作成に失敗しました: ' + e.message); console.error(e); }
}

// 選択した複数取引先分を1シートにまとめ、取引先ごとに必ず改ページして出力する（タブは分けない）
async function bulkExportInvExcel() {
  const checked = Array.from(document.querySelectorAll('.aggInvChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('取引先を選択してください'); return; }
  const rowGroups = checked.map(cliId => Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId)?.rows).filter(rows=>rows && rows.length);
  if (!rowGroups.length) { alert('対象データがありません'); return; }
  const wb = XLSX.utils.book_new();
  const { ws, rowBreaks } = buildStatementSheetStacked('billing', rowGroups, {});
  XLSX.utils.book_append_sheet(wb, ws, '請求明細書');
  await downloadXlsxWithPageSetup(wb, `請求明細書_選択分_${fmtLocalDate(new Date())}.xlsx`, [rowBreaks]);
  addLog('Excel出力', `請求明細書 選択${checked.length}件`);
}

// 選択した複数取引先分を「鑑」形式（表紙に各取引先の合計一覧→そのあと各取引先の請求明細をページを
// 分けて連続出力）でまとめて1枚のExcelに出力する
async function bulkExportInvExcelStacked() {
  const checked = Array.from(document.querySelectorAll('.aggInvChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('取引先を選択してください'); return; }
  const rowGroups = checked.map(cliId => Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId)?.rows).filter(rows=>rows && rows.length);
  if (!rowGroups.length) { alert('対象データがありません'); return; }
  const wb = XLSX.utils.book_new();
  const { ws, rowBreaks } = buildStatementSheetStacked('billing', rowGroups, {withCover:true});
  XLSX.utils.book_append_sheet(wb, ws, '請求明細書');
  await downloadXlsxWithPageSetup(wb, `請求明細書_鑑_${fmtLocalDate(new Date())}.xlsx`, [rowBreaks]);
  addLog('Excel出力', `請求明細書（鑑形式） 選択${checked.length}件`);
}

function toggleAggInvAll(checked) {
  document.querySelectorAll('.aggInvChk').forEach(el=>el.checked=checked);
}

/* ===== 取引先 複数選択ドロップダウン（請求明細書作成／支払明細書作成の集計フィルタ共通） ===== */
// keyは 'aggInvCli' または 'aggPayCli'。未チェック=フィルタなし（全件）、1件以上チェック=その取引先のみに絞り込み
function initMSelClients(key) {
  const list = document.getElementById(key+'List');
  if (!list) return;
  const prevChecked = new Set(getMSelValues(key));
  list.innerHTML = clients.map(c => `<label><input type="checkbox" class="${key}Chk" value="${c.id}" ${prevChecked.has(c.id)?'checked':''} onchange="onMSelChange('${key}')"> ${escHtml(c.name)}</label>`).join('');
  updateMSelBtnLabel(key);
}
function toggleMSelPanel(key) {
  const panel = document.getElementById(key+'Panel');
  if (!panel) return;
  const willOpen = panel.style.display !== 'block';
  document.querySelectorAll('.msel-panel').forEach(p=>p.style.display='none');
  panel.style.display = willOpen ? 'block' : 'none';
}
function toggleMSelAll(key, checked) {
  document.querySelectorAll('.'+key+'Chk').forEach(el=>el.checked=checked);
  onMSelChange(key);
}
function getMSelValues(key) {
  return Array.from(document.querySelectorAll('.'+key+'Chk:checked')).map(el=>+el.value);
}
function updateMSelBtnLabel(key) {
  const btn = document.getElementById(key+'Btn');
  if (!btn) return;
  const vals = getMSelValues(key);
  btn.textContent = (vals.length ? `取引先: ${vals.length}件選択中` : '取引先: 全て') + ' ▾';
}
function onMSelChange(key) {
  updateMSelBtnLabel(key);
  if (key === 'aggInvCli') runAggInv();
  else if (key === 'aggPayCli') runAggPay();
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.msel-wrap')) document.querySelectorAll('.msel-panel').forEach(p=>p.style.display='none');
});

function bulkCreateInvoicePdf() {
  const checked = Array.from(document.querySelectorAll('.aggInvChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('取引先を選択してください'); return; }
  const groups = checked.map(cliId => Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId)?.rows).filter(rows=>rows && rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtmlMulti('billing', groups));
}

// 鑑（表紙）付きの請求明細書PDFを、選択した複数取引先分まとめて作成する
function bulkCreateInvoicePdfWithCover() {
  const checked = Array.from(document.querySelectorAll('.aggInvChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('取引先を選択してください'); return; }
  const groups = checked.map(cliId => Object.values(window._aggInvGroups||{}).find(g=>g.cli===cliId)?.rows).filter(rows=>rows && rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  if (!writeStatementWindow(win, () => buildStatementHtmlMultiWithCover('billing', groups, null))) return;
  addLog('PDF出力', `請求明細書（鑑形式） 選択${checked.length}件`);
}

function jumpToInvList(cliId, from, to) {
  jumpToEntryTab();
  document.getElementById('scli').value = cliId || '';
  document.getElementById('sd1').value = from || '';
  document.getElementById('sd2').value = to || '';
  renderInv();
}

// 単価×数量・税区分（外税/内税/非課税/立替）から運賃内訳を計算
// 立替を選んだ場合、入力額は運賃(fare)ではなく立替金(oth)として扱う
function computeQ0FareBreakdown(qty, unitPrice, taxClass) {
  const fareAmt = unitPrice * qty;
  let fare = 0, oth = 0;
  if (taxClass === 'advance') oth = fareAmt; else fare = fareAmt;
  const sub = fare + oth;
  const total = taxClass === 'excl' ? sub + Math.round(fare * 10/100) : sub;
  return { fareAmt, fare, hw: 0, oth, total };
}

function calcQ0Total() {
  const qty = +document.getElementById('q0Qty').value || 1;

  // 請求運賃（高速代・立替は下の「追加料金」欄から反映）
  const unitFare = +document.getElementById('q0Fare').value||0;
  const taxClass = document.getElementById('q0TaxClass').value||'excl';
  const b = computeQ0FareBreakdown(qty, unitFare, taxClass);
  document.getElementById('q0FareSub').textContent = yen(b.fareAmt);
  let total = b.total;
  // 追加料金（請求／両方）を加算
  (q0ExtraFees||[]).filter(f=>f.applies==='billing'||f.applies==='both').forEach(f => {
    total += f.tax==='excl' ? Math.round(f.amount*1.10) : f.amount;
  });
  document.getElementById('q0Total').textContent = yen(total);

  // 支払運賃（高速代・立替は下の「追加料金」欄から反映）
  const unitPayFare = +document.getElementById('q0PayFare').value||0;
  const payTaxClass = document.getElementById('q0PayTaxClass').value||'excl';
  const p = computeQ0FareBreakdown(qty, unitPayFare, payTaxClass);
  document.getElementById('q0PayFareSub').textContent = yen(p.fareAmt);
  let payTotal = p.total;
  // 追加料金（支払／両方）を加算（外税は税込換算。集計時のsumRecsExtraFeesと同じ扱い）
  (q0ExtraFees||[]).filter(f=>f.applies==='payment'||f.applies==='both').forEach(f => {
    payTotal += f.tax==='excl' ? Math.round(f.amount*1.10) : f.amount;
  });
  document.getElementById('q0PayTotal').textContent = yen(payTotal);
}

// 請求運賃の入力を支払運賃へ既定で連動（異なる場合は支払側を直接手動修正すればよい）
function syncQ0PayFromFare() {
  document.getElementById('q0PayFare').value = document.getElementById('q0Fare').value;
  document.getElementById('q0PayTaxClass').value = document.getElementById('q0TaxClass').value;
  document.getElementById('q0PayMethod').value = document.getElementById('q0FareMethod').value;
}

async function submitQ0(forceContinuous) {
  const date = document.getElementById('q0D').value;
  const car = document.getElementById('q0Car').value;
  const cli = +document.getElementById('q0Cli').value||null;
  const result = document.getElementById('q0Result');
  if (!date||!car) { result.textContent='⚠ 日付と車番は必須です'; result.style.color='var(--red)'; return; }
  if (!cli) { result.textContent='⚠ 取引先は登録済みの候補から選択してください'; result.style.color='var(--red)'; return; }

  const qty = +document.getElementById('q0Qty').value || 1;
  const taxClass = document.getElementById('q0TaxClass').value||'excl';
  const b = computeQ0FareBreakdown(qty, +document.getElementById('q0Fare').value||0, taxClass);
  const payTaxClass = document.getElementById('q0PayTaxClass').value||'excl';
  const p = computeQ0FareBreakdown(qty, +document.getElementById('q0PayFare').value||0, payTaxClass);
  // 内税入力は、他機能と同じ「外税ベース（税別金額を保存）」に変換
  let fare = b.fare, hw = b.hw, oth = b.oth;
  const tax = taxClass === 'none' || taxClass === 'advance' ? 0 : 10;
  if (taxClass === 'incl') {
    const factor = 1/1.10;
    fare = Math.round(fare*factor);
  }
  let payFare = p.fare, payHw = p.hw, payOth = p.oth;
  if (payTaxClass === 'incl') {
    const factor = 1/1.10;
    payFare = Math.round(payFare*factor);
  }

  const coreObj = {
    date,
    car,
    type: document.getElementById('q0Type').value,
    fare,
    hw,
    oth,
    pay_fare: payFare,
    pay_hw: payHw,
    pay_oth: payOth,
    tax,
    // 内税入力時は「入力した税込額−税別換算額」を記載消費税として保存し、
    // 1.1で割り切れない金額の再計算誤差（±1円）を防ぐ
    tax_amount: taxClass === 'incl' ? (b.fareAmt - fare) : null,
    st: 0,
    cli,
    note: document.getElementById('q0Note').value.trim(),
    drv_id: +document.getElementById('q0DrvOverride').value || null,
  };
  const extObj = {
    pickup_date: document.getElementById('q0PickD').value || null,
    pickup_time: document.getElementById('q0PickT').value || null,
    pickup_done: document.getElementById('q0PickDone').checked,
    pickup_location: document.getElementById('q0PickLoc').value.trim(),
    delivery_time: document.getElementById('q0DeliT').value || null,
    delivery_done: document.getElementById('q0DeliDone').checked,
    delivery_location: document.getElementById('q0DeliLoc').value.trim(),
    task_name: document.getElementById('q0TaskName').value.trim(),
    qty: document.getElementById('q0Qty').value === '' ? null : +document.getElementById('q0Qty').value,
    distance_time: document.getElementById('q0DistTime').value.trim(),
    fare_calc_method: document.getElementById('q0FareMethod').value,
    pay_calc_method: document.getElementById('q0PayMethod').value,
    fare_tax_class: taxClass,
    pay_tax_class: payTaxClass,
    extra_fees: q0ExtraFees,
    invoice_payment_date: document.getElementById('q0InvPayDate').value || null,
  };
  const obj = { ...coreObj, ...extObj };

  if (q0EditId) {
    result.textContent = '更新中...'; result.style.color = 'var(--text2)';
    showLoad(true);
    try {
      let { data, error } = await sb.from('invoices').update(obj).eq('id', q0EditId).select().single();
      if (error && error.message && (error.message.includes('does not exist') || error.message.includes('column'))) {
        ({data, error} = await sb.from('invoices').update(coreObj).eq('id', q0EditId).select().single());
      }
      if (error) throw error;
      const idx = recs.findIndex(r => r.id === q0EditId);
      const oldMonth = idx >= 0 ? (recs[idx].date || '').slice(0,7) : '';
      if (idx >= 0) Object.assign(recs[idx], data, extObj);
      // 支払・入金スケジュールを自動同期（ボタン不要）。日付が別の月に変わった場合は旧月も同期し、
      // 元の月に明細が無くなったドライバー・取引先の未消込の予定を自動的に消す
      const newMonth = date.slice(0,7);
      syncPaySchedule(newMonth); syncReceiptSchedule(newMonth);
      if (oldMonth && oldMonth !== newMonth) { syncPaySchedule(oldMonth); syncReceiptSchedule(oldMonth); }
      addLog('受注入力修正', `${car} ${date} 請求${yen(obj.fare)} / 支払${yen(obj.pay_fare)}`);
      showT('更新しました');
      const returnToDetail = _q0EditReturnToDetail;
      cancelQ0Edit(true);
      if (returnToDetail) { goPage(20); renderAggDetailFull(); }
    } catch(e) {
      result.textContent = '✗ エラー: ' + e.message;
      result.style.color = 'var(--red)';
    }
    showLoad(false);
    return;
  }

  result.textContent='送信中...'; result.style.color='var(--text2)';
  showLoad(true);
  try {
    let data, error, extSaved = true;
    ({data, error} = await sb.from('invoices').insert(obj).select().single());
    // 拡張カラムが未作成の場合は基本項目のみで再試行
    if (error && error.message && (error.message.includes('does not exist') || error.message.includes('column'))) {
      extSaved = false;
      ({data, error} = await sb.from('invoices').insert(coreObj).select().single());
    }
    if (error) throw error;
    // 拡張カラム未作成時は保存済みのcoreObjのみをrecsに反映（追加料金・依頼者等は消える点に注意）
    recs.unshift(extSaved ? data : { ...data, ...extObj });
    // 支払・入金スケジュールを自動同期（ボタン不要）
    syncPaySchedule(date.slice(0,7)); syncReceiptSchedule(date.slice(0,7));
    addLog('受注入力登録', `${car} ${date} 請求${yen(obj.fare)} / 支払${yen(obj.pay_fare)}`);
    if (extSaved) {
      result.textContent = '✔ 登録しました';
      result.style.color='var(--green)';
      setTimeout(()=>{result.textContent='';},2000);
    } else {
      // 拡張項目（追加料金・依頼者など）が未保存の重要な警告のため自動で消さない
      result.innerHTML = '⚠ 登録しました（<b>追加料金など拡張項目は未保存</b>: Supabaseにカラム未作成。セットアップページのSQLを実行してください）';
      result.style.color='var(--amber-text,#b45309)';
    }
    showT(extSaved ? '登録しました' : '登録しました（拡張項目は未保存）', extSaved ? undefined : 'twa');
    // 金額・付随項目リセット（税区分は連続入力を想定して保持）
    ['q0Fare','q0PayFare','q0Note',
     'q0PickT','q0PickLoc','q0DeliT','q0DeliLoc','q0TaskName','q0DistTime','q0Dist','q0Time'
     ].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    ['q0PickDone','q0DeliDone'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});
    document.getElementById('q0Qty').value = 1;
    // 連続入力: 日付を翌日に（引取日・支払日も同じ日に同期）
    // 「連続登録」ボタンから呼ばれた場合はチェックボックスの設定にかかわらず必ず継続する
    if (forceContinuous || document.getElementById('q0Cont')?.checked) {
      const d = new Date(date); d.setDate(d.getDate()+1);
      const next = fmtLocalDate(d);
      document.getElementById('q0D').value = next;
      document.getElementById('q0PickD').value = next;
      document.getElementById('q0InvPayDate').value = next;
    } else {
      document.getElementById('q0PickD').value = '';
      document.getElementById('q0InvPayDate').value = '';
    }
    q0ExtraFees = [];
    renderQ0FeeList();
    calcQ0Total();
    renderQ0History();
  } catch(e) {
    if (e.message.includes('pay_fare')||e.message.includes('pay_hw')||e.message.includes('pay_oth')||e.message.includes('column')) {
      result.textContent='✗ エラー: invoicesテーブルにpay_fare等のカラムが必要です。セットアップページのSQLを確認してください';
    } else {
      result.textContent='✗ エラー: '+e.message;
    }
    result.style.color='var(--red)';
  }
  showLoad(false);
}

function renderQ0History() {
  const el = document.getElementById('q0History');
  if (!el) return;
  const today = fmtLocalDate(new Date());
  const todayRecs = recs.filter(r=>r.date===today).slice(0,5);
  if (!todayRecs.length) { el.textContent='なし'; return; }
  el.innerHTML = todayRecs.map(r=>{
    const c=lkC(r.cli); const d=recDrv(r);
    return `<div style="padding:3px 0;border-bottom:0.5px solid var(--border);display:flex;justify-content:space-between">
      <span>${escHtml(r.car)}${d?' ('+escHtml(d.name)+')':''} ${c?'/ '+escHtml(c.name):''}</span>
      <span style="font-weight:500">${yen((r.fare||0)+(r.hw||0)+(r.oth||0))}</span>
    </div>`;
  }).join('');
}

/* ===== ファイル取込（列マッピング） ===== */
let fileMappings = {}; // Supabaseから読み込む（cli_idをキーにしたオブジェクト）
let f0PreviewData = [];
let f0RawRows = []; // 選択ファイルの生データ全行（スキップ前）。生プレビュー表示自体は先頭15行のみ描画（renderF0RawTable内）

function initF0Form() {
  const sel = document.getElementById('f0Cli');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">選択してください</option>' +
    clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  enhanceSelectSearchable('f0Cli');
  if (cur) sel.value = cur;
}

// 取引先を切り替えたとき：既にファイル読込済みなら、その取引先の保存済み設定を列選択に反映し直す
function loadFileMapping() {
  const cliId = document.getElementById('f0Cli').value;
  if (!f0RawRows.length) return;
  if (!cliId) return;
  const saved = fileMappings[cliId];
  const skip = saved && saved.skip_rows != null ? Math.min(saved.skip_rows, f0RawRows.length-1) : (+document.getElementById('mp_skip').value || 0);
  document.getElementById('mp_skip').value = skip;
  renderF0RawTable(skip);
  populateF0ColumnPickers(skip, saved);
  updateF0Preview();
}

// 1始まりの列番号 → Excel列記号（1=A, 2=B, ..., 27=AA）
function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n-1)%26; s = String.fromCharCode(65+m) + s; n = Math.floor((n-1)/26); }
  return s;
}

// CSVファイルの文字コードを自動判別してデコードする（UTF-8として不正なバイト列ならShift-JISとして読み直す）
// 支払予定明細書CSVなど業務系ソフトの出力はShift-JISであることが多いため、ユーザーが文字コードを意識しなくて済むようにする
async function decodeCsvFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder('shift-jis').decode(buf);
  }
}

// ファイル選択時：スキップ行を決める前にファイル全体を読み込み、生データプレビューと列選択UIを組み立てる
async function handleF0FileSelect(file) {
  const result = document.getElementById('f0Result');
  result.textContent = ''; result.style.color = '';
  if (!file) return;
  try {
    let rows = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await decodeCsvFile(file);
      rows = text.split('\n').filter(l => l.trim()).map(l => parseCsvLine(l));
    } else {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, {type:'array', cellText:true, cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    }
    f0RawRows = rows.filter(r => r.some(c => String(c).trim()));
    if (!f0RawRows.length) { result.textContent = 'データが見つかりませんでした'; result.style.color = 'var(--red)'; return; }

    const cliId = document.getElementById('f0Cli').value;
    const saved = fileMappings[cliId];
    const skip = saved && saved.skip_rows != null ? Math.min(saved.skip_rows, f0RawRows.length-1) : 0;
    document.getElementById('mp_skip').value = skip;
    renderF0RawTable(skip);
    populateF0ColumnPickers(skip, saved);
    document.getElementById('f0RawPreviewWrap').style.display = 'block';
    document.getElementById('f0MappingArea').style.display = 'block';
    updateF0Preview();
  } catch(e) {
    result.textContent = 'エラー: ' + e.message;
    result.style.color = 'var(--red)';
  }
}

// 生データプレビュー（先頭15行・全列）を描画。行をクリックするとその行を取込開始行に設定できる
function renderF0RawTable(skip) {
  const previewRows = f0RawRows.slice(0, 15);
  const maxCols = Math.max(1, ...previewRows.map(r => r.length));
  let html = '<thead><tr><th style="padding:3px 6px;border:0.5px solid var(--border);background:var(--bg2)"></th>' +
    Array.from({length:maxCols}, (_,i) => `<th style="padding:3px 6px;border:0.5px solid var(--border);background:var(--bg2)">${colLetter(i+1)}</th>`).join('') +
    '</tr></thead><tbody>';
  previewRows.forEach((row, ri) => {
    const isStart = ri === skip;
    html += `<tr style="cursor:pointer;${isStart?'background:var(--blue-bg)':''}" onclick="setF0SkipRow(${ri})" title="クリックしてこの行から取込を開始">
      <td style="padding:3px 6px;border:0.5px solid var(--border);font-weight:600;color:var(--text2);white-space:nowrap">${isStart?'▶ ':''}${ri+1}行目</td>
      ${Array.from({length:maxCols}, (_,ci) => `<td style="padding:3px 6px;border:0.5px solid var(--border)">${String(row[ci] ?? '').trim()}</td>`).join('')}
    </tr>`;
  });
  html += '</tbody>';
  document.getElementById('f0RawTable').innerHTML = html;
}

function setF0SkipRow(idx) {
  document.getElementById('mp_skip').value = idx;
  renderF0RawTable(idx);
  populateF0ColumnPickers(idx);
  updateF0Preview();
}

// 取込開始行の実データをサンプルとして、各項目の列選択プルダウンを組み立てる
function populateF0ColumnPickers(skip, savedMapping) {
  const sampleRow = f0RawRows[skip] || [];
  const maxCols = Math.max(1, ...f0RawRows.slice(0, 15).map(r => r.length));
  const cliId = document.getElementById('f0Cli').value;
  const m = savedMapping || fileMappings[cliId] || {};
  const fields = [
    {id:'mp_date', key:'col_date'}, {id:'mp_driver', key:'col_driver'}, {id:'mp_fare', key:'col_fare'},
    {id:'mp_hw', key:'col_hw'}, {id:'mp_note', key:'col_note'}, {id:'mp_tax_amount', key:'col_tax_amount'},
  ];
  fields.forEach(f => {
    const sel = document.getElementById(f.id);
    if (!sel) return;
    const savedVal = m[f.key] || 0;
    let opts = '<option value="0">（使用しない）</option>';
    for (let c = 1; c <= maxCols; c++) {
      const sample = String(sampleRow[c-1] ?? '').trim();
      opts += `<option value="${c}" ${savedVal===c?'selected':''}>列${colLetter(c)}: ${sample || '(空欄)'}</option>`;
    }
    sel.innerHTML = opts;
  });
  const typeSel = document.getElementById('mp_type');
  if (typeSel) typeSel.value = m.default_type || 'regular';
  const taxRoundSel = document.getElementById('mp_tax_round');
  if (taxRoundSel) taxRoundSel.value = m.default_tax_round || 'round';
  const hwAdvanceChk = document.getElementById('mp_hw_as_advance');
  if (hwAdvanceChk) hwAdvanceChk.checked = !!m.hw_as_advance;
  pendTypeByMonth = { ...(m.default_type_by_month || {}) };
  renderF0TypeByMonth();
}

// 月ごとの種別設定（取込マッピングの編集中の一時状態。保存すると default_type_by_month として書き込まれる）
let pendTypeByMonth = {};
const TYPE_LABEL_JA = {regular:'定期集配(個人・企業)', charter:'チャーター・スポット便', other:'その他'};
function renderF0TypeByMonth() {
  const el = document.getElementById('mp_typeByMonthList');
  if (!el) return;
  const months = Object.keys(pendTypeByMonth).sort();
  if (!months.length) { el.innerHTML = '<div style="font-size:10px;color:var(--text3)">設定なし（既定の種別が全期間に適用されます）</div>'; return; }
  el.innerHTML = months.map(mo => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 6px;background:var(--bg2);border-radius:var(--radius)">
    <span style="flex:1">${mo}</span><span style="color:var(--text2)">${TYPE_LABEL_JA[pendTypeByMonth[mo]]||pendTypeByMonth[mo]}</span>
    <button class="ibtn" onclick="rmF0TypeByMonth('${mo}')" title="削除">🗑</button>
  </div>`).join('');
}
function addF0TypeByMonth() {
  const mo = document.getElementById('mp_typeByMonth_month')?.value;
  const type = document.getElementById('mp_typeByMonth_type')?.value;
  if (!mo) { alert('月を選択してください'); return; }
  pendTypeByMonth[mo] = type;
  renderF0TypeByMonth();
  updateF0Preview();
}
function rmF0TypeByMonth(mo) {
  delete pendTypeByMonth[mo];
  renderF0TypeByMonth();
  updateF0Preview();
}

// 現在の列選択プルダウンの値からマッピングを組み立てる（保存前でも即座にプレビュー・取込に使える）
function currentF0Mapping() {
  return {
    col_date: +document.getElementById('mp_date')?.value || 0,
    col_driver: +document.getElementById('mp_driver')?.value || 0,
    col_fare: +document.getElementById('mp_fare')?.value || 0,
    col_hw: +document.getElementById('mp_hw')?.value || 0,
    col_note: +document.getElementById('mp_note')?.value || 0,
    col_tax_amount: +document.getElementById('mp_tax_amount')?.value || 0,
    skip_rows: +document.getElementById('mp_skip')?.value || 0,
    default_type: document.getElementById('mp_type')?.value || 'regular',
    default_tax_round: document.getElementById('mp_tax_round')?.value || 'round',
    hw_as_advance: !!document.getElementById('mp_hw_as_advance')?.checked,
    default_type_by_month: { ...pendTypeByMonth },
  };
}

async function saveFileMapping() {
  const cliId = document.getElementById('f0Cli').value;
  if (!cliId) { alert('取引先を選択してください'); return; }
  const mapping = { cli_id: +cliId, ...currentF0Mapping() };
  showLoad(true);
  try {
    // upsert（同じcli_idがあれば更新、なければ追加）
    const {data, error} = await sb.from('file_mappings')
      .upsert(mapping, {onConflict:'cli_id'}).select().single();
    if (error) throw error;
    fileMappings[cliId] = mapping;
    const cli = clients.find(c=>c.id==cliId);
    addLog('マッピング設定保存', cli?.name||'');
    showT(`「${cli?.name}」の列設定を保存しました（次回この取引先を選ぶと自動で復元されます）`);
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) {
      showMappingSql();
    } else { showT('エラー: '+e.message,'ter'); }
  }
  showLoad(false);
}

// 列選択プルダウンが変更されるたびに呼ばれ、取込開始行以降の全データをf0PreviewDataとして再構築してプレビューを更新する
function updateF0Preview() {
  if (!f0RawRows.length) return;
  const cliId = document.getElementById('f0Cli').value;
  const m = currentF0Mapping();
  const skip = m.skip_rows;
  f0PreviewData = f0RawRows.slice(skip);
  renderFilePreview(cliId, m);
}

function renderFilePreview(cliId, m) {
  const preview5 = f0PreviewData.slice(0,5);
  const colIdx = (n) => n>0 ? n-1 : null;
  const get = (row,col) => col!=null&&col<row.length ? String(row[col]||'').trim() : '';

  let html = `<table style="width:100%;border-collapse:collapse;font-size:10px">
    <thead><tr style="background:var(--bg2)">
      <th style="padding:3px 6px;border:0.5px solid var(--border)">日付</th>
      <th style="padding:3px 6px;border:0.5px solid var(--border)">ドライバー</th>
      <th style="padding:3px 6px;border:0.5px solid var(--border)">運賃</th>
      <th style="padding:3px 6px;border:0.5px solid var(--border)">高速</th>
      <th style="padding:3px 6px;border:0.5px solid var(--border)">備考</th>
    </tr></thead><tbody>`;

  preview5.forEach(row => {
    html += `<tr>
      <td style="padding:3px 6px;border:0.5px solid var(--border)">${get(row,colIdx(m.col_date))}</td>
      <td style="padding:3px 6px;border:0.5px solid var(--border)">${get(row,colIdx(m.col_driver))}</td>
      <td style="padding:3px 6px;border:0.5px solid var(--border)">${get(row,colIdx(m.col_fare))}</td>
      <td style="padding:3px 6px;border:0.5px solid var(--border)">${get(row,colIdx(m.col_hw))}</td>
      <td style="padding:3px 6px;border:0.5px solid var(--border)">${get(row,colIdx(m.col_note))}</td>
    </tr>`;
  });
  html += `</tbody></table><div style="font-size:10px;color:var(--text2);margin-top:4px">全${f0PreviewData.length}行 / 先頭5件表示</div>`;

  document.getElementById('f0PreviewTable').innerHTML = html;
  document.getElementById('f0Preview').style.display = 'block';
}

async function confirmFileImport() {
  const cliId = document.getElementById('f0Cli').value;
  if (!cliId) { alert('取引先を選択してください'); return; }
  const m = currentF0Mapping();
  const colIdx = (n) => n>0 ? n-1 : null;
  const get = (row,col) => col!=null&&col<row.length ? String(row[col]||'').trim() : '';

  const objs = [];
  f0PreviewData.forEach(row => {
    const dateRaw = get(row, colIdx(m.col_date));
    if (!dateRaw) return;
    // 日付パース（YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD）
    const dm = dateRaw.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (!dm) return;
    const date = `${dm[1]}-${dm[2].padStart(2,'0')}-${dm[3].padStart(2,'0')}`;
    const fareRaw = get(row,colIdx(m.col_fare)).replace(/,/g,'');
    const hwRaw = get(row,colIdx(m.col_hw)).replace(/,/g,'');
    const taxAmountRaw = get(row,colIdx(m.col_tax_amount)).replace(/,/g,'');
    const driverRaw = get(row,colIdx(m.col_driver));
    // ドライバーから車番を逆引き
    const drv = drvs.find(d=>d.name===driverRaw||(d.cars||[]).some(c=>nm(c)===nm(driverRaw)));
    const car = drv ? (drv.cars||[])[0]||driverRaw : driverRaw;
    const hwAmt = +hwRaw||0;
    // 種別：その行の日付の月に個別設定（default_type_by_month）があればそれを優先し、
    // なければ取引先の既定種別（default_type）にフォールバックする
    const rowMonth = date.slice(0,7);
    const obj = {
      date,
      car,
      type: (m.default_type_by_month && m.default_type_by_month[rowMonth]) || m.default_type || 'regular',
      fare: +fareRaw||0,
      hw: hwAmt,
      oth: 0,
      tax: 10,
      // 「消費税額」列が選択されていれば取引先の明細書に記載の金額をそのまま採用し、自前での再計算誤差を避ける
      tax_amount: (m.col_tax_amount && taxAmountRaw !== '') ? (+taxAmountRaw||0) : null,
      tax_round: m.default_tax_round === 'floor' ? 'floor' : null,
      st: 0,
      cli: +cliId||null,
      note: get(row,colIdx(m.col_note)),
    };
    // 高速代を「ドライバーへの支払時のみ」立替（消費税込み・非課税扱い）として計上する場合：
    // 支払側の基本高速代はreplaces:'hw'マーカーにより0扱いにし（pay_hwへの0代入では請求側hwへフォールバックしてしまうため使わない）、
    // 代わりに消費税込みの金額を追加料金（立替）として計上する。取引先への請求側（hw）は税別のまま変更しない。
    if (m.hw_as_advance && hwAmt > 0) {
      // 立替額の逆算はCSV取込（processCsvText）と同じ考え方：記載の消費税額があれば
      // 「高速代＋（記載消費税−運賃のみの消費税）」で行全体の合計を厳密に一致させる
      const fareTax = roundHalfUp((obj.fare) * (obj.tax / 100));
      const amt = (obj.tax_amount != null) ? (hwAmt + obj.tax_amount - fareTax) : roundHalfUp(hwAmt * 1.10);
      obj.extra_fees = [{ name: '高速代（立替）', amount: amt, applies: 'payment', tax: 'advance', replaces: 'hw' }];
    }
    objs.push(obj);
  });

  if (!objs.length) { alert('取込対象データがありません。取込開始行・列の選択を確認してください。'); return; }
  if (!confirm(`${objs.length}件を取り込みます。よろしいですか？`)) return;

  showLoad(true);
  const result = document.getElementById('f0Result');
  try {
    // 50件ずつinsert
    let inserted = 0;
    const chunk = (arr,n) => Array.from({length:Math.ceil(arr.length/n)},(_,i)=>arr.slice(i*n,(i+1)*n));
    for (const ch of chunk(objs,50)) {
      const {data, error} = await sb.from('invoices').insert(ch).select();
      if (error) throw error;
      (data||[]).forEach(r=>recs.unshift(r));
      inserted += ch.length;
    }
    addLog('ファイル取込', `${clients.find(c=>c.id==cliId)?.name||''} ${inserted}件`);
    result.textContent = `✔ ${inserted}件を取り込みました`;
    result.style.color = 'var(--green)';
    cancelFileImport();
    showT(`${inserted}件を取り込みました`);
    if (confirm('受注入力タブの一覧で確認しますか？')) jumpToEntryTab();
  } catch(e) {
    result.textContent = '✗ エラー: '+e.message;
    result.style.color = 'var(--red)';
  }
  showLoad(false);
}

function cancelFileImport() {
  f0PreviewData = [];
  f0RawRows = [];
  document.getElementById('f0Preview').style.display = 'none';
  document.getElementById('f0RawPreviewWrap').style.display = 'none';
  document.getElementById('f0MappingArea').style.display = 'none';
  document.getElementById('f0File').value = '';
}

// pg0サブタブ初期化はrenderInv内で対応
