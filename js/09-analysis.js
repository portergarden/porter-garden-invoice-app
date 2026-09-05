/* js/09-analysis.js
   支払明細の汎用解析、日報の提出漏れアラート、単価マスタ、ドライバー稼働統計

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   v13: フェーズB
   ② pg6 汎用XLSX/CSV解析拡張
   ⑤ 日報提出漏れアラート
   ⑥ 単価マスタ
   ⑦ ドライバー稼働統計
   ============================================================ */

/* ===== ② pg6 汎用解析 ===== */

// 取引先切替時の表示制御
function onSlipCliChange() {
  const mode = document.getElementById('slipCliSel')?.value;
  const panel = document.getElementById('slipMappingPanel');
  if (!panel) return;
  panel.style.display = mode === 'custom' ? 'block' : 'none';
  if (mode === 'custom') {
    // pg0で保存済みのマッピングがあれば自動ロード（最初の取引先）
    const firstKey = Object.keys(fileMappings)[0];
    if (firstKey) loadSlipMappingFromCli(firstKey);
  }
}

// slipLoadAuto: モードによってコムトラック専用 or 汎用パーサーに振り分け
function slipLoadAuto(files, appendMode=false) {
  const mode = document.getElementById('slipCliSel')?.value || 'yamato';
  if (!files || !files.length) return;
  if (mode === 'yamato') {
    // 既存のコムトラック専用解析（slipLoadMulti）をそのまま使用
    slipLoadMulti(files, appendMode);
  } else {
    // 汎用パーサー
    Array.from(files).forEach((f, i) => {
      setTimeout(() => slipLoadGeneric(f, appendMode || i > 0), i * 300);
    });
  }
}

// 汎用XLSXパーサー
async function slipLoadGeneric(file, appendMode=false) {
  if (!file) return;
  const dropArea = document.getElementById('slipDropArea');
  if (dropArea) dropArea.style.display = 'none';
  setSlipStatus('📂 読み込み中（汎用）... ' + file.name, 'info');

  const m = getSlipMapping();
  if (!m.col_date && !m.col_amount && !m.col_fare) {
    setSlipStatus('⚠ 列マッピングが設定されていません。マッピング設定を入力してください。', 'warn');
    return;
  }

  try {
    let rows = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').slice(m.skip_rows||1);
      rows = lines.map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array', cellText:true, cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      rows = raw.slice(m.skip_rows||1);
    }

    const colIdx = n => (n > 0 ? n-1 : null);
    const get = (row, col) => col!=null && col<row.length ? String(row[col]||'').trim() : '';
    const getNum = (row, col) => {
      const v = get(row, col).replace(/,/g,'').replace(/[¥￥]/g,'');
      return isNaN(+v) ? 0 : +v;
    };

    const newRows = [];
    rows.forEach((row, ri) => {
      if (!row.some(c => String(c||'').trim())) return; // 空行スキップ

      // 日付パース
      const dateRaw = get(row, colIdx(m.col_date));
      const dm = dateRaw.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
      const date = dm ? `${dm[1]}.${parseInt(dm[2])}.${parseInt(dm[3])}` : dateRaw;

      const car = get(row, colIdx(m.col_car));
      const detail = get(row, colIdx(m.col_detail));
      const qty = getNum(row, colIdx(m.col_qty));
      const price = getNum(row, colIdx(m.col_price));
      const amount = colIdx(m.col_amount) !== null
        ? getNum(row, colIdx(m.col_amount))
        : qty * price;
      const hw = getNum(row, colIdx(m.col_hw));

      if (!date && !car && !amount) return; // 意味のない行スキップ

      newRows.push({
        date,
        car: car || '—',
        detail: detail || '—',
        qty: qty || 1,
        price: price || amount,
        amount,
        hw,
        invoice_no: 'GENERIC',
        supplier_id: null,
      });
    });

    if (!newRows.length) {
      setSlipStatus('⚠ 取込対象データが見つかりませんでした。列マッピングを確認してください。', 'warn');
      return;
    }

    if (!appendMode) payRows = [];
    payRows.push(...newRows);
    renderPayTable();
    setSlipStatus(`✓ ${file.name} — ${newRows.length}行を読み込みました（汎用解析）`, 'ok');
    addLog('汎用XLSX取込', `${file.name} ${newRows.length}行`);

  } catch(e) {
    setSlipStatus('✗ エラー: ' + e.message, 'err');
  }
}

// 現在のマッピング設定を取得
function getSlipMapping() {
  return {
    col_date:   +document.getElementById('sm_date')?.value||0,
    col_car:    +document.getElementById('sm_car')?.value||0,
    col_detail: +document.getElementById('sm_detail')?.value||0,
    col_qty:    +document.getElementById('sm_qty')?.value||0,
    col_price:  +document.getElementById('sm_price')?.value||0,
    col_amount: +document.getElementById('sm_amount')?.value||0,
    col_hw:     +document.getElementById('sm_hw')?.value||0,
    skip_rows:  +document.getElementById('sm_skip')?.value||1,
  };
}

// pg6マッピング設定をSupabaseに保存（cli_idは'slip_generic'として保存）
async function saveSlipMapping() {
  const m = getSlipMapping();
  const name = prompt('このマッピング設定の名前を入力してください（例: 日通、佐川等）:');
  if (!name) return;
  showLoad(true);
  try {
    const row = { ...m, cli_id: null, mapping_name: name };
    const {data, error} = await sb.from('file_mappings')
      .insert({...m, cli_id: -Date.now(), mapping_name: name}).select().single();
    if (error) throw error;
    addLog('明細書マッピング保存', name);
    showT(`「${name}」のマッピング設定を保存しました`);
  } catch(e) {
    // テーブル未作成の場合はlocalStorageに保存
    const key = 'slip_mapping_' + name;
    localStorage.setItem(key, JSON.stringify(m));
    showT(`「${name}」をローカルに保存しました（Supabaseテーブル未作成）`);
  }
  showLoad(false);
}

// pg0のfile_mappingsから読み込み
function loadSlipMappingFromCli(cliId) {
  const cliKey = cliId || document.getElementById('slipCliSel')?.dataset?.cliId;
  if (!cliKey) return;
  const m = fileMappings[cliKey];
  if (!m) { showT('この取引先のマッピング設定がありません','twa'); return; }
  if (m.col_date) document.getElementById('sm_date').value = m.col_date;
  if (m.col_driver) document.getElementById('sm_car').value = m.col_driver;
  if (m.col_fare) document.getElementById('sm_price').value = m.col_fare;
  if (m.col_hw) document.getElementById('sm_hw').value = m.col_hw;
  if (m.skip_rows != null) document.getElementById('sm_skip').value = m.skip_rows;
  showT('マッピング設定を読み込みました');
}

/* ===== ⑤ 日報提出漏れアラート ===== */
async function checkDailyReportMissing() {
  if (!sb || !recs.length) { setNavWarnDot('nt10', false); return; }
  try {
    const now = new Date();
    const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    // 今月の稼働データ日付一覧
    const invDates = new Set(
      recs.filter(r=>r.date?.startsWith(thisM)).map(r=>r.date)
    );
    if (!invDates.size) { setNavWarnDot('nt10', false); return; }

    // 今月の日報日付一覧
    const [y,m] = thisM.split('-');
    const {data, error} = await fetchAllRows(() => sb.from('daily_reports')
      .select('date,car,driver_name,status')
      .gte('date', `${y}-${m}-01`)
      .lte('date', fmtLocalDate(new Date(+y,+m,0)))
      .order('date').order('id'));
    if (error) return;

    const drDates = new Set((data||[]).map(r=>r.date));

    // 稼働データはあるが日報がない日（ダッシュボードの警告パネル(renderDashWarnings)に表示するため、ここではナビの赤丸のみ）
    const missing = [...invDates].filter(d=>!drDates.has(d)).sort();
    setNavWarnDot('nt10', missing.length>0);
  } catch(e) { console.warn('checkDailyReportMissing:', e.message); }
}

// renderDashの後にアラートチェックを実行
// checkDailyReportMissingはcheckSchedAlertsと同タイミングで呼ぶ

/* ===== ⑥ 単価マスタ ===== */
// pg3（取引先）画面に単価マスタボタンを追加するため
// 単価マスタはsupabase price_master テーブルで管理
let priceMaster = [];

async function loadPriceMaster(cliId) {
  if (!sb || !cliId) return [];
  try {
    const {data, error} = await sb.from('price_master')
      .select('*').eq('cli_id', cliId).order('service_name');
    if (error) throw error;
    return data || [];
  } catch(e) { return []; }
}

async function savePriceItem(cliId, serviceName, unitPrice, unit) {
  try {
    const {data, error} = await sb.from('price_master')
      .upsert({cli_id:+cliId, service_name:serviceName, unit_price:+unitPrice, unit:unit||'回'},
              {onConflict:'cli_id,service_name'}).select().single();
    if (error) throw error;
    addLog('単価マスタ保存', `${serviceName} ${unitPrice}円`);
    return data;
  } catch(e) {
    showT('単価マスタエラー: '+e.message,'ter');
    return null;
  }
}

// 単価マスタモーダルを開く（取引先ページから呼ぶ）
async function openPriceMasterModal(cliId) {
  const cli = clients.find(c=>c.id==cliId);
  if (!cli) return;
  const items = await loadPriceMaster(cliId);

  let rows = items.map(p=>
    `<tr>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border)">${p.service_name}</td>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border);text-align:right">${yen(p.unit_price)}</td>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border)">${p.unit||'回'}</td>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border)">
        <button class="ibtn" style="color:var(--red)" onclick="deletePriceItem(${cliId},${p.id},this)">🗑</button>
      </td>
    </tr>`
  ).join('');

  const html = `
    <div style="padding:12px">
      <div style="font-size:13px;font-weight:500;margin-bottom:10px">💰 単価マスタ — ${escHtml(cli.name)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px">
        <thead><tr style="background:var(--bg2)">
          <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">サービス名</th>
          <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">単価</th>
          <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">単位</th>
          <th style="padding:5px 8px;border-bottom:0.5px solid var(--border)"></th>
        </tr></thead>
        <tbody id="pmRows">${rows||'<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text2)">未登録</td></tr>'}</tbody>
      </table>
      <div style="display:grid;grid-template-columns:1fr 100px 70px auto;gap:6px;align-items:end">
        <div class="fld" style="margin:0"><label style="font-size:10px">サービス名</label>
          <input type="text" id="pmName" placeholder="例: 宅配便" style="width:100%;padding:5px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
        </div>
        <div class="fld" style="margin:0"><label style="font-size:10px">単価（円）</label>
          <input type="number" id="pmPrice" placeholder="0" style="width:100%;padding:5px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
        </div>
        <div class="fld" style="margin:0"><label style="font-size:10px">単位</label>
          <input type="text" id="pmUnit" placeholder="個" style="width:100%;padding:5px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
        </div>
        <button class="btn grn" onclick="addPriceItem(${cliId})">＋ 追加</button>
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:8px">単価マスタは手入力フォームで個数を入力すると自動計算に使われます</div>
    </div>`;

  // 既存モーダルに表示
  const modal = document.getElementById('mPriceMaster');
  if (modal) {
    modal.querySelector('.modal').innerHTML = `<div class="mh">単価マスタ <button class="ibtn" onclick="closeM('mPriceMaster')">✕</button></div>` + html;
    modal.classList.add('on');
  }
}

async function addPriceItem(cliId) {
  const name = document.getElementById('pmName')?.value.trim();
  const price = +document.getElementById('pmPrice')?.value||0;
  const unit = document.getElementById('pmUnit')?.value.trim()||'個';
  if (!name||!price) { alert('サービス名と単価は必須です'); return; }
  showLoad(true);
  try {
    const {data, error} = await sb.from('price_master')
      .upsert({cli_id:+cliId,service_name:name,unit_price:price,unit},{onConflict:'cli_id,service_name'})
      .select().single();
    if (error) throw error;
    addLog('単価追加', `${name} ${yen(price)}`);
    showT('追加しました');
    document.getElementById('pmName').value='';
    document.getElementById('pmPrice').value='';
    document.getElementById('pmUnit').value='';
    openPriceMasterModal(cliId); // 再描画
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) showPriceMasterSql();
    else showT('エラー: '+e.message,'ter');
  }
  showLoad(false);
}

async function deletePriceItem(cliId, id, btn) {
  if (!confirm('削除しますか？')) return;
  try {
    const {error} = await sb.from('price_master').delete().eq('id',id);
    if (error) throw error;
    btn.closest('tr').remove();
    addLog('単価削除','id:'+id);
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

// 手入力フォームで取引先選択時に単価マスタから候補を表示
async function showPriceSuggestions(cliId) {
  if (!cliId) return;
  const items = await loadPriceMaster(cliId);
  const hint = document.getElementById('q0LastHint');
  if (!hint || !items.length) return;

  const existing = hint.innerHTML;
  const suggestions = items.map(p=>
    `<button class="btn sml" style="font-size:10px" onclick="applyPriceItem(${p.unit_price})">${p.service_name} ${yen(p.unit_price)}/${p.unit}</button>`
  ).join(' ');
  hint.style.display='block';
  hint.innerHTML = (existing||'') + `<div style="margin-top:4px;font-size:10px;color:var(--text2)">単価マスタ: ${suggestions}</div>`;
}

function applyPriceItem(price) {
  document.getElementById('q0Fare').value = price;
  calcQ0Total();
}

function showPriceMasterSql() { openSetupSqlGuide('price_master'); }

/* ===== ⑦ ドライバー稼働統計（pg2に追加） ===== */
async function showDriverStats(drvId) {
  const drv = drvs.find(d=>d.id===drvId);
  if (!drv) return;
  const dCars = drv.cars||[];

  // 過去6ヶ月のデータ
  const now = new Date();
  const months = Array.from({length:6},(_,i)=>{
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }).reverse();

  const mAmts = months.map(m=>recs.filter(r=>r.date?.startsWith(m)&&dCars.some(c=>nm(c)===nm(r.car))).reduce((a,r)=>a+totR(r,'inc'),0));
  const mCnts = months.map(m=>recs.filter(r=>r.date?.startsWith(m)&&dCars.some(c=>nm(c)===nm(r.car))).length);
  const maxAmt = Math.max(...mAmts, 1);

  // 日報から走行距離・アルコール記録を取得
  let drReports = [];
  try {
    const [y,m] = months[0].split('-');
    const {data} = await fetchAllRows(() => sb.from('daily_reports')
      .select('date,distance_km,alc_before,alc_after,status')
      .in('car', dCars)
      .gte('date', `${y}-${m}-01`)
      .order('date', {ascending:false})
      .order('id', {ascending:false}));
    drReports = data||[];
  } catch(e) {}

  const totalKm = drReports.reduce((a,r)=>a+(+r.distance_km||0),0);
  const alcAlerts = drReports.filter(r=>+r.alc_before>=0.15||+r.alc_after>=0.15).length;
  const rejectedDr = drReports.filter(r=>r.status==='rejected').length;

  const barHtml = months.map((m,i)=>{
    const pct = Math.round(mAmts[i]/maxAmt*100);
    return `<div class="bar-row">
      <div class="bar-label">${m.slice(5)}月</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--blue)"></div></div>
      <div class="bar-val">${yen(mAmts[i])} <span style="color:var(--text2)">${mCnts[i]}件</span></div>
    </div>`;
  }).join('');

  const modal = document.getElementById('mDriverStats');
  if (modal) {
    modal.querySelector('.modal').innerHTML = `
      <div class="mh">${escHtml(drv.name)} — 稼働統計 <button class="ibtn" onclick="closeM('mDriverStats')">✕</button></div>
      <div style="padding:10px 12px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
          <div class="kpi-card"><div class="kpi-label">直近6ヶ月 走行距離</div><div class="kpi-val">${totalKm.toLocaleString()}km</div></div>
          <div class="kpi-card"><div class="kpi-label">差戻し日報</div><div class="kpi-val" style="color:${rejectedDr?'var(--amber-text)':'var(--green)'}">${rejectedDr}件</div></div>
          <div class="kpi-card"><div class="kpi-label">アルコール超過</div><div class="kpi-val" style="color:${alcAlerts?'var(--red)':'var(--green)'}">${alcAlerts}件</div></div>
        </div>
        <div style="font-size:11px;font-weight:500;color:var(--text2);margin-bottom:6px">月次売上推移（直近6ヶ月）</div>
        <div class="bar-chart" style="padding:0">${barHtml}</div>
      </div>`;
    modal.classList.add('on');
  }
}

