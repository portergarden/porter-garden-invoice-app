/* js/03-dashboard-daily.js
   ダッシュボードのKPI、稼働カレンダー、従業員予定、タスク管理、支払スケジュール、法定乗務日報

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   新機能 v8: 損益計算書・KPI強化・カレンダー・スケジュール・モバイル日報・月次締め
   ============================================================ */

/* ===== ① ダッシュボード KPI強化 ===== */
// 既存renderDashを拡張：月次推移・前月比・ランキングを追加
/* KPI補助 - renderKpiCards()はrenderDash()末尾から呼ばれる */
function renderKpiCards() {
  const da = document.getElementById('dashArea');
  if (!da) return;
  // 既存KPIカード除去
  const old = da.querySelector('.kpi-grid');
  if (old) old.remove();
  // 警告パネル(dashWarnings)は常に一番上に出したいため、KPIカードはその直後に挿入する
  const warnBox = document.getElementById('dashWarnings');

  const now = new Date();
  const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const lastM = (() => { const d=new Date(now.getFullYear(),now.getMonth()-1,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
  const sumM = m => recs.filter(r=>r.date&&r.date.startsWith(m)).reduce((a,r)=>a+totR(r,taxMode),0);
  const cntM = m => recs.filter(r=>r.date&&r.date.startsWith(m)).length;
  const thisAmt=sumM(thisM),lastAmt=sumM(lastM),thisCnt=cntM(thisM),lastCnt=cntM(lastM);
  const diffAmt=thisAmt-lastAmt,diffCnt=thisCnt-lastCnt;
  const diffPct=lastAmt>0?Math.round(diffAmt/lastAmt*100):0;
  const invoiced=recs.filter(r=>r.st===3).length,paid=recs.filter(r=>r.st===4).length;
  const kpiDiff=(v,pct)=>{
    if(v===0)return`<span class="kpi-eq">— 前月比同額</span>`;
    const cls=v>0?'kpi-up':'kpi-dn',arrow=v>0?'▲':'▼';
    return`<span class="${cls}">${arrow} ${pct>0?pct+'% ':''}${yen(Math.abs(v))}</span>`;
  };
  const kpiHtml = `<div class="kpi-grid" style="grid-column:1/-1">
    <div class="kpi-card"><div class="kpi-label">今月売上</div><div class="kpi-val">${yen(thisAmt)}</div><div class="kpi-diff">${kpiDiff(diffAmt,Math.abs(diffPct))}</div></div>
    <div class="kpi-card"><div class="kpi-label">今月件数</div><div class="kpi-val">${thisCnt}件</div><div class="kpi-diff">${diffCnt===0?'<span class="kpi-eq">— 前月同数</span>':`<span class="${diffCnt>0?'kpi-up':'kpi-dn'}">${diffCnt>0?'▲':'▼'} ${Math.abs(diffCnt)}件</span>`}</div></div>
    <div class="kpi-card"><div class="kpi-label">請求済</div><div class="kpi-val">${invoiced}件</div><div class="kpi-diff"><span class="kpi-eq">全${recs.length}件中</span></div></div>
    <div class="kpi-card"><div class="kpi-label">入金済</div><div class="kpi-val">${paid}件</div><div class="kpi-diff"><span class="kpi-eq">全${recs.length}件中</span></div></div>
  </div>`;
  if (warnBox) warnBox.insertAdjacentHTML('afterend', kpiHtml);
  else da.insertAdjacentHTML('afterbegin', kpiHtml);
}

// togglePnl/printPnlPdfは月次締めページ（差異チェック）・明細フル画面のPDF出力でも使う共通処理のため残置
function togglePnl(head) {
  const body = head.nextElementSibling;
  body.classList.toggle('open');
  head.querySelector(':scope > div:last-child > div:last-child').textContent = body.classList.contains('open') ? '手取り額 ▲' : '手取り額';
}

/* ===== ③ 稼働カレンダー ===== */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed

function initCal() {
  const sel = document.getElementById('calDrvSel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">全員</option>' +
    activeDrvs().map(d => `<option value="${d.id}" ${d.id==cur?'selected':''}>${escHtml(d.name)}</option>`).join('');
  enhanceSelectSearchable('calDrvSel');
}

function calPrev() { calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCal(); }
function calNext() { calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCal(); }

function renderCal() {
  const title = document.getElementById('calTitle');
  if (title) title.textContent = `${calYear}年${calMonth+1}月`;

  const drvId = parseInt(document.getElementById('calDrvSel')?.value) || null;
  let filterRecs = recs;
  if (drvId) {
    const drv = drvs.find(d=>d.id===drvId);
    if (drv) filterRecs = recs.filter(r => (drv.cars||[]).some(c=>nm(c)===nm(r.car)));
  }

  // その月のレコードをdate→{cnt,amt}にまとめる
  const dayMap = {};
  filterRecs.forEach(r => {
    if (!r.date) return;
    const d = new Date(r.date);
    if (d.getFullYear()===calYear && d.getMonth()===calMonth) {
      const key = r.date;
      if (!dayMap[key]) dayMap[key] = {cnt:0, amt:0};
      dayMap[key].cnt++;
      dayMap[key].amt += totR(r,taxMode);
    }
  });

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth+1, 0);
  const todayStr = fmtLocalDate(new Date());
  const startDow = firstDay.getDay();

  let html = '<div class="cal-grid">';
  ['日','月','火','水','木','金','土'].forEach(d => { html += `<div class="cal-head">${d}</div>`; });

  // 前月の余白
  for (let i=0; i<startDow; i++) html += '<div class="cal-day other"></div>';

  for (let day=1; day<=lastDay.getDate(); day++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const data = dayMap[dateStr];
    const isToday = dateStr === todayStr;
    const hasWork = !!data;
    let cls = 'cal-day';
    if (isToday) cls += ' today';
    else if (hasWork) cls += ' has-work';
    html += `<div class="${cls}">
      <div class="cal-dn">${day}</div>
      ${hasWork ? `<div class="cal-cnt">${data.cnt}件</div><div class="cal-amt">${yen(data.amt)}</div>` : ''}
    </div>`;
  }

  // 末尾余白
  const endDow = lastDay.getDay();
  for (let i=endDow+1; i<7; i++) html += '<div class="cal-day other"></div>';
  html += '</div>';

  document.getElementById('calGrid').innerHTML = html;
}

/* ===== 従業員予定管理 ===== */
let staffSchedules = [];
let staffSchedYear = new Date().getFullYear();
let staffSchedMonth = new Date().getMonth();
let eStaffSchedId = null;

function staffMembers() { return users.filter(u => u.role !== 'driver'); }

// 予定管理カレンダーの担当者ごとの色分け。
// 色は生の色コードではなくパレットのキーで持ち、CSS変数を通すことでライト/ダーク両方で読める配色にする
const STAFF_SCHED_PALETTE = {
  blue:   {label:'ブルー',   bg:'var(--blue-bg)',   text:'var(--blue-text)'},
  green:  {label:'グリーン', bg:'var(--green-bg)',  text:'var(--green-text)'},
  amber:  {label:'イエロー', bg:'var(--amber-bg)',  text:'var(--amber-text)'},
  purple: {label:'パープル', bg:'var(--purple-bg)', text:'var(--purple-text)'},
  red:    {label:'レッド',   bg:'var(--red-bg)',    text:'var(--red-text)'},
  teal:   {label:'ティール', bg:'var(--teal-bg)',   text:'var(--teal-text)'},
  pink:   {label:'ピンク',   bg:'var(--pink-bg)',   text:'var(--pink-text)'},
};
// 自分で色を選んでいない担当者に順番に割り当てる既定の並び
const STAFF_SCHED_DEFAULT_ORDER = ['blue','green','amber','purple','red','teal','pink'];
const STAFF_SCHED_UNASSIGNED_COLOR = {bg:'var(--gray-bg)', text:'var(--gray-text)'};
function staffSchedColorFor(userId) {
  if (!userId) return STAFF_SCHED_UNASSIGNED_COLOR;
  const u = users.find(x=>String(x.id)===String(userId));
  // 本人が選んだ色があればそれを優先し、未選択なら担当者一覧の並び順で自動割り当てする
  if (u?.schedule_color && STAFF_SCHED_PALETTE[u.schedule_color]) return STAFF_SCHED_PALETTE[u.schedule_color];
  const idx = staffMembers().findIndex(x=>String(x.id)===String(userId));
  return idx>=0 ? STAFF_SCHED_PALETTE[STAFF_SCHED_DEFAULT_ORDER[idx % STAFF_SCHED_DEFAULT_ORDER.length]] : STAFF_SCHED_UNASSIGNED_COLOR;
}
function renderStaffSchedLegend() {
  const el = document.getElementById('staffSchedLegend');
  if (!el) return;
  const members = staffMembers();
  if (!members.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = members.map(u => {
    const c = staffSchedColorFor(u.id);
    const mine = me && String(u.id) === String(me.id);
    return `<span style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2)"><span style="width:10px;height:10px;border-radius:50%;background:${c.bg};border:0.5px solid var(--border2);display:inline-block"></span>${escHtml(u.name)}${mine?'（自分）':''}</span>`;
  }).join('');
  // 自分の色を選ぶプルダウンを凡例の右端に出す（社内メンバーとしてログインしている場合のみ）
  if (me && members.some(u => String(u.id) === String(me.id))) {
    const cur = users.find(u=>String(u.id)===String(me.id))?.schedule_color || '';
    el.innerHTML += `<span style="display:flex;align-items:center;gap:5px;margin-left:auto;font-size:11px;color:var(--text2)">自分の色:
      <select id="staffSchedMyColor" onchange="saveMyScheduleColor(this.value)" style="padding:2px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
        <option value="">自動</option>
        ${Object.entries(STAFF_SCHED_PALETTE).map(([k,v])=>`<option value="${k}" ${cur===k?'selected':''}>${v.label}</option>`).join('')}
      </select></span>`;
  }
}
// 自分の表示色を保存する。usersテーブルの更新は管理者のみに制限されているためRPC経由で行う
async function saveMyScheduleColor(color) {
  if (!me) return;
  try {
    const { error } = await sb.rpc('set_my_schedule_color', { p_color: color || null });
    if (error) throw error;
    const u = users.find(x=>String(x.id)===String(me.id));
    if (u) u.schedule_color = color || null;
    renderStaffSchedCal();
    showT(color ? `自分の色を「${STAFF_SCHED_PALETTE[color].label}」にしました` : '自分の色を自動に戻しました');
  } catch(e) { showT('色の保存に失敗しました: '+e.message, 'ter'); }
}

async function loadStaffSchedules() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('staff_schedules').select('*').order('date').order('id'));
    if (error) { if (error.message.includes('does not exist')||error.message.includes('relation')) return; throw error; }
    staffSchedules = data || [];
  } catch(e) { console.warn('loadStaffSchedules:', e.message); }
}

function initStaffSched() {
  const sel = document.getElementById('staffSchedUserSel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">全員</option>' + staffMembers().map(u=>`<option value="${u.id}" ${u.id==cur?'selected':''}>${escHtml(u.name)}</option>`).join('');
  renderStaffSchedLegend();
}

function staffSchedPrev() { staffSchedMonth--; if(staffSchedMonth<0){staffSchedMonth=11;staffSchedYear--;} renderStaffSchedCal(); }
function staffSchedNext() { staffSchedMonth++; if(staffSchedMonth>11){staffSchedMonth=0;staffSchedYear++;} renderStaffSchedCal(); }

function renderStaffSchedCal() {
  const title = document.getElementById('staffSchedTitle');
  if (title) title.textContent = `${staffSchedYear}年${staffSchedMonth+1}月`;
  renderStaffSchedLegend(); // 色の変更をカレンダーと凡例で同時に反映させる

  const userId = document.getElementById('staffSchedUserSel')?.value || '';
  let items = staffSchedules;
  if (userId) items = items.filter(s=>String(s.user_id)===String(userId));

  // 終了日(end_date)が開始日より後なら、その範囲の日付すべてにこの予定を表示する（月をまたぐ場合も含む）
  const dayMap = {};
  items.forEach(s => {
    if (!s.date) return;
    const endDate = (s.end_date && s.end_date > s.date) ? s.end_date : s.date;
    let cur = new Date(s.date+'T00:00:00');
    const endD = new Date(endDate+'T00:00:00');
    while (cur <= endD) {
      if (cur.getFullYear()===staffSchedYear && cur.getMonth()===staffSchedMonth) {
        const ds = fmtLocalDate(cur);
        (dayMap[ds] = dayMap[ds] || []).push(s);
      }
      cur.setDate(cur.getDate()+1);
    }
  });

  const firstDay = new Date(staffSchedYear, staffSchedMonth, 1);
  const lastDay = new Date(staffSchedYear, staffSchedMonth+1, 0);
  const todayStr = fmtLocalDate(new Date());
  const startDow = firstDay.getDay();

  let html = '<div class="cal-grid">';
  ['日','月','火','水','木','金','土'].forEach((d,i) => {
    const style = i===0 ? 'color:var(--cal-sun);font-weight:700' : i===6 ? 'color:var(--cal-sat);font-weight:700' : '';
    html += `<div class="cal-head" style="${style}">${d}</div>`;
  });
  for (let i=0; i<startDow; i++) html += '<div class="cal-day other"></div>';

  for (let day=1; day<=lastDay.getDate(); day++) {
    const dateStr = `${staffSchedYear}-${String(staffSchedMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    // 開始時刻が早い順に表示する（時刻未設定は先頭）
    const dayItems = (dayMap[dateStr] || []).slice().sort((a,b) => (a.start_time||'').localeCompare(b.start_time||''));
    const isToday = dateStr === todayStr;
    const dow = new Date(dateStr+'T00:00:00').getDay();
    const holName = jpHolidayName(dateStr);
    // 背景は色分けされた予定バッジで判別できるため、セル自体は白背景のまま。
    // 土日祝は日付の文字色を専用の濃い赤・青にし、太字にして見分けやすくする
    const dnColor = (dow===0 || holName) ? 'var(--cal-sun)' : dow===6 ? 'var(--cal-sat)' : '';
    let cls = 'cal-day';
    if (isToday) cls += ' today';
    html += `<div class="${cls}" style="cursor:pointer" onclick="openStaffSchedM(null,'${dateStr}')">
      <div class="cal-dn"${dnColor?` style="color:${dnColor};font-weight:700"`:''}${holName?` title="${escHtml(holName)}"`:''}>${day}</div>
      ${dayItems.map(s=>{
        const u = users.find(x=>x.id===s.user_id);
        const isSpan = s.end_date && s.end_date > s.date;
        const isStartDay = dateStr === s.date;
        const titleHtml = (isSpan && !isStartDay ? '▸ ' : '') + escHtml(s.title) + (isSpan && isStartDay ? `〜${s.end_date.slice(5).replace('-','/')}` : '');
        const c = staffSchedColorFor(s.user_id);
        return `<div onclick="event.stopPropagation();openStaffSchedM(${s.id})" style="font-size:11.5px;background:${c.bg};color:${c.text};border-radius:3px;padding:2px 4px;margin:2px 0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isStartDay&&s.start_time?escHtml(s.start_time)+' ':''}${titleHtml}${u?'（'+escHtml(u.name)+'）':''}</div>`;
      }).join('')}
    </div>`;
  }
  const endDow = lastDay.getDay();
  for (let i=endDow+1; i<7; i++) html += '<div class="cal-day other"></div>';
  html += '</div>';
  document.getElementById('staffSchedGrid').innerHTML = html;
}

function openStaffSchedM(id, presetDate) {
  const sel = document.getElementById('ssUser');
  sel.innerHTML = '<option value="">選択</option>' + staffMembers().map(u=>`<option value="${u.id}">${escHtml(u.name)}</option>`).join('');
  eStaffSchedId = id || null;
  const delBtn = document.getElementById('ssDelBtn');
  if (id) {
    const s = staffSchedules.find(x=>x.id===id);
    if (!s) return;
    document.getElementById('mStaffSchedH').innerHTML = '予定 編集 <button class="ibtn" onclick="closeM(\'mStaffSched\')">✕</button>';
    sel.value = s.user_id || '';
    document.getElementById('ssTitle').value = s.title || '';
    document.getElementById('ssDate').value = s.date || '';
    document.getElementById('ssEndDate').value = (s.end_date && s.end_date !== s.date) ? s.end_date : '';
    document.getElementById('ssStart').value = s.start_time || '';
    document.getElementById('ssEnd').value = s.end_time || '';
    document.getElementById('ssNote').value = s.note || '';
    delBtn.style.display = '';
  } else {
    document.getElementById('mStaffSchedH').innerHTML = '予定 追加 <button class="ibtn" onclick="closeM(\'mStaffSched\')">✕</button>';
    sel.value = document.getElementById('staffSchedUserSel')?.value || '';
    document.getElementById('ssTitle').value = '';
    document.getElementById('ssDate').value = presetDate || fmtLocalDate(new Date());
    document.getElementById('ssEndDate').value = '';
    document.getElementById('ssStart').value = '';
    document.getElementById('ssEnd').value = '';
    document.getElementById('ssNote').value = '';
    delBtn.style.display = 'none';
  }
  document.getElementById('mStaffSched').classList.add('on');
}

async function saveStaffSched() {
  const title = document.getElementById('ssTitle').value.trim();
  const date = document.getElementById('ssDate').value;
  const endDateRaw = document.getElementById('ssEndDate').value;
  if (!title || !date) { alert('タイトルと開始日は必須です'); return; }
  if (endDateRaw && endDateRaw < date) { alert('終了日は開始日以降にしてください'); return; }
  const row = {
    user_id: document.getElementById('ssUser').value || null,
    title, date,
    end_date: endDateRaw || null,
    start_time: document.getElementById('ssStart').value || null,
    end_time: document.getElementById('ssEnd').value || null,
    note: document.getElementById('ssNote').value.trim() || null,
  };
  showLoad(true);
  try {
    if (eStaffSchedId) {
      const {data,error} = await sb.from('staff_schedules').update(row).eq('id',eStaffSchedId).select().single();
      if (error) throw error;
      const idx = staffSchedules.findIndex(s=>s.id===eStaffSchedId);
      if (idx>=0) staffSchedules[idx] = data;
      showT('予定を更新しました');
    } else {
      row.created_by = me?.name || null;
      const {data,error} = await sb.from('staff_schedules').insert(row).select().single();
      if (error) throw error;
      staffSchedules.push(data);
      showT('予定を追加しました');
    }
    closeM('mStaffSched');
    renderStaffSchedCal();
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

async function deleteStaffSched() {
  if (!eStaffSchedId) return;
  if (!confirm('この予定を削除しますか？')) return;
  showLoad(true);
  try {
    const {error} = await sb.from('staff_schedules').delete().eq('id',eStaffSchedId);
    if (error) throw error;
    staffSchedules = staffSchedules.filter(s=>s.id!==eStaffSchedId);
    closeM('mStaffSched');
    renderStaffSchedCal();
    showT('予定を削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

/* ===== タスク管理 ===== */
let tasks = [];
let eTaskId = null;

async function loadTasks() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('tasks').select('*').order('due_date',{ascending:true, nullsFirst:false}).order('id'));
    if (error) { if (error.message.includes('does not exist')||error.message.includes('relation')) return; throw error; }
    tasks = data || [];
  } catch(e) { console.warn('loadTasks:', e.message); }
}

function initTasks() {
  const sel = document.getElementById('taskAssigneeFilter');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">全担当者</option>' + staffMembers().map(u=>`<option value="${u.id}" ${u.id==cur?'selected':''}>${escHtml(u.name)}</option>`).join('');
  }
}

const TASK_STATUS_LABEL = {todo:'未着手', doing:'進行中', done:'完了'};
const TASK_STATUS_COLOR = {todo:['--gray-bg','--gray-text'], doing:['--blue-bg','--blue-text'], done:['--green-bg','--green-text']};
const TASK_PRIORITY_LABEL = {low:'低', normal:'中', high:'高'};

function renderTasks() {
  const area = document.getElementById('taskListArea');
  if (!area) return;
  const statusF = document.getElementById('taskStatusFilter')?.value || '';
  const assigneeF = document.getElementById('taskAssigneeFilter')?.value || '';
  let rows = tasks;
  if (statusF) rows = rows.filter(t=>(t.status||'todo')===statusF);
  if (assigneeF) rows = rows.filter(t=>String(t.assignee_user_id)===String(assigneeF));
  const todayStr = fmtLocalDate(new Date());
  rows = [...rows].sort((a,b)=>{
    const oa = a.status==='done'?1:0, ob = b.status==='done'?1:0;
    if (oa!==ob) return oa-ob;
    return (a.due_date||'9999-99-99').localeCompare(b.due_date||'9999-99-99');
  });
  if (!rows.length) { area.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:10px 0">タスクがありません</div>'; return; }
  area.innerHTML = rows.map(t=>{
    const u = users.find(x=>x.id===t.assignee_user_id);
    const overdue = t.due_date && t.due_date < todayStr && t.status!=='done';
    const sc = TASK_STATUS_COLOR[t.status] || TASK_STATUS_COLOR.todo;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:0.5px solid var(--border)">
      <input type="checkbox" ${t.status==='done'?'checked':''} onchange="toggleTaskDone(${t.id},this.checked)" style="width:15px;height:15px">
      <div style="flex:1;min-width:0;cursor:pointer" onclick="openTaskM(${t.id})">
        <div style="font-weight:500;color:var(--text);${t.status==='done'?'text-decoration:line-through;color:var(--text2)':''}">${escHtml(t.title)}</div>
        <div style="font-size:10px;color:var(--text2);display:flex;gap:8px;margin-top:2px;flex-wrap:wrap">
          ${u?`<span>👤 ${escHtml(u.name)}</span>`:''}
          ${t.due_date?`<span style="${overdue?'color:var(--red-text);font-weight:600':''}">📅 ${t.due_date}${overdue?'（期限超過）':''}</span>`:''}
          <span class="bdg" style="background:var(${sc[0]});color:var(${sc[1]})">${TASK_STATUS_LABEL[t.status]||'未着手'}</span>
          <span>優先度: ${TASK_PRIORITY_LABEL[t.priority]||'中'}</span>
        </div>
      </div>
      <button class="ibtn" onclick="openTaskM(${t.id})" title="編集">✎</button>
    </div>`;
  }).join('');
}

function openTaskM(id) {
  const sel = document.getElementById('tkAssignee');
  sel.innerHTML = '<option value="">未割当</option>' + staffMembers().map(u=>`<option value="${u.id}">${escHtml(u.name)}</option>`).join('');
  eTaskId = id || null;
  const delBtn = document.getElementById('tkDelBtn');
  if (id) {
    const t = tasks.find(x=>x.id===id);
    if (!t) return;
    document.getElementById('mTaskH').innerHTML = 'タスク 編集 <button class="ibtn" onclick="closeM(\'mTask\')">✕</button>';
    document.getElementById('tkTitle').value = t.title || '';
    sel.value = t.assignee_user_id || '';
    document.getElementById('tkDue').value = t.due_date || '';
    document.getElementById('tkPriority').value = t.priority || 'normal';
    document.getElementById('tkStatus').value = t.status || 'todo';
    document.getElementById('tkNote').value = t.note || '';
    delBtn.style.display = '';
  } else {
    document.getElementById('mTaskH').innerHTML = 'タスク 追加 <button class="ibtn" onclick="closeM(\'mTask\')">✕</button>';
    document.getElementById('tkTitle').value = '';
    sel.value = document.getElementById('taskAssigneeFilter')?.value || '';
    document.getElementById('tkDue').value = '';
    document.getElementById('tkPriority').value = 'normal';
    document.getElementById('tkStatus').value = 'todo';
    document.getElementById('tkNote').value = '';
    delBtn.style.display = 'none';
  }
  document.getElementById('mTask').classList.add('on');
}

async function saveTask() {
  const title = document.getElementById('tkTitle').value.trim();
  if (!title) { alert('タイトルは必須です'); return; }
  const status = document.getElementById('tkStatus').value;
  const row = {
    title,
    assignee_user_id: document.getElementById('tkAssignee').value || null,
    due_date: document.getElementById('tkDue').value || null,
    priority: document.getElementById('tkPriority').value,
    status,
    note: document.getElementById('tkNote').value.trim() || null,
    completed_at: status==='done' ? new Date().toISOString() : null,
  };
  showLoad(true);
  try {
    if (eTaskId) {
      const {data,error} = await sb.from('tasks').update(row).eq('id',eTaskId).select().single();
      if (error) throw error;
      const idx = tasks.findIndex(t=>t.id===eTaskId);
      if (idx>=0) tasks[idx] = data;
      showT('タスクを更新しました');
    } else {
      row.created_by = me?.name || null;
      const {data,error} = await sb.from('tasks').insert(row).select().single();
      if (error) throw error;
      tasks.push(data);
      showT('タスクを追加しました');
    }
    closeM('mTask');
    renderTasks();
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

async function toggleTaskDone(id, done) {
  const t = tasks.find(x=>x.id===id);
  if (!t) return;
  try {
    const {data,error} = await sb.from('tasks').update({status: done?'done':'todo', completed_at: done ? new Date().toISOString() : null}).eq('id',id).select().single();
    if (error) throw error;
    const idx = tasks.findIndex(x=>x.id===id);
    if (idx>=0) tasks[idx] = data;
    renderTasks();
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

async function deleteTask() {
  if (!eTaskId) return;
  if (!confirm('このタスクを削除しますか？')) return;
  showLoad(true);
  try {
    const {error} = await sb.from('tasks').delete().eq('id',eTaskId);
    if (error) throw error;
    tasks = tasks.filter(t=>t.id!==eTaskId);
    closeM('mTask');
    renderTasks();
    showT('タスクを削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

/* ===== 請求・明細書 送付管理（旧タスク管理タブ） =====
   取引先マスタを毎月の行として自動で並べ、請求金額・請求日はシステムの請求データから自動反映する。
   毎月手で入れるのは「提出日」「チェック担当者」など進行状況だけで済むようにしている。
   送付方式は取引先マスタ(clients.send_method)を既定値として引き継ぐ（月ごとに上書きも可能）。 */
/* ===== 取引先名の読み（カナ）自動生成 =====
   アイウエオ順の並び替え用。ひらがな→カタカナ変換と、社名によく出る語の辞書引きで組み立てる。
   人名・地名など辞書に無い漢字はそのまま残るため（読みを機械的に判定できない）、
   正しく並ばない会社は取引先・協力会社タブの「カナ」欄で手直しできるようにしている。 */
const KANA_CORP_RE = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|社会福祉法人|医療法人|\(株\)|（株）|\(有\)|（有）|㈱|㈲)/g;
// 社名に頻出する語。長い語から先に置換するため、登録順ではなく文字数順に並べ替えて使う
const KANA_DICT = {
  // 業種・組織
  '郵便局':'ユウビンキョク','営業所':'エイギョウショ','損害保険':'ソンガイホケン','郵便':'ユウビン','保険':'ホケン',
  '運輸':'ウンユ','運送':'ウンソウ','急送':'キュウソウ','急便':'キュウビン','通運':'ツウウン','物流':'ブツリュウ',
  '配送':'ハイソウ','輸送':'ユソウ','陸運':'リクウン','海運':'カイウン','航空':'コウクウ','交通':'コウツウ',
  '倉庫':'ソウコ','梱包':'コンポウ','包装':'ホウソウ','建設':'ケンセツ','工業':'コウギョウ','産業':'サンギョウ',
  '鉄工':'テッコウ','工場':'コウジョウ','商店':'ショウテン','商事':'ショウジ','商会':'ショウカイ','食品':'ショクヒン',
  '電機':'デンキ','電気':'デンキ','機械':'キカイ','製作所':'セイサクショ','製造':'セイゾウ','販売':'ハンバイ',
  '支店':'シテン','支社':'シシャ','本社':'ホンシャ','主管':'シュカン',
  // 地名（東北中心＋主要都市）
  '北海道':'ホッカイドウ','青森':'アオモリ','岩手':'イワテ','宮城':'ミヤギ','秋田':'アキタ','山形':'ヤマガタ',
  '福島':'フクシマ','仙台':'センダイ','盛岡':'モリオカ','釜石':'カマイシ','北上':'キタカミ','八戸':'ハチノヘ',
  '東京':'トウキョウ','大阪':'オオサカ','名古屋':'ナゴヤ','横浜':'ヨコハマ','川崎':'カワサキ','京都':'キョウト',
  '神戸':'コウベ','広島':'ヒロシマ','福岡':'フクオカ','新潟':'ニイガタ','千葉':'チバ','埼玉':'サイタマ',
  '神奈川':'カナガワ','栃木':'トチギ','群馬':'グンマ','群馬県':'グンマケン','茨城':'イバラキ','静岡':'シズオカ',
  '三多摩':'サンタマ','八潮':'ヤシオ','関東':'カントウ','東北':'トウホク','関西':'カンサイ','九州':'キュウシュウ',
  '日本':'ニホン','中央':'チュウオウ','中部':'チュウブ','西店':'ニシテン','東店':'ヒガシテン',
  // 序数・その他
  '第一':'ダイイチ','第二':'ダイニ','第三':'ダイサン','大町':'オオマチ','泉':'イズミ',
  '店':'テン','県':'ケン',
  // 業種・組織（追加分）
  '軽貨物':'ケイカモツ','貨物':'カモツ','自動車':'ジドウシャ','整備':'セイビ','鋼材':'コウザイ',
  '郵政':'ユウセイ','火災':'カサイ','海上':'カイジョウ','引越':'ヒッコシ','印刷所':'インサツショ','印刷':'インサツ',
  '鉄道':'テツドウ','眼科':'ガンカ','医院':'イイン','製作':'セイサク','創造':'ソウゾウ','最適':'サイテキ','急配':'キュウハイ',
  // 方角つきの拠点名（単漢字の誤変換を避けるため、複合語としてのみ登録する）
  '南営業所':'ミナミエイギョウショ','東営業所':'ヒガシエイギョウショ','北営業所':'キタエイギョウショ','西営業所':'ニシエイギョウショ',
  '南支店':'ミナミシテン','東支店':'ヒガシシテン','北支店':'キタシテン','西支店':'ニシシテン',
  '南店':'ミナミテン','東店':'ヒガシテン','北店':'キタテン',
  // 地名（追加分）
  '白石':'シライシ','古川':'フルカワ','相馬':'ソウマ','国見':'クニミ','岩沼':'イワヌマ','郡山':'コオリヤマ',
  '京橋':'キョウバシ','安城':'アンジョウ','長野':'ナガノ','愛知':'アイチ','仙南':'センナン','新仙台':'シンセンダイ',
  // 有名企業名・実データに出てくる社名（複合語として先に当てる）
  '佐川急便':'サガワキュウビン','福山通運':'フクヤマツウウン','第一貨物':'ダイイチカモツ','日本郵政':'ニホンユウセイ',
  '出光':'イデミツ','東亜':'トウア','中越':'チュウエツ','出前館':'デマエカン',
  '南東北':'ミナミトウホク','新宮城':'シンミヤギ','日本海':'ニホンカイ',
  '小田島':'オダジマ','中田':'ナカタ','落合':'オチアイ','同和':'ドウワ',
  '佐々木':'ササキ','徳永':'トクナガ','黒木':'クロキ','左近':'サコン','早川':'ハヤカワ','藤井':'フジイ','武田':'タケダ',
  // ※ 読みが複数ある名字（大和=ダイワ/ヤマト、小山=コヤマ/オヤマ 等）は誤変換を避けるため登録しない。
  //    未変換のまま「要修正」として表示され、カナ欄で正しい読みを入れられる。
  // ※ 単漢字（大・小・北・西など）は名字や地名の中で誤変換を起こすため辞書に入れない。
  //    読みを取り違えるより、未変換のまま「要修正」として気づける方が安全なため。
};
const KANA_DICT_KEYS = Object.keys(KANA_DICT).filter(k=>KANA_DICT[k]).sort((a,b)=>b.length-a.length);
function autoKana(name) {
  if (!name) return '';
  let s = String(name)
    .replace(/[　\s]+/g, '')            // 全角・半角スペースを除去
    .replace(KANA_CORP_RE, '')              // 株式会社などの法人格は並び順に影響させない
    .replace(/[（(].*?[)）]/g, '');          // （山形県）等の補足を除去
  // ひらがな → カタカナ
  s = s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  // 全角英数 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // 辞書引き（長い語を優先）
  KANA_DICT_KEYS.forEach(k => { if (s.includes(k)) s = s.split(k).join(KANA_DICT[k]); });
  return s.toUpperCase();
}
// 読みが未確定（漢字が残っている）かどうか。手直しが必要な取引先の目印に使う
const kanaNeedsFix = k => /[一-鿿]/.test(k || '');
// 並び替えキー: 手入力のカナ → 自動生成カナ の順で採用する
const clientKanaKey = c => (c.name_kana && c.name_kana.trim()) ? autoKana(c.name_kana) : autoKana(c.name);
// 取引先IDは「1, 10, 100, 11」のようにゼロ埋めされていないため、数値として比較する
// （文字列比較だと 1→10→100→11 の順になり、会社一覧の並びと食い違う）
/* 会社IDは「147」（親・単独）と「147-3」（親147の3番目の支店）の2つの形をとる。
   本体番号→枝番の順で比べ、親を必ず支店より先に並べる。
   英字混在・未設定のIDは数値IDの後ろにまとめる */
function parseClientNo(no) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(no||'').trim());
  return m ? {main: parseInt(m[1],10), branch: m[2] ? parseInt(m[2],10) : 0} : null;
}
function clientNoCompare(a, b) {
  const pa = parseClientNo(a.client_no), pb = parseClientNo(b.client_no);
  if (pa && pb) return pa.main - pb.main || pa.branch - pb.branch;
  if (pa) return -1;   // 数値IDを先に、英字混在・未設定を後ろに
  if (pb) return 1;
  return (a.client_no||'zzz').localeCompare(b.client_no||'zzz', 'ja');
}
// 支店を追加したときの次の枝番（親ID-N）。既に使われている枝番の最大＋1
function nextBranchNo(parentId) {
  const parent = lkCli(parentId);
  const main = parseClientNo(parent?.client_no)?.main;
  if (main == null) return '';
  const used = clients.filter(c => c.parent_id === parentId)
    .map(c => parseClientNo(c.client_no)).filter(x => x && x.main === main).map(x => x.branch);
  return `${main}-${(used.length ? Math.max(...used) : 0) + 1}`;
}

const BP_SEND_LABEL = {mail:'メール', fax:'FAX', post:'郵送', hand:'手渡し', web:'Web', mail_post:'メール＋郵送'};
// ステータスは請求書発行の実務の流れ順に並べる
// （未着手→作成中→確認待ち→発行済→送付待ち→送付済→完了）。
const BP_STATUS_LABEL = {
  todo:'未着手', drafting:'作成中', review:'確認待ち', issued:'発行済',
  awaiting_send:'送付待ち', sent:'送付済', done:'完了',
};
const BP_STATUS_COLOR = {
  todo:          ['--gray-bg','--gray-text'],
  drafting:      ['--purple-bg','--purple-text'],
  review:        ['--teal-bg','--teal-text'],
  issued:        ['--blue-bg','--blue-text'],
  awaiting_send: ['--amber-bg','--amber-text'],
  sent:          ['--green-bg','--green-text'],
  done:          ['--green-bg','--green-text'],
};
// 発行はしたがまだ送っていない状態（送付漏れの検出に使う）
const BP_UNSENT_STATUSES = ['issued','awaiting_send'];
// 提出期限のルール。取引先ごとに設定し、月が変わっても自動で日付を計算する
const BP_RULE_LABEL = {day:'毎月N日', month_end:'月末', next_month_day:'翌月N日', none:'期限なし'};
// 対象月(YYYY-MM)における提出期限を、取引先のルールから計算する。
// 月末に満たない日（2月31日など）は、その月の末日に丸める
function bpPlannedDate(cli, month) {
  const type = cli?.submit_rule_type;
  if (!type || type === 'none') return '';
  const [y, m] = month.split('-').map(Number);
  const lastDayOf = (yy, mm) => new Date(yy, mm, 0).getDate();
  if (type === 'month_end') return `${month}-${String(lastDayOf(y, m)).padStart(2,'0')}`;
  const day = cli.submit_rule_day || 1;
  if (type === 'next_month_day') {
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2,'0')}-${String(Math.min(day, lastDayOf(ny, nm))).padStart(2,'0')}`;
  }
  return `${month}-${String(Math.min(day, lastDayOf(y, m))).padStart(2,'0')}`;
}
// 実際に使う提出期限。月ごとの上書き(planned_date)があればそれを優先する
function bpEffectiveDue(b, cli, month) {
  return b?.planned_date || bpPlannedDate(cli, month);
}
function bpRuleText(cli) {
  const t = cli?.submit_rule_type;
  if (!t || t === 'none') return '期限なし';
  if (t === 'month_end') return '月末';
  if (t === 'next_month_day') return `翌月${cli.submit_rule_day || 1}日`;
  return `毎月${cli.submit_rule_day || 1}日`;
}
// 期限超過＝提出日が未入力かつ完了しておらず、期限を過ぎている
function bpIsOverdue(b, cli, month) {
  if (b?.submitted_date || b?.status === 'done') return false;
  const due = bpEffectiveDue(b, cli, month);
  return !!due && due < fmtLocalDate(new Date());
}
// 未送付＝発行済・送付待ちのまま提出日が入っていない
function bpIsUnsent(b) {
  return BP_UNSENT_STATUSES.includes(b?.status) && !b?.submitted_date;
}
let billingProgress = [];   // 表示中の月のbilling_progress行
let bpLoadedMonth = null;

function bpCurrentMonth() {
  const el = document.getElementById('bpMonth');
  if (el?.value) return el.value;
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}
function bpShiftMonth(delta) {
  const [y,m] = bpCurrentMonth().split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  const v = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const el = document.getElementById('bpMonth');
  if (el) el.value = v;
  return v;
}
function bpPrevMonth(){ bpShiftMonth(-1); onBpMonthChange(); }
function bpNextMonth(){ bpShiftMonth(1); onBpMonthChange(); }
function onBpMonthChange(){ loadBillingProgress().then(()=>renderBillingProgress()); }

async function initBillingProgress() {
  const el = document.getElementById('bpMonth');
  if (el && !el.value) {
    // 請求業務は前月分を当月に処理することが多いため、既定は前月にしておく
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth()-1, 1);
    el.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
}
async function loadBillingProgress() {
  if (!sb) return;
  const month = bpCurrentMonth();
  try {
    const {data, error} = await sb.from('billing_progress').select('*').eq('month', month);
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) { billingProgress=[]; return; }
      throw error;
    }
    billingProgress = data || [];
    bpLoadedMonth = month;
  } catch(e) { console.warn('loadBillingProgress:', e.message); billingProgress = []; }
}

// その月の請求データ（invoices）を取引先ごとに集計。cli_id → {amt, cnt, lastDate}
function bpInvoiceSummary(month) {
  const map = {};
  recs.forEach(r => {
    if (!r.date || !r.date.startsWith(month) || r.cli == null) return;
    const k = String(r.cli);
    if (!map[k]) map[k] = {amt:0, cnt:0, lastDate:''};
    map[k].amt += totR(r, taxMode);
    map[k].cnt++;
    if (r.date > map[k].lastDate) map[k].lastDate = r.date;
  });
  return map;
}
const bpRow = cliId => billingProgress.find(b => String(b.cli_id) === String(cliId));

function renderBillingProgress() {
  const area = document.getElementById('bpArea');
  const sumEl = document.getElementById('bpSummary');
  if (!area) return;
  // 再描画で表を作り直すため、選択中の行を先に控えておく
  const keepSel = new Set(Array.from(document.querySelectorAll('.bpRowChk:checked')).map(el => el.value));
  const month = bpCurrentMonth();
  const invMap = bpInvoiceSummary(month);
  const statusF = document.getElementById('bpStatusFilter')?.value || '';
  const q = nm(document.getElementById('bpSearch')?.value || '');

  // 並び順: ID順（数値として比較）/ アイウエオ順（カナ欄→自動生成カナ）
  const sortMode = document.getElementById('bpSort')?.value || 'id';
  const sortFn = sortMode === 'name'
    ? (a,b) => clientKanaKey(a).localeCompare(clientKanaKey(b), 'ja') || clientNoCompare(a,b)
    : clientNoCompare;

  // その月の請求実績が無い取引先は既定で隠す（毎月使う取引先だけに絞って見られるようにする）。
  // ただし手動で追加した取引先(manual)は実績が無くても必ず残す
  const dataF = document.getElementById('bpDataFilter')?.value ?? 'hasdata';
  let base = [...clients].sort(sortFn);
  if (dataF === 'hasdata') base = base.filter(c => invMap[String(c.id)] || bpRow(c.id)?.manual);

  const rowOf = c => bpRow(c.id) || {};
  const effStatus = c => rowOf(c).status || 'todo';

  let list = base;
  // 検索は親会社名でも支店がヒットするようにする
  if (q) list = list.filter(c => nm(cliSearchName(c)).includes(q) || nm(c.short||'').includes(q));
  if (statusF === 'open')         list = list.filter(c => effStatus(c) !== 'done');
  else if (statusF === 'done')    list = list.filter(c => effStatus(c) === 'done');
  else if (statusF === 'overdue') list = list.filter(c => bpIsOverdue(rowOf(c), c, month));
  else if (statusF === 'unsent')  list = list.filter(c => bpIsUnsent(rowOf(c)));

  // 進捗・件数は表示中の母集団（実績ありのみ等）から算出する
  const targets = base;
  const doneCnt    = targets.filter(c => effStatus(c) === 'done').length;
  const overdueCnt = targets.filter(c => bpIsOverdue(rowOf(c), c, month)).length;
  const unsentCnt  = targets.filter(c => bpIsUnsent(rowOf(c))).length;
  const pct = targets.length ? Math.round(doneCnt / targets.length * 1000)/10 : 0;
  // 請求合計は請求データの自動集計に、手動追加した行の手入力金額を足す
  const manualAmt = billingProgress.reduce((a,b)=>a+(b.manual&&!invMap[String(b.cli_id)]?(+b.manual_amt||0):0), 0);
  const totalAmt = Object.values(invMap).reduce((a,v)=>a+v.amt, 0) + manualAmt;
  // 件数つきの絞り込みタブ。今どの状態が何件あるかを一目で分かるようにする
  const tabs = [
    {id:'',        label:'すべて',   n:targets.length},
    {id:'open',    label:'未完了',   n:targets.length-doneCnt},
    {id:'overdue', label:'期限超過', n:overdueCnt, warn:true},
    {id:'unsent',  label:'未送付',   n:unsentCnt,  warn:true},
    {id:'done',    label:'完了',     n:doneCnt},
  ];
  if (sumEl) {
    sumEl.innerHTML = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;margin-bottom:7px">
      <span>対象 <b>${targets.length}</b>件${dataF==='hasdata'?`（実績なし ${clients.length-base.length}件を非表示）`:''}</span>
      <span>完了 <b style="color:var(--green-text)">${doneCnt}</b> / 未完了 <b style="color:var(--amber-text)">${targets.length-doneCnt}</b></span>
      ${overdueCnt?`<span style="color:var(--red-text);font-weight:600">⚠ 期限超過 ${overdueCnt}件</span>`:''}
      ${unsentCnt?`<span style="color:var(--amber-text);font-weight:600">未送付 ${unsentCnt}件</span>`:''}
      <span>請求合計 <b>${yen(totalAmt)}</b></span>
      <span style="flex:1;min-width:120px;display:flex;align-items:center;gap:6px">
        <span style="flex:1;height:7px;background:var(--border);border-radius:99px;overflow:hidden;display:inline-block">
          <span style="display:block;height:100%;width:${pct}%;background:var(--green)"></span>
        </span><b>${pct}%</b>
      </span></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${tabs.map(t=>{
        const on = statusF === t.id;
        const col = t.warn && t.n ? 'var(--red-text)' : on ? 'var(--blue-text)' : 'var(--text2)';
        return `<button class="btn sml" onclick="setBpStatusFilter('${t.id}')" style="padding:3px 10px;font-size:11px;${on?'background:var(--blue-bg);border-color:var(--blue);font-weight:700;':''}color:${col}">${t.label} ${t.n}</button>`;
      }).join('')}</div>`;
  }

  if (!clients.length) { area.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:14px 0">取引先が登録されていません（取引先管理から登録してください）</div>'; return; }
  if (!list.length) {
    const hint = (dataF === 'hasdata' && !base.length)
      ? 'この月に請求実績のある取引先がありません（「実績なしも表示」に切り替えると全取引先を表示できます）'
      : '該当する取引先がありません';
    area.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:14px 0">${hint}</div>`; return;
  }

  const th = 'padding:6px 8px;border:0.5px solid var(--border);background:var(--bg2);font-size:10.5px;font-weight:600;white-space:nowrap;position:sticky;top:0';
  const td = 'padding:4px 6px;border:0.5px solid var(--border);font-size:11.5px';
  const inp = 'padding:3px 5px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)';
  const staff = staffMembers();
  const staffOpts = (sel) => '<option value="">未入力</option>' + staff.map(u=>`<option value="${escHtml(u.id)}" ${String(u.id)===String(sel||'')?'selected':''}>${escHtml(u.name)}</option>`).join('');

  area.innerHTML = `<div id="bpBulkBar" style="display:none;align-items:center;gap:8px;padding:6px 10px;margin-bottom:6px;background:var(--blue-bg);border-radius:var(--radius);font-size:11.5px">
      <span id="bpBulkCount" style="color:var(--blue-text);font-weight:600"></span>
      <button class="btn sml" onclick="carryOverBpSelected()" title="選択した取引先を翌月の一覧に追加します（担当者・方法は引き継ぎ、進捗はリセット）">→ 翌月へ繰り越し</button>
      ${me && me.role !== 'viewer' ? `<button class="btn sml" onclick="deleteBpSelected()" style="color:var(--red-text)" title="手動で追加した行のみ削除できます">🗑 選択を削除</button>` : ''}
      <button class="btn sml" onclick="toggleBpRowAll(false)" style="margin-left:auto">選択を解除</button>
    </div>
    <table style="width:100%;border-collapse:collapse;min-width:1000px">
    <thead><tr>
      <th style="${th};width:26px"><input type="checkbox" id="bpRowChkAll" onchange="toggleBpRowAll(this.checked)" title="表示中の全行を選択" style="width:14px;height:14px;cursor:pointer"></th>
      <th style="${th};text-align:left">取引先</th>
      <th style="${th};text-align:right">請求金額<div style="font-weight:400;color:var(--text2)">自動</div></th>
      <th style="${th}">請求日<div style="font-weight:400;color:var(--text2)">自動</div></th>
      <th style="${th}">ステータス</th>
      <th style="${th}">提出期限<div style="font-weight:400;color:var(--text2)">ルール</div></th>
      <th style="${th}">到着方法</th>
      <th style="${th}">明細到着日</th>
      <th style="${th}">提出方法</th>
      <th style="${th}">明細提出日</th>
      <th style="${th}">担当者</th>
      <th style="${th}">チェック</th>
      <th style="${th}">チェック担当者</th>
      <th style="${th};text-align:left">送付メモ</th>
      <th style="${th};text-align:left">備考</th>
    </tr></thead>
    <tbody>${(() => {
    // 1行分のHTML。indent=true は親会社の下にぶら下がる支店・営業所
    const rowHtml = (c, indent) => {
      const b = bpRow(c.id) || {};
      const inv = invMap[String(c.id)];
      const st = b.status || 'todo';
      const sc = BP_STATUS_COLOR[st] || BP_STATUS_COLOR.todo;
      // 送付方式は月次の指定 → 取引先マスタの既定値 の順で採用する
      const sm = b.send_method || c.send_method || '';
      const due = bpEffectiveDue(b, c, month);
      const overdue = bpIsOverdue(b, c, month);
      return `<tr>
        <td style="${td};text-align:center"><input type="checkbox" class="bpRowChk" value="${c.id}" data-manual="${b.manual?1:0}" onchange="updateBpBulkBar()" style="width:14px;height:14px;cursor:pointer"></td>
        <td style="${td};text-align:left;white-space:nowrap${indent?';padding-left:18px':''}">
          ${indent?'<span style="color:var(--text3)">└ </span>':''}<span style="font-weight:600">${escHtml(c.name)}</span>
          ${c.client_no?`<span style="font-size:9.5px;color:var(--text2)"> ID:${escHtml(c.client_no)}</span>`:''}
          ${inv?`<span class="bdg" style="background:var(--blue-bg);color:var(--blue-text);margin-left:4px">${inv.cnt}件</span>`:'<span style="font-size:9.5px;color:var(--text2);margin-left:4px">実績なし</span>'}
          ${b.manual&&!inv?`<span class="bdg" style="background:var(--amber-bg);color:var(--amber-text);margin-left:4px">手動</span><button class="ibtn" title="この行を一覧から外す" onclick="removeBpManual(${c.id})" style="margin-left:2px">🗑</button>`:''}
          ${sortMode==='name'?(()=>{
            const k = clientKanaKey(c);
            const bad = kanaNeedsFix(k);
            return `<div style="font-size:9.5px;color:var(${bad?'--amber-text':'--text2'})" title="${bad?'読みを判定できない漢字があります。取引先管理のカナ欄で修正できます':'並び替えに使っている読み'}">${bad?'⚠ ':''}${escHtml(k)}${c.name_kana?'':'（自動）'}</div>`;
          })():''}
        </td>
        <td style="${td};text-align:right;white-space:nowrap">${
          inv ? yen(inv.amt)
              : (b.manual
                  ? `<input type="number" step="1" style="${inp};width:96px;text-align:right" value="${b.manual_amt??''}" placeholder="金額を入力" title="手動追加した行の請求金額。請求合計にも反映されます" onchange="saveBpField(${c.id},'manual_amt',this.value)">`
                  : '—')
        }</td>
        <td style="${td};text-align:center;white-space:nowrap;color:var(--text2)">${inv?inv.lastDate:'—'}</td>
        <td style="${td};text-align:center">
          <select style="${inp};background:var(${sc[0]});color:var(${sc[1]});font-weight:600" onchange="saveBpField(${c.id},'status',this.value)">
            ${Object.entries(BP_STATUS_LABEL).map(([k,v])=>`<option value="${k}" ${st===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td style="${td};text-align:center;white-space:nowrap">
          <input type="date" style="${inp};${overdue?'color:var(--red-text);font-weight:700;border-color:var(--red)':''}" value="${due||''}" title="取引先設定の提出ルールから自動計算されます。ここで直接入れると、その月だけ上書きできます" onchange="saveBpField(${c.id},'planned_date',this.value)">
          <div style="font-size:9px;color:var(${overdue?'--red-text':'--text2'})">${overdue?'⚠ 期限超過':escHtml(bpRuleText(c))}</div>
        </td>
        <td style="${td};text-align:center">
          <select style="${inp}" onchange="saveBpField(${c.id},'arrival_method',this.value)">
            <option value="">未設定</option>
            ${Object.entries(BP_SEND_LABEL).map(([k,v])=>`<option value="${k}" ${(b.arrival_method||'')===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td style="${td};text-align:center"><input type="date" style="${inp}" value="${b.arrival_date||''}" onchange="saveBpField(${c.id},'arrival_date',this.value)"></td>
        <td style="${td};text-align:center">
          <select style="${inp}" onchange="saveBpField(${c.id},'send_method',this.value)">
            <option value="">未設定</option>
            ${Object.entries(BP_SEND_LABEL).map(([k,v])=>`<option value="${k}" ${sm===k?'selected':''}>${v}</option>`).join('')}
          </select>
          ${!b.send_method && c.send_method?'<div style="font-size:9px;color:var(--text2)">マスタ既定</div>':''}
        </td>
        <td style="${td};text-align:center"><input type="date" style="${inp}" value="${b.submitted_date||''}" onchange="saveBpField(${c.id},'submitted_date',this.value)"></td>
        <td style="${td};text-align:center"><select style="${inp}" onchange="saveBpField(${c.id},'assignee_user_id',this.value)">${staffOpts(b.assignee_user_id)}</select></td>
        <td style="${td};text-align:center"><input type="checkbox" ${b.checked?'checked':''} onchange="saveBpField(${c.id},'checked',this.checked)" title="チェックが済んだらレ点を付けます" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)"></td>
        <td style="${td};text-align:center"><select style="${inp}" onchange="saveBpField(${c.id},'check_user_id',this.value)">${staffOpts(b.check_user_id)}</select></td>
        <td style="${td};max-width:150px">${c.send_memo
          ? `<span style="font-size:10.5px;color:var(--text2);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(c.send_memo)}">${escHtml(c.send_memo)}</span>`
          : '<span style="font-size:10px;color:var(--text3)">—</span>'}</td>
        <td style="${td}"><input type="text" style="${inp};width:100%;min-width:110px" value="${escHtml(b.note||'')}" placeholder="—" onchange="saveBpField(${c.id},'note',this.value)"></td>
      </tr>`;
    };
    // 本社・支店をまとめ、深刻な状態のグループを上に出す
    const sevOf = c => {
      const b = bpRow(c.id) || {};
      if (bpIsOverdue(b, c, month)) return -1;
      if (b.status === 'done') return 90;
      return Object.keys(BP_STATUS_LABEL).indexOf(b.status || 'todo');
    };
    return groupByRootClient(list, sevOf).map(g => {
      if (!g.isGroup) return g.items.map(c => rowHtml(c, false)).join('');
      const collapsed = !!bpCollapsed[g.rootId];
      const tg = g.items;
      const doneN = tg.filter(c => (bpRow(c.id)||{}).status === 'done').length;
      const overN = tg.filter(c => bpIsOverdue(bpRow(c.id)||{}, c, month)).length;
      return `<tr style="background:var(--bg2)">
        <td style="${td};text-align:center"></td>
        <td style="${td};text-align:left;white-space:nowrap;font-weight:700;cursor:pointer" colspan="14" onclick="toggleBpGroup(${g.rootId})" title="クリックで折りたたみ／展開">
          <span style="color:var(--text2);display:inline-block;width:12px">${collapsed?'▸':'▾'}</span>
          ${escHtml(g.root?.name || '—')}
          <span style="font-size:10px;color:var(--text2);font-weight:400;margin-left:6px">
            全${g.items.length}件・未完了${tg.length-doneN}件${overN?`　<span style="color:var(--red-text);font-weight:700">⚠ 期限超過${overN}件</span>`:''}
          </span>
        </td>
      </tr>` + (collapsed ? '' : g.items.map(c => rowHtml(c, true)).join(''));
    }).join('');
  })()}</tbody></table>`;

  // 金額入力などで再描画されても行の選択が消えないよう復元する
  if (keepSel.size) {
    document.querySelectorAll('.bpRowChk').forEach(el => { if (keepSel.has(el.value)) el.checked = true; });
    updateBpBulkBar();
  }
}
const renderBillingProgressDebounced = debounce(renderBillingProgress, 250);

// 1セルの変更をその場で保存する（取引先×月の行が無ければ作る）。
// 「明細提出日」を入れたらステータスを自動で完了にし、二重入力を省く。
async function saveBpField(cliId, field, value) {
  if (!sb) return;
  const month = bpCurrentMonth();
  // 金額は数値列、チェックは真偽値のため、それぞれ型を整えてから保存する
  const patch = { [field]: (typeof value === 'boolean') ? value
    : value === '' ? null
    : (field === 'manual_amt' ? Math.round(+value) || null : value) };
  // 提出日を入れたら送付済に進める。
  // 発行前（未着手・作成中・確認待ち）から一足飛びに完了にはせず、実態に合わせて「送付済」にする
  if (field === 'submitted_date' && value) {
    const cur = bpRow(cliId);
    if (!['sent','done'].includes(cur?.status || 'todo')) patch.status = 'sent';
  }
  try {
    const {data, error} = await sb.from('billing_progress')
      .upsert({ month, cli_id: cliId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'month,cli_id' })
      .select().single();
    if (error) throw error;
    const idx = billingProgress.findIndex(b => String(b.cli_id) === String(cliId));
    if (idx >= 0) billingProgress[idx] = data; else billingProgress.push(data);
    renderBillingProgress();
    const cli = clients.find(c=>c.id===cliId);
    addLog('送付管理更新', `${month} ${cli?cli.name:`cli:${cliId}`} ${field}=${value||'（クリア）'}`);
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
}

// タスク管理に取引先を手動追加する（請求実績が無い取引先を一覧に出したい場合）。
// 候補は「まだこの月の一覧に出ていない取引先」に絞る
function openBpAddM() {
  document.getElementById('bpAddSearch').value = '';
  document.getElementById('bpAddErr').textContent = '';
  renderBpAddList();
  document.getElementById('mBpAdd').classList.add('on');
}
// 追加候補＝まだこの月の一覧に出ていない取引先（実績あり・追加済みは除外）。
// チェック状態は絞り込みで再描画しても消えないよう、既存のチェックを引き継ぐ
function renderBpAddList() {
  const month = bpCurrentMonth();
  const invMap = bpInvoiceSummary(month);
  const checked = new Set(Array.from(document.querySelectorAll('.bpAddChk:checked')).map(el=>el.value));
  const q = nm(document.getElementById('bpAddSearch')?.value || '');
  const cand = [...clients]
    .filter(c => !invMap[String(c.id)] && !bpRow(c.id)?.manual)
    .filter(c => !q || nm(c.name).includes(q) || nm(c.short||'').includes(q))
    .sort(clientNoCompare);
  const el = document.getElementById('bpAddList');
  el.innerHTML = cand.length
    ? cand.map(c=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="bpAddChk" value="${c.id}" ${checked.has(String(c.id))?'checked':''} onchange="updateBpAddCount()" style="width:auto">${escHtml(c.name)}${c.client_no?`<span style="color:var(--text2);font-size:10.5px">（ID:${escHtml(c.client_no)}）</span>`:''}</label>`).join('')
    : '<div style="font-size:11px;color:var(--text2)">該当する取引先がありません（すべて一覧に表示済みです）</div>';
  updateBpAddCount();
}
function toggleBpAddAll(on) {
  document.querySelectorAll('.bpAddChk').forEach(el => el.checked = on);
  updateBpAddCount();
}
function updateBpAddCount() {
  const n = document.querySelectorAll('.bpAddChk:checked').length;
  const el = document.getElementById('bpAddCount');
  if (el) el.textContent = n ? `${n}件選択中` : '';
}
async function submitBpAdd() {
  const ids = Array.from(document.querySelectorAll('.bpAddChk:checked')).map(el=>+el.value);
  const errEl = document.getElementById('bpAddErr');
  errEl.textContent = '';
  if (!ids.length) { errEl.textContent = '取引先を選択してください'; return; }
  const month = bpCurrentMonth();
  showLoad(true);
  try {
    const rows = ids.map(cli_id => ({ month, cli_id, manual: true, updated_at: new Date().toISOString() }));
    const {data, error} = await sb.from('billing_progress')
      .upsert(rows, { onConflict: 'month,cli_id' }).select();
    if (error) throw error;
    (data||[]).forEach(r => {
      const idx = billingProgress.findIndex(b => String(b.cli_id) === String(r.cli_id));
      if (idx >= 0) billingProgress[idx] = r; else billingProgress.push(r);
    });
    closeM('mBpAdd');
    renderBillingProgress();
    addLog('タスク管理 取引先追加', `${month} ${ids.length}件`);
    showT(`${ids.length}件を一覧に追加しました`);
  } catch(e) { errEl.textContent = '追加エラー: ' + e.message; }
  showLoad(false);
}
/* ===== タスク管理のサブタブ（1つのナビタブの中で4画面を切り替える） ===== */
const TASK_SUBTABS = [
  {n:31, label:'🏠 TOP'},
  {n:29, label:'✅ 請求書発行'},
  {n:32, label:'💴 支払明細書発行'},
  {n:33, label:'👤 個人タスク'},
];
// サブタブから移動するときは、ナビ上の「タスク管理」タブを選択状態のままにする
function goTaskPage(n) { goPage(n, document.getElementById('nt31')); }
// 4画面それぞれの先頭にある .task-subnav へ、共通のサブタブ行を描画する
function renderTaskSubnav(current) {
  document.querySelectorAll('.task-subnav').forEach(el => {
    el.innerHTML = TASK_SUBTABS.map(t =>
      `<div class="ntab${t.n===current?' on':''}" onclick="goTaskPage(${t.n})">${t.label}</div>`).join('');
  });
}

/* ===== 取引先の親子（本社・支店・営業所） ===== */
// 親をたどって最上位の取引先IDを返す（循環参照が混入しても止まるよう回数で打ち切る）
function cliRootId(cliId) {
  let c = clients.find(x => x.id === cliId), guard = 0;
  while (c && c.parent_id && guard++ < 6) {
    const p = clients.find(x => x.id === c.parent_id);
    if (!p) break;
    c = p;
  }
  return c ? c.id : cliId;
}
function cliHasChildren(cliId) { return clients.some(c => c.parent_id === cliId); }
// 支店行は自分の名称（「仙台支店」など）しか持たないため、親会社名で検索してもヒットするよう
// 検索用の文字列は「親会社名＋自分の名称」を連結したものにする
function cliSearchName(c) {
  if (!c) return '';
  const p = c.parent_id ? clients.find(x => x.id === c.parent_id) : null;
  return (p ? p.name + ' ' : '') + c.name;
}
// 行を親会社ごとにまとめる。深刻な状態（期限超過→未完了→完了）のグループを上に出す
function groupByRootClient(rows, sevOf) {
  const byRoot = {};
  rows.forEach(r => { const rid = cliRootId(r.id); (byRoot[rid] = byRoot[rid] || []).push(r); });
  return Object.keys(byRoot).map(rid => {
    const rootId = +rid;
    const items = byRoot[rid].slice().sort((a, b) =>
      (a.id === rootId ? -1 : b.id === rootId ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'ja'));
    return {
      rootId, root: clients.find(c => c.id === rootId) || null, items,
      severity: Math.min(...items.map(sevOf)),
      isGroup: items.length > 1 || cliHasChildren(rootId),
    };
  }).sort((a, b) => a.severity - b.severity
    || String(a.root?.name || '').localeCompare(String(b.root?.name || ''), 'ja'));
}
// 折りたたみ中のグループ（画面を再描画しても保つ）
let bpCollapsed = {};
function toggleBpGroup(rootId) { bpCollapsed[rootId] = !bpCollapsed[rootId]; renderBillingProgress(); }

// 集計欄の件数つきタブから絞り込みを切り替える（上のプルダウンと同じ状態を共有する）
function setBpStatusFilter(v) {
  const sel = document.getElementById('bpStatusFilter');
  if (sel) sel.value = v;
  renderBillingProgress();
}

/* ===== タスク管理の行選択（一括削除・翌月繰り越し） ===== */
function toggleBpRowAll(on) {
  document.querySelectorAll('.bpRowChk').forEach(el => el.checked = on);
  const all = document.getElementById('bpRowChkAll');
  if (all) all.checked = on;
  updateBpBulkBar();
}
function bpSelectedIds() {
  return Array.from(document.querySelectorAll('.bpRowChk:checked')).map(el => +el.value);
}
function updateBpBulkBar() {
  const sel = Array.from(document.querySelectorAll('.bpRowChk:checked'));
  const bar = document.getElementById('bpBulkBar');
  const cnt = document.getElementById('bpBulkCount');
  if (!bar) return;
  bar.style.display = sel.length ? 'flex' : 'none';
  if (cnt) {
    const manualN = sel.filter(el => el.dataset.manual === '1').length;
    cnt.textContent = `${sel.length}件選択中` + (manualN < sel.length ? `（うち手動追加 ${manualN}件）` : '');
  }
  const all = document.getElementById('bpRowChkAll');
  if (all) all.checked = sel.length > 0 && sel.length === document.querySelectorAll('.bpRowChk').length;
}
// 選択した行のうち、手動で追加したものだけを削除する。
// 請求実績から自動で出ている行は消しても再表示されるため対象外にする
async function deleteBpSelected() {
  const sel = Array.from(document.querySelectorAll('.bpRowChk:checked'));
  const manualIds = sel.filter(el => el.dataset.manual === '1').map(el => +el.value);
  const skipped = sel.length - manualIds.length;
  if (!manualIds.length) {
    alert(`削除できるのは手動で追加した行だけです。\n選択中の${sel.length}件はいずれも請求実績から自動表示されている行です。`);
    return;
  }
  const names = manualIds.map(id => clients.find(c=>c.id===id)?.name || id).join('、');
  if (!confirm(`次の${manualIds.length}件をこの月の一覧から外しますか？\n\n${names}\n\n入力済みのステータス・担当者・日付も削除されます。`
      + (skipped ? `\n\n※ 選択中の${skipped}件は請求実績があるため削除されません。` : ''))) return;
  const month = bpCurrentMonth();
  showLoad(true);
  try {
    const {error} = await sb.from('billing_progress').delete().eq('month', month).in('cli_id', manualIds);
    if (error) throw error;
    billingProgress = billingProgress.filter(b => !manualIds.includes(+b.cli_id));
    renderBillingProgress();
    addLog('タスク管理 取引先削除', `${month} ${manualIds.length}件`);
    showT(`${manualIds.length}件を一覧から外しました`);
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}
// 選択した取引先を翌月の一覧へ繰り越す。
// 担当者・到着方法・提出方法は引き継ぎ、ステータス・日付・チェック・金額・備考はリセットする
// （毎月の設定は同じでも、その月の進捗は最初からやり直すため）。繰り越し元の行は今月に残す
async function carryOverBpSelected() {
  const ids = bpSelectedIds();
  if (!ids.length) return;
  const month = bpCurrentMonth();
  const [y, m] = month.split('-').map(Number);
  const next = new Date(y, m, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
  const names = ids.map(id => clients.find(c=>c.id===id)?.name || id).join('、');
  if (!confirm(`次の${ids.length}件を ${nextMonth} の一覧へ繰り越しますか？\n\n${names}\n\n`
    + `担当者・チェック担当者・到着方法・提出方法を引き継ぎます。\n`
    + `ステータスは「未着手」に戻り、日付・チェック・金額・備考は空になります。\n`
    + `${month} の行はそのまま残ります。`)) return;
  showLoad(true);
  try {
    const rows = ids.map(cli_id => {
      const b = billingProgress.find(x => String(x.cli_id) === String(cli_id)) || {};
      return {
        month: nextMonth, cli_id, manual: true,
        assignee_user_id: b.assignee_user_id ?? null,
        check_user_id: b.check_user_id ?? null,
        arrival_method: b.arrival_method ?? null,
        send_method: b.send_method ?? null,
        // 提出期限は取引先の提出ルールから翌月分が自動計算されるため、月ごとの上書きは引き継がない
        status: 'todo', arrival_date: null, submitted_date: null, planned_date: null,
        checked: false, manual_amt: null, note: null,
        updated_at: new Date().toISOString(),
      };
    });
    const {error} = await sb.from('billing_progress').upsert(rows, { onConflict: 'month,cli_id' });
    if (error) throw error;
    addLog('タスク管理 翌月繰り越し', `${month} → ${nextMonth} ${ids.length}件`);
    showT(`${ids.length}件を ${nextMonth} へ繰り越しました`);
    toggleBpRowAll(false);
  } catch(e) { showT('繰り越しエラー: '+e.message, 'ter'); }
  showLoad(false);
}

// 手動追加した行を一覧から外す（入力済みの担当者・日付などもまとめて消えるため確認する）
async function removeBpManual(cliId) {
  const cli = clients.find(c=>c.id===cliId);
  if (!confirm(`「${cli?cli.name:cliId}」をこの月の一覧から外しますか？\n入力済みのステータス・担当者・日付も削除されます。`)) return;
  const month = bpCurrentMonth();
  showLoad(true);
  try {
    const {error} = await sb.from('billing_progress').delete().eq('month', month).eq('cli_id', cliId);
    if (error) throw error;
    billingProgress = billingProgress.filter(b => String(b.cli_id) !== String(cliId));
    renderBillingProgress();
    addLog('タスク管理 取引先削除', `${month} ${cli?cli.name:`cli:${cliId}`}`);
    showT('一覧から外しました');
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* ============================================================
   個人タスク（pg33）— 会社共通業務とは別に、担当者・依頼者・期限で管理する
   ============================================================ */
let personalTasks = [];
let ePtId = null;
const PT_STATUS_LABEL = {not_started:'未着手', in_progress:'進行中', review:'確認待ち', done:'完了'};
const PT_STATUS_COLOR = {
  not_started: ['--gray-bg','--gray-text'],
  in_progress: ['--blue-bg','--blue-text'],
  review:      ['--teal-bg','--teal-text'],
  done:        ['--green-bg','--green-text'],
};
function initPersonalTasks() {
  const sel = document.getElementById('ptUser');
  if (sel) {
    const cur = sel.value || (me?.id ?? '');
    sel.innerHTML = staffMembers().map(u=>`<option value="${escHtml(u.id)}" ${String(u.id)===String(cur)?'selected':''}>${escHtml(u.name)}</option>`).join('');
  }
  const btn = document.getElementById('ptAddBtn');
  if (btn) btn.classList.toggle('hide', !(me && me.role !== 'viewer'));
}
async function loadPersonalTasks() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('tasks').select('*').order('due_date', {nullsFirst:false}).order('id'));
    if (error) { if (/does not exist|relation/.test(error.message)) { personalTasks=[]; return; } throw error; }
    personalTasks = data || [];
  } catch(e) { console.warn('loadPersonalTasks:', e.message); personalTasks = []; }
}
/* 他人から自分あてに来た依頼＝担当者が自分で、依頼者が自分以外の未完了タスク。
   自分で自分に立てたメモは依頼ではないので数えない */
// 依頼＝依頼者が担当者と別のタスク。完了済みでも依頼だったことは変わらない
function ptIsRequest(t) {
  return t.requester_user_id != null
    && String(t.requester_user_id) !== String(t.assignee_user_id||'');
}
// uid あての「まだ対応が要る」依頼＝未完了で、その人が担当のもの
function ptIsRequestTo(t, uid) {
  return t.status !== 'done' && String(t.assignee_user_id||'') === String(uid) && ptIsRequest(t);
}
/* お知らせに出すのは「まだ受け取り側がレ点を付けていない依頼」だけ。
   レ点を付けた時点で確認済みとみなし、ダッシュボードの警告から消える */
function ptIncomingRequests() {
  if (!me) return [];
  return personalTasks.filter(t => ptIsRequestTo(t, me.id) && !t.acknowledged_at);
}

// 依頼日時・完了日時の表示（「09/03 14:05」の形。年は今年なら省く）
function ptStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0'), mi = String(d.getMinutes()).padStart(2,'0');
  const y = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}/`;
  return `${y}${mm}/${dd} ${hh}:${mi}`;
}

const ptIsOverdue = t => !!t.due_date && t.due_date < fmtLocalDate(new Date()) && t.status !== 'done';
const ptIsToday   = t => t.due_date === fmtLocalDate(new Date()) && t.status !== 'done';
/* 個人タスクは「自分の分（担当が自分）」と「他人の分（担当が自分以外）」の二段で見せる。
   上段は自分がやること、下段は自分が誰かに頼んでいることが分かるようにしている。
   ptUserで視点を切り替えられるので、管理者が他の人の状況を見ることもできる。 */
function renderPersonalTasks() {
  const area = document.getElementById('ptArea');
  const sumEl = document.getElementById('ptSummary');
  if (!area) return;
  const uid   = document.getElementById('ptUser')?.value || me?.id || '';
  const scope = document.getElementById('ptOtherScope')?.value || 'all';
  const q     = nm(document.getElementById('ptSearch')?.value || '');
  const uname = id => users.find(u=>String(u.id)===String(id))?.name || '—';
  const selfName = uname(uid);

  const bySearch = t => !q || nm(t.title||'').includes(q) || nm(t.note||'').includes(q);
  const mine   = personalTasks.filter(t => String(t.assignee_user_id||'') === String(uid)).filter(bySearch);
  const others = personalTasks.filter(t => String(t.assignee_user_id||'') !== String(uid))
    .filter(t => scope === 'all' || String(t.requester_user_id||'') === String(uid))
    .filter(bySearch);

  // 未確認の依頼＝自分あてに来ていて、まだレ点を付けていないもの
  const unack = mine.filter(t => ptIsRequestTo(t, uid) && !t.acknowledged_at).length;

  if (sumEl) {
    const all = [...mine, ...others];
    const overdueN = all.filter(ptIsOverdue).length;
    const todayN   = all.filter(ptIsToday).length;
    sumEl.innerHTML = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px">
      <span>自分の分 <b>${mine.length}</b>件（未完了 <b style="color:var(--amber-text)">${mine.filter(t=>t.status!=='done').length}</b>）</span>
      <span>他人の分 <b>${others.length}</b>件（未完了 <b style="color:var(--amber-text)">${others.filter(t=>t.status!=='done').length}</b>）</span>
      ${unack?`<span style="color:var(--red-text);font-weight:600">🙋 未確認の依頼 ${unack}件</span>`:''}
      ${overdueN?`<span style="color:var(--red-text);font-weight:600">⚠ 期限超過 ${overdueN}件</span>`:''}
      ${todayN?`<span style="color:var(--amber-text);font-weight:600">本日期限 ${todayN}件</span>`:''}
    </div>`;
  }

  const th = 'padding:6px 8px;border:0.5px solid var(--border);background:var(--bg2);font-size:10.5px;font-weight:600;white-space:nowrap;position:sticky;top:0';
  const td = 'padding:4px 6px;border:0.5px solid var(--border);font-size:11.5px';
  const inp = 'padding:3px 5px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)';

  // 期限超過 → 本日 → 期限あり（近い順）→ 期限なし → 完了 の順に並べる
  const rank = t => t.status === 'done' ? 4 : ptIsOverdue(t) ? 0 : ptIsToday(t) ? 1 : t.due_date ? 2 : 3;
  const sortRows = list => [...list].sort((a,b) => rank(a)-rank(b)
    || String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))
    || String(a.title||'').localeCompare(String(b.title||''),'ja'));

  const rowHtml = (t, isMine) => {
    const sc = PT_STATUS_COLOR[t.status] || PT_STATUS_COLOR.not_started;
    const over = ptIsOverdue(t), today = ptIsToday(t);
    const isRequest = ptIsRequest(t);          // 依頼者が担当者と別＝誰かからの依頼
    const acked = !!t.acknowledged_at;
    const needsAck = isRequest && !acked && t.status !== 'done';   // 強調するのは未完了で未確認のものだけ
    // レ点は担当者本人だけが操作できる。他人の分と完了済みは状態の表示だけにする
    const canAck = isMine && String(uid) === String(me?.id||'') && t.status !== 'done';
    return `<tr style="${t.status==='done'?'opacity:.6':''}${isMine&&needsAck?';background:var(--amber-bg)':''}">
      <td style="${td};text-align:center">${isRequest
        ? `<input type="checkbox" ${acked?'checked':''} ${canAck?'':'disabled'} onchange="togglePtAck(${t.id},this.checked)"
             title="${canAck?'依頼を確認したらレ点を付けます（ダッシュボードのお知らせが消えます）':t.status==='done'?'完了済みのため変更できません':`確認のレ点は担当者本人（${escHtml(uname(t.assignee_user_id))}）だけが付けられます`}"
             style="width:16px;height:16px;cursor:${canAck?'pointer':'not-allowed'};accent-color:var(--green)">`
        : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="${td};text-align:left"><span style="font-weight:600">${escHtml(t.title||'')}</span>
        ${needsAck?'<span class="bdg" style="background:var(--red-bg);color:var(--red-text);margin-left:5px">未確認</span>':''}</td>
      <td style="${td};text-align:center">
        <select style="${inp};background:var(${sc[0]});color:var(${sc[1]});font-weight:600" onchange="savePtField(${t.id},'status',this.value)">
          ${Object.entries(PT_STATUS_LABEL).map(([k,v])=>`<option value="${k}" ${t.status===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td style="${td};text-align:center;white-space:nowrap;color:var(--text2)" title="タスクを登録した日時です">${ptStamp(t.created_at)||'—'}</td>
      <td style="${td};text-align:center;white-space:nowrap;${over?'color:var(--red-text);font-weight:700':today?'color:var(--amber-text);font-weight:700':''}">
        ${t.due_date ? escHtml(t.due_date) + (over?'<div style="font-size:9px">⚠ 期限超過</div>':today?'<div style="font-size:9px">本日</div>':'') : '<span style="color:var(--text3)">期限なし</span>'}
      </td>
      <td style="${td};text-align:center;white-space:nowrap;color:var(${t.completed_at?'--green-text':'--text3'})" title="ステータスを「完了」にすると自動で入ります">${ptStamp(t.completed_at)||'—'}</td>
      <td style="${td};max-width:220px"><span style="font-size:10.5px;color:var(--text2);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.note||'')}">${escHtml(t.note||'')||'—'}</span></td>
      <td style="${td};text-align:center;white-space:nowrap">${escHtml(uname(t.assignee_user_id))}</td>
      <td style="${td};text-align:center;white-space:nowrap;color:var(--text2)">${escHtml(uname(t.requester_user_id))}</td>
      <td style="${td};text-align:center">${me&&me.role!=='viewer'?`<button class="ibtn" onclick="openPtM(${t.id})" title="編集">✎</button>`:''}</td>
    </tr>`;
  };

  const tableHtml = (list, isMine, emptyMsg) => !list.length
    ? `<div style="color:var(--text2);font-size:12px;padding:10px 0 16px">${emptyMsg}</div>`
    : `<table style="width:100%;border-collapse:collapse;min-width:980px;margin-bottom:16px">
        <thead><tr>
          <th style="${th};width:44px">チェック</th>
          <th style="${th};text-align:left">タスク</th>
          <th style="${th}">ステータス</th>
          <th style="${th}">依頼日時<div style="font-weight:400;color:var(--text2)">自動</div></th>
          <th style="${th}">期限</th>
          <th style="${th}">完了日時<div style="font-weight:400;color:var(--text2)">自動</div></th>
          <th style="${th};text-align:left">メモ</th>
          <th style="${th}">担当者</th>
          <th style="${th}">依頼者</th>
          <th style="${th};width:40px"></th>
        </tr></thead>
        <tbody>${sortRows(list).map(t => rowHtml(t, isMine)).join('')}</tbody></table>`;

  area.innerHTML =
    `<div class="ctitle" style="margin-top:10px">👤 自分の分
       <span style="font-weight:400;color:var(--text2);font-size:11px">${escHtml(selfName)}が担当・${mine.length}件${unack?` / 未確認の依頼 ${unack}件`:''}</span></div>`
    + tableHtml(mine, true, '自分が担当のタスクはありません')
    + `<div class="ctitle">👥 他人の分
       <span style="font-weight:400;color:var(--text2);font-size:11px">${scope==='requested'?`${escHtml(selfName)}が依頼した分`:'すべて'}・${others.length}件</span></div>`
    + tableHtml(others, false, scope==='requested' ? '自分が依頼したタスクはありません' : '他の人が担当のタスクはありません');
}
const renderPersonalTasksDebounced = debounce(renderPersonalTasks, 250);
/* 依頼の確認レ点。担当者本人だけが付け外しできる（依頼した側が勝手に確認済みにしない） */
async function togglePtAck(id, on) {
  if (!sb) return;
  const t = personalTasks.find(x => x.id === id);
  if (!t) return;
  if (String(t.assignee_user_id||'') !== String(me?.id||'')) {
    showT('確認のレ点は担当者本人だけが付けられます', 'twa');
    renderPersonalTasks();
    return;
  }
  if (t.status === 'done') {
    showT('完了済みのタスクは変更できません', 'twa');
    renderPersonalTasks();
    return;
  }
  const val = on ? new Date().toISOString() : null;
  try {
    const {data, error} = await sb.from('tasks').update({acknowledged_at: val}).eq('id', id).select().single();
    if (error) throw error;
    const i = personalTasks.findIndex(x => x.id === id);
    if (i >= 0) personalTasks[i] = data;
    renderPersonalTasks();
    renderDashWarningsIfVisible();
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); renderPersonalTasks(); }
}
// ダッシュボードを開いたままレ点を付けた場合に、警告パネルもその場で更新する
function renderDashWarningsIfVisible() {
  if (document.getElementById('dashWarnings')) renderDashWarnings();
}

async function savePtField(id, field, value) {
  if (!sb) return;
  const patch = { [field]: value === '' ? null : value };
  if (field === 'status') patch.completed_at = value === 'done' ? new Date().toISOString() : null;
  try {
    const {data, error} = await sb.from('tasks').update(patch).eq('id', id).select().single();
    if (error) throw error;
    const idx = personalTasks.findIndex(t => t.id === id);
    if (idx >= 0) personalTasks[idx] = data;
    renderPersonalTasks();
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
}
function openPtM(id) {
  ePtId = id ?? null;
  const t = id ? personalTasks.find(x=>x.id===id) : null;
  const opts = (sel) => staffMembers().map(u=>`<option value="${escHtml(u.id)}" ${String(u.id)===String(sel||'')?'selected':''}>${escHtml(u.name)}</option>`).join('');
  document.getElementById('mPtH').innerHTML = (t?'タスクを編集':'タスクを追加')+' <button class="ibtn" onclick="closeM(\'mPt\')">✕</button>';
  document.getElementById('ptTitle').value = t?.title || '';
  document.getElementById('ptAssignee').innerHTML = '<option value="">未割当</option>' + opts(t ? t.assignee_user_id : me?.id);
  document.getElementById('ptRequester').innerHTML = '<option value="">未設定</option>' + opts(t ? t.requester_user_id : me?.id);
  document.getElementById('ptDue').value = t?.due_date || '';
  document.getElementById('ptStatus').innerHTML = Object.entries(PT_STATUS_LABEL)
    .map(([k,v])=>`<option value="${k}" ${(t?.status||'not_started')===k?'selected':''}>${v}</option>`).join('');
  document.getElementById('ptNote').value = t?.note || '';
  document.getElementById('ptErr').textContent = '';
  document.getElementById('ptDelBtn').style.display = t ? '' : 'none';
  document.getElementById('mPt').classList.add('on');
}
async function savePersonalTask() {
  const title = document.getElementById('ptTitle').value.trim();
  const errEl = document.getElementById('ptErr');
  errEl.textContent = '';
  if (!title) { errEl.textContent = 'タスク名を入力してください'; return; }
  const status = document.getElementById('ptStatus').value;
  const obj = {
    title,
    assignee_user_id: document.getElementById('ptAssignee').value || null,
    requester_user_id: document.getElementById('ptRequester').value || null,
    due_date: document.getElementById('ptDue').value || null,
    status,
    note: document.getElementById('ptNote').value.trim() || null,
    // 完了日時は「完了になった瞬間」を残す。既に完了済みのタスクを編集し直しても打ち直さない
    completed_at: status === 'done'
      ? ((ePtId && personalTasks.find(t=>t.id===ePtId)?.completed_at) || new Date().toISOString())
      : null,
  };
  showLoad(true);
  try {
    if (ePtId) {
      const {data, error} = await sb.from('tasks').update(obj).eq('id', ePtId).select().single();
      if (error) throw error;
      const idx = personalTasks.findIndex(t=>t.id===ePtId);
      if (idx>=0) personalTasks[idx] = data;
      addLog('個人タスク編集', title);
    } else {
      obj.created_by = me?.name || null;
      const {data, error} = await sb.from('tasks').insert(obj).select().single();
      if (error) throw error;
      personalTasks.push(data);
      addLog('個人タスク追加', title);
    }
    closeM('mPt');
    renderPersonalTasks();
    showT('保存しました');
  } catch(e) { errEl.textContent = '保存エラー: ' + e.message; }
  showLoad(false);
}
async function deletePersonalTask() {
  if (!ePtId) return;
  const t = personalTasks.find(x=>x.id===ePtId);
  if (!confirm(`「${t?.title||''}」を削除しますか？`)) return;
  showLoad(true);
  try {
    const {error} = await sb.from('tasks').delete().eq('id', ePtId);
    if (error) throw error;
    personalTasks = personalTasks.filter(x=>x.id!==ePtId);
    closeM('mPt');
    renderPersonalTasks();
    showT('削除しました');
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* ============================================================
   タスクTOP（pg31）— 請求書・支払明細書・個人タスクの当月状況をまとめて見る
   ============================================================ */
function ttCurrentMonth() {
  const el = document.getElementById('ttMonth');
  if (el?.value) return el.value;
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth()-1, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function taskTopShiftMonth(delta) {
  const el = document.getElementById('ttMonth');
  const [y,m] = ttCurrentMonth().split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  el.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  initTaskTop();
}
async function initTaskTop() {
  const el = document.getElementById('ttMonth');
  if (el && !el.value) el.value = ttCurrentMonth();
  const who = document.getElementById('ttWho');
  if (who) who.textContent = me ? `ログイン中: ${me.name}` : '';
  const month = ttCurrentMonth();
  document.getElementById('ttBody').innerHTML = '<div style="color:var(--text2);font-size:12px;padding:14px 0">読み込み中...</div>';
  // 3種類のデータをまとめて取得する（画面を開いたときだけ通信する）
  try {
    const [bp, dp] = await Promise.all([
      sb.from('billing_progress').select('*').eq('month', month),
      sb.from('driver_progress').select('*').eq('month', month),
    ]);
    billingProgress = bp.data || [];
    driverProgress  = dp.data || [];
    await loadPersonalTasks();
  } catch(e) { console.warn('initTaskTop:', e.message); }
  renderTaskTop();
}
function renderTaskTop() {
  const body = document.getElementById('ttBody');
  if (!body) return;
  const month = ttCurrentMonth();
  const invMap = bpInvoiceSummary(month);
  const payMap = dpPaySummary(month);

  // 請求書側: その月に実績がある取引先＋手動追加分
  const bpList = clients.filter(c => invMap[String(c.id)] || bpRow(c.id)?.manual);
  const dpList = dpCompanies().filter(d => payMap[String(d.id)] || dpRow(d.id)?.manual);

  const stat = (list, rowFn) => {
    const done = list.filter(x => (rowFn(x)||{}).status === 'done').length;
    const over = list.filter(x => bpIsOverdue(rowFn(x)||{}, x, month)).length;
    const unsent = list.filter(x => bpIsUnsent(rowFn(x)||{})).length;
    return {n:list.length, done, over, unsent};
  };
  const sB = stat(bpList, c => bpRow(c.id));
  const sD = stat(dpList, d => dpRow(d.id));

  const myTasks = personalTasks.filter(t => String(t.assignee_user_id||'') === String(me?.id||''));
  const myOver  = myTasks.filter(ptIsOverdue);
  const myToday = myTasks.filter(ptIsToday);
  const incoming = ptIncomingRequests();
  const uname = id => users.find(u=>String(u.id)===String(id))?.name || '';

  const card = (n, label, warn) => `<div class="kpi-card"><div class="kpi-label">${label}</div>
    <div class="kpi-val" style="color:${warn && n ? 'var(--red)' : 'inherit'}">${n}</div></div>`;

  // 対応が必要な行を、深刻な順（期限超過→未送付→進捗が浅い）に並べて上位だけ出す
  const rank = (row, obj) => bpIsOverdue(row, obj, month) ? -1
    : bpIsUnsent(row) ? 0
    : Object.keys(BP_STATUS_LABEL).indexOf(row.status || 'todo') + 1;
  const problems = [
    ...bpList.filter(c => (bpRow(c.id)||{}).status !== 'done')
      .map(c => ({kind:'請求書', name:c.name, row:bpRow(c.id)||{}, obj:c, go:29})),
    ...dpList.filter(d => (dpRow(d.id)||{}).status !== 'done')
      .map(d => ({kind:'支払明細書', name:d.name, row:dpRow(d.id)||{}, obj:d, go:32})),
  ].sort((a,b) => rank(a.row,a.obj) - rank(b.row,b.obj)).slice(0, 8);

  const td = 'padding:5px 8px;border-bottom:0.5px solid var(--border);font-size:11.5px';
  body.innerHTML = `
    <div style="font-size:11.5px;color:var(--text2);margin-bottom:8px">${escHtml(month)} の状況</div>
    ${incoming.length ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 11px;margin-bottom:10px;border-radius:var(--radius);cursor:pointer;
        background:var(${incoming.some(ptIsOverdue)?'--red-bg':'--amber-bg'});color:var(${incoming.some(ptIsOverdue)?'--red-text':'--amber-text'})"
        onclick="goTaskPage(33)" title="クリックで個人タスクを開きます">
      <span style="font-size:15px">🙋</span>
      <span style="font-size:12px;font-weight:600">未確認の依頼が ${incoming.length}件 あります</span>
      <span style="font-size:11px;font-weight:400">${escHtml([...new Set(incoming.map(t=>uname(t.requester_user_id)).filter(Boolean))].join('、'))} から
        ／ 個人タスクでレ点を付けると消えます</span>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:14px">
      ${card(sB.n + sD.n, '対象（請求＋支払）')}
      ${card(sB.done + sD.done, '完了')}
      ${card(sB.over + sD.over, '期限超過', true)}
      ${card(sB.unsent + sD.unsent, '未送付', true)}
      ${card(myOver.length, '自分の期限超過タスク', true)}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:16px">
      <div class="card" style="cursor:pointer" onclick="goTaskPage(29)">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px">✅ 請求書発行</div>
        <div style="font-size:11.5px;color:var(--text2)">対象 ${sB.n}件 ／ 完了 ${sB.done}件 ／ 未完了 ${sB.n-sB.done}件
          ${sB.over?`<span style="color:var(--red-text);font-weight:600">　⚠ 期限超過 ${sB.over}件</span>`:''}</div>
      </div>
      <div class="card" style="cursor:pointer" onclick="goTaskPage(32)">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px">💴 支払明細書発行</div>
        <div style="font-size:11.5px;color:var(--text2)">対象 ${sD.n}社 ／ 完了 ${sD.done}社 ／ 未完了 ${sD.n-sD.done}社
          ${sD.over?`<span style="color:var(--red-text);font-weight:600">　⚠ 期限超過 ${sD.over}件</span>`:''}</div>
      </div>
      <div class="card" style="cursor:pointer" onclick="goTaskPage(33)">
        <div style="font-size:12px;font-weight:600;margin-bottom:5px">👤 自分のタスク</div>
        <div style="font-size:11.5px;color:var(--text2)">未完了 ${myTasks.filter(t=>t.status!=='done').length}件
          ${myOver.length?`<span style="color:var(--red-text);font-weight:600">　⚠ 期限超過 ${myOver.length}件</span>`:''}
          ${myToday.length?`<span style="color:var(--amber-text);font-weight:600">　本日 ${myToday.length}件</span>`:''}
          ${incoming.length?`<span style="color:var(--amber-text);font-weight:600">　🙋 未確認の依頼 ${incoming.length}件</span>`:''}</div>
      </div>
    </div>

    <div class="ctitle">対応が必要な業務 <span style="font-weight:400;color:var(--text2);font-size:11px">${problems.length}件（上位8件）</span></div>
    ${problems.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr style="background:var(--bg2)">
        <th style="${td};text-align:left">種別</th><th style="${td};text-align:left">相手先</th>
        <th style="${td}">ステータス</th><th style="${td}">提出期限</th><th style="${td}"></th>
      </tr></thead><tbody>${problems.map(p => {
        const sc = BP_STATUS_COLOR[p.row.status||'todo'] || BP_STATUS_COLOR.todo;
        const over = bpIsOverdue(p.row, p.obj, month);
        const due = bpEffectiveDue(p.row, p.obj, month);
        return `<tr>
          <td style="${td};color:var(--text2)">${p.kind}</td>
          <td style="${td};font-weight:600">${escHtml(p.name)}</td>
          <td style="${td};text-align:center"><span class="bdg" style="background:var(${sc[0]});color:var(${sc[1]})">${BP_STATUS_LABEL[p.row.status||'todo']}</span></td>
          <td style="${td};text-align:center;${over?'color:var(--red-text);font-weight:700':''}">${due||'—'}${over?' ⚠':''}</td>
          <td style="${td};text-align:center"><button class="btn sml" onclick="goTaskPage(${p.go})">開く</button></td>
        </tr>`;
      }).join('')}</tbody></table>` : '<div style="color:var(--text2);font-size:12px;padding:8px 0 16px">対応が必要な業務はありません</div>'}

    <div class="ctitle">自分の期限が近いタスク <span style="font-weight:400;color:var(--text2);font-size:11px">${myOver.length+myToday.length}件</span></div>
    ${(myOver.length+myToday.length) ? `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:var(--bg2)">
        <th style="${td};text-align:left">タスク</th><th style="${td}">ステータス</th><th style="${td}">期限</th>
      </tr></thead><tbody>${[...myOver, ...myToday].map(t => {
        const sc = PT_STATUS_COLOR[t.status] || PT_STATUS_COLOR.not_started;
        return `<tr>
          <td style="${td};font-weight:600">${escHtml(t.title||'')}</td>
          <td style="${td};text-align:center"><span class="bdg" style="background:var(${sc[0]});color:var(${sc[1]})">${PT_STATUS_LABEL[t.status]}</span></td>
          <td style="${td};text-align:center;color:var(--red-text);font-weight:700">${escHtml(t.due_date||'')}</td>
        </tr>`;
      }).join('')}</tbody></table>` : '<div style="color:var(--text2);font-size:12px;padding:8px 0">期限が近いタスクはありません</div>'}
  `;
}

/* ============================================================
   支払明細書発行（pg32）— ドライバー・協力会社向けの進捗。
   請求書側(billing_progress)と同じ考え方だが、対象がドライバーのため別テーブル(driver_progress)を使う
   ============================================================ */
let driverProgress = [];
const dpRow = cliId => driverProgress.find(d => String(d.cli_id) === String(cliId));
function dpCurrentMonth() {
  const el = document.getElementById('dpMonth');
  if (el?.value) return el.value;
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}
function dpShiftMonth(delta) {
  const el = document.getElementById('dpMonth');
  const [y,m] = dpCurrentMonth().split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  el.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  onDpMonthChange();
}
function onDpMonthChange() { loadDriverProgress().then(() => renderDriverProgress()); }
function initDriverProgress() {
  const el = document.getElementById('dpMonth');
  if (el && !el.value) {
    // 支払業務も前月分を当月に処理することが多いため、既定は前月にする
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth()-1, 1);
    el.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  const btn = document.getElementById('dpAddBtn');
  if (btn) btn.classList.toggle('hide', !(me && me.role !== 'viewer'));
}
async function loadDriverProgress() {
  if (!sb) return;
  try {
    const {data, error} = await sb.from('driver_progress').select('*').eq('month', dpCurrentMonth());
    if (error) { if (/does not exist|relation/.test(error.message)) { driverProgress=[]; return; } throw error; }
    driverProgress = data || [];
  } catch(e) { console.warn('loadDriverProgress:', e.message); driverProgress = []; }
}
/* 支払明細書の発行先は会社単位。会社マスタ(clients)のうち、
   ドライバーを供給してくれている会社と、協力会社・自社支店・リース会社として登録した会社を出す。
   （ドライバー管理には個人しか置かないため、会社はすべてこちらで扱う） */
function dpCompanies() {
  return clients.filter(c => ['supplier','lease','branch'].includes(cliKindOf(c)) || cliSuppliedDrivers(c).length);
}
// 実績を会社単位に寄せる。個人ドライバーの実績は、その人の所属会社に合算する
// （所属が無い個人の分はどの会社にも積まない）
function dpCompanyIdOf(drv) {
  if (!drv) return null;
  if (drv.company_client_id != null) return drv.company_client_id;
  if (drv.company) {
    const co = clients.find(c => nm(c.name) === nm(drv.company));
    if (co) return co.id;
  }
  return null;
}
// その月の支払対象を会社ごとに集計する
function dpPaySummary(month) {
  const map = {};
  recs.forEach(r => {
    if (!r.date || !r.date.startsWith(month)) return;
    const coId = dpCompanyIdOf(recDrv(r));
    if (coId == null) return;
    const k = String(coId);
    if (!map[k]) map[k] = {amt:0, cnt:0, lastDate:''};
    map[k].amt += subBySide(r,'payment') + rtaxBySide(r,'payment');
    map[k].cnt++;
    if (r.date > map[k].lastDate) map[k].lastDate = r.date;
  });
  return map;
}
function renderDriverProgress() {
  const area = document.getElementById('dpArea');
  const sumEl = document.getElementById('dpSummary');
  if (!area) return;
  const keepSel = new Set(Array.from(document.querySelectorAll('.dpRowChk:checked')).map(el => el.value));
  const month = dpCurrentMonth();
  const payMap = dpPaySummary(month);
  const statusF = document.getElementById('dpStatusFilter')?.value || '';
  const q = nm(document.getElementById('dpSearch')?.value || '');
  const dataF = document.getElementById('dpDataFilter')?.value ?? 'hasdata';

  let base = [...dpCompanies()].sort((a,b) =>
    (parseInt(a.supplier_id,10)||999999) - (parseInt(b.supplier_id,10)||999999));
  if (dataF === 'hasdata') base = base.filter(d => payMap[String(d.id)] || dpRow(d.id)?.manual);

  const rowOf = d => dpRow(d.id) || {};
  const effStatus = d => rowOf(d).status || 'todo';

  let list = base;
  if (q) list = list.filter(d => nm(d.name).includes(q) || nm(d.company||'').includes(q));
  if (statusF === 'open')         list = list.filter(d => effStatus(d) !== 'done');
  else if (statusF === 'done')    list = list.filter(d => effStatus(d) === 'done');
  else if (statusF === 'overdue') list = list.filter(d => bpIsOverdue(rowOf(d), d, month));
  else if (statusF === 'unsent')  list = list.filter(d => bpIsUnsent(rowOf(d)));

  const targets = base;
  const doneCnt    = targets.filter(d => effStatus(d) === 'done').length;
  const overdueCnt = targets.filter(d => bpIsOverdue(rowOf(d), d, month)).length;
  const unsentCnt  = targets.filter(d => bpIsUnsent(rowOf(d))).length;
  const pct = targets.length ? Math.round(doneCnt / targets.length * 1000)/10 : 0;
  const manualAmt = driverProgress.reduce((a,b)=>a+(b.manual&&!payMap[String(b.drv_id)]?(+b.manual_amt||0):0), 0);
  const totalAmt = Object.values(payMap).reduce((a,v)=>a+v.amt, 0) + manualAmt;
  const tabs = [
    {id:'',        label:'すべて',   n:targets.length},
    {id:'open',    label:'未完了',   n:targets.length-doneCnt},
    {id:'overdue', label:'期限超過', n:overdueCnt, warn:true},
    {id:'unsent',  label:'未送付',   n:unsentCnt,  warn:true},
    {id:'done',    label:'完了',     n:doneCnt},
  ];
  if (sumEl) {
    sumEl.innerHTML = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11.5px;margin-bottom:7px">
      <span>対象 <b>${targets.length}</b>社${dataF==='hasdata'?`（実績なし ${dpCompanies().length-base.length}社を非表示）`:''}</span>
      <span>完了 <b style="color:var(--green-text)">${doneCnt}</b> / 未完了 <b style="color:var(--amber-text)">${targets.length-doneCnt}</b></span>
      ${overdueCnt?`<span style="color:var(--red-text);font-weight:600">⚠ 期限超過 ${overdueCnt}件</span>`:''}
      ${unsentCnt?`<span style="color:var(--amber-text);font-weight:600">未送付 ${unsentCnt}件</span>`:''}
      <span>支払合計 <b>${yen(totalAmt)}</b></span>
      <span style="flex:1;min-width:120px;display:flex;align-items:center;gap:6px">
        <span style="flex:1;height:7px;background:var(--border);border-radius:99px;overflow:hidden;display:inline-block">
          <span style="display:block;height:100%;width:${pct}%;background:var(--green)"></span>
        </span><b>${pct}%</b>
      </span></div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">${tabs.map(t=>{
        const on = statusF === t.id;
        const col = t.warn && t.n ? 'var(--red-text)' : on ? 'var(--blue-text)' : 'var(--text2)';
        return `<button class="btn sml" onclick="setDpStatusFilter('${t.id}')" style="padding:3px 10px;font-size:11px;${on?'background:var(--blue-bg);border-color:var(--blue);font-weight:700;':''}color:${col}">${t.label} ${t.n}</button>`;
      }).join('')}</div>`;
  }

  if (!list.length) {
    area.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:14px 0">${
      dataF==='hasdata' && !base.length
        ? 'この月に支払実績のある会社がありません（「実績なしも表示」に切り替えると全社表示できます）'
        : '該当する会社がありません'}</div>`;
    return;
  }

  const th = 'padding:6px 8px;border:0.5px solid var(--border);background:var(--bg2);font-size:10.5px;font-weight:600;white-space:nowrap;position:sticky;top:0';
  const td = 'padding:4px 6px;border:0.5px solid var(--border);font-size:11.5px';
  const inp = 'padding:3px 5px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)';
  const staff = staffMembers();
  const staffOpts = (sel) => '<option value="">未入力</option>' + staff.map(u=>`<option value="${escHtml(u.id)}" ${String(u.id)===String(sel||'')?'selected':''}>${escHtml(u.name)}</option>`).join('');

  area.innerHTML = `<div id="dpBulkBar" style="display:none;align-items:center;gap:8px;padding:6px 10px;margin-bottom:6px;background:var(--blue-bg);border-radius:var(--radius);font-size:11.5px">
      <span id="dpBulkCount" style="color:var(--blue-text);font-weight:600"></span>
      <button class="btn sml" onclick="carryOverDpSelected()" title="選択した会社を翌月の一覧に追加します（担当者・方法は引き継ぎ、進捗はリセット）">→ 翌月へ繰り越し</button>
      ${me && me.role !== 'viewer' ? `<button class="btn sml" onclick="deleteDpSelected()" style="color:var(--red-text)" title="手動で追加した行のみ削除できます">🗑 選択を削除</button>` : ''}
      <button class="btn sml" onclick="toggleDpRowAll(false)" style="margin-left:auto">選択を解除</button>
    </div>
    <table style="width:100%;border-collapse:collapse;min-width:900px">
    <thead><tr>
      <th style="${th};width:26px"><input type="checkbox" id="dpRowChkAll" onchange="toggleDpRowAll(this.checked)" title="表示中の全行を選択" style="width:14px;height:14px;cursor:pointer"></th>
      <th style="${th};text-align:left">会社</th>
      <th style="${th};text-align:right">支払金額<div style="font-weight:400;color:var(--text2)">自動</div></th>
      <th style="${th}">ステータス</th>
      <th style="${th}">提出期限<div style="font-weight:400;color:var(--text2)">ルール</div></th>
      <th style="${th}">提出方法</th>
      <th style="${th}">発行・送付日</th>
      <th style="${th}">担当者</th>
      <th style="${th}">チェック</th>
      <th style="${th}">チェック担当者</th>
      <th style="${th};text-align:left">送付メモ</th>
      <th style="${th};text-align:left">備考</th>
    </tr></thead>
    <tbody>${list.map(d => {
      const b = dpRow(d.id) || {};
      const pay = payMap[String(d.id)];
      const st = b.status || 'todo';
      const sc = BP_STATUS_COLOR[st] || BP_STATUS_COLOR.todo;
      const due = bpEffectiveDue(b, d, month);
      const overdue = bpIsOverdue(b, d, month);
      return `<tr>
        <td style="${td};text-align:center"><input type="checkbox" class="dpRowChk" value="${d.id}" data-manual="${b.manual?1:0}" onchange="updateDpBulkBar()" style="width:14px;height:14px;cursor:pointer"></td>
        <td style="${td};text-align:left;white-space:nowrap">
          <span style="font-weight:600">${escHtml(d.name)}</span>
          ${d.supplier_id?`<span style="font-size:9.5px;color:var(--text2)"> ID:${escHtml(d.supplier_id)}</span>`:''}
          ${pay?`<span class="bdg" style="background:var(--blue-bg);color:var(--blue-text);margin-left:4px">${pay.cnt}件</span>`:'<span style="font-size:9.5px;color:var(--text2);margin-left:4px">実績なし</span>'}
          ${b.manual&&!pay?`<span class="bdg" style="background:var(--amber-bg);color:var(--amber-text);margin-left:4px">手動</span>`:''}
        </td>
        <td style="${td};text-align:right;white-space:nowrap">${
          pay ? yen(pay.amt)
              : (b.manual ? `<input type="number" step="1" style="${inp};width:96px;text-align:right" value="${b.manual_amt??''}" placeholder="金額を入力" onchange="saveDpField(${d.id},'manual_amt',this.value)">` : '—')
        }</td>
        <td style="${td};text-align:center">
          <select style="${inp};background:var(${sc[0]});color:var(${sc[1]});font-weight:600" onchange="saveDpField(${d.id},'status',this.value)">
            ${Object.entries(BP_STATUS_LABEL).map(([k,v])=>`<option value="${k}" ${st===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td style="${td};text-align:center;white-space:nowrap">
          <input type="date" style="${inp};${overdue?'color:var(--red-text);font-weight:700;border-color:var(--red)':''}" value="${due||''}" title="協力会社（ドライバー登録の会社レコード）の提出ルールから自動計算されます" onchange="saveDpField(${d.id},'planned_date',this.value)">
          <div style="font-size:9px;color:var(${overdue?'--red-text':'--text2'})">${overdue?'⚠ 期限超過':escHtml(bpRuleText(d))}</div>
        </td>
        <td style="${td};text-align:center">
          <select style="${inp}" onchange="saveDpField(${d.id},'send_method',this.value)">
            <option value="">未設定</option>
            ${Object.entries(BP_SEND_LABEL).map(([k,v])=>`<option value="${k}" ${(b.send_method||'')===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </td>
        <td style="${td};text-align:center"><input type="date" style="${inp}" value="${b.submitted_date||''}" onchange="saveDpField(${d.id},'submitted_date',this.value)"></td>
        <td style="${td};text-align:center"><select style="${inp}" onchange="saveDpField(${d.id},'assignee_user_id',this.value)">${staffOpts(b.assignee_user_id)}</select></td>
        <td style="${td};text-align:center"><input type="checkbox" ${b.checked?'checked':''} onchange="saveDpField(${d.id},'checked',this.checked)" title="チェックが済んだらレ点を付けます" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)"></td>
        <td style="${td};text-align:center"><select style="${inp}" onchange="saveDpField(${d.id},'check_user_id',this.value)">${staffOpts(b.check_user_id)}</select></td>
        <td style="${td};max-width:150px">${d.send_memo
          ? `<span style="font-size:10.5px;color:var(--text2);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(d.send_memo)}">${escHtml(d.send_memo)}</span>`
          : '<span style="font-size:10px;color:var(--text3)">—</span>'}</td>
        <td style="${td}"><input type="text" style="${inp};width:100%;min-width:110px" value="${escHtml(b.note||'')}" placeholder="—" onchange="saveDpField(${d.id},'note',this.value)"></td>
      </tr>`;
    }).join('')}</tbody></table>`;

  if (keepSel.size) {
    document.querySelectorAll('.dpRowChk').forEach(el => { if (keepSel.has(el.value)) el.checked = true; });
    updateDpBulkBar();
  }
}
const renderDriverProgressDebounced = debounce(renderDriverProgress, 250);
function setDpStatusFilter(v) {
  const sel = document.getElementById('dpStatusFilter');
  if (sel) sel.value = v;
  renderDriverProgress();
}
/* 支払明細書発行の進捗を1項目だけ保存する。
   行の単位は会社（取引先レコード）なので cli_id で持つ。一覧を作る dpCompanies() が
   clients を返しており、dpRow() も cli_id で引いているのに、ここだけ旧名の drv_id を
   送っていたため保存が常に失敗していた（driver_progress に drv_id 列は無い）。 */
async function saveDpField(cliId, field, value) {
  if (!sb) return;
  const month = dpCurrentMonth();
  const patch = { [field]: (typeof value === 'boolean') ? value
    : value === '' ? null
    : (field === 'manual_amt' ? Math.round(+value) || null : value) };
  if (field === 'submitted_date' && value) {
    const cur = dpRow(cliId);
    if (!['sent','done'].includes(cur?.status || 'todo')) patch.status = 'sent';
  }
  try {
    const {data, error} = await sb.from('driver_progress')
      .upsert({ month, cli_id: cliId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'month,cli_id' })
      .select().single();
    if (error) throw error;
    const idx = driverProgress.findIndex(b => String(b.cli_id) === String(cliId));
    if (idx >= 0) driverProgress[idx] = data; else driverProgress.push(data);
    renderDriverProgress();
    const c = lkCli(cliId);
    addLog('支払明細書発行 更新', `${month} ${c?c.name:`cli:${cliId}`} ${field}=${value||'（クリア）'}`);
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
}
/* 行選択（一括削除・翌月繰り越し） */
function toggleDpRowAll(on) {
  document.querySelectorAll('.dpRowChk').forEach(el => el.checked = on);
  const all = document.getElementById('dpRowChkAll');
  if (all) all.checked = on;
  updateDpBulkBar();
}
function updateDpBulkBar() {
  const sel = Array.from(document.querySelectorAll('.dpRowChk:checked'));
  const bar = document.getElementById('dpBulkBar');
  const cnt = document.getElementById('dpBulkCount');
  if (!bar) return;
  bar.style.display = sel.length ? 'flex' : 'none';
  if (cnt) {
    const manualN = sel.filter(el => el.dataset.manual === '1').length;
    cnt.textContent = `${sel.length}社選択中` + (manualN < sel.length ? `（うち手動追加 ${manualN}社）` : '');
  }
  const all = document.getElementById('dpRowChkAll');
  if (all) all.checked = sel.length > 0 && sel.length === document.querySelectorAll('.dpRowChk').length;
}
async function deleteDpSelected() {
  const sel = Array.from(document.querySelectorAll('.dpRowChk:checked'));
  const manualIds = sel.filter(el => el.dataset.manual === '1').map(el => +el.value);
  const skipped = sel.length - manualIds.length;
  if (!manualIds.length) {
    alert(`削除できるのは手動で追加した行だけです。\n選択中の${sel.length}社はいずれも支払実績から自動表示されている行です。`);
    return;
  }
  const names = manualIds.map(id => drvs.find(d=>d.id===id)?.name || id).join('、');
  if (!confirm(`次の${manualIds.length}社をこの月の一覧から外しますか？\n\n${names}\n\n入力済みの内容も削除されます。`
    + (skipped ? `\n\n※ 選択中の${skipped}社は支払実績があるため削除されません。` : ''))) return;
  showLoad(true);
  try {
    const {error} = await sb.from('driver_progress').delete().eq('month', dpCurrentMonth()).in('cli_id', manualIds);
    if (error) throw error;
    driverProgress = driverProgress.filter(b => !manualIds.includes(+b.drv_id));
    renderDriverProgress();
    showT(`${manualIds.length}社を一覧から外しました`);
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}
async function carryOverDpSelected() {
  const ids = Array.from(document.querySelectorAll('.dpRowChk:checked')).map(el => +el.value);
  if (!ids.length) return;
  const month = dpCurrentMonth();
  const [y, m] = month.split('-').map(Number);
  const next = new Date(y, m, 1);
  const nextMonth = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
  const names = ids.map(id => drvs.find(d=>d.id===id)?.name || id).join('、');
  if (!confirm(`次の${ids.length}社を ${nextMonth} の一覧へ繰り越しますか？\n\n${names}\n\n`
    + `担当者・チェック担当者・提出方法を引き継ぎます。\n`
    + `ステータスは「未着手」に戻り、日付・チェック・金額・備考は空になります。\n`
    + `${month} の行はそのまま残ります。`)) return;
  showLoad(true);
  try {
    const rows = ids.map(drv_id => {
      const b = driverProgress.find(x => String(x.drv_id) === String(drv_id)) || {};
      return {
        month: nextMonth, drv_id, manual: true,
        assignee_user_id: b.assignee_user_id ?? null,
        check_user_id: b.check_user_id ?? null,
        send_method: b.send_method ?? null,
        status: 'todo', submitted_date: null, planned_date: null,
        checked: false, manual_amt: null, note: null,
        updated_at: new Date().toISOString(),
      };
    });
    const {error} = await sb.from('driver_progress').upsert(rows, { onConflict: 'month,cli_id' });
    if (error) throw error;
    showT(`${ids.length}社を ${nextMonth} へ繰り越しました`);
    toggleDpRowAll(false);
  } catch(e) { showT('繰り越しエラー: '+e.message, 'ter'); }
  showLoad(false);
}
/* ドライバーの手動追加 */
function openDpAddM() {
  document.getElementById('dpAddSearch').value = '';
  document.getElementById('dpAddErr').textContent = '';
  renderDpAddList();
  document.getElementById('mDpAdd').classList.add('on');
}
function renderDpAddList() {
  const payMap = dpPaySummary(dpCurrentMonth());
  const checked = new Set(Array.from(document.querySelectorAll('.dpAddChk:checked')).map(el=>el.value));
  const q = nm(document.getElementById('dpAddSearch')?.value || '');
  const cand = [...dpCompanies()]
    .filter(d => !payMap[String(d.id)] && !dpRow(d.id)?.manual)
    .filter(d => !q || nm(d.name).includes(q))
    .sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999));
  const el = document.getElementById('dpAddList');
  el.innerHTML = cand.length
    ? cand.map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="dpAddChk" value="${d.id}" ${checked.has(String(d.id))?'checked':''} onchange="updateDpAddCount()" style="width:auto">${escHtml(d.name)}${d.supplier_id?`<span style="color:var(--text2);font-size:10.5px">（ID:${escHtml(d.supplier_id)}）</span>`:''}</label>`).join('')
    : '<div style="font-size:11px;color:var(--text2)">該当する会社がありません（すべて一覧に表示済みです）</div>';
  updateDpAddCount();
}
function toggleDpAddAll(on) {
  document.querySelectorAll('.dpAddChk').forEach(el => el.checked = on);
  updateDpAddCount();
}
function updateDpAddCount() {
  const n = document.querySelectorAll('.dpAddChk:checked').length;
  const el = document.getElementById('dpAddCount');
  if (el) el.textContent = n ? `${n}社選択中` : '';
}
async function submitDpAdd() {
  const ids = Array.from(document.querySelectorAll('.dpAddChk:checked')).map(el=>+el.value);
  const errEl = document.getElementById('dpAddErr');
  errEl.textContent = '';
  if (!ids.length) { errEl.textContent = '会社を選択してください'; return; }
  const month = dpCurrentMonth();
  showLoad(true);
  try {
    const rows = ids.map(drv_id => ({ month, drv_id, manual: true, updated_at: new Date().toISOString() }));
    const {data, error} = await sb.from('driver_progress').upsert(rows, { onConflict: 'month,cli_id' }).select();
    if (error) throw error;
    (data||[]).forEach(r => {
      const idx = driverProgress.findIndex(b => String(b.drv_id) === String(r.drv_id));
      if (idx >= 0) driverProgress[idx] = r; else driverProgress.push(r);
    });
    closeM('mDpAdd');
    renderDriverProgress();
    showT(`${ids.length}社を一覧に追加しました`);
  } catch(e) { errEl.textContent = '追加エラー: ' + e.message; }
  showLoad(false);
}
function exportDriverProgressCsv() {
  const month = dpCurrentMonth();
  const payMap = dpPaySummary(month);
  const headers = ['会社','仕入先ID','支払金額','件数','ステータス','提出期限','期限超過','提出方法','発行・送付日','担当者','チェック','チェック担当者','送付メモ','備考'];
  const dataF = document.getElementById('dpDataFilter')?.value ?? 'hasdata';
  const rows = [...dpCompanies()]
    .sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999))
    .filter(d => dataF !== 'hasdata' || payMap[String(d.id)] || dpRow(d.id)?.manual)
    .map(d => {
      const b = dpRow(d.id) || {};
      const pay = payMap[String(d.id)];
      const an = users.find(u=>String(u.id)===String(b.assignee_user_id))?.name || '';
      const cn = users.find(u=>String(u.id)===String(b.check_user_id))?.name || '';
      return [d.name, d.supplier_id||'',
        pay?pay.amt:(b.manual?(b.manual_amt??''):''), pay?pay.cnt:'',
        BP_STATUS_LABEL[b.status||'todo'],
        bpEffectiveDue(b, d, month)||'', bpIsOverdue(b, d, month)?'超過':'',
        BP_SEND_LABEL[b.send_method]||'', b.submitted_date||'',
        an, b.checked?'済':'', cn, d.send_memo||'', b.note||''];
    });
  const csv = [headers, ...rows].map(r=>r.map(v=>{
    const s = csvSafe(v);
    return (s.includes('"')||s.includes(',')||s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\r\n');
  const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `支払明細書発行_${month}.csv`;
  a.click();
}

function exportBillingProgressCsv() {
  const month = bpCurrentMonth();
  const invMap = bpInvoiceSummary(month);
  // 画面の列順に合わせる
  const headers = ['取引先','取引先ID','請求金額','件数','請求日','ステータス','提出期限','期限超過','到着方法','明細到着日','提出方法','明細提出日','担当者','チェック','チェック担当者','送付メモ','備考'];
  // CSVは画面の並び順・絞り込み（実績ありのみ等）に合わせて出力する
  const sortMode = document.getElementById('bpSort')?.value || 'id';
  const sortFn = sortMode === 'name'
    ? (a,b) => clientKanaKey(a).localeCompare(clientKanaKey(b), 'ja') || clientNoCompare(a,b)
    : clientNoCompare;
  const dataF = document.getElementById('bpDataFilter')?.value ?? 'hasdata';
  const rows = [...clients].sort(sortFn)
    .filter(c => dataF !== 'hasdata' || invMap[String(c.id)] || bpRow(c.id)?.manual)
    .map(c => {
      const b = bpRow(c.id) || {};
      const inv = invMap[String(c.id)];
      const an = users.find(u=>String(u.id)===String(b.assignee_user_id))?.name || '';
      const cn = users.find(u=>String(u.id)===String(b.check_user_id))?.name || '';
      // 実績が無い手動追加行は手入力した金額を出力する
      return [c.name, c.client_no||'',
        inv?inv.amt:(b.manual?(b.manual_amt??''):''), inv?inv.cnt:'', inv?inv.lastDate:'',
        BP_STATUS_LABEL[b.status||'todo'],
        bpEffectiveDue(b, c, month)||'', bpIsOverdue(b, c, month)?'超過':'',
        BP_SEND_LABEL[b.arrival_method]||'', b.arrival_date||'',
        BP_SEND_LABEL[b.send_method||c.send_method]||'', b.submitted_date||'',
        an, b.checked?'済':'', cn, c.send_memo||'', b.note||''];
    });
  const csv = [headers, ...rows].map(r=>r.map(v=>{
    const s = csvSafe(v);
    return (s.includes('"')||s.includes(',')||s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\r\n');
  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom, csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `タスク管理_${month}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===== ④ 支払スケジュール ===== */
// schedData → Supabase管理（loadSched()参照）

function openSchedM() {
  const sel = document.getElementById('scDrv');
  sel.innerHTML = '<option value="">選択</option>' + activeDrvs().map(d=>`<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
  enhanceSelectSearchable('scDrv');
  const now = new Date();
  document.getElementById('scDate').value = '';
  document.getElementById('scAmt').value = '';
  document.getElementById('scNote').value = '';
  document.getElementById('scMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('mSched').classList.add('on');
}

// saveSched → v9新実装に移行済み（async版）

// 支払・入金スケジュール共通: 日付ごとにグループ化し、区切り線と小計を付けて表示
function renderScheduleGrouped(data, listId, opts) {
  const list = document.getElementById(listId);
  if (!list) return;
  const today = fmtLocalDate(new Date());
  const soon = new Date(); soon.setDate(soon.getDate()+7); const soonStr = fmtLocalDate(soon);

  const sorted = [...data].sort((a,b)=>a.date.localeCompare(b.date));
  const groups = {};
  sorted.forEach(s => { (groups[s.date] = groups[s.date] || []).push(s); });
  const dates = Object.keys(groups).sort();

  list.innerHTML = dates.map(date => {
    const items = groups[date];
    const subtotal = items.reduce((a,s)=>a+(s.amt||0),0);
    const allDone = items.every(s=>s.done);
    let headerBg = 'var(--bg2)', headerColor = 'var(--text)', headerBadge = '';
    if (allDone) { headerBg='var(--green-bg)'; headerColor='var(--green-text)'; headerBadge=opts.doneLabel; }
    else if (date < today) { headerBg='var(--red-bg)'; headerColor='var(--red-text)'; headerBadge='期限超過'; }
    else if (date <= soonStr) { headerBg='var(--amber-bg)'; headerColor='var(--amber-text)'; headerBadge='7日以内'; }

    const rows = items.map(s => {
      let cls = 'sched-row';
      let badge = '';
      if (!s.done) {
        if (s.date < today) { cls += ' overdue'; badge = `<span class="sched-pill" style="background:var(--red-bg);color:var(--red-text)">期限超過</span>`; }
        else if (s.date <= soonStr) { cls += ' soon'; badge = `<span class="sched-pill" style="background:var(--amber-bg);color:var(--amber-text)">7日以内</span>`; }
      } else { cls += ' done'; badge = `<span class="sched-pill" style="background:var(--green-bg);color:var(--green-text)">${opts.doneLabel}</span>`; }
      const checked = opts.selSet && opts.selSet.has(s.id);
      return `<div class="${cls}">
        <input type="checkbox" data-schedid="${s.id}" ${checked?'checked':''} onchange="${opts.toggleSelFn}(${s.id},this.checked)">
        <div style="flex:1">
          <div style="font-weight:500">${opts.getName(s)} <span style="font-size:10px;color:var(--text2)">${s.month ? s.month+'分' : ''}</span></div>
          ${s.note ? `<div style="font-size:10px;color:var(--text2)">${s.note}</div>` : ''}
        </div>
        <div style="font-size:13px;font-weight:600">${yen(s.amt)}</div>
        ${badge}
        ${!s.done
          ? `<button class="btn sml grn" onclick="${opts.markDoneFn}(${s.id})">${opts.doneLabel}</button>`
          : `<button class="btn sml" title="間違って${opts.doneLabel}にした場合、未済に戻します" onclick="${opts.unmarkDoneFn}(${s.id})">↺ 取消</button>`}
        <button class="ibtn" style="color:#e05b5b" onclick="${opts.deleteFn}(${s.id})">🗑</button>
      </div>`;
    }).join('');

    const groupChecked = opts.selSet && items.every(s=>opts.selSet.has(s.id));
    return `<div class="sched-date-group" data-date="${date}">
      <div class="sched-date-header" style="background:${headerBg};color:${headerColor}">
        <span style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" ${groupChecked?'checked':''} onchange="${opts.toggleGroupFn}('${date}',this.checked)">
          📅 ${date}${headerBadge?' ・ '+headerBadge:''}
        </span>
        <span>${items.length}件 ／ 小計 ${yen(subtotal)}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
}

// 支払・入金スケジュール共通：予定合計／済合計／残高／件数のKPIサマリーを表示する
function renderScheduleSummary(data, elId, label, getName) {
  const el = document.getElementById(elId);
  if (!el) return;
  const total = data.reduce((a,s)=>a+(s.amt||0),0);
  const doneTotal = data.filter(s=>s.done).reduce((a,s)=>a+(s.amt||0),0);
  const remaining = total - doneTotal;
  // 直近の予定＝未済のうち最も日付が早いもの（期限超過があればそれが最優先で表示される）
  const today = fmtLocalDate(new Date());
  const next = data.filter(s=>!s.done).sort((a,b)=>a.date.localeCompare(b.date))[0];
  const nextOverdue = next && next.date < today;
  const nextHtml = next
    ? `<div style="font-size:12px;font-weight:600${nextOverdue?';color:var(--red-text)':''}">${next.date}${nextOverdue?'（期限超過）':''}</div>
       <div style="font-size:12px;margin-top:1px">${getName ? (getName(next)||'—') : '—'}${next.month?` <span style="color:var(--text2)">${next.month}分</span>`:''}</div>
       <div style="font-size:13px;font-weight:600;margin-top:1px">${yen(next.amt)}</div>`
    : `<div style="font-size:11px;color:var(--text2)">予定はありません</div>`;
  el.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">${label}予定合計</div><div class="kpi-val">${yen(total)}</div></div>
    <div class="kpi-card"><div class="kpi-label">${label}済合計</div><div class="kpi-val" style="color:var(--green)">${yen(doneTotal)}</div></div>
    <div class="kpi-card"><div class="kpi-label">未${label}残高</div><div class="kpi-val" style="color:${remaining>0?'var(--red)':'var(--green)'}">${yen(remaining)}</div></div>
    <div class="kpi-card"><div class="kpi-label">件数</div><div class="kpi-val">${data.length}件</div></div>
    <div class="kpi-card"><div class="kpi-label">直近の予定</div>${nextHtml}</div>
  `;
}
let schedSelIds = new Set();
function renderSched() {
  const list = document.getElementById('schedList');
  if (!list) return;
  renderScheduleSummary(schedData, 'schedSummary', '支払', s => s.drv_name || s.drvName || '');
  schedSelIds = new Set([...schedSelIds].filter(id=>schedData.some(s=>s.id===id)));
  updateSchedBulkBar();
  if (!schedData.length) {
    list.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">
      支払予定がありません<br>
      <button class="btn sml" style="margin-top:8px" onclick="showSchedSql()">テーブル未作成の場合はこちら</button>
    </div>`;
    return;
  }
  renderScheduleGrouped(schedData, 'schedList', {
    getName: s => s.drv_name || s.drvName || '',
    doneLabel: '支払済',
    markDoneFn: 'markSchedDone',
    unmarkDoneFn: 'unmarkSchedDone',
    deleteFn: 'deleteSchedItem',
    selSet: schedSelIds,
    toggleSelFn: 'toggleSchedSel',
    toggleGroupFn: 'toggleSchedDateGroup',
  });
}
function toggleSchedSel(id,v){ if(v)schedSelIds.add(id); else schedSelIds.delete(id); updateSchedBulkBar(); }
function toggleSchedDateGroup(date,v){
  schedData.filter(s=>s.date===date).forEach(s=>v?schedSelIds.add(s.id):schedSelIds.delete(s.id));
  document.querySelectorAll(`#schedList .sched-date-group[data-date="${date}"] input[data-schedid]`).forEach(cb=>cb.checked=v);
  updateSchedBulkBar();
}
function toggleSchedSelAll(v){ schedSelIds = v ? new Set(schedData.map(s=>s.id)) : new Set(); renderSched(); }
function updateSchedBulkBar(){
  const el=document.getElementById('schedBulkCount');
  if(el)el.textContent=schedSelIds.size?`${schedSelIds.size}件選択中`:'';
}
async function bulkMarkSchedDone(){
  const ids=[...schedSelIds].filter(id=>{const it=schedData.find(s=>s.id===id);return it&&!it.done;});
  if(!ids.length){showT('未済の予定を選択してください','twa');return;}
  if(!confirm(`${ids.length}件を支払済にしますか？`))return;
  showLoad(true);
  try{
    await scheduleSetDone('payment_schedules', ids, true);
    ids.forEach(id=>{const it=schedData.find(s=>s.id===id);if(it)it.done=true;});
    schedSelIds.clear();renderSched();
    addLog('支払済一括マーク',`${ids.length}件`);showT(`${ids.length}件を支払済にしました`);
  }catch(e){showT('エラー: '+e.message,'ter');}
  showLoad(false);
}
async function bulkUnmarkSchedDone(){
  const ids=[...schedSelIds].filter(id=>{const it=schedData.find(s=>s.id===id);return it&&it.done;});
  if(!ids.length){showT('支払済の予定を選択してください','twa');return;}
  if(!confirm(`${ids.length}件の支払済を取り消しますか？`))return;
  showLoad(true);
  try{
    await scheduleSetDone('payment_schedules', ids, false);
    ids.forEach(id=>{const it=schedData.find(s=>s.id===id);if(it)it.done=false;});
    schedSelIds.clear();renderSched();
    addLog('支払済一括取消',`${ids.length}件`);showT(`${ids.length}件の支払済を取り消しました`);
  }catch(e){showT('エラー: '+e.message,'ter');}
  showLoad(false);
}

// markSchedDone → v9新実装に移行済み（async版）
// deleteSchedItem → v9新実装に移行済み（async版）

/* ===== ⑤ 法定乗務日報 ===== */
/* 運行の配列を取り出す。trips が無い旧データは、それまでの平坦な項目から1件ぶんに見立てる。
   一覧・印刷・CSVがどちらの形式でも同じように扱えるようにするため */
function dailyTrips(r) {
  if (Array.isArray(r.trips) && r.trips.length) {
    return [...r.trips].sort((a,b)=>String(a.start||'').localeCompare(String(b.start||'')));
  }
  if (!r.cli && !r.start_time) return [];
  return [{
    cli_id: r.cli ?? null, cli_name: lkC(r.cli)?.name || '',
    start: (r.start_time||'').slice(0,5), end: (r.end_time||'').slice(0,5),
    start_loc: r.start_location||'', end_loc: r.end_location||'',
    qty_tak: r.qty_takkyubin||0, qty_neko: r.qty_nekopos||0,
    qty_charter: r.qty_charter||0, qty_other: r.qty_other||0, note: '',
  }];
}
// 運行に出てくる取引先名を重複なく並べる
function dailyTripClients(r) {
  return [...new Set(dailyTrips(r).map(t => t.cli_name || lkC(t.cli_id)?.name || '').filter(Boolean))];
}

// 点呼方法の表示名。対面以外は具体的方法の記録が必要（輸送安全規則 第7条 ⑤ロ）
const TENKO_METHOD_LABEL = {face:'対面', phone:'電話', remote:'遠隔点呼', auto:'業務後自動点呼', other:'その他'};
let dailyReports = []; // Supabaseから読み込む
let editDailyId = null;

// 日報入力フォーム（#dailyFormArea）はpg10（管理者用）に置かれているが、
// ドライバーポータル（#dpg0）は別コンテナのため、ドライバーがログイン中はフォームDOMを
// dpg0側へ移動させてから開く。同じフォームを両方のUIで使い回すための仕組み
function ensureDailyFormPlacement() {
  const formArea = document.getElementById('dailyFormArea');
  if (!formArea) return;
  if (me?.role === 'driver') {
    const target = document.getElementById('dpg0');
    if (target && formArea.parentElement !== target) target.appendChild(formArea);
  } else {
    const host = document.getElementById('dailyFormAreaHost');
    if (host && host.nextElementSibling !== formArea) host.insertAdjacentElement('afterend', formArea);
  }
}
async function showDailyForm(reportId=null) {
  editDailyId = reportId;
  ensureDailyFormPlacement();
  document.getElementById('dailyFormArea').style.display = 'block';
  const listArea = document.getElementById(me?.role === 'driver' ? 'drvDailyListArea' : 'dailyListArea');
  if (listArea) listArea.style.display = 'none';
  // initDailyForm は車両候補の取得で非同期に動くため、必ず終わってから下書きを扱う。
  // 待たずに進めると、復元した下書きが後から終わる初期化に消される
  await initDailyForm(reportId);
  drStep = 1;
  // 新規入力のときだけ、同じ日の書きかけがあれば続きから再開できるようにする
  if (!reportId) {
    const draft = loadDrDraft();
    if (draft && confirm('入力途中の日報が残っています。続きから再開しますか？\n（いいえを選ぶと新しく入力し直します）')) {
      applyDrDraft(draft);
    } else if (draft) {
      clearDrDraft();
    }
  }
  renderDrSteps();
}

function showDailyList() {
  document.getElementById('dailyFormArea').style.display = 'none';
  if (me?.role === 'driver') {
    const listArea = document.getElementById('drvDailyListArea');
    if (listArea) listArea.style.display = 'block';
    loadDriverDailyList();
  } else {
    document.getElementById('dailyListArea').style.display = 'block';
    loadDailyReports();
  }
}

function initMob() {
  // 初期表示は一覧
  showDailyList();
  renderDailySummary();
}

// 車両番号がフル表記（例: 品川300あ1234）かどうかを判定する。数字のみの4桁略式登録は対象外
function isFullPlateNumber(car) {
  return !!car && !/^\d+$/.test(car);
}

// ドライバーはclientsテーブルを直接読めないため、名前のみを返すRPC経由で取引先候補を取得する（セッション中はキャッシュ）
let driverClientNames = null;
async function populateDriverCliList() {
  const listEl = document.getElementById('drCliList');
  if (!listEl) return;
  if (driverClientNames === null) {
    try {
      const {data, error} = await sb.rpc('list_client_names');
      driverClientNames = error ? [] : (data || []);
    } catch(e) { driverClientNames = []; }
  }
  listEl.innerHTML = driverClientNames.map(c => `<option value="${escHtml(c.name)}">`).join('');
}

async function initDailyForm(reportId=null) {
  // 日付
  const dEl = document.getElementById('drD');
  if (!dEl.value) dEl.value = fmtLocalDate(new Date());
  const carSel = document.getElementById('drCar');
  const carCustom = document.getElementById('drCarCustom');
  const isDriver = me?.role === 'driver';
  if (isDriver) {
    // ドライバー本人には自分の登録車両に加え、車両管理の乗務履歴で現在割り当てられている
    // 代車（登録車両にない場合もある）も選択肢に出す（他ドライバーの車番は見せない）。
    // 登録車両はフル表記のみ表示し、4桁だけの略式登録は非表示にする。
    // それ以外の未登録車両は「その他（手入力）」で入力できるようにする
    const ownCars = (me.driver_data?.cars || []).filter(isFullPlateNumber);
    let assignedCars = [];
    try {
      const {data} = await sb.from('vehicle_assignments').select('car').eq('driver_id', me.driver_id).is('end_date', null);
      assignedCars = [...new Set((data||[]).map(v=>v.car).filter(c=>c && !ownCars.some(oc=>nm(oc)===nm(c))))];
    } catch(e) {}
    carSel.innerHTML = '<option value="">選択してください</option>' +
      ownCars.map(c => `<option value="${c}">${c}</option>`).join('') +
      (assignedCars.length ? `<optgroup label="現在割り当て中の代車">${assignedCars.map(c => `<option value="${c}">${c}</option>`).join('')}</optgroup>` : '') +
      '<option value="__custom__">＋ その他の車両（手入力）</option>';
    enhanceSelectSearchable('drCar');
  } else {
    const allCars = drvs.flatMap(d => (d.cars||[]).filter(isFullPlateNumber).map(c => ({car:c, name:d.name, drvId:d.id})));
    // 車両管理の乗務履歴で現在使用中の代車も候補に加える（登録車両にない場合があるため）
    const assignedCars = (vehicleAssignments||[]).filter(v=>!v.end_date).map(v => {
      const d = drvs.find(x=>x.id===v.driver_id);
      return d && !allCars.some(x=>nm(x.car)===nm(v.car)) ? {car:v.car, name:d.name, drvId:d.id} : null;
    }).filter(Boolean);
    const allCarsWithAssigned = [...allCars, ...assignedCars];
    // 管理者アカウント自身にドライバーが紐づけられている場合（本人も乗務するケース）、
    // 自分の車両を「自分の車両」として先頭にまとめて出す（全ドライバー分の一覧はそのまま維持する）
    const myDrv = me?.driver_id ? drvs.find(d=>d.id===me.driver_id) : null;
    const myCars = myDrv ? allCarsWithAssigned.filter(x=>x.drvId===myDrv.id).map(x=>x.car) : [];
    carSel.innerHTML = '<option value="">選択してください</option>' +
      (myCars.length ? `<optgroup label="自分の車両（${escHtml(myDrv.name)}）">${myCars.map(c => `<option value="${c}">${c}</option>`).join('')}</optgroup>` : '') +
      allCarsWithAssigned.map(x => `<option value="${x.car}" data-name="${x.name}">${x.car}（${x.name}）</option>`).join('');
    enhanceSelectSearchable('drCar');
  }
  carCustom.style.display = 'none';
  carCustom.value = '';

  // 取引先（名前で候補表示・手入力可能なdatalist方式）。
  // ドライバーはclientsテーブルを直接読めない（RLSで他社情報を遮断済み）ため、
  // 名前だけを安全に返すRPC（list_client_names）から候補を取得する
  if (isDriver) {
    await populateDriverCliList();
  } else {
    document.getElementById('drCliList').innerHTML = clients.map(c => `<option value="${escHtml(c.name)}">`).join('');
  }

  // 既存データ編集
  if (reportId) {
    const r = dailyReports.find(x => x.id === reportId);
    if (r) {
      document.getElementById('drD').value = r.date || '';
      // 車両: 選択肢にない車番（過去の代車など）の場合は手入力欄にフォールバック
      const carOptExists = Array.from(carSel.options).some(o => o.value === (r.car||''));
      if (carOptExists) {
        carSel.value = r.car || '';
      } else if (isDriver && r.car) {
        carSel.value = '__custom__';
        carCustom.style.display = 'block';
        carCustom.value = r.car;
      } else {
        carSel.value = r.car || '';
      }
      document.getElementById('drName').value = r.driver_name || '';
      document.getElementById('drStart').value = r.start_time || '';
      document.getElementById('drEnd').value = r.end_time || '';
      document.getElementById('drKm').value = r.distance_km || '';
      document.getElementById('drOdoStart').value = r.start_odometer ?? '';
      document.getElementById('drOdoEnd').value = r.end_odometer ?? '';
      document.getElementById('drType').value = r.type || 'regular';
      // クライアント名解決: 管理者はclients、ドライバーはRPCで取得したdriverClientNamesから引く
      const cliName = r.cli ? (isDriver ? (driverClientNames||[]).find(c=>c.id===r.cli)?.name : lkC(r.cli)?.name) : '';
      document.getElementById('drAlcBefore').value = r.alc_before ?? '';
      document.getElementById('drAlcAfter').value = r.alc_after ?? '';
      document.getElementById('drAlcDevice').value = r.alc_device || '';
      document.getElementById('drHealthBefore').value = r.health_before || 'good';
      document.getElementById('drHealthAfter').value = r.health_after || 'good';
      // 点呼記録
      document.getElementById('drTenkoExecutor').value = r.tenko_executor || '';
      document.getElementById('drTenkoMethod').value = r.tenko_method || 'face';
      document.getElementById('drTenkoMethodNote').value = r.tenko_method_note || '';
      document.getElementById('drTenkoBeforeAt').value = r.tenko_before_at || '';
      document.getElementById('drTenkoAfterAt').value = r.tenko_after_at || '';
      document.getElementById('drAlcDetectorUsed').checked = r.alc_detector_used !== false;
      document.getElementById('drHealthIllness').checked = r.health_illness_ok !== false;
      document.getElementById('drHealthFatigue').checked = r.health_fatigue_ok !== false;
      document.getElementById('drHealthSleep').checked = r.health_sleep_ok !== false;
      document.getElementById('drTenkoInstructions').value = r.tenko_instructions || '';
      document.getElementById('drRouteReport').value = r.route_report || '';
      document.getElementById('drHandoverNote').value = r.handover_note || '';
      onDrTenkoMethodChange();
      document.getElementById('drCli').value = '';
      // 運行。旧データ（trips が無い）は、それまでの平坦な項目から1件ぶんに組み立てる
      pendDrTrips = Array.isArray(r.trips) && r.trips.length ? r.trips.map(t=>({...t}))
        : (r.cli || r.start_time ? [{
            cli_id: r.cli ?? null, cli_name: cliName || '',
            start: (r.start_time||'').slice(0,5), end: (r.end_time||'').slice(0,5),
            start_loc: r.start_location||'', end_loc: r.end_location||'',
            qty_tak: r.qty_takkyubin||0, qty_neko: r.qty_nekopos||0,
            qty_charter: r.qty_charter||0, qty_other: r.qty_other||0, note: '',
          }] : []);
      renderDrTrips();
      document.getElementById('drNote').value = r.note || '';
      // 出発・到着地点、休憩（貨物自動車運送事業輸送安全規則第8条）
      document.getElementById('drStartLoc').value = r.start_location || '';
      document.getElementById('drEndLoc').value = r.end_location || '';
      // 休憩は配列（rests）で保持。古いデータ（単一のrest_start等）しかない場合はそちらから復元する
      pendDrRests = Array.isArray(r.rests) && r.rests.length ? r.rests
        : (r.rest_start ? [{start:r.rest_start, end:r.rest_end||'', location:r.rest_location||''}] : []);
      document.getElementById('drRestStart').value = '';
      document.getElementById('drRestEnd').value = '';
      document.getElementById('drRestLoc').value = '';
      renderDrRests();
      // 荷待ち・付帯作業（2025年4月法改正：全車両が記録対象）
      document.getElementById('drWaitFlag').checked = !!r.wait_flag;
      document.getElementById('drWaitStart').value = r.wait_start || '';
      document.getElementById('drWaitEnd').value = r.wait_end || '';
      document.getElementById('drWaitLoc').value = r.wait_location || '';
      document.getElementById('drCargoWorkFlag').checked = !!r.cargo_work_flag;
      document.getElementById('drCargoWorkStart').value = r.cargo_work_start || '';
      document.getElementById('drCargoWorkEnd').value = r.cargo_work_end || '';
      document.getElementById('drShipperConfirmed').checked = !!r.shipper_confirmed;
      toggleDrWaitFields();
      // 事故記録
      document.getElementById('drIncidentFlag').checked = !!r.incident_flag;
      document.getElementById('drIncidentCause').value = r.incident_cause || '';
      document.getElementById('drIncidentPrevention').value = r.incident_prevention || '';
      toggleDrIncidentFields();
      // 点検復元
      const inspMap = {1:'tire',2:'brake',3:'light',4:'wiper',5:'engine',6:'mirror',7:'horn',8:'battery',9:'cargo',10:'fuel'};
      Object.entries(inspMap).forEach(([n,k])=>{const el=document.getElementById('insp'+n);if(el)el.checked=r['insp_'+k]!==false;});
      const inEl=document.getElementById('inspNote');if(inEl)inEl.value=r.insp_note||'';
    }
  } else {
    // 新規: リセット
    ['drStart','drEnd','drKm','drAlcBefore','drAlcAfter','drAlcDevice','drCli',
     'drQtyTak','drQtyNeko','drQtyCharter','drQtyOther','drNote',
     'drStartLoc','drEndLoc','drRestStart','drRestEnd','drRestLoc',
     'drWaitStart','drWaitEnd','drWaitLoc','drCargoWorkStart','drCargoWorkEnd',
     'drIncidentCause','drIncidentPrevention',
     'drTenkoMethodNote','drTenkoBeforeAt','drTenkoAfterAt',
     'drTenkoInstructions','drRouteReport','drHandoverNote',
     'drTripStart','drTripEnd','drTripStartLoc','drTripEndLoc','drTripNote',
     'drOdoStart','drOdoEnd'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    ['drWaitFlag','drCargoWorkFlag','drShipperConfirmed','drIncidentFlag'].forEach(id => {
      const el = document.getElementById(id); if(el) el.checked = false;
    });
    pendDrRests = [];
    pendDrTrips = [];
    renderDrRests();
    renderDrTrips();
    toggleDrWaitFields();
    toggleDrIncidentFields();
    document.getElementById('drHealthBefore').value = 'good';
    document.getElementById('drHealthAfter').value = 'good';
    document.getElementById('drType').value = 'regular';
    // 点呼記録の初期値。貨物軽の一人事業者は自ら点呼して対面扱いになるため、執行者は自分を既定にする
    document.getElementById('drTenkoExecutor').value = me?.name || '';
    document.getElementById('drTenkoMethod').value = 'face';
    ['drAlcDetectorUsed','drHealthIllness','drHealthFatigue','drHealthSleep'].forEach(id => {
      const el = document.getElementById(id); if(el) el.checked = true;
    });
    onDrTenkoMethodChange();
    document.getElementById('drResult').textContent = '';
  }

  // ドライバーロールなら乗務員名は常に自分自身。新規入力時、車両1台のみなら自動選択する
  if (isDriver) {
    document.getElementById('drName').value = me.name || '';
    if (!reportId) {
      const dCars = me.driver_data?.cars || [];
      if (dCars.length === 1) carSel.value = dCars[0];
    }
  }
  // 開いた時点で車が決まっていれば、その車の前回の帰着メーターを引き継ぐ。
  // 編集で開いたときも呼ぶ（中で値は触らず、案内文だけ既定に戻す）
  if (carSel.value && carSel.value !== '__custom__') await prefillOdoStart(carSel.value);
  // 出発地点は人に紐づくので、車が未選択でもドライバー本人なら引き継げる
  await prefillStartLoc();
}

// 車両番号セレクトの選択変更時: ドライバーは「その他（手入力）」欄の表示切替のみ、
// 管理者は選択した車両の所有ドライバー名を乗務員名欄へ自動反映する
function onDrCarChange() {
  const carSel = document.getElementById('drCar');
  const carCustom = document.getElementById('drCarCustom');
  if (me?.role === 'driver') {
    const showCustom = carSel.value === '__custom__';
    carCustom.style.display = showCustom ? 'block' : 'none';
    if (showCustom) carCustom.focus(); else carCustom.value = '';
  } else {
    const opt = carSel.options[carSel.selectedIndex];
    document.getElementById('drName').value = opt ? (opt.dataset.name||'') : '';
  }
  // 車が決まった時点で、その車の前回の帰着メーターを引き継ぐ
  if (carSel.value && carSel.value !== '__custom__') prefillOdoStart(carSel.value);
  // 管理者の代理入力では車番からドライバーが決まるため、出発地点もここで引き継ぐ
  if (me?.role !== 'driver') prefillStartLoc();
}

function checkAlc(input, warnId) {
  const v = parseFloat(input.value);
  const warn = document.getElementById(warnId);
  const alertBox = document.getElementById('drAlcAlert');
  if (!isNaN(v) && v >= 0.15) {
    warn.style.display = 'block';
    if (alertBox) alertBox.style.display = 'block';
  } else {
    warn.style.display = 'none';
    // 両方0.15未満なら警告非表示
    const b = parseFloat(document.getElementById('drAlcBefore').value);
    const a = parseFloat(document.getElementById('drAlcAfter').value);
    if ((isNaN(b)||b<0.15) && (isNaN(a)||a<0.15)) {
      if (alertBox) alertBox.style.display = 'none';
    }
  }
}

// 改善基準告示の「430ルール」チェック：連続運転4時間ごとに合計30分以上の休憩が必要。
// リアルタイム計測ではなく、提出内容（乗務開始〜終了・休憩時刻）から事後的に判定する
function checkContinuousDrivingWarning() {
  const start = document.getElementById('drStart').value;
  const end = document.getElementById('drEnd').value;
  if (!start || !end) return null;
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  let totalMin = toMin(end) - toMin(start);
  if (totalMin < 0) totalMin += 24*60; // 日をまたぐ場合
  // 全休憩の合計時間（複数回に分かれていてもよい）
  const restMin = pendDrRests.reduce((a,r) => {
    if (!r.start || !r.end) return a;
    let d = toMin(r.end) - toMin(r.start);
    if (d < 0) d += 24*60;
    return a + d;
  }, 0);
  // 連続運転4時間ごとに合計30分以上の休憩が必要（12時間稼働なら90分以上、など長時間ほど要件が増える）
  const requiredMin = Math.floor(totalMin / 240) * 30;
  if (requiredMin > 0 && restMin < requiredMin) {
    const h = Math.floor(totalMin/60), m = totalMin%60;
    return `⚠️ 乗務開始から終了まで${h}時間${m}分のうち、休憩の合計が${restMin}分しか記録されていません。連続運転4時間ごとに合計30分以上の休憩が必要です（改善基準告示）。目安: 合計${requiredMin}分以上。`;
  }
  return null;
}

// 休憩・睡眠は12時間稼働などで複数回に分かれることがあるため、追加式のリストで管理する
let pendDrRests = [];
function addDrRest() {
  const startEl = document.getElementById('drRestStart');
  const endEl = document.getElementById('drRestEnd');
  const locEl = document.getElementById('drRestLoc');
  const start = startEl.value, end = endEl.value, location = locEl.value.trim();
  if (!start || !end) { alert('休憩の開始・終了時刻を入力してください'); return; }
  pendDrRests.push({start, end, location});
  startEl.value = ''; endEl.value = ''; locEl.value = '';
  renderDrRests();
}
function rmDrRest(i) { pendDrRests.splice(i,1); renderDrRests(); }
function renderDrRests() {
  const el = document.getElementById('drRestList');
  if (!el) return;
  if (!pendDrRests.length) { el.innerHTML = '<div style="font-size:10px;color:var(--text3)">休憩の記録はありません</div>'; return; }
  el.innerHTML = pendDrRests.map((r,i) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 6px;background:var(--bg2);border-radius:var(--radius);margin-bottom:3px">
    <span style="flex:1">${r.start}〜${r.end}${r.location?`（${escHtml(r.location)}）`:''}</span>
    <button class="ibtn" onclick="rmDrRest(${i})" title="削除">🗑</button>
  </div>`).join('');
}

/* ===== 運行（1日に複数回） =====
   チャーターを午前と午後で別の取引先に走るような日は、運行ごとに日報を分けると
   点呼記録まで分かれてしまう。日報は1日1枚のままにして、運行だけを配列で持つ。
   既存の集計（月報・分析・CSV・印刷）は start_time / end_time / cli / qty_* を見ているため、
   保存時にこの配列から積み上げてそれらの列にも入れておく。 */
let pendDrTrips = [];

// 入力欄の取引先名から登録済みの取引先を引く。ドライバーはclientsを直接読めないためRPCの結果を使う
function drResolveClient(name) {
  const src = (me?.role === 'driver') ? (driverClientNames||[]) : clients;
  return name ? (src.find(c => nm(c.name) === nm(name)) || null) : null;
}

function addDrTrip() {
  const cliInput = document.getElementById('drCli').value.trim();
  const start = document.getElementById('drTripStart').value;
  const end   = document.getElementById('drTripEnd').value;
  if (!cliInput) { showT('取引先を入力してください', 'twa'); return; }
  const cli = drResolveClient(cliInput);
  if (!cli) { showT(`「${cliInput}」は登録済みの取引先と一致しません`, 'ter'); return; }
  if (!start || !end) { showT('運行の開始・終了時刻を入力してください', 'twa'); return; }
  pendDrTrips.push({
    cli_id: cli.id, cli_name: cli.name,
    start, end,
    start_loc: document.getElementById('drTripStartLoc').value.trim(),
    end_loc:   document.getElementById('drTripEndLoc').value.trim(),
    qty_tak:     +document.getElementById('drQtyTak').value || 0,
    qty_neko:    +document.getElementById('drQtyNeko').value || 0,
    qty_charter: +document.getElementById('drQtyCharter').value || 0,
    qty_other:   +document.getElementById('drQtyOther').value || 0,
    note: document.getElementById('drTripNote').value.trim(),
  });
  ['drCli','drTripStart','drTripEnd','drTripStartLoc','drTripEndLoc',
   'drQtyTak','drQtyNeko','drQtyCharter','drQtyOther','drTripNote']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderDrTrips();
  applyDrTripRollup();
}
function rmDrTrip(i) { pendDrTrips.splice(i,1); renderDrTrips(); applyDrTripRollup(); }

function renderDrTrips() {
  const el = document.getElementById('drTripList');
  if (!el) return;
  if (!pendDrTrips.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--amber-text);background:var(--amber-bg);border-radius:var(--radius);padding:6px 8px">運行が1件も追加されていません。上の欄を埋めて「＋ 運行を追加」を押してください</div>';
    return;
  }
  const qty = t => [t.qty_tak?`宅配便${t.qty_tak}`:'', t.qty_neko?`ポスト便${t.qty_neko}`:'',
                    t.qty_charter?`チャーター${t.qty_charter}`:'', t.qty_other?`その他${t.qty_other}`:''].filter(Boolean).join('・');
  // スマホの幅では1行に収まらず取引先名が切れてしまうため、
  // 「時刻＋取引先」と「区間・個数・メモ」の2段に分けて全文を出す
  el.innerHTML = pendDrTrips
    .map((t,i) => ({t,i}))
    .sort((a,b) => String(a.t.start||'').localeCompare(String(b.t.start||'')))
    .map(({t,i}) => {
      const sub = [
        (t.start_loc||t.end_loc) ? `${escHtml(t.start_loc||'?')} → ${escHtml(t.end_loc||'?')}` : '',
        qty(t),
        t.note ? escHtml(t.note) : '',
      ].filter(Boolean).join('　');
      return `<div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;padding:6px 8px;margin-bottom:4px;background:var(--bg2);border-radius:var(--radius)">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
            <span style="font-weight:600;white-space:nowrap">${t.start||''}〜${t.end||''}</span>
            <span style="font-weight:600;overflow-wrap:break-word;word-break:break-word">${escHtml(t.cli_name||'')}</span>
          </div>
          ${sub?`<div style="font-size:11px;color:var(--text2);margin-top:2px;overflow-wrap:break-word;word-break:break-word">${sub}</div>`:''}
        </div>
        <button class="ibtn" style="flex-shrink:0" onclick="rmDrTrip(${i})" title="削除">🗑</button>
      </div>`;
    }).join('');
}

/* 運行から1日の枠を組み立てて、上の②へ自動で反映する。
   終わってから正確な時刻を書き直す手間をなくすため、運行を足すたびに埋め直す */
/* 運行から1日の枠を埋める。埋めるのは時刻だけにしている。
   地点は種類が違うため運行からは持ってこない。1日の出発・帰着地点は自宅や配属先の
   店舗（業務を始めた／終えた場所）で、運行の場所はセンターや配達エリアだから。
   業務開始時刻も、乗務前点呼で本人が入れていれば触らない（点呼から出発までの時間が消えるため） */
function applyDrTripRollup() {
  if (!pendDrTrips.length) return;
  const starts = pendDrTrips.map(t=>t.start).filter(Boolean).sort();
  const fillIfEmpty = (id,v) => { const el=document.getElementById(id); if (el && v && !el.value) el.value = v; };
  fillIfEmpty('drStart', starts[0]);
}
/* ステップ3に入った時点で、業務終了時刻を最後の運行から補う。
   帰着地点は運行の到着先ではなく、出発地点と同じ場所（自宅・営業所）に戻ることが
   ほとんどなので、出発地点をそのまま候補として入れる */
function applyDrTripEndRollup() {
  if (!pendDrTrips.length) return;
  const ends = pendDrTrips.map(t=>t.end).filter(Boolean).sort();
  const fillIfEmpty = (id,v) => { const el=document.getElementById(id); if (el && v && !el.value) el.value = v; };
  fillIfEmpty('drEnd', ends[ends.length-1]);
  fillIfEmpty('drEndLoc', document.getElementById('drStartLoc')?.value || '');
}

// 保存する日報に、運行から積み上げた値を載せる（既存の集計がそのまま動くようにするため）
function drTripTotals(trips) {
  const t = trips || [];
  const starts = t.map(x=>x.start).filter(Boolean).sort();
  const ends   = t.map(x=>x.end).filter(Boolean).sort();
  // 業務開始・終了は本人が点呼のときに入れた値を優先する（点呼から出発まで、
  // 帰着から点呼までの時間も業務時間に含まれるため、運行の時刻とは一致しない）
  const formStart = document.getElementById('drStart')?.value || '';
  const formEnd   = document.getElementById('drEnd')?.value || '';
  return {
    cli: t[0]?.cli_id ?? null,
    start_time: formStart || starts[0] || null,
    end_time: formEnd || ends[ends.length-1] || null,
    qty_takkyubin: t.reduce((a,x)=>a+(+x.qty_tak||0),0),
    qty_nekopos:   t.reduce((a,x)=>a+(+x.qty_neko||0),0),
    qty_charter:   t.reduce((a,x)=>a+(+x.qty_charter||0),0),
    qty_other:     t.reduce((a,x)=>a+(+x.qty_other||0),0),
  };
}

function toggleDrWaitFields() {
  document.getElementById('drWaitFields').style.display = document.getElementById('drWaitFlag').checked ? 'block' : 'none';
  document.getElementById('drCargoWorkFields').style.display = document.getElementById('drCargoWorkFlag').checked ? 'block' : 'none';
}
/* 対面以外の点呼は「具体的にどうやったか」の記録が必要なため、選んだときだけ欄を出す。
   DB側にも同じ制約を入れてあるので、画面を通さない書き込みでも空では入らない */
function onDrTenkoMethodChange() {
  const m = document.getElementById('drTenkoMethod')?.value || 'face';
  const w = document.getElementById('drTenkoMethodNoteWrap');
  if (w) w.style.display = m === 'face' ? 'none' : 'block';
}

/* ===== 日報の3ステップ =====
   1日の流れ（出発前に点呼 → 走る → 帰着後に点呼）に合わせている。
   走り終わるまで確定しない項目（走行距離・帰着時刻・乗務後アルコール）を最後にまとめ、
   出発前に分かることだけ先に入れられるようにするため。
   途中で画面を閉じても失わないよう、ステップを移るたびに下書きを端末に保存する */
const DR_STEPS = [
  {n:1, label:'乗務前点呼'},
  {n:2, label:'稼働'},
  {n:3, label:'乗務後点呼'},
];
let drStep = 1;

function renderDrSteps() {
  const el = document.getElementById('drSteps');
  if (!el) return;
  el.innerHTML = DR_STEPS.map(st => {
    const done = st.n < drStep, cur = st.n === drStep;
    const bg = cur ? 'var(--blue)' : done ? 'var(--green-bg)' : 'var(--bg2)';
    const fg = cur ? '#fff' : done ? 'var(--green-text)' : 'var(--text2)';
    return `<div style="flex:1;text-align:center;padding:6px 4px;border-radius:var(--radius);background:${bg};color:${fg};font-size:11px;font-weight:600;cursor:pointer" onclick="goDrStep(${st.n})">
      ${done?'✓':st.n} ${st.label}</div>`;
  }).join('');
  document.querySelectorAll('.dr-step').forEach(d => {
    d.style.display = (+d.dataset.step === drStep) ? '' : 'none';
  });
  document.getElementById('drPrevBtn').style.display = drStep > 1 ? '' : 'none';
  document.getElementById('drNextBtn').style.display = drStep < 3 ? '' : 'none';
  document.getElementById('drSubmitBtn').style.display = drStep === 3 ? '' : 'none';
  if (drStep === 3) { applyDrTripEndRollup(); renderDrSummary(); }
  document.getElementById('dailyFormArea').scrollTop = 0;
}

/* ステップを移る。前に進むときだけ、そのステップで必要な項目が入っているかを確認する
   （戻るときや、既に通ったステップに飛ぶときは止めない） */
function goDrStep(n) {
  n = Math.max(1, Math.min(3, n));
  const resultEl = document.getElementById('drResult');
  if (n > drStep) {
    const err = validateDrStep(drStep);
    if (err) {
      resultEl.textContent = '⚠ ' + err;
      resultEl.style.color = 'var(--red)';
      return;
    }
  }
  resultEl.textContent = '';
  drStep = n;
  renderDrSteps();
  saveDrDraft();
}

function validateDrStep(step) {
  const v = id => (document.getElementById(id)?.value || '').trim();
  if (step === 1) {
    let car = v('drCar');
    if (car === '__custom__') car = v('drCarCustom');
    if (!v('drD') || !car) return '乗務日と車両番号は必須です';
    if (!v('drTenkoExecutor')) return '点呼執行者を入力してください（点呼記録簿の必須項目です）';
    if (v('drTenkoMethod') !== 'face' && !v('drTenkoMethodNote')) return '対面以外の点呼は、具体的な方法の記録が必要です';
    if (v('drAlcBefore') === '' || isNaN(+v('drAlcBefore'))) return '乗務前アルコール検知値を入力してください';
    if (!v('drHealthBefore')) return '乗務前の体調を選択してください';
    if (!v('drStart')) return '業務開始時刻を入力してください';
    if (!v('drStartLoc')) return '出発地点（業務を始めた場所）を入力してください';
  }
  if (step === 2) {
    if (!pendDrTrips.length) return '運行が1件も追加されていません。取引先と時刻を入れて「＋ 運行を追加」を押してください';
  }
  return '';
}

/* 前回の帰着メーターを、次回の出発メーターの初期値として入れる。
   同じ車に乗り続けていれば自然に埋まるので、メーターを必須にしなくても記録が揃う。
   別の車に乗り換えた日はその車の記録を探すため、勝手に前の車の数字が入ることはない。
   既に入力済みのときと、既存の日報を編集しているときは触らない。 */
const DR_ODO_HINT_DEFAULT = '車のメーターの数字をそのまま入れてください。帰着時にも入れると走行距離が自動で計算されます';
// 乗務日を変えると「前回」が変わるため、まだ空なら引き継ぎ直す
function onDrDateChange() {
  const carSel = document.getElementById('drCar');
  const car = carSel?.value === '__custom__'
    ? (document.getElementById('drCarCustom')?.value || '').trim()
    : (carSel?.value || '');
  if (car) prefillOdoStart(car);
  prefillStartLoc();
}
async function prefillOdoStart(car) {
  const el = document.getElementById('drOdoStart');
  const hint = document.getElementById('drOdoStartHint');
  if (!el || !hint) return;
  // 編集中は元の値をそのまま残す。前の画面で出た引き継ぎの案内が残ると
  // 「この値は引き継いだもの」と誤解されるため、案内だけ既定に戻す
  if (editDailyId != null) { hint.textContent = DR_ODO_HINT_DEFAULT; return; }
  if (el.value !== '') return;              // 本人が入れた値も、その案内も触らない
  hint.textContent = DR_ODO_HINT_DEFAULT;
  if (!sb || !car) return;
  const date = document.getElementById('drD')?.value || fmtLocalDate(new Date());
  try {
    const {data, error} = await sb.from('daily_reports')
      .select('date,end_odometer')
      .eq('car', car)
      .lt('date', date)                      // 同じ日の記録を自分で参照しないように前日以前に限る
      .not('end_odometer', 'is', null)
      .order('date', {ascending:false})
      .limit(1);
    if (error || !data?.length) return;
    if (el.value !== '') return;             // 問い合わせの間に入力されていたら触らない
    const last = data[0];
    el.value = last.end_odometer;
    hint.textContent = `前回（${last.date}）の帰着メーター ${last.end_odometer} を入れました。違っていれば直してください`;
    onDrOdoChange();
  } catch(e) { console.warn('prefillOdoStart:', e.message); }
}

/* 前回の出発地点を、次回の初期値として入れる。
   出発地点は業務委託なら自宅、社員なら配属先の店舗でほぼ毎日同じため、
   毎回打ち直すうちに業務先を書いてしまうのを防ぐ意味もある。
   メーターと違って車ではなく人に紐づくので、ドライバーIDで前回を探す。
   IDが分からないとき（管理者が車番未選択で代理入力するなど）は何もしない。
   他人の自宅が別のドライバーの日報に入ることは避ける。 */
function drFormDrvId() {
  if (me?.role === 'driver') return me.driver_id ?? null;
  const carSel = document.getElementById('drCar');
  const car = carSel?.value === '__custom__'
    ? (document.getElementById('drCarCustom')?.value || '').trim()
    : (carSel?.value || '');
  if (!car) return null;
  const date = document.getElementById('drD')?.value || fmtLocalDate(new Date());
  return lkDByAssign(car, date)?.id ?? lkD(car)?.id ?? null;
}
async function prefillStartLoc() {
  const el = document.getElementById('drStartLoc');
  const hint = document.getElementById('drStartLocHint');
  if (!el || !hint) return;
  if (editDailyId != null) { hint.textContent = ''; return; }  // 編集中は元の値をそのまま残す
  if (el.value !== '') return;              // 本人が入れた値も、その案内も触らない
  hint.textContent = '';
  const drvId = drFormDrvId();
  if (!sb || drvId == null) return;
  const date = document.getElementById('drD')?.value || fmtLocalDate(new Date());
  try {
    const {data, error} = await sb.from('daily_reports')
      .select('date,start_location')
      .eq('drv_id', drvId)
      .lt('date', date)                      // 同じ日の記録を自分で参照しないように前日以前に限る
      .not('start_location', 'is', null)
      .neq('start_location', '')
      .order('date', {ascending:false})
      .limit(1);
    if (error || !data?.length) return;
    if (el.value !== '') return;             // 問い合わせの間に入力されていたら触らない
    const last = data[0];
    el.value = last.start_location;
    hint.textContent = `前回（${last.date}）と同じ「${last.start_location}」を入れました。違っていれば直してください`;
  } catch(e) { console.warn('prefillStartLoc:', e.message); }
}

// メーターを両方入れたら走行距離を自動で入れる
function onDrOdoChange() {
  const a = document.getElementById('drOdoStart').value;
  const b = document.getElementById('drOdoEnd').value;
  const hint = document.getElementById('drKmHint');
  if (a === '' || b === '') { if (hint) hint.textContent = 'メーターを両方入れると自動で計算されます'; return; }
  const d = +b - +a;
  if (d < 0) { if (hint) { hint.textContent = '⚠ 帰着時のメーターが出発時より小さくなっています'; hint.style.color = 'var(--red)'; } return; }
  document.getElementById('drKm').value = d;
  if (hint) { hint.textContent = `メーターの差から自動計算しました（${b} − ${a}）`; hint.style.color = 'var(--text2)'; }
}

// 提出前の内容確認
function renderDrSummary() {
  const el = document.getElementById('drSummary');
  if (!el) return;
  const v = id => document.getElementById(id)?.value || '';
  const trips = pendDrTrips.length;
  const names = [...new Set(pendDrTrips.map(t=>t.cli_name).filter(Boolean))];
  el.innerHTML = `<div style="font-weight:600;margin-bottom:4px">提出内容の確認</div>
    <div>${escHtml(v('drD'))}　${escHtml(v('drCar')==='__custom__'?v('drCarCustom'):v('drCar'))}　${escHtml(v('drName'))}</div>
    <div>業務 ${escHtml(v('drStart'))}〜${escHtml(v('drEnd'))||'（未入力）'}　走行 ${escHtml(v('drKm'))||'—'}km</div>
    <div>運行 ${trips}件${names.length?`（${escHtml(names.join('、'))}）`:''}　休憩 ${pendDrRests.length}回</div>
    <div>アルコール 前 ${escHtml(v('drAlcBefore'))||'—'} ／ 後 ${escHtml(v('drAlcAfter'))||'（未入力）'} mg/L</div>`;
}

/* 下書きの保存。DBには入れず端末のlocalStorageに置くだけなので、
   途中の中途半端な記録がサーバーに残らない */
const DR_DRAFT_KEY = () => `drDraft:${me?.id||''}`;
function drFormFieldIds() {
  return [...document.querySelectorAll('#dailyFormArea input, #dailyFormArea select, #dailyFormArea textarea')]
    .map(el => el.id).filter(Boolean);
}
function saveDrDraft() {
  if (editDailyId) return;   // 既存の日報を編集中は下書きを作らない
  try {
    const f = {};
    drFormFieldIds().forEach(id => {
      const el = document.getElementById(id);
      f[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    localStorage.setItem(DR_DRAFT_KEY(), JSON.stringify({step:drStep, f, trips:pendDrTrips, rests:pendDrRests, at:Date.now()}));
  } catch(e) { /* 保存できなくても入力は続けられるようにする */ }
}
function loadDrDraft() {
  try {
    const raw = localStorage.getItem(DR_DRAFT_KEY());
    if (!raw) return null;
    const d = JSON.parse(raw);
    // 日付が変わった下書きは古いものとみなす
    if (d?.f?.drD && d.f.drD !== fmtLocalDate(new Date())) return null;
    return d;
  } catch(e) { return null; }
}
function clearDrDraft() { try { localStorage.removeItem(DR_DRAFT_KEY()); } catch(e) {} }
function applyDrDraft(d) {
  Object.entries(d.f || {}).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val; else el.value = val;
  });
  // 値は下書きから戻したものなので、引き継ぎの案内が残っていると出どころを誤解させる
  const locHint = document.getElementById('drStartLocHint');
  if (locHint) locHint.textContent = '';
  const odoHint = document.getElementById('drOdoStartHint');
  if (odoHint) odoHint.textContent = DR_ODO_HINT_DEFAULT;
  pendDrTrips = Array.isArray(d.trips) ? d.trips : [];
  pendDrRests = Array.isArray(d.rests) ? d.rests : [];
  renderDrTrips(); renderDrRests();
  onDrTenkoMethodChange(); toggleDrWaitFields(); toggleDrIncidentFields(); onDrOdoChange();
  drStep = d.step || 1;
}

function toggleDrIncidentFields() {
  document.getElementById('drIncidentFields').style.display = document.getElementById('drIncidentFlag').checked ? 'block' : 'none';
}

async function submitDailyReport() {
  const date = document.getElementById('drD').value;
  let car = document.getElementById('drCar').value;
  if (car === '__custom__') car = document.getElementById('drCarCustom').value.trim();
  const km = document.getElementById('drKm').value;
  const alcBefore = document.getElementById('drAlcBefore').value;
  const alcAfter = document.getElementById('drAlcAfter').value;
  const startTime = document.getElementById('drStart').value;
  const endTime = document.getElementById('drEnd').value;
  const startLoc = document.getElementById('drStartLoc').value.trim();
  const endLoc = document.getElementById('drEndLoc').value.trim();
  const healthBefore = document.getElementById('drHealthBefore').value;
  const resultEl = document.getElementById('drResult');

  // 貨物自動車運送事業輸送安全規則 第8条：乗務の開始・終了の地点・日時は乗務記録の必須記載事項。
  // ステップ1・2の必須項目は各ステップで確認済みだが、戻って消された場合に備えてここでも通す
  for (const st of [1, 2]) {
    const err = validateDrStep(st);
    if (err) {
      resultEl.textContent = `⚠ ${err}（${DR_STEPS[st-1].label}に戻って直してください）`;
      resultEl.style.color='var(--red)';
      goDrStep(st);
      return;
    }
  }
  if (!km || isNaN(+km)) { resultEl.textContent = '⚠ 走行距離を入力してください'; resultEl.style.color='var(--red)'; return; }
  if (!startTime || !endTime) { resultEl.textContent = '⚠ 乗務開始時刻・乗務終了時刻は必須です'; resultEl.style.color='var(--red)'; return; }
  if (!startLoc || !endLoc) { resultEl.textContent = '⚠ 出発地点（業務を始めた場所）と帰着地点（業務を終えた場所）は必須です'; resultEl.style.color='var(--red)'; return; }
  if (alcBefore === '' || isNaN(+alcBefore)) { resultEl.textContent = '⚠ 乗務前アルコール検知値を入力してください'; resultEl.style.color='var(--red)'; return; }
  if (alcAfter === '' || isNaN(+alcAfter)) { resultEl.textContent = '⚠ 乗務後アルコール検知値を入力してください'; resultEl.style.color='var(--red)'; return; }
  if (!healthBefore) { resultEl.textContent = '⚠ 乗務前の体調を選択してください'; resultEl.style.color='var(--red)'; return; }
  // 点呼記録簿の必須項目
  const tenkoExecutor = document.getElementById('drTenkoExecutor').value.trim();
  const tenkoMethod = document.getElementById('drTenkoMethod').value;
  const tenkoMethodNote = document.getElementById('drTenkoMethodNote').value.trim();
  if (!tenkoExecutor) { resultEl.textContent = '⚠ 点呼執行者を入力してください（点呼記録簿の必須項目です）'; resultEl.style.color='var(--red)'; return; }
  if (tenkoMethod !== 'face' && !tenkoMethodNote) {
    resultEl.textContent = '⚠ 対面以外の点呼は、具体的な方法の記録が必要です'; resultEl.style.color='var(--red)'; return;
  }
  if (!document.getElementById('drAlcDetectorUsed').checked) {
    if (!confirm('⚠ アルコール検知器を使用していない記録になります。\n検知器の使用は義務です。このまま提出しますか？')) return;
  }
  if (+alcBefore >= 0.15) {
    if (!confirm('⚠ 乗務前アルコール値が0.15mg/L以上です。記録を提出しますか？（管理者に即時報告してください）')) return;
  }
  const drivingWarning = checkContinuousDrivingWarning();
  if (drivingWarning) {
    if (!confirm(drivingWarning + '\n\nこのまま提出しますか？')) return;
  }
  // 取引先は運行を追加するときに必ず登録済みのものと照合しているため、ここでの確認は不要。
  // 入力欄に打ちかけのまま「追加」を押し忘れているケースだけ拾う
  const leftover = document.getElementById('drCli').value.trim();
  if (leftover) {
    if (!confirm(`⚠ 取引先「${leftover}」が入力欄に残っていますが、運行として追加されていません。
この分を除いて提出しますか？`)) return;
  }
  // 車番も同様にチェックする。ドライバー本人は自分の登録車両としか比較できない（RLSで他ドライバーの車両は見えないため）。
  // 車両プルダウンの候補（登録車両＋乗務履歴で割り当て中の代車）から選んだ場合は、
  // 手入力(__custom__)でない限りここでの警告は出さない（プルダウン自体が既に妥当な候補のみを出しているため）
  const carFromDropdown = car && [...document.getElementById('drCar').options].some(o => o.value === car && o.value !== '__custom__');
  if (car && !carFromDropdown) {
    const knownCars = (me?.role === 'driver') ? (me.driver_data?.cars || []) : drvs.flatMap(d => d.cars || []);
    if (!knownCars.some(c => nm(c) === nm(car))) {
      if (!confirm(`⚠ 車番「${car}」は登録車両と一致しませんでした（代車など）。このまま提出しますか？`)) return;
    }
  }

  // drv_id: RLSで「自分の日報だけ見える」を成立させるための紐付け。
  // ドライバー本人の提出は、共有車両（車番の所有者が別ドライバー）でも必ず本人IDに紐づける
  // （車番所有者に紐づけると本人が自分の日報を見られず、RLSのINSERT本人チェックにも弾かれるため）。
  // 管理者・編集者が代理入力する場合のみ、車番から所有ドライバーを解決する
  // （恒久登録車両はlkD、乗務履歴で割り当て中の代車はlkDByAssignで解決。車番プルダウンに
  // 両方の車両が候補として出るようになったため、代車を選んだ場合も正しく紐づける）。
  const resolvedDrvId = (me?.role === 'driver') ? me.driver_id : (lkDByAssign(car, date)?.id ?? lkD(car)?.id ?? null);

  const obj = {
    date,
    car,
    drv_id: resolvedDrvId,
    driver_name: document.getElementById('drName').value || '',
    start_time: startTime,
    end_time: endTime,
    distance_km: +km,
    // メーターは任意。代車への乗り換えなどで連続しない日もあるため、入っていれば残す程度にとどめる
    start_odometer: document.getElementById('drOdoStart').value === '' ? null : +document.getElementById('drOdoStart').value,
    end_odometer:   document.getElementById('drOdoEnd').value   === '' ? null : +document.getElementById('drOdoEnd').value,
    type: document.getElementById('drType').value,
    alc_before: +alcBefore,
    alc_after: +alcAfter,
    alc_device: document.getElementById('drAlcDevice').value.trim(),
    health_before: healthBefore,
    health_after: document.getElementById('drHealthAfter').value,
    // 点呼記録（輸送安全規則 第7条の記録事項）
    tenko_executor: document.getElementById('drTenkoExecutor').value.trim(),
    tenko_method: tenkoMethod,
    tenko_method_note: tenkoMethod === 'face' ? null : tenkoMethodNote,
    tenko_before_at: document.getElementById('drTenkoBeforeAt').value || null,
    tenko_after_at: document.getElementById('drTenkoAfterAt').value || null,
    alc_detector_used: document.getElementById('drAlcDetectorUsed').checked,
    health_illness_ok: document.getElementById('drHealthIllness').checked,
    health_fatigue_ok: document.getElementById('drHealthFatigue').checked,
    health_sleep_ok: document.getElementById('drHealthSleep').checked,
    tenko_instructions: document.getElementById('drTenkoInstructions').value.trim() || null,
    route_report: document.getElementById('drRouteReport').value.trim() || null,
    handover_note: document.getElementById('drHandoverNote').value.trim() || null,
    // 運行の明細と、そこから積み上げた1日ぶんの値。
    // 積み上げた値は月報・分析・CSV・印刷が従来どおり参照する
    trips: pendDrTrips,
    ...drTripTotals(pendDrTrips),
    note: document.getElementById('drNote').value.trim(),
    // 個人事業主のドライバーが自分の記録として提出するもので、会社の承認を必要としないため提出=確定とする。
    // 内容に不備があれば管理側が「差戻し」でマークし、ドライバーに修正を促す
    status: 'approved',
    submitted_by: me?.name || '',
    // 出発・到着地点、休憩（貨物自動車運送事業輸送安全規則第8条）
    start_location: startLoc,
    end_location: endLoc,
    rests: pendDrRests,
    // 荷待ち・付帯作業（2025年4月法改正：全車両が記録対象）
    wait_flag: document.getElementById('drWaitFlag').checked,
    wait_start: document.getElementById('drWaitFlag').checked ? (document.getElementById('drWaitStart').value || null) : null,
    wait_end: document.getElementById('drWaitFlag').checked ? (document.getElementById('drWaitEnd').value || null) : null,
    wait_location: document.getElementById('drWaitFlag').checked ? document.getElementById('drWaitLoc').value.trim() : '',
    cargo_work_flag: document.getElementById('drCargoWorkFlag').checked,
    cargo_work_start: document.getElementById('drCargoWorkFlag').checked ? (document.getElementById('drCargoWorkStart').value || null) : null,
    cargo_work_end: document.getElementById('drCargoWorkFlag').checked ? (document.getElementById('drCargoWorkEnd').value || null) : null,
    shipper_confirmed: document.getElementById('drShipperConfirmed').checked,
    // 事故記録
    incident_flag: document.getElementById('drIncidentFlag').checked,
    incident_cause: document.getElementById('drIncidentFlag').checked ? document.getElementById('drIncidentCause').value.trim() : '',
    incident_prevention: document.getElementById('drIncidentFlag').checked ? document.getElementById('drIncidentPrevention').value.trim() : '',
    // 車両点検
    insp_tire:    document.getElementById('insp1')?.checked||false,
    insp_brake:   document.getElementById('insp2')?.checked||false,
    insp_light:   document.getElementById('insp3')?.checked||false,
    insp_wiper:   document.getElementById('insp4')?.checked||false,
    insp_engine:  document.getElementById('insp5')?.checked||false,
    insp_mirror:  document.getElementById('insp6')?.checked||false,
    insp_horn:    document.getElementById('insp7')?.checked||false,
    insp_battery: document.getElementById('insp8')?.checked||false,
    insp_cargo:   document.getElementById('insp9')?.checked||false,
    insp_fuel:    document.getElementById('insp10')?.checked||false,
    insp_note:    document.getElementById('inspNote')?.value.trim()||'',
  };

  resultEl.textContent = '送信中...'; resultEl.style.color='var(--text2)';
  showLoad(true);
  try {
    let data;
    if (editDailyId) {
      const res = await sb.from('daily_reports').update(obj).eq('id', editDailyId).select().single();
      if (res.error) throw res.error;
      data = res.data;
      const idx = dailyReports.findIndex(x=>x.id===editDailyId);
      if (idx>=0) dailyReports[idx] = data;
      addLog('日報更新', `${car} ${date}`);
    } else {
      const res = await sb.from('daily_reports').insert(obj).select().single();
      if (res.error) throw res.error;
      data = res.data;
      dailyReports.unshift(data);
      addLog('日報提出', `${car} ${date} ${km}km アルコール前:${alcBefore}`);
    }
    clearDrDraft();
    resultEl.textContent = '✔ 提出しました'; resultEl.style.color='var(--green)';
    setTimeout(() => showDailyList(), 1200);
  } catch(e) {
    // テーブル未作成の場合のガイド
    if (e.message && (e.message.includes('does not exist') || e.message.includes('relation'))) {
      resultEl.innerHTML = `⚠ <b>daily_reportsテーブルが未作成です</b><br>管理者はセットアップタブのSQLをSupabaseで実行してください`;
      resultEl.style.color='var(--red)';
      showDailyTableSql();
    } else {
      resultEl.textContent = '✗ エラー: ' + e.message;
      resultEl.style.color='var(--red)';
    }
  }
  showLoad(false);
}

/* テーブル未作成のときの共通案内。
   以前は各機能がそれぞれCREATE TABLE文を関数の中に持っていたが、列を足しても更新されず
   本来のスキーマから乖離し、しかもRLSが allow_all（全員が全件読み書き可）のままだった。
   これを実行すると、列の欠けた無防備なテーブルができてしまう。しかも
   CREATE TABLE IF NOT EXISTS のため、後から正しいセットアップSQLを流しても直らない。
   独自SQLは全て廃止し、常に最新が載っているセットアップタブへ誘導するだけにした。 */
function openSetupSqlGuide(tableName) {
  goPage(17, document.getElementById('nt17'));
  setTimeout(() => {
    document.getElementById('setupSql')?.scrollIntoView({behavior:'smooth', block:'center'});
    showT(`${tableName} が未作成です。セットアップタブのSQLを全文コピーしてSupabaseで実行してください`);
  }, 120);
}
function showDailyTableSql() { openSetupSqlGuide('daily_reports'); }


async function loadDailyReports() {
  if (!sb) return;
  try {
    const from = document.getElementById('drListFrom')?.value || '';
    const to = document.getElementById('drListTo')?.value || '';
    /* 200件で打ち切っていたため、7人が毎日提出すると1か月分（約210件）すら
       全部は表示できず、しかも黙って切れていた。CSV出力と印刷も同じ配列を使うので、
       法定記録が欠けたまま出力されてしまう。期間で絞ったぶんは全件読む。 */
    const build = () => {
      let q = sb.from('daily_reports').select('*').order('date', {ascending:false}).order('id', {ascending:false});
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      return q;
    };
    const {data, error} = await fetchAllRows(build);
    if (error) {
      if (error.message.includes('does not exist') || error.message.includes('relation')) {
        document.getElementById('dailyListBody').innerHTML =
          `<div style="padding:20px;color:var(--amber-text);font-size:12px">
            ⚠ daily_reportsテーブルが未作成です。<br>
            セットアップタブのSQLをSupabaseで実行してください。<br>
            <button class="btn sml" style="margin-top:8px" onclick="showDailyTableSql()">セットアップを開く</button>
          </div>`;
        return;
      }
      throw error;
    }
    dailyReports = data || [];
    renderDailyList();
    renderDailySummary();
    renderDailyListCount(from, to);
  } catch(e) {
    document.getElementById('dailyListBody').innerHTML =
      `<div style="padding:20px;color:var(--red);font-size:12px">読み込みエラー: ${e.message}</div>`;
  }
}

// 読み込んだ件数を出す。黙って切れる作りに戻さないための歯止めでもある
function renderDailyListCount(from, to) {
  const el = document.getElementById('drListCount');
  if (!el) return;
  const n = dailyReports.length;
  const range = (from || to) ? `${from||'最初'} 〜 ${to||'最新'}` : '全期間';
  el.textContent = `${range}：${n}件`;
  // 期間を切らずに読むと、年数が経つほど重くなる。目安を超えたら知らせる
  el.style.color = n >= 3000 ? 'var(--amber-text)' : 'var(--text2)';
  el.title = n >= 3000 ? '件数が多いため表示に時間がかかります。期間で絞ることをおすすめします' : '';
}

function renderDailyList() {
  const drvFilter = document.getElementById('drListDrv')?.value || '';
  const statusFilter = document.getElementById('drListStatus')?.value || '';

  // ドライバープルダウン更新
  const drvSel = document.getElementById('drListDrv');
  if (drvSel) {
    const cur = drvSel.value;
    drvSel.innerHTML = '<option value="">全ドライバー</option>' +
      activeDrvs().map(d => `<option value="${d.id}" ${d.id==cur?'selected':''}>${escHtml(d.name)}</option>`).join('');
    enhanceSelectSearchable('drListDrv');
    drvSel.value = cur;
  }

  let list = dailyReports;
  if (drvFilter) {
    const drv = drvs.find(d=>d.id==drvFilter);
    if (drv) list = list.filter(r => (drv.cars||[]).some(c=>nm(c)===nm(r.car)));
  }
  if (statusFilter) list = list.filter(r=>r.status===statusFilter);

  const body = document.getElementById('dailyListBody');
  if (!list.length) {
    body.innerHTML = '<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">該当する日報がありません</div>';
    return;
  }

  const canEdit = me && (me.role==='admin'||me.role==='editor');
  body.innerHTML = list.map(r => {
    const alcWarn = (+r.alc_before>=0.15||+r.alc_after>=0.15);
    const healthBad = r.health_before==='bad'||r.health_after==='bad';
    const drv = recDrv(r);
    const cli = lkC(r.cli);
    return `<div class="dr-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
            <span style="font-weight:500;font-size:12px">${r.date}</span>
            <span style="font-size:11px;color:var(--text2)">${escHtml(r.car)} ${drv?escHtml(drv.name):''}</span>
            ${r.status==='rejected'?'<span class="dr-status rejected">差戻し</span>':''}
            ${alcWarn?'<span class="dr-alc-warn" title="アルコール検知値超過">🚨 ALc</span>':''}
            ${healthBad?'<span style="color:var(--amber-text);font-size:10px">体調不良申告</span>':''}
            ${r.incident_flag?'<span style="color:var(--red-text);font-size:10px">🚧 事故あり</span>':''}
            ${r.wait_flag?'<span style="color:var(--amber-text);font-size:10px">⏳ 荷待ちあり</span>':''}
          </div>
          <div class="dr-section">
            <span>🏃 ${r.distance_km??'—'}km</span>
            ${r.start_time?`<span>⏱ ${r.start_time}〜${r.end_time||'?'}</span>`:''}
            ${(r.start_location||r.end_location)?`<span>📍 ${escHtml(r.start_location)||'?'}→${escHtml(r.end_location)||'?'}</span>`:''}
            <span>🍺 前:${r.alc_before??'—'} 後:${r.alc_after??'—'} mg/L</span>
            ${(r.qty_takkyubin||r.qty_nekopos||r.qty_charter)?`<span>📦 宅配便:${r.qty_takkyubin||0} ポスト便:${r.qty_nekopos||0} チャーター便:${r.qty_charter||0}</span>`:''}
            ${(() => {
              const names = dailyTripClients(r);
              if (!names.length) return '';
              const trips = dailyTrips(r);
              const tip = trips.map(t=>`${t.start||''}〜${t.end||''} ${t.cli_name||''}`).join('\n');
              return `<span title="${escHtml(tip)}">🏢 ${escHtml(names.join('、'))}${trips.length>1?`（運行${trips.length}件）`:''}</span>`;
            })()}
          </div>
          ${r.note?`<div style="font-size:11px;color:var(--text2);margin-top:3px">📝 ${escHtml(r.note)}</div>`:''}
        </div>
        <div style="display:flex;gap:3px;flex-shrink:0">
          <button class="ibtn" onclick="showDailyForm(${r.id})" title="編集">✎</button>
          ${canEdit&&r.status!=='rejected'?`<button class="ibtn" style="color:var(--amber-text)" onclick="rejectDailyReport(${r.id})" title="差戻し（要修正としてマークします）">↩</button>`:''}
          ${canEdit?`<button class="ibtn" style="color:var(--red)" onclick="deleteDailyReport(${r.id})" title="削除">🗑</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderDailySummary() {
  const bar = document.getElementById('dailySummaryBar');
  if (!bar) return;
  const now = new Date();
  const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthRep = dailyReports.filter(r=>r.date&&r.date.startsWith(thisM));
  const rejected = monthRep.filter(r=>r.status==='rejected').length;
  const alcAlert = monthRep.filter(r=>+r.alc_before>=0.15||+r.alc_after>=0.15).length;
  bar.innerHTML = `
    <span style="font-size:10px;color:var(--text2)">今月（${thisM}）</span>
    <span style="font-size:11px">提出: <b>${monthRep.length}件</b></span>
    ${rejected?`<span style="font-size:11px;color:var(--red-text)">差戻し: <b>${rejected}件</b></span>`:''}
    ${alcAlert?`<span style="font-size:11px;color:var(--red)">🚨 アルコール超過記録: ${alcAlert}件</span>`:''}
  `;
}

async function rejectDailyReport(id) {
  const reason = prompt('差戻し理由を入力してください:');
  if (reason === null) return;
  try {
    const note_add = reason ? `\n[差戻し: ${reason}]` : '\n[差戻し]';
    const r = dailyReports.find(x=>x.id===id);
    const {error} = await sb.from('daily_reports').update({
      status:'rejected',
      reviewed_by:me?.name||'',
      reviewed_at:new Date().toISOString(),
      note: (r?.note||'') + note_add
    }).eq('id',id);
    if (error) throw error;
    if (r) { r.status='rejected'; r.note=(r.note||'')+note_add; }
    addLog('日報差戻し', r?.car+' '+r?.date+' '+reason);
    renderDailyList(); renderDailySummary();
    showT('差戻ししました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

async function deleteDailyReport(id) {
  if (!confirm('この日報を削除しますか？')) return;
  try {
    const {error} = await sb.from('daily_reports').delete().eq('id',id);
    if (error) throw error;
    dailyReports = dailyReports.filter(x=>x.id!==id);
    addLog('日報削除', 'id:'+id);
    renderDailyList(); renderDailySummary();
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

// 現在の絞り込み条件（日付範囲・ドライバー・ステータス）に一致する日報を、日付の古い順（時系列）で返す
function filteredDailyReportsForExport() {
  const drvFilter = document.getElementById('drListDrv')?.value || '';
  const statusFilter = document.getElementById('drListStatus')?.value || '';
  const from = document.getElementById('drListFrom')?.value || '';
  const to = document.getElementById('drListTo')?.value || '';
  let list = dailyReports;
  if (from) list = list.filter(r=>r.date&&r.date>=from);
  if (to) list = list.filter(r=>r.date&&r.date<=to);
  if (drvFilter) { const drv = drvs.find(d=>d.id==drvFilter); if (drv) list = list.filter(r => (drv.cars||[]).some(c=>nm(c)===nm(r.car))); }
  if (statusFilter) list = list.filter(r=>r.status===statusFilter);
  return [...list].sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.id-b.id));
}

// 休憩は複数回ありうるため、rests配列（新形式）を「、」区切りの文字列にまとめる。
// 旧データ（単一のrest_start等のみ）は後方互換としてそこから1件生成する
function formatRests(r) {
  const list = Array.isArray(r.rests) && r.rests.length ? r.rests
    : (r.rest_start ? [{start:r.rest_start, end:r.rest_end||'', location:r.rest_location||''}] : []);
  return list.map(x => `${x.start||''}〜${x.end||''}${x.location?`（${x.location}）`:''}`).join('、');
}

// 日報一覧（list）をCSVとしてダウンロードする。管理画面・ドライバーポータル両方の日報CSV出力で共有する
function downloadDailyReportCsv(list, filenameLabel) {
  const healthLabel = {good:'良好',normal:'普通',bad:'不調'};
  const headers = ['日付','車番','乗務員','出発地点','出発時刻','帰着地点','帰着時刻','走行距離(km)','種別',
    '休憩',
    '点呼執行者','点呼方法','点呼方法の詳細','点呼日時(前)','点呼日時(後)',
    'アルコール前(mg/L)','アルコール後(mg/L)','検知器の使用','検知器ID','体調(前)','体調(後)',
    '疾病','疲労','睡眠','指示事項','運行の状況','交替運転者への通告',
    '荷待ちあり','荷待ち開始','荷待ち終了','荷待ち地点','荷役等あり','荷役等開始','荷役等終了','荷主確認',
    '運行件数','取引先','運行明細',
    '宅配便','ポスト便','チャーター便','その他','備考',
    '事故あり','事故原因','再発防止策','ステータス'];
  const rows = list.map(r=>[
    r.date,r.car,r.driver_name,
    r.start_location||'',r.start_time||'',r.end_location||'',r.end_time||'',
    r.distance_km||0, typeShort(r.type),
    formatRests(r),
    r.tenko_executor||'', TENKO_METHOD_LABEL[r.tenko_method||'face'], r.tenko_method_note||'',
    r.tenko_before_at||'', r.tenko_after_at||'',
    r.alc_before??'',r.alc_after??'', r.alc_detector_used===false?'無':'有', r.alc_device||'',
    healthLabel[r.health_before||'good'], healthLabel[r.health_after||'good'],
    r.health_illness_ok===false?'疾病あり':'なし',
    r.health_fatigue_ok===false?'疲労あり':'なし',
    r.health_sleep_ok===false?'睡眠不足':'十分',
    r.tenko_instructions||'', r.route_report||'', r.handover_note||'',
    r.wait_flag?'あり':'', r.wait_start||'', r.wait_end||'', r.wait_location||'',
    r.cargo_work_flag?'あり':'', r.cargo_work_start||'', r.cargo_work_end||'',
    r.shipper_confirmed?'確認済':'',
    dailyTrips(r).length, dailyTripClients(r).join('、'),
    dailyTrips(r).map(t=>`${t.start||''}-${t.end||''} ${t.cli_name||''}`).join(' / '),
    r.qty_takkyubin||0,r.qty_nekopos||0,r.qty_charter||0,r.qty_other||0,
    (r.note||'').replace(/\n/g,' '),
    r.incident_flag?'あり':'', r.incident_cause||'', r.incident_prevention||'',
    r.status==='rejected'?'差戻し':''
  ].map(v=>`"${csvSafe(v).replace(/"/g,'""')}"`).join(','));
  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom,[headers.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`乗務日報_${filenameLabel||'全期間'}.csv`;a.click();
  addLog('日報CSV出力', filenameLabel||'全期間');
}

function exportDailyReportCsv() {
  const from = document.getElementById('drListFrom')?.value || '';
  const to = document.getElementById('drListTo')?.value || '';
  const month = (from||to) ? `${from}〜${to}` : '';
  downloadDailyReportCsv(filteredDailyReportsForExport(), month);
}

/* ===== 乗務日報 印刷用書式（紙の日報に近いレイアウト） ===== */
function dailyReportPrintCss() {
  return `
  *{box-sizing:border-box}
  body{font-family:"Noto Sans JP","Hiragino Sans",sans-serif;margin:0;padding:0;color:#1a1a1a;font-size:12px}
  .drp-page{padding:14mm 12mm;page-break-after:always}
  .drp-page:last-child{page-break-after:auto}
  .drp-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:6px;margin-bottom:10px}
  .drp-title{font-size:20px;font-weight:700;letter-spacing:2px}
  .drp-sub{font-size:11px;color:#555}
  table.drp-table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
  table.drp-table th,table.drp-table td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
  table.drp-table th{background:#f0f0f0;font-weight:600;width:15%;white-space:nowrap}
  .drp-section-title{font-size:11px;font-weight:700;background:#e6f1fb;padding:3px 6px;margin:10px 0 6px}
  .drp-insp{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;font-size:10px;margin-bottom:4px}
  .drp-insp span{border:1px solid #ccc;padding:2px 4px;display:block}
  .drp-insp span.ng{background:#fce8e8;color:#a32d2d;font-weight:600}
  .drp-print-bar{text-align:right;padding:8px 16px}
  .drp-print-bar button{font-size:13px;padding:6px 14px;cursor:pointer}
  @media print{.drp-print-bar{display:none}}
  `;
}
function buildDailyReportHtml(r) {
  // 取引先名: 管理者はclients、ドライバー（clientsを読めない）はRPCで取得済みのdriverClientNamesから解決する
  const cli = lkC(r.cli) || (r.cli ? (driverClientNames||[]).find(c=>c.id===r.cli) : null);
  const healthLabel = {good:'良好',normal:'普通',bad:'不調'};
  const inspList = [['insp_tire','タイヤ'],['insp_brake','ブレーキ'],['insp_light','灯火類'],['insp_wiper','ワイパー'],['insp_engine','エンジン'],
    ['insp_mirror','ミラー'],['insp_horn','ホーン'],['insp_battery','バッテリー'],['insp_cargo','積載装置'],['insp_fuel','燃料']];
  const inspHtml = inspList.map(([k,label]) => {
    const ok = r[k] !== false;
    return `<span class="${ok?'':'ng'}">${ok?'✓':'✕'} ${label}</span>`;
  }).join('');
  return `<div class="drp-page">
    <div class="drp-head">
      <div><div class="drp-title">乗務日報</div><div class="drp-sub">貨物軽自動車運送事業 法定様式準拠</div></div>
      <div class="drp-sub">発行日: ${fmtLocalDate(new Date())}</div>
    </div>
    <table class="drp-table">
      <tr><th>乗務日</th><td>${r.date||''}</td><th>車両番号</th><td>${escHtml(r.car)}</td></tr>
      <tr><th>乗務員名</th><td>${escHtml(r.driver_name)}</td><th>乗務形態</th><td>${typeShort(r.type)}</td></tr>
    </table>

    <div class="drp-section-title">① 乗務記録</div>
    <table class="drp-table">
      <tr><th>業務開始</th><td>${r.start_time||'—'}${r.start_location?`（${escHtml(r.start_location)}）`:''}</td>
          <th>業務終了</th><td>${r.end_time||'—'}${r.end_location?`（${escHtml(r.end_location)}）`:''}</td></tr>
      <tr><th>走行距離</th><td>${r.distance_km??''} km</td>
          <th>休憩</th><td>${escHtml(formatRests(r)) || '—'}</td></tr>
    </table>

    <div class="drp-section-title">② 点呼記録</div>
    <table class="drp-table">
      <tr><th>点呼執行者</th><td>${escHtml(r.tenko_executor||'')}</td>
          <th>点呼方法</th><td>${TENKO_METHOD_LABEL[r.tenko_method||'face']}${r.tenko_method_note?`（${escHtml(r.tenko_method_note)}）`:''}</td></tr>
      <tr><th>点呼日時（前）</th><td>${r.date} ${r.tenko_before_at||'—'}</td>
          <th>点呼日時（後）</th><td>${r.date} ${r.tenko_after_at||'—'}</td></tr>
      <tr><th>酒気帯び（前）</th><td>${r.alc_before??''} mg/L　${(+r.alc_before||0)>0?'検出あり':'検出なし'}</td>
          <th>酒気帯び（後）</th><td>${r.alc_after??''} mg/L　${(+r.alc_after||0)>0?'検出あり':'検出なし'}</td></tr>
      <tr><th>検知器の使用</th><td>${r.alc_detector_used===false?'無':'有'}${r.alc_device?`（${escHtml(r.alc_device)}）`:''}</td>
          <th>疾病・疲労・睡眠</th><td>${r.health_illness_ok===false?'疾病あり':'疾病なし'} ／ ${r.health_fatigue_ok===false?'疲労あり':'疲労なし'} ／ ${r.health_sleep_ok===false?'睡眠不足':'睡眠十分'}</td></tr>
      <tr><th>体調（前／後）</th><td>${healthLabel[r.health_before||'good']} ／ ${healthLabel[r.health_after||'good']}</td>
          <th>指示事項</th><td>${escHtml(r.tenko_instructions||'')||'—'}</td></tr>
      <tr><th>自動車・道路及び運行の状況</th><td>${escHtml(r.route_report||'')||'—'}</td>
          <th>交替運転者への通告</th><td>${escHtml(r.handover_note||'')||'—'}</td></tr>
    </table>

    ${(r.wait_flag||r.cargo_work_flag) ? `
    <div class="drp-section-title">③ 荷待ち・付帯作業</div>
    <table class="drp-table">
      ${r.wait_flag?`<tr><th>荷待ち</th><td>${r.wait_start||''}〜${r.wait_end||''}${r.wait_location?`（${escHtml(r.wait_location)}）`:''}</td></tr>`:''}
      ${r.cargo_work_flag?`<tr><th>荷役・付帯作業</th><td>${r.cargo_work_start||''}〜${r.cargo_work_end||''}</td></tr>`:''}
      <tr><th>荷主確認</th><td>${r.shipper_confirmed?'確認済':'未確認'}</td></tr>
    </table>` : ''}

    <div class="drp-section-title">④ 運行の記録</div>
    ${(() => {
      const trips = dailyTrips(r);
      if (!trips.length) return '<table class="drp-table"><tr><td>—</td></tr></table>';
      return `<table class="drp-table">
        <tr><th style="width:100px">時刻</th><th>取引先</th><th style="width:150px">区間</th><th style="width:150px">個数</th></tr>
        ${trips.map(t => `<tr>
          <td>${t.start||''}〜${t.end||''}</td>
          <td>${escHtml(t.cli_name || lkC(t.cli_id)?.name || '')}${t.note?`<div style="font-size:10px">${escHtml(t.note)}</div>`:''}</td>
          <td>${escHtml(t.start_loc||'')}${(t.start_loc||t.end_loc)?' → ':''}${escHtml(t.end_loc||'')}</td>
          <td>${[t.qty_tak?`宅配便${t.qty_tak}`:'', t.qty_neko?`ポスト便${t.qty_neko}`:'', t.qty_charter?`チャーター${t.qty_charter}`:'', t.qty_other?`その他${t.qty_other}`:''].filter(Boolean).join(' ／ ')||'—'}</td>
        </tr>`).join('')}
        <tr><th>合計</th><td colspan="3">運行${trips.length}件　宅配便${r.qty_takkyubin||0} ／ ポスト便${r.qty_nekopos||0} ／ チャーター便${r.qty_charter||0} ／ その他${r.qty_other||0}</td></tr>
      </table>`;
    })()}

    <div class="drp-section-title">⑤ 車両日常点検</div>
    <div class="drp-insp">${inspHtml}</div>
    ${r.insp_note?`<div style="font-size:11px;margin-bottom:8px">点検異常内容: ${escHtml(r.insp_note)}</div>`:''}

    <div class="drp-section-title">⑥ 特記事項</div>
    <table class="drp-table"><tr><td style="min-height:32px">${escHtml(r.note).replace(/\n/g,'<br>')||'—'}</td></tr></table>
    ${r.incident_flag?`<table class="drp-table"><tr><th>事故原因</th><td>${escHtml(r.incident_cause)||'—'}</td></tr><tr><th>再発防止策</th><td>${escHtml(r.incident_prevention)||'—'}</td></tr></table>`:''}

    ${r.status==='rejected'?`<table class="drp-table">
      <tr><th>ステータス</th><td>差戻し</td><th>差戻し者</th><td>${escHtml(r.reviewed_by)||'—'}${r.reviewed_at?`（${(r.reviewed_at||'').slice(0,16).replace('T',' ')}）`:''}</td></tr>
    </table>`:''}
  </div>`;
}
// 複数日報を日付の古い順（時系列）にまとめ、1つの印刷用ドキュメントにする
function buildDailyReportsPrintDoc(reports) {
  const sorted = [...reports].sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.id-b.id));
  const pages = sorted.map(r => buildDailyReportHtml(r)).join('');
  const label = sorted.length ? `${sorted[0].date}${sorted.length>1?`〜${sorted[sorted.length-1].date}`:''}` : '';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>乗務日報_${label}</title>
  <style>${dailyReportPrintCss()}</style></head><body>
  <div class="drp-print-bar"><button onclick="window.print()">🖨 印刷 / PDF保存</button></div>
  ${pages}
  </body></html>`;
}
// 管理画面: 現在の絞り込み条件（日付範囲・ドライバー・ステータス）に一致する日報を印刷
function printDailyReports() {
  const list = filteredDailyReportsForExport();
  if (!list.length) { alert('対象の日報がありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  win.document.open(); win.document.write(buildDailyReportsPrintDoc(list)); win.document.close();
  addLog('日報印刷', `${list.length}件`);
}
// ドライバーポータル: 現在表示中の月の自分の日報を印刷（loadDriverDailyListがdailyReportsに反映済み）
async function printDriverDailyReports() {
  if (!dailyReports.length) { alert('対象の日報がありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  // 取引先名の解決用（ドライバーはclientsを読めないためRPC経由の候補が必要）。未取得なら先に読み込む
  if (me?.role === 'driver' && driverClientNames === null) await populateDriverCliList();
  win.document.open(); win.document.write(buildDailyReportsPrintDoc(dailyReports)); win.document.close();
}

// 日報は請求集計と違って「今日提出されたものを今すぐ確認する」用途のため、
// 請求系で使うensureMonthRangeDefault（前月がデフォルト）ではなく今月をデフォルトにする
function _setDailyListMonth() {
  const fromEl = document.getElementById('drListFrom');
  const toEl = document.getElementById('drListTo');
  if (fromEl && toEl && !fromEl.value) {
    const now = new Date();
    fromEl.value = fmtLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
    toEl.value = fmtLocalDate(new Date(now.getFullYear(), now.getMonth()+1, 0));
  }
}

/* ===== ⑥ 月次締め処理 ===== */
function initClose() {
  ensureMonthRangeDefault('closeFrom', 'closeTo');
}

function runClosePreview() {
  const from = document.getElementById('closeFrom').value;
  const to = document.getElementById('closeTo').value;
  if (!from || !to) { alert('対象期間を選択してください'); return; }
  const month = `${from}〜${to}`;

  const monthRecs = recs.filter(r => r.date && r.date >= from && r.date <= to);
  const unmatched = monthRecs.filter(r=>!recDrv(r)).length;

  const checks = [
    { ok: monthRecs.length > 0, label: `対象レコード: ${monthRecs.length}件` },
    { ok: unmatched === 0, label: `未照合車番: ${unmatched}件${unmatched?'　⚠ ドライバー未登録車あり':' ✓'}` },
  ];

  document.getElementById('closeCheckList').innerHTML = checks.map(c =>
    `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;border-bottom:0.5px solid var(--border)">
      <span style="color:${c.ok?'var(--green)':'var(--amber-text)'};font-size:14px">${c.ok?'✓':'⚠'}</span>
      <span>${c.label}</span>
    </div>`
  ).join('');

  document.getElementById('closeSummary').style.display = 'block';
  document.getElementById('closeActions').style.display = 'block';

  // プレビューテーブル
  const totalAmt = monthRecs.reduce((a,r)=>a+totR(r,taxMode),0);
  document.getElementById('closeOutput').innerHTML =
    `${month} — ${monthRecs.length}件 / 合計 ${yen(totalAmt)}`;

  renderCloseTable(month, monthRecs);
}

function renderCloseTable(month, monthRecs) {
  const byDrv = {};
  monthRecs.forEach(r => {
    const d = recDrv(r); const k = d ? d.name : '（未照合）';
    if (!byDrv[k]) byDrv[k] = {recs:[], drv:d};
    byDrv[k].recs.push(r);
  });
  let html = `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:10px">
    <thead><tr style="background:var(--bg2)">
      <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">ドライバー</th>
      <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">件数</th>
      <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">売上合計</th>
      <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">手取り概算</th>
    </tr></thead><tbody>`;
  Object.entries(byDrv).forEach(([name, {recs:dRecs, drv}]) => {
    const gross = dRecs.reduce((a,r)=>a+totR(r,'inc'),0);
    let takeHome = gross;
    if (drv) {
      const feeRate = drv.fee_rate != null ? drv.fee_rate : -0.15;
      const adminFee = drv.admin_fee != null ? drv.admin_fee : -10000;
      const vehicleRental = drv.vehicle_rental != null ? drv.vehicle_rental : -30000;
      const baseGrossAll = dRecs.reduce((a,r)=>a+(r.fare||0)+(r.hw||0)+(r.oth||0),0); // 全明細の税別ベース額（非課税分を含む）
      const nonTax = dRecs.filter(r=>(r.tax||0)===0).reduce((a,r)=>a+sub(r),0);
      const baseGross = baseGrossAll - nonTax; // 税別金額（課税対象分のみ。非課税分は業務手数料の対象外）
      const taxAmt = gross - baseGrossAll;
      const { bizFeeWithTax } = calcBizFeeWithTax(baseGross, taxAmt, feeRate);
      const otherTotal = (drv.other_deductions||[]).reduce((s,od)=>s+(Number(od.amount)||0),0);
      takeHome = gross + bizFeeWithTax + adminFee + vehicleRental + otherTotal;
    }
    html += `<tr>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border)">${name}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">${dRecs.length}件</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">${yen(gross)}</td>
      <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-weight:600">${drv ? yen(takeHome) : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  const ct = document.getElementById('closeTable');
  ct.innerHTML = html; ct.style.display = 'block';
}

function downloadBook1Csv() {
  const from = document.getElementById('closeFrom').value;
  const to = document.getElementById('closeTo').value;
  if (!from || !to) { alert('対象期間を選択してください'); return; }
  const month = `${from}_${to}`;
  // 既存のdownloadPayCsv相当をmonthRecs→payRowsに変換して実行
  const monthRecs = recs.filter(r => r.date && r.date >= from && r.date <= to);
  const payDate = from.replace(/-/g,''); // 仮の支払日（集計開始日）

  const headers = ['ドライバーID','業務手数料率','備考','事務手数料','車両レンタル','請求明細書番号','支払実行日','№','月日','車番・名前','作業明細','高速代他','距離/時間','数量','単価'];
  const lines = [headers.join(',')];

  function fmtDate(s) {
    if (!s) return '';
    const md = String(s).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (md) return `${md[1]}.${parseInt(md[2])}.${parseInt(md[3])}`;
    return s;
  }
  function cell(v) {
    if (v===''||v===null||v===undefined) return '';
    const s = csvSafe(String(v).trim());
    if (s.includes('"')||s.includes(',')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  // ドライバーごとにグループ化
  drvs.forEach(d => {
    const dCars = d.cars || [];
    const dRecs = monthRecs.filter(r => dCars.some(c => nm(c)===nm(r.car))).sort((a,b)=>a.date.localeCompare(b.date));
    if (!dRecs.length) return;
    dRecs.forEach((r, idx) => {
      const cli = clients.find(c=>c.id===r.cli);
      const cliName = cli ? (cli.short||cli.name) : '';
      const detail = [cliName, r.note].filter(Boolean).join(' ') || typeShort(r.type);
      const isFirst = idx===0;
      lines.push([
        cell(isFirst ? (d.supplier_id||'') : ''),
        cell(isFirst ? (d.fee_rate!=null?d.fee_rate:-0.15) : ''),
        cell(''),
        cell(isFirst ? (d.admin_fee!=null?d.admin_fee:-10000) : ''),
        cell(isFirst ? (d.vehicle_rental!=null?d.vehicle_rental:-30000) : ''),
        cell(isFirst ? (d.supplier_id||'') : ''),
        cell(fmtDate(payDate)),
        cell(idx+1),
        cell(fmtDate(r.date)),
        cell(`${r.car} ${d.name}`),
        cell(detail),
        cell(feeBreakdown(r,'payment').total||''),
        cell(''),
        cell(1),
        cell(r.fare||0)
      ].join(','));
    });
  });

  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom, lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `Book1_${month}.csv`; a.click();
  addLog('月次締め Book1出力', month);
  showT('Book1.csvをダウンロードしました');
}

function exportCloseReport() {
  const from = document.getElementById('closeFrom').value;
  const to = document.getElementById('closeTo').value;
  const month = `${from}_${to}`;
  const monthRecs = recs.filter(r => r.date && r.date >= from && r.date <= to);
  const lines = [['日付','車番','ドライバー','種別','運賃','高速','立替代','追加料金(他)','税','合計','ステータス','取引先','備考'].join(',')];
  monthRecs.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r => {
    const d = recDrv(r); const c = lkC(r.cli);
    const fb = feeBreakdown(r,'billing');
    lines.push([r.date, r.car, d?.name||'未照合', typeShort(r.type),
      r.fare||0, fb.hw, fb.oth, fb.other, (r.tax??10), totR(r,'inc')+sumRecsExtraFees([r],'billing'), stLbl(r.st),
      c?.name||'', r.note||''].join(','));
  });
  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom, lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `締め報告_${month}.csv`; a.click();
}

async function markMonthApproved() {
  const from = document.getElementById('closeFrom').value;
  const to = document.getElementById('closeTo').value;
  if (!from || !to) return;
  const month = `${from}〜${to}`;
  if (!confirm(`${month}の未確認レコードをすべて「確認済」にしますか？`)) return;
  const targets = recs.filter(r => r.date && r.date >= from && r.date <= to && r.st < 1);
  if (!targets.length) { showT('対象なし'); return; }
  showLoad(true);
  try {
    const ids = targets.map(r=>r.id);
    const {error} = await sb.from('invoices').update({st:1}).in('id',ids);
    if (error) throw error;
    targets.forEach(r => r.st = 1);
    addLog('月次確認', `${month} ${ids.length}件`);
    showT(`${ids.length}件を確認済にしました`);
    runClosePreview();
  } catch(e) { showT('エラー: '+e.message, 'ter'); }
  showLoad(false);
}

