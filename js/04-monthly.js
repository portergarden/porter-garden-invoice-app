/* js/04-monthly.js
   月報の自動集計と、支払明細書の差異チェック

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   v8: 月報自動集計 & 支払明細書差異チェック
   ============================================================ */

/* ===== 月報の表示項目 =====
   画面の日別明細と、印刷の日めくり表が同じ定義・同じ選択を使う。
   pw は印刷時の列幅の目安。選ばれた列だけで按分し直すので合計が100%でなくてよい。
   get(r) は日報1件を受け取り、表示用の文字列（HTMLとして出すのでエスケープ済み）を返す。
   r が無い日（印刷の日めくり表で日報が無い日）は空欄にする。 */
const MR_COLS = [
  {key:'date',     label:'日付',        def:true,  align:'left',   pw:8,  screen:true,  print:false, get:r=>escHtml(r.date||'')},
  {key:'day',      label:'日',          def:true,  align:'center', pw:4,  screen:false, print:true},
  {key:'dow',      label:'曜日',        def:true,  align:'center', pw:4,  screen:false, print:true},
  {key:'car',      label:'車番',        def:false, align:'left',   pw:11, get:r=>escHtml(r.car||'')},
  {key:'worktime', label:'稼働時間',    def:false, align:'center', pw:11, get:r=>(r.start_time||r.end_time)?`${escHtml(r.start_time||'?')}-${escHtml(r.end_time||'?')}`:''},
  {key:'site',     label:'稼働先',      def:false, align:'left',   pw:13, get:r=>{const c=lkC(r.cli);return c?escHtml(c.short||c.name):'';}},
  {key:'km',       label:'走行km',      def:true,  align:'right',  pw:8,  get:r=>String(r.distance_km||0)},
  {key:'odo',      label:'メーター',    def:false, align:'right',  pw:11, get:r=>(r.start_odometer!=null||r.end_odometer!=null)?`${r.start_odometer??'—'}/${r.end_odometer??'—'}`:''},
  {key:'tak',      label:'宅配便',      def:true,  align:'right',  pw:8,  get:r=>String(r.qty_takkyubin||0)},
  {key:'neko',     label:'ポスト便',    def:true,  align:'right',  pw:8,  get:r=>String(r.qty_nekopos||0)},
  {key:'charter',  label:'チャーター便',def:true,  align:'right',  pw:8,  get:r=>String(r.qty_charter||0)},
  {key:'other',    label:'その他',      def:false, align:'right',  pw:7,  get:r=>String(r.qty_other||0)},
  {key:'alc',      label:'Alc前/後',    def:true,  align:'center', pw:11, get:r=>`${r.alc_before??'—'}/${r.alc_after??'—'}`},
  {key:'health',   label:'体調',        def:true,  align:'center', pw:6,  get:r=>({good:'良',normal:'普',bad:'不'}[r.health_before||'good']||'')},
  {key:'rest',     label:'休憩',        def:false, align:'left',   pw:12, get:r=>escHtml(formatRests(r)||'')},
  {key:'wait',     label:'荷待ち',      def:false, align:'left',   pw:14, get:r=>escHtml(dailyTrips(r).filter(t=>t.wait).map(t=>`${t.wait.loc||''} ${t.wait.arrive||''}-${t.wait.depart||''}`).join(' / '))},
  {key:'cargo',    label:'荷役作業等',  def:false, align:'left',   pw:14, get:r=>escHtml(dailyTrips(r).filter(t=>t.cargo).map(t=>`${t.cargo.loc||''} ${t.cargo.work_start||''}-${t.cargo.work_end||''}`).join(' / '))},
  {key:'handover', label:'業務交替',    def:false, align:'left',   pw:12, get:r=>r.handover_flag?escHtml(`${r.handover_location||''} ${r.handover_time||''}`):''},
  {key:'status',   label:'状態',        def:true,  align:'center', pw:8,  get:r=>r.status==='rejected'?'差戻し':''},
  {key:'note',     label:'備考',        def:true,  align:'left',   pw:14, screen:true, print:false, get:r=>escHtml(r.note||'')},
];
/* 月報タブが読み込んだ日報。CSV出力も同じものを使う。
   以前は日報タブ用の共有配列(dailyReports)を見ており、日報タブを一度も開いていないと
   CSVが空になり、開いていても別の期間の内容が出ることがあった */
let mrReports = [];
const MR_COLS_KEY = 'mrCols';
function loadMrCols() {
  const on = {};
  MR_COLS.forEach(c => on[c.key] = c.def);
  try {
    const saved = JSON.parse(localStorage.getItem(MR_COLS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      // 保存後に列が増えても、増えた列は既定値のまま残す
      MR_COLS.forEach(c => { if (typeof saved[c.key] === 'boolean') on[c.key] = saved[c.key]; });
    }
  } catch(e) {}
  return on;
}
let mrCols = loadMrCols();
function saveMrCols() { try { localStorage.setItem(MR_COLS_KEY, JSON.stringify(mrCols)); } catch(e) {} }
// where は 'screen' か 'print'。列ごとに出す場所を絞れる（日付は画面用、日＋曜は印刷用）
function mrSelectedCols(where) {
  return MR_COLS.filter(c => mrCols[c.key] && (c[where] !== false));
}
function toggleMrCol(key, on) { mrCols[key] = on; saveMrCols(); renderMonthlyReport(); renderMrColPicker(); }
function setAllMrCols(on) { MR_COLS.forEach(c => mrCols[c.key] = on); saveMrCols(); renderMonthlyReport(); renderMrColPicker(); }
function resetMrCols() { MR_COLS.forEach(c => mrCols[c.key] = c.def); saveMrCols(); renderMonthlyReport(); renderMrColPicker(); }
function toggleMrColPicker() {
  const el = document.getElementById('mrColPicker');
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? 'block' : 'none';
  if (show) renderMrColPicker();
}
function renderMrColPicker() {
  const el = document.getElementById('mrColBoxes');
  if (!el) return;
  // 画面だけ・印刷だけの列があるので、どちらに出るのかを添える
  const scope = c => c.screen === false ? '<span style="color:var(--text3);font-size:9.5px">（印刷のみ）</span>'
                   : c.print  === false ? '<span style="color:var(--text3);font-size:9.5px">（画面のみ）</span>' : '';
  el.innerHTML = MR_COLS.map(c => `<label style="display:flex;align-items:center;gap:5px;font-size:11px;padding:2px 4px;cursor:pointer">
    <input type="checkbox" onchange="toggleMrCol('${c.key}',this.checked)"${mrCols[c.key]?' checked':''}>${escHtml(c.label)}${scope(c)}
  </label>`).join('');
  const n = MR_COLS.filter(c=>mrCols[c.key]).length;
  const cnt = document.getElementById('mrColCount');
  if (cnt) cnt.textContent = `${n}/${MR_COLS.length}`;
}

/* ===== 月報 ===== */
function initMonthlyReport() {
  ensureMonthRangeDefault('mrFrom', 'mrTo');
  populateMrDrvSel();
}
// 月報の「提出者のみ表示／全員表示」切替。既定は提出者のみ（未提出のドライバーはカードを出さない）
let mrShowAll = false;
function toggleMrShowAll() {
  mrShowAll = !mrShowAll;
  const btn = document.getElementById('mrShowAllBtn');
  if (btn) { btn.textContent = mrShowAll ? '全員表示中' : '提出者のみ表示'; btn.classList.toggle('pri', mrShowAll); }
  renderMonthlyReport();
}
/* 印刷する相手を個別に選べるようにする。
   空のときは「全員（提出者のみ表示の設定に従う）」を意味する。
   プルダウンで1名を選んでいる場合はそちらを優先し、この選択は使わない。 */
let mrDrvIds = new Set();
function mrTargetDrvs() {
  const one = +document.getElementById('mrDrvSel')?.value || null;
  if (one) return drvs.filter(d => d.id === one);
  if (mrDrvIds.size) return drvs.filter(d => mrDrvIds.has(d.id));
  return activeDrvs();
}
function toggleMrDrvPicker() {
  const el = document.getElementById('mrDrvPicker');
  if (!el) return;
  const show = el.style.display === 'none';
  el.style.display = show ? 'block' : 'none';
  if (show) renderMrDrvPicker();
}
function renderMrDrvPicker() {
  const el = document.getElementById('mrDrvBoxes');
  if (!el) return;
  // その期間に日報を出している人を先に並べる。誰も出していなければ在籍者全員を出す
  const submitted = new Set((mrReports||[]).map(r => recDrv(r)?.id).filter(v => v != null));
  const list = [...activeDrvs()].sort((a,b) => {
    const sa = submitted.has(a.id) ? 0 : 1, sb2 = submitted.has(b.id) ? 0 : 1;
    return sa - sb2 || (a.supplier_id||'999').localeCompare(b.supplier_id||'999');
  });
  el.innerHTML = list.map(d => `<label style="display:flex;align-items:center;gap:5px;font-size:11px;padding:2px 4px;cursor:pointer${submitted.has(d.id)?'':';color:var(--text3)'}">
    <input type="checkbox" onchange="toggleMrDrv(${d.id},this.checked)"${mrDrvIds.has(d.id)?' checked':''}>${escHtml(d.name)}${d.supplier_id?`<span style="color:var(--text3);font-size:9.5px">(${escHtml(d.supplier_id)})</span>`:''}${submitted.has(d.id)?'':'<span style="color:var(--text3);font-size:9.5px">未提出</span>'}
  </label>`).join('');
  const cnt = document.getElementById('mrDrvCount');
  if (cnt) cnt.textContent = mrDrvIds.size ? `${mrDrvIds.size}名` : '全員';
}
function toggleMrDrv(id, on) {
  if (on) mrDrvIds.add(id); else mrDrvIds.delete(id);
  renderMrDrvPicker();
  renderMonthlyReport();
}
function setAllMrDrvs(on) {
  mrDrvIds = new Set();
  if (on) (mrReports||[]).forEach(r => { const d = recDrv(r); if (d) mrDrvIds.add(d.id); });
  renderMrDrvPicker();
  renderMonthlyReport();
}
// 月報タブのドライバー選択プルダウンを更新する（登録ドライバーの追加・削除に追随させるため
// 画面表示のたびに呼び出す。選択中の値は維持する）
function populateMrDrvSel() {
  const sel = document.getElementById('mrDrvSel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">全ドライバー</option>' +
    [...activeDrvs()].sort((a,b)=>(a.supplier_id||'999').localeCompare(b.supplier_id||'999'))
      .map(d=>`<option value="${d.id}">${escHtml(d.name)}${d.supplier_id?`（ID:${escHtml(d.supplier_id)}）`:''}</option>`).join('');
  enhanceSelectSearchable('mrDrvSel');
  if ([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}

async function renderMonthlyReport() {
  const from = document.getElementById('mrFrom')?.value;
  const to = document.getElementById('mrTo')?.value;
  if (!from || !to) return;
  const month = from;

  const kpiEl   = document.getElementById('mrKpi');
  const bodyEl  = document.getElementById('mrBody');
  const diffEl  = document.getElementById('mrDiffBanner');

  kpiEl.innerHTML  = '<div style="grid-column:1/-1;color:var(--text2);font-size:11px;padding:4px 0">読み込み中...</div>';
  bodyEl.innerHTML = '';
  diffEl.style.display = 'none';

  // 日報データを取得（daily_reports テーブル）
  let drReports = [];
  try {
    const {data, error} = await fetchAllRows(() => sb.from('daily_reports')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date').order('id'));
    if (!error) drReports = data || [];
    mrReports = drReports;   // CSV出力が同じ範囲・同じ内容を使えるようにする
  } catch(e) {}
  if (document.getElementById('mrDrvPicker')?.style.display === 'block') renderMrDrvPicker();

  // 請求書データ（invoices）から当月分
  const invMonth = recs.filter(r => r.date && r.date >= from && r.date <= to);

  // ドライバー個別選択（未選択なら全ドライバー対象のまま）。KPI・カード一覧の両方に反映する。
  // ドライバーの特定はrecDrv()で行う（drv_id優先→乗務履歴の代車→登録車両の順）。
  // 以前は登録車両(d.cars)の文字列一致だけで絞り込んでおり、代車（乗務履歴）を使った日の
  // 日報がどのドライバーにもマッチせず月報から丸ごと抜け落ちていた
  populateMrDrvSel();
  const mrDrvId = +document.getElementById('mrDrvSel')?.value || null;
  let targetDrvs = mrTargetDrvs();
  if (mrDrvId || mrDrvIds.size) {
    const ids = new Set(targetDrvs.map(d=>d.id));
    drReports = drReports.filter(r => ids.has(recDrv(r)?.id));
  } else if (!mrShowAll) {
    // 既定では対象期間に日報の提出があるドライバーのみを表示する（未提出者はカード一覧から省く）。
    // 「全員表示」ボタンで切り替えられる
    const submittedIds = new Set(drReports.map(r => recDrv(r)?.id).filter(id => id != null));
    targetDrvs = targetDrvs.filter(d => submittedIds.has(d.id));
  }

  /* ──── 全体KPI ──── */
  const totalKm    = drReports.reduce((a,r) => a + (+r.distance_km||0), 0);
  const totalTak   = drReports.reduce((a,r) => a + (+r.qty_takkyubin||0), 0);
  const totalNeko  = drReports.reduce((a,r) => a + (+r.qty_nekopos||0), 0);
  const workDays   = new Set(drReports.map(r=>r.date)).size;
  const alcAlerts  = drReports.filter(r => +r.alc_before>=0.15 || +r.alc_after>=0.15).length;

  kpiEl.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">稼働日数</div><div class="kpi-val">${workDays}日</div></div>
    <div class="kpi-card"><div class="kpi-label">総走行距離</div><div class="kpi-val">${totalKm.toLocaleString()}km</div></div>
    <div class="kpi-card"><div class="kpi-label">宅配便計</div><div class="kpi-val">${totalTak.toLocaleString()}個</div></div>
    <div class="kpi-card"><div class="kpi-label">ポスト便計</div><div class="kpi-val">${totalNeko.toLocaleString()}個</div></div>
    <div class="kpi-card ${alcAlerts?'':''}"><div class="kpi-label">🍺 アルコール超過</div><div class="kpi-val" style="color:${alcAlerts?'var(--red)':'var(--green)'}">${alcAlerts}件</div></div>
  `;

  /* ──── ドライバー別集計 ──── */
  if (!targetDrvs.length) {
    bodyEl.innerHTML = (!mrDrvId && !mrShowAll && drvs.length)
      ? '<div style="color:var(--text2);padding:20px;text-align:center">この期間に日報の提出がありません（「提出者のみ表示」ボタンで全ドライバー表示に切り替えられます）</div>'
      : '<div style="color:var(--text2);padding:20px;text-align:center">ドライバー未登録</div>';
    return;
  }

  const diffWarnings = [];

  const cards = targetDrvs
    .sort((a,b)=>(a.supplier_id||'999').localeCompare(b.supplier_id||'999'))
    .map(d => {
      // 日報・請求書ともドライバーの特定はrecDrv()で行う（drv_id優先→乗務履歴の代車→登録車両）。
      // 登録車両(d.cars)の文字列一致だけだと、代車を使った日の分が抜け落ちるため。
      // 同じ日に複数枚提出されることがあるため、日付→乗務開始時刻の順で時系列に並べる
      // （日付だけのDB側ソートでは同日内の順序が保証されないため）
      const dReports = drReports.filter(r => recDrv(r)?.id === d.id)
        .sort((a,b) => (a.date||'').localeCompare(b.date||'') || (a.start_time||'').localeCompare(b.start_time||''));
      const drWorkDays = new Set(dReports.map(r=>r.date)).size;
      const drKm  = dReports.reduce((a,r)=>a+(+r.distance_km||0),0);
      const drTak = dReports.reduce((a,r)=>a+(+r.qty_takkyubin||0),0);
      const drNeko= dReports.reduce((a,r)=>a+(+r.qty_nekopos||0),0);
      const drOtherQty=dReports.reduce((a,r)=>a+(+r.qty_other||0),0);
      const drAlcAlert = dReports.filter(r=>+r.alc_before>=0.15||+r.alc_after>=0.15);
      const drHealthBad= dReports.filter(r=>r.health_before==='bad'||r.health_after==='bad');

      // 請求書（invoices）からの集計
      const invRecs = invMonth.filter(r => recDrv(r)?.id === d.id);
      const invTotal= invRecs.reduce((a,r)=>a+totR(r,'inc'),0);
      const invDays = new Set(invRecs.map(r=>r.date)).size;

      /* ── 差異チェック ── */
      const diffs = [];

      // 稼働日数の差（日報 vs 請求書）
      if (dReports.length > 0 && invRecs.length > 0) {
        const dayDiff = Math.abs(drWorkDays - invDays);
        if (dayDiff >= 2) {
          diffs.push(`稼働日数: 日報 ${drWorkDays}日 / 請求明細書 ${invDays}日（差${dayDiff}日）`);
        }
      }

      // 未提出日のチェック（請求書はあるが日報なし）
      const invDates = new Set(invRecs.map(r=>r.date));
      const drDates  = new Set(dReports.map(r=>r.date));
      const missingDr = [...invDates].filter(d=>!drDates.has(d));
      if (missingDr.length) {
        diffs.push(`日報未提出: ${missingDr.slice(0,5).join(', ')}${missingDr.length>5?` 他${missingDr.length-5}日`:''}`);
      }

      if (diffs.length) {
        diffWarnings.push({ name: d.name, diffs });
      }

      const hasDiff = diffs.length > 0;

      return `<div class="pnl-card" style="${hasDiff?'border-color:var(--amber-border);':''}">
        <div class="pnl-head" onclick="togglePnl(this)">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="av drv" style="width:24px;height:24px;font-size:10px">${escHtml((d.name||'').slice(-2))}</div>
            <div>
              <div style="font-size:12px;font-weight:500">
                ${d.name}
                ${d.supplier_id?`<span style="font-size:10px;color:var(--text2)"> ID:${escHtml(d.supplier_id)}</span>`:''}
                ${hasDiff?'<span style="font-size:10px;color:var(--amber-text);margin-left:6px">⚠ 差異あり</span>':''}
                ${drAlcAlert.length?'<span style="font-size:10px;color:var(--red);margin-left:4px">🚨 ALc超過</span>':''}
              </div>
              <div style="font-size:10px;color:var(--text2)">
                稼働${drWorkDays}日 · ${drKm}km · 宅配便${drTak}個 · ポスト便${drNeko}個
              </div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:600">${(drTak+drNeko+drOtherQty).toLocaleString()}個</div>
            <div style="font-size:10px;color:var(--text2)">配送個数計</div>
          </div>
        </div>
        <div class="pnl-body">
          ${!dReports.length ? '<div style="color:var(--text2);font-size:11px;padding:6px">日報なし</div>' : `

          <!-- 差異警告 -->
          ${hasDiff ? `<div style="padding:6px 8px;background:var(--amber-bg);border-radius:var(--radius);margin-bottom:8px;font-size:11px;color:var(--amber-text)">
            <div style="font-weight:500;margin-bottom:3px">⚠ 支払明細書との差異</div>
            ${diffs.map(d=>`<div>・${d}</div>`).join('')}
          </div>` : '<div style="font-size:11px;color:var(--green);margin-bottom:6px">✓ 支払明細書との差異なし</div>'}

          <!-- 数値サマリー -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
            <div class="kpi-card" style="padding:6px 8px">
              <div class="kpi-label">稼働日数</div>
              <div style="font-size:14px;font-weight:600">${drWorkDays}日</div>
              ${invDays !== drWorkDays ? `<div class="kpi-diff kpi-dn">請求明細書 ${invDays}日</div>` : `<div class="kpi-diff kpi-eq">請求明細書 ${invDays}日 ✓</div>`}
            </div>
            <div class="kpi-card" style="padding:6px 8px">
              <div class="kpi-label">走行距離</div>
              <div style="font-size:14px;font-weight:600">${drKm.toLocaleString()}km</div>
            </div>
            <div class="kpi-card" style="padding:6px 8px">
              <div class="kpi-label">配送個数計</div>
              <div style="font-size:14px;font-weight:600">${(drTak+drNeko+drOtherQty).toLocaleString()}個</div>
              <div class="kpi-diff kpi-eq">宅${drTak} ポスト${drNeko} 他${drOtherQty}</div>
            </div>
          </div>

          <!-- アルコール・健康 -->
          ${drAlcAlert.length ? `<div class="pnl-row neg"><span>🍺 アルコール超過記録</span><span>${drAlcAlert.length}件</span></div>` : ''}
          ${drHealthBad.length ? `<div class="pnl-row" style="color:var(--amber-text)"><span>⚠ 体調不良申告</span><span>${drHealthBad.length}日</span></div>` : ''}

          <!-- 日別明細 -->
          <div style="margin-top:8px;border-top:0.5px solid var(--border);padding-top:6px">
            <div style="font-size:10px;color:var(--text2);margin-bottom:4px;font-weight:500">日別明細</div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:10px">
                <thead><tr style="background:var(--bg2)">
                  ${mrSelectedCols('screen').map(c=>`<th style="padding:3px 6px;text-align:${c.align}">${escHtml(c.label)}</th>`).join('')}
                </tr></thead>
                <tbody>
                  ${dReports.map(r => {
                    const alcWarn = +r.alc_before>=0.15||+r.alc_after>=0.15;
                    const healthBad = r.health_before==='bad'||r.health_after==='bad';
                    return `<tr style="border-bottom:0.5px solid var(--border)${alcWarn?';background:var(--red-bg)':''}">${
                      mrSelectedCols('screen').map(c => {
                        // 目立たせたい列だけ色を付ける。備考は長いので省略表示にする
                        const extra = c.key==='alc' && alcWarn ? ';color:var(--red);font-weight:600'
                                    : c.key==='health' && healthBad ? ';color:var(--amber-text)'
                                    : ';white-space:pre-wrap;word-break:break-word';   // 途中で切らずに折り返す
                        const title = c.key==='note' ? ` title="${escHtml(r.note||'')}"` : '';
                        const v = c.key==='status' && r.status==='rejected'
                                ? '<span class="dr-status rejected">差</span>' : (c.get ? c.get(r) : '');
                        return `<td style="padding:3px 6px;text-align:${c.align}${extra}"${title}>${v}</td>`;
                      }).join('')
                    }</tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
          `}
        </div>
      </div>`;
    });

  bodyEl.innerHTML = cards.join('');

  // 差異バナー表示
  if (diffWarnings.length) {
    diffEl.style.display = 'block';
    diffEl.innerHTML = `<div style="font-weight:500;margin-bottom:4px">⚠ 以下のドライバーで日報と支払明細書に差異があります：</div>` +
      diffWarnings.map(w => `<div>・<b>${w.name}</b>: ${w.diffs[0]}${w.diffs.length>1?` 他${w.diffs.length-1}件`:''}</div>`).join('');
  }
}

// 日本の祝日名を返す（固定日・ハッピーマンデー・春分/秋分の近似計算・日曜が祝日の場合の振替休日）。
// 「国民の休日」（祝日と祝日に挟まれた平日）等の稀な例外は対象外。月報印刷の色分け表示用の簡易実装
function jpHolidayName(dateStr) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const nthMonday = (month, n) => {
    const firstDow = new Date(y, month-1, 1).getDay();
    const firstMonday = 1 + ((8 - firstDow) % 7);
    return firstMonday + (n-1)*7;
  };
  const vernal = Math.floor(20.8431 + 0.242194*(y-1980) - Math.floor((y-1980)/4));
  const autumnal = Math.floor(23.2488 + 0.242194*(y-1980) - Math.floor((y-1980)/4));
  const fixed = {
    '1-1':'元日', '2-11':'建国記念の日', '2-23':'天皇誕生日', '4-29':'昭和の日',
    '5-3':'憲法記念日', '5-4':'みどりの日', '5-5':'こどもの日', '8-11':'山の日',
    '11-3':'文化の日', '11-23':'勤労感謝の日',
  };
  if (fixed[`${m}-${d}`]) return fixed[`${m}-${d}`];
  if (m===1 && d===nthMonday(1,2)) return '成人の日';
  if (m===7 && d===nthMonday(7,3)) return '海の日';
  if (m===9 && d===nthMonday(9,3)) return '敬老の日';
  if (m===10 && d===nthMonday(10,2)) return 'スポーツの日';
  if (m===3 && d===vernal) return '春分の日';
  if (m===9 && d===autumnal) return '秋分の日';
  // 振替休日: 前日が日曜かつ祝日なら、当日（多くの場合は月曜）も休日扱い
  const dt = new Date(y, m-1, d);
  if (dt.getDay() !== 0) {
    const prev = new Date(y, m-1, d-1);
    if (prev.getDay() === 0 && jpHolidayName(fmtLocalDate(prev))) return '振替休日';
  }
  return null;
}

// 月報（日報自動集計）を「1日〜月末までの日めくり表」としてドライバーごとに1ページずつまとめ、
// 印刷用ウィンドウを開く。各ページは対象月の全日数分の行を持ち、日報が無い日は空欄行のまま
// 印字する（休みとして扱わず、単に空欄で「未提出/非稼働」を表す）。1ドライバー分がA4縦1枚に
// 収まるよう、列は既存の日別明細テーブルと同じ構成（走行距離・宅配便・ポスト便・チャーター・
// Alc前後・体調・状態）にとどめ、フォントを小さくして31行+ヘッダーが収まるようにしている
async function printMonthlyReportA4() {
  const from = document.getElementById('mrFrom')?.value;
  if (!from) { alert('対象期間を選択してください'); return; }
  const [y, m] = from.slice(0,7).split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // 対象月の末日（28〜31）
  const monthStr = `${y}-${String(m).padStart(2,'0')}`;
  const monthFrom = `${monthStr}-01`;
  const monthTo = `${monthStr}-${String(lastDay).padStart(2,'0')}`;

  // await(データ取得)の後にwindow.open()すると、ブラウザがユーザー操作から切り離されたと
  // 判断してポップアップブロックする（特にSafari）ため、クリック時に空タブを先に開いておき、
  // データが揃ってからそのタブへ内容を書き込む
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }

  let drReports = [];
  try {
    const {data, error} = await fetchAllRows(() => sb.from('daily_reports').select('*').gte('date', monthFrom).lte('date', monthTo).order('date').order('id'));
    if (error) throw error;
    drReports = data || [];
    mrReports = drReports;   // CSV出力が同じ範囲・同じ内容を使えるようにする
  } catch(e) { win.close(); alert('日報データの取得に失敗しました: ' + e.message); return; }

  const weekdayLabel = ['日','月','火','水','木','金','土'];
  const cAll = companySettings || {};

  // 月報タブで選択中のドライバーがいればその1名分のみ、未選択（全ドライバー）ならこれまで通り全員分を出力する
  const mrDrvId = +document.getElementById('mrDrvSel')?.value || null;
  const targetDrvs = mrTargetDrvs();

  const pages = targetDrvs
    .sort((a,b)=>(a.supplier_id||'999').localeCompare(b.supplier_id||'999'))
    .map(d => {
      const dReports = drReports.filter(r => recDrv(r)?.id === d.id);
      if (!dReports.length) return null; // その月の日報が1件もないドライバーは出力対象外
      const byDate = {};
      dReports.forEach(r => { byDate[r.date] = r; }); // 同日複数件は最後の1件を優先

      const partner = lkCli(d.company_client_id);

      const drWorkDays = dReports.length;
      const drKm  = dReports.reduce((a,r)=>a+(+r.distance_km||0),0);
      const drTak = dReports.reduce((a,r)=>a+(+r.qty_takkyubin||0),0);
      const drNeko= dReports.reduce((a,r)=>a+(+r.qty_nekopos||0),0);
      const drChar= dReports.reduce((a,r)=>a+(+r.qty_charter||0),0);
      const drOtherQty=dReports.reduce((a,r)=>a+(+r.qty_other||0),0);

      const dayRows = [];
      const printCols = mrSelectedCols('print');
      for (let day=1; day<=lastDay; day++) {
        const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`;
        const wd = new Date(y, m-1, day).getDay();
        const holName = jpHolidayName(dateStr);
        const r = byDate[dateStr];
        const alcWarn = r && (+r.alc_before>=0.15||+r.alc_after>=0.15);
        const site = r ? lkC(r.cli) : null;
        const rowCls = alcWarn ? 'alc' : holName ? 'hol' : wd===0 ? 'sun' : wd===6 ? 'sat' : '';
        // 選択された列だけを、定義順に並べる
        dayRows.push(`<tr${rowCls?` class="${rowCls}"`:''}>${printCols.map(c=>{
          const cls = c.align==='right' ? 'num' : c.align==='center' ? 'center' : (c.key==='car'?'car':c.key==='site'?'site':'');
          const title = (c.key==='day'||c.key==='dow') && holName ? ` title="${escHtml(holName)}"` : '';
          let v = '';
          if (c.key==='day') v = String(day);
          else if (c.key==='dow') v = weekdayLabel[wd];
          else if (r) v = c.get ? c.get(r) : '';
          return `<td class="${cls}"${title}>${v}</td>`;
        }).join('')}</tr>`);
      }

      return `<div class="mr-page">
        <div class="mr-head">
          <div>
            <div class="mr-title">月報（日報自動集計）</div>
            <div class="mr-period">${y}年${m}月　${escHtml(d.name)}${d.supplier_id?`（ID:${escHtml(d.supplier_id)}）`:''}${partner?`　協力会社: ${escHtml(partner.name)}`:''}</div>
          </div>
          <div class="mr-company">
            ${escHtml(cAll.name || '株式会社ポーターガーデン')}<br>
            発行日: ${fmtLocalDate(new Date())}
          </div>
        </div>
        <div class="mr-summary">稼働日数 ${drWorkDays}日　走行距離 ${drKm.toLocaleString()}km　宅配便 ${drTak.toLocaleString()}　ポスト便 ${drNeko.toLocaleString()}　チャーター便 ${drChar.toLocaleString()}　その他 ${drOtherQty.toLocaleString()}　配送個数計 ${(drTak+drNeko+drOtherQty).toLocaleString()}</div>
        <table class="mr-table">
          <thead><tr>
            ${(() => {
              // 選ばれた列の目安幅を合計100%になるよう按分する
              const cols = mrSelectedCols('print');
              const sum = cols.reduce((a,c)=>a+(c.pw||8),0) || 1;
              return cols.map(c=>`<th style="width:${((c.pw||8)/sum*100).toFixed(1)}%">${escHtml(c.label)}</th>`).join('');
            })()}
          </tr></thead>
          <tbody>${dayRows.join('')}</tbody>
        </table>
      </div>`;
    })
    .filter(Boolean);

  if (!pages.length) { win.close(); alert(mrDrvId ? '選択中のドライバーは対象月に日報データがありません' : '対象月に日報データがありません'); return; }

  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <title>月報_${monthStr}</title>
  <style>
    @page{size:A4 portrait;margin:10mm}
    *{box-sizing:border-box}
    body{font-family:"Hiragino Sans","Meiryo",sans-serif;color:#222;margin:0}
    .mr-page{page-break-after:always}
    .mr-page:last-child{page-break-after:auto}
    .mr-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
    .mr-title{font-size:16px;font-weight:700}
    .mr-period{font-size:12px;color:#555;margin-top:2px}
    .mr-company{text-align:right;font-size:10px;color:#555;line-height:1.5}
    .mr-summary{font-size:10px;color:#333;margin-bottom:6px;padding:4px 6px;background:#f2f2f2;border-radius:3px}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    table.mr-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:8.7px}
    table.mr-table th,table.mr-table td{border:1px solid #666;padding:2px 3px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
    table.mr-table th{background:#eee;font-weight:600}
    table.mr-table td.num{text-align:right}
    table.mr-table td.center{text-align:center}
    /* 以前は1行に収めて「…」で切っていたが、車番や稼働先が読めなくなるため折り返す */
    table.mr-table td.car,table.mr-table td.site{white-space:normal;word-break:break-word}
    tr.sun td:first-child,tr.sun td:nth-child(2){color:#c0392b}
    tr.sat td:first-child,tr.sat td:nth-child(2){color:#2874a6}
    tr.hol td:first-child,tr.hol td:nth-child(2){color:#c0392b;font-weight:700}
    tr.alc{background:#fdeaea}
  </style></head><body>
  ${pages.join('')}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  writeStatementWindow(win, () => html);
}

function exportMonthlyCsv() {
  const mrFrom = document.getElementById('mrFrom')?.value || '';
  const mrTo = document.getElementById('mrTo')?.value || '';
  const month = mrFrom;
  const drReports_local = (mrReports||[]).filter(r=>r.date&&r.date>=mrFrom&&r.date<=mrTo);
  // 画面と同じ項目を出す。ドライバーの識別だけは常に付ける
  const csvCols = mrSelectedCols('screen');
  const headers = ['ドライバー','ドライバーID', ...csvCols.map(c=>c.label)];
  const rows = [];
  drvs.forEach(d => {
    const dReps = drReports_local.filter(r=>recDrv(r)?.id===d.id);
    dReps.forEach(r => {
      rows.push([
        d.name, d.supplier_id||'',
        // 列の get() は画面表示用にHTMLを返すので、タグと実体参照を戻してから出す
        ...csvCols.map(c => {
          const raw = c.get ? String(c.get(r) ?? '') : '';
          return raw.replace(/<[^>]*>/g,'')
                    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
                    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
        }),
      ].map(v => csvSafe(v)).map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    });
  });
  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom,[headers.map(h=>`"${h}"`).join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`月報_${month}.csv`;a.click();
}

/* ===== 支払明細書（pg6）差異チェック強化 ===== */
// renderPayCore() の後に差異チェックを自動実行する
function renderPay() {
  renderPayCore();
  // 少し遅延させてDOMが安定してから実行
  setTimeout(checkSlipVsDailyReport, 500);
}

async function checkSlipVsDailyReport() {
  if (!payRows || !payRows.length) return;
  if (!sb) return;

  // 支払明細書の対象月を特定
  const months = [...new Set(payRows.map(r=>{
    const d = String(r.date||'');
    const m = d.match(/^(\d{4})[.\-\/](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2,'0')}` : null;
  }).filter(Boolean))];

  if (!months.length) return;

  let drReports = [];
  try {
    const minM = months.sort()[0];
    const maxM = months.sort().pop();
    const [maxY, maxMo] = maxM.split('-');
    const {data, error} = await fetchAllRows(() => sb.from('daily_reports')
      .select('date,car,distance_km,qty_takkyubin,qty_nekopos,status')
      .gte('date', `${minM}-01`)
      .lte('date', fmtLocalDate(new Date(+maxY,+maxMo,0)))
      .order('date').order('id'));
    if (!error) drReports = data||[];
  } catch(e) { return; }

  if (!drReports.length) return;

  const warnings = [];

  // ドライバーごとに比較
  // payRowsをinvoice_noでグループ化
  const payByInv = {};
  payRows.forEach(r => {
    if (!payByInv[r.invoice_no]) payByInv[r.invoice_no] = [];
    payByInv[r.invoice_no].push(r);
  });

  drvs.forEach(d => {
    const dCars = d.cars||[];
    const suppId = d.supplier_id;
    if (!suppId) return;

    // この仕入先IDのpayRows
    const dPayRows = payRows.filter(r=>String(r.supplier_id)===String(suppId));
    if (!dPayRows.length) return;

    // 日報
    const dDailyReps = drReports.filter(r=>dCars.some(c=>nm(c)===nm(r.car)));
    if (!dDailyReps.length) {
      warnings.push(`<b>${escHtml(d.name)}</b>: 日報の提出がありません`);
      return;
    }

    // 稼働日数比較（payRowsのdate一覧 vs 日報のdate一覧）
    const payDates = new Set(dPayRows.map(r=>{
      const s = String(r.date||'');
      // 日付フォーマット統一: 2026.5.1 → 2026-05-01
      const m2 = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
      return m2?`${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`:s;
    }));
    const drDates = new Set(dDailyReps.map(r=>r.date));

    // 明細書にある日付で日報がない
    const missingDr = [...payDates].filter(d=>!drDates.has(d));
    // 日報にある日付で明細書がない
    const missingPay = [...drDates].filter(d=>!payDates.has(d));

    if (missingDr.length) {
      warnings.push(`<b>${escHtml(d.name)}</b>: 明細書に日報のない日があります（${missingDr.slice(0,3).join('、')}${missingDr.length>3?'…':''}）`);
    }
    if (missingPay.length) {
      warnings.push(`<b>${escHtml(d.name)}</b>: 日報はあるが明細書に含まれていない日があります（${missingPay.slice(0,3).join('、')}${missingPay.length>3?'…':''}）`);
    }

    // 差戻し（要修正）のまま放置されている日報がある場合
    const rejected = dDailyReps.filter(r=>r.status==='rejected').length;
    if (rejected) {
      warnings.push(`<b>${escHtml(d.name)}</b>: 差戻し（要修正）の日報が ${rejected}件 あります`);
    }
  });

  // 警告表示
  let warnEl = document.getElementById('slipDiffWarn');
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.id = 'slipDiffWarn';
    warnEl.style.cssText = 'margin:6px 14px;padding:8px 10px;border-radius:4px;font-size:11px;display:none';
    const statusEl = document.getElementById('slipStatus');
    if (statusEl && statusEl.parentNode) {
      statusEl.parentNode.insertBefore(warnEl, statusEl.nextSibling);
    }
  }

  if (warnings.length) {
    warnEl.style.display = 'block';
    warnEl.style.background = 'var(--amber-bg)';
    warnEl.style.border = '0.5px solid var(--amber-border)';
    warnEl.style.color = 'var(--amber-text)';
    warnEl.innerHTML = `<div style="font-weight:500;margin-bottom:4px">⚠ 日報との差異 ${warnings.length}件</div>` +
      warnings.map(w=>`<div style="margin-top:2px">・${w}</div>`).join('') +
      `<div style="margin-top:6px;font-size:10px;opacity:.7">📊 月報タブで詳細を確認できます</div>`;
  } else {
    warnEl.style.display = 'block';
    warnEl.style.background = 'var(--green-bg)';
    warnEl.style.border = '0.5px solid #8DC554';
    warnEl.style.color = 'var(--green-text)';
    warnEl.innerHTML = '✓ 日報との差異なし — すべての稼働日が確認されています';
    setTimeout(() => { if(warnEl) warnEl.style.display='none'; }, 4000);
  }
}
