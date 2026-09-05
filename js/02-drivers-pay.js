/* js/02-drivers-pay.js
   ドライバー管理の一覧、車両管理、支払明細書の作成と保存

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ===== 🚚 ドライバー管理：仕入れ先ID順ソート＆四角・横長レイアウト切替対応 ===== */
let drvViewMode = 'list';

function setDriverView(mode) {
  drvViewMode = mode;
  const bCard = document.getElementById('bViewCard');
  const bList = document.getElementById('bViewList');
  if (bCard && bList) {
    if (mode === 'card') {
      bCard.style.background = 'var(--blue)'; bCard.style.color = '#fff';
      bList.style.background = 'transparent'; bList.style.color = 'var(--text)';
    } else {
      bList.style.background = 'var(--blue)'; bList.style.color = '#fff';
      bCard.style.background = 'transparent'; bCard.style.color = 'var(--text)';
    }
  }
  renderDrv();
}

/* ===== 車両管理（自社の代車・リース車の車検・保険期限・現在の使用者を一覧管理） ===== */
let vehicles = [];
let eVehicleId = null;

async function loadVehicles() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('vehicles').select('*').order('car').order('id'));
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) return;
      throw error;
    }
    vehicles = data || [];
  } catch(e) { console.warn('loadVehicles:', e.message); }
}

// この車番の「使用中」の乗務履歴（end_date未設定）からドライバーを引く
function currentVehicleDriver(car) {
  const open = vehicleAssignments.find(v => nm(v.car)===nm(car) && !v.end_date);
  if (!open) return null;
  return drvs.find(d => d.id === open.driver_id) || null;
}
// 全ドライバーの登録車番（フル表記優先。フル表記が無ければ略式車番、プレースホルダー「----」は除外）を重複なく集める
function getAllRegisteredCarNumbers() {
  const set = new Set();
  drvs.forEach(d => {
    const cars = (d.cars || []).filter(c => c && !c.includes('----'));
    const full = cars.filter(isFullPlateNumber);
    (full.length ? full : cars).forEach(c => set.add(c));
  });
  return [...set].sort();
}
/* ドライバーには登録済みだが車両管理(vehicles)にまだ無い車番。
   台帳に入れるのは稼働中ドライバーのフル表記の車番だけにする。
   数字だけの略式車番は同じ車の別表記であることが多く、解約済みドライバーの車番は
   コムトラからの引き継ぎ分に重複が残っているため、どちらも台帳には入れない。 */
function getUnregisteredCarNumbers() {
  const registered = new Set(vehicles.map(v => nm(v.car)));
  const missing = new Set();
  drvs.forEach(d => {
    if (d.status === 'terminated') return;
    (d.cars || []).forEach(c => {
      if (!c || c.includes('----') || !isFullPlateNumber(c)) return;
      if (registered.has(nm(c))) return;
      missing.add(c);
    });
  });
  return [...missing].sort();
}

/* 同じ車の表記ゆれと思われる組み合わせ（分類記号＋かな＋一連番号が同じで、地名だけ違う）。
   「仙台480れ2618」と「宮城480れ2618」のような重複登録に気づけるように一覧へ出す */
function vehiclePlateVariants() {
  const bySig = new Map();
  (vehicles||[]).forEach(v => {
    const m = nm(v.car).match(/(\d{1,3}[^\d]{1,2}\d{1,4})$/);   // 末尾の「480れ2618」部分
    if (!m) return;
    const sig = m[1];
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(v);
  });
  return [...bySig.values()].filter(list => list.length > 1)
    .sort((a,b) => nm(a[0].car).localeCompare(nm(b[0].car), 'ja'));
}

/* 車両カルテの「使用者」。乗務履歴に使用中の記録があればそれを最優先し、
   無ければドライバー登録の担当車番から引く（取り込んだ車両にも使用者が出るようにするため） */
function vehicleUserDriver(car) {
  const byAssign = currentVehicleDriver(car);
  if (byAssign) return {drv: byAssign, fromAssign: true};
  const d = drvs.find(x => x.status !== 'terminated' && (x.cars||[]).some(c => nm(c)===nm(car)));
  return d ? {drv: d, fromAssign: false} : null;
}

/* ドライバー登録で車番を足したとき、車両管理(vehicles)にも同じ車番を自動で作る。
   車両管理を唯一の台帳にするため、登録の手間を二重にしないための処理。
   種別は「未分類」で入り、車両管理の一覧に⚠付きで出るので、あとで分類してもらう。
   失敗してもドライバー登録自体は成功扱いにする（台帳は後から取り込みボタンで揃えられる） */
async function syncVehiclesFromDriverCars(cars) {
  if (!sb || !cars?.length) return;
  const registered = new Set(vehicles.map(v => nm(v.car)));
  const add = [...new Set(cars.filter(c => c && !c.includes('----') && isFullPlateNumber(c) && !registered.has(nm(c))))];
  if (!add.length) return;
  try {
    const {data, error} = await sb.from('vehicles')
      .insert(add.map(car => ({car, status:'active', vehicle_type:'unclassified', note:'ドライバー登録の車番から自動作成'})))
      .select();
    if (error) throw error;
    vehicles.push(...(data||[]));
  } catch(e) { console.warn('syncVehiclesFromDriverCars:', e.message); }
}

/* ドライバー登録に無い車番を車両管理へまとめて取り込む（種別は未分類。あとで分類する） */
async function importUnregisteredCars() {
  if (!sb) return;
  const cars = getUnregisteredCarNumbers();
  if (!cars.length) { showT('取り込む車番はありません'); return; }
  if (!confirm(`ドライバー登録にあって車両管理に無い車番 ${cars.length}台 を取り込みます。\n種別は「未分類」で登録されるので、あとで自社所有／持ち込み／リースに分類してください。\nよろしいですか？`)) return;
  showLoad(true);
  try {
    const rows = cars.map(car => ({car, status:'active', vehicle_type:'unclassified', note:'ドライバー登録の車番から取り込み'}));
    const {data, error} = await sb.from('vehicles').insert(rows).select();
    if (error) throw error;
    vehicles.push(...(data||[]));
    addLog('車番の一括取り込み', `${cars.length}台`);
    renderVehicles();
    showT(`${cars.length}台を取り込みました`);
  } catch(e) { showT('取込エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* ===== リース会社 ⇄ 所属車両の連動 =====
   車両管理で「リース」種別＋リース会社名を設定した車両を、会社名でまとめて引けるようにする。
   会社マスタでリース会社に指定した会社のカードに、所属車番を自動表示するために使う
   （別途の登録作業は不要で、車両管理の登録がそのまま反映される）。 */
function leaseCarsIndex() {
  const map = new Map();
  (vehicles||[]).forEach(v => {
    if (v.vehicle_type !== 'lease' || !v.lease_company || !v.car) return;
    const k = nm(v.lease_company);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v.car);
  });
  map.forEach(list => list.sort((a,b)=>nm(a).localeCompare(nm(b),'ja')));
  return map;
}
// 協力会社カードの「所属車両」から車両管理タブへ飛び、その会社の車両で絞り込む
function jumpToVehiclesByLease(name) {
  goPage(26, document.getElementById('nt26'));
  setTimeout(()=>{
    const sel = document.getElementById('vehicleLeaseFilter');
    if (!sel) return;
    const target = `lease::${name}`;
    if ([...sel.options].some(o=>o.value===target)) { sel.value = target; renderVehicles(); }
  }, 0);
}

// 種別フィルタの選択肢を、登録済み車両の内訳（自社所有・持ち込み・リース会社ごとの台数）から再構築する。
// 旧データ（vehicle_type='own'。持ち込み・自社所有が未分離だった頃の値）は自社所有として数える
function populateVehicleLeaseFilter() {
  const sel = document.getElementById('vehicleLeaseFilter');
  if (!sel) return;
  const cur = sel.value;
  const companyCount = vehicles.filter(v=>v.vehicle_type!=='lease' && v.vehicle_type!=='brought' && v.vehicle_type!=='unclassified').length;
  const broughtCount = vehicles.filter(v=>v.vehicle_type==='brought').length;
  const unclassifiedCount = vehicles.filter(v=>v.vehicle_type==='unclassified').length;
  const leaseGroups = {};
  vehicles.filter(v=>v.vehicle_type==='lease').forEach(v=>{
    const name = v.lease_company || '（リース会社未設定）';
    leaseGroups[name] = (leaseGroups[name]||0)+1;
  });
  const leaseNames = Object.keys(leaseGroups).sort((a,b)=>nm(a).localeCompare(nm(b),'ja'));
  sel.innerHTML = `<option value="">種別・リース会社: すべて（${vehicles.length}台）</option>`
    + `<option value="company">自社所有（${companyCount}台）</option>`
    + `<option value="brought">持ち込み（${broughtCount}台）</option>`
    + (unclassifiedCount ? `<option value="unclassified">⚠ 未分類（${unclassifiedCount}台）</option>` : '')
    + leaseNames.map(n=>`<option value="lease::${escHtml(n)}">${escHtml(n)}（${leaseGroups[n]}台）</option>`).join('');
  sel.value = [...sel.options].some(o=>o.value===cur) ? cur : '';
}
function vehicleTypeLabel(v) {
  if (v.vehicle_type === 'lease') return 'リース';
  if (v.vehicle_type === 'brought') return '持ち込み';
  if (v.vehicle_type === 'unclassified') return '未分類';
  return '自社所有'; // 'company'、および旧データ'own'（未分離だった頃の値）はここに含める
}

/* ===== 日報×車両乗務履歴の不一致検知 =====
   日報で実際に使われた車番のうち、その日を乗務履歴（vehicle_assignments）でカバーできていない
   ものを検出する。自動では乗務履歴を作成しない（日額リース設定のある車だと、日報の入力ミスで
   勝手に控除が発生してしまうため）。あくまで事務所が気づいて手動登録するための通知にとどめる。 */
let vehicleMismatches = [];
async function loadDailyReportVehicleMismatches() {
  if (!sb) { vehicleMismatches = []; return; }
  const since = fmtLocalDate(new Date(Date.now() - 60*86400000)); // 直近60日分のみ対象（重すぎず、実務上意味のある範囲）
  try {
    const { data, error } = await sb.from('daily_reports').select('car,date,drv_id').gte('date', since).not('drv_id', 'is', null);
    if (error) throw error;
    const grouped = {};
    (data||[]).forEach(r => {
      if (!r.car || !r.date) return;
      const d = driverIndexes().id.get(r.drv_id);
      if (!d) return;
      if ((d.cars||[]).some(c => nm(c)===nm(r.car))) return; // 恒久登録車両は対象外
      const covered = (vehicleAssignments||[]).some(v => v.driver_id===d.id && nm(v.car)===nm(r.car) && v.start_date<=r.date && (!v.end_date || r.date<=v.end_date));
      if (covered) return;
      const k = `${nm(r.car)}__${d.id}`;
      if (!grouped[k]) grouped[k] = { car:r.car, drvId:d.id, drvName:d.name, dates:[] };
      grouped[k].dates.push(r.date);
    });
    vehicleMismatches = Object.values(grouped).map(g => {
      const dates = g.dates.sort();
      return { ...g, count:dates.length, minDate:dates[0], maxDate:dates[dates.length-1] };
    });
  } catch(e) { console.warn('loadDailyReportVehicleMismatches:', e.message); vehicleMismatches = []; }
}
function toggleVehicleMismatchList() {
  const el = document.getElementById('vehicleMismatchList');
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
// 不一致一覧から「乗務履歴に登録」を押した時、車両乗務履歴モーダルをその内容で開く
function quickRegisterVehicleMismatch(car, drvId, minDate) {
  openVehicleHistM(car);
  const d = drvs.find(x=>x.id===drvId);
  if (d) {
    document.getElementById('vhDrvId').value = d.id;
    document.getElementById('vhDrvText').value = q0DrvOverrideLabel(d);
  }
  document.getElementById('vhStart').value = minDate;
}
// 同じ車の別表記が二重登録されていないかの注意書き（地名だけ違う車番の組み合わせ）
function vehicleVariantPanelHtml() {
  const groups = vehiclePlateVariants();
  if (!groups.length) return '';
  return `<div style="padding:8px 12px;margin-bottom:10px;background:var(--amber-bg);border:0.5px solid var(--amber-border);border-radius:var(--radius);font-size:11.5px;color:var(--amber-text)">
      <span style="cursor:pointer" onclick="toggleVehicleVariantList()">⚠ 同じ車の表記ゆれと思われる車番があります（${groups.length}組）（クリックで一覧表示）</span>
      <div id="vehicleVariantList" style="display:none;flex-direction:column;gap:4px;margin-top:8px">
        ${groups.map(list => `<div style="background:var(--bg);border-radius:var(--radius);padding:5px 8px">
          ${list.map(v => `<span style="cursor:pointer;text-decoration:underline dotted;margin-right:10px" onclick="editVehicle(${v.id})">🚙 ${escHtml(v.car)}</span>`).join('')}
          <span style="color:var(--text2)">— 使わない方をカルテから削除してください</span>
        </div>`).join('')}
      </div>
    </div>`;
}
function toggleVehicleVariantList() {
  const el = document.getElementById('vehicleVariantList');
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
function renderVehicleMismatchPanel() {
  const el = document.getElementById('vehicleMismatchArea');
  if (!el) return;
  const variantHtml = vehicleVariantPanelHtml();
  if (!vehicleMismatches.length) { el.innerHTML = variantHtml; return; }
  const totalCnt = vehicleMismatches.length;
  el.innerHTML = variantHtml + `
    <div style="padding:8px 12px;margin-bottom:10px;background:var(--amber-bg);border:0.5px solid var(--amber-border);border-radius:var(--radius);font-size:11.5px;color:var(--amber-text)">
      <span style="cursor:pointer" onclick="toggleVehicleMismatchList()">⚠ 乗務履歴の登録がない車番で日報が提出されています（${totalCnt}件・直近60日）（クリックで一覧表示）</span>
      <div id="vehicleMismatchList" style="display:none;flex-direction:column;gap:4px;margin-top:8px">
        ${vehicleMismatches.map(m => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--bg);border-radius:var(--radius);padding:5px 8px">
          <span>🚙 ${escHtml(m.car)}　${escHtml(m.drvName)}　${m.minDate}${m.maxDate!==m.minDate?`〜${m.maxDate}`:''}（${m.count}日分）</span>
          <button class="btn sml" onclick="quickRegisterVehicleMismatch('${escAttrJs(m.car)}',${m.drvId},'${escAttrJs(m.minDate)}')">乗務履歴に登録</button>
        </div>`).join('')}
      </div>
    </div>`;
}
function renderVehicles() {
  const listEl = document.getElementById('vehicleList');
  if (!listEl) return;
  const kpiEl = document.getElementById('vehicleKpi');
  if (kpiEl) {
    const active = vehicles.filter(v=>v.status!=='scrapped');
    const unclassified = active.filter(v=>v.vehicle_type==='unclassified');
    const unreg = getUnregisteredCarNumbers();
    const soonOrExpired = active.filter(v => {
      const sts = [v.shaken_expiry, v.jibai_expiry, v.nini_expiry].map(d=>docStatusOf({expiry_date:d}));
      return sts.some(s => ['expired','soon'].includes(s.cls));
    });
    kpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">登録車両数</div><div class="kpi-val">${active.length}台</div></div>
      <div class="kpi-card"><div class="kpi-label">種別が未分類</div><div class="kpi-val" style="color:${unclassified.length?'var(--amber-text)':'inherit'}">${unclassified.length}台</div></div>
      <div class="kpi-card"><div class="kpi-label">車検・保険 要確認</div><div class="kpi-val" style="color:${soonOrExpired.length?'var(--amber-text)':'inherit'}">${soonOrExpired.length}台</div></div>
      <div class="kpi-card"><div class="kpi-label">取り込み待ちの車番</div><div class="kpi-val" style="color:${unreg.length?'var(--amber-text)':'inherit'}">${unreg.length}台</div></div>
      <div class="kpi-card"><div class="kpi-label">廃車</div><div class="kpi-val">${vehicles.filter(v=>v.status==='scrapped').length}台</div></div>
    `;
  }
  renderVehicleMismatchPanel();
  populateVehicleLeaseFilter();
  if (!vehicles.length) { listEl.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">車両が登録されていません</div>`; return; }
  const q = nm(document.getElementById('vehicleSearch')?.value||'');
  const leaseFilter = document.getElementById('vehicleLeaseFilter')?.value || '';
  const statusFilter = document.getElementById('vehicleStatusFilter')?.value ?? 'active';
  let filtered = q ? vehicles.filter(v=>nm(v.car).includes(q)) : vehicles;
  if (leaseFilter === 'company') filtered = filtered.filter(v=>v.vehicle_type!=='lease' && v.vehicle_type!=='brought' && v.vehicle_type!=='unclassified');
  else if (leaseFilter === 'brought') filtered = filtered.filter(v=>v.vehicle_type==='brought');
  else if (leaseFilter === 'unclassified') filtered = filtered.filter(v=>v.vehicle_type==='unclassified');
  else if (leaseFilter.startsWith('lease::')) {
    const name = leaseFilter.slice(7);
    filtered = filtered.filter(v=>v.vehicle_type==='lease' && (v.lease_company||'（リース会社未設定）')===name);
  }
  if (statusFilter === 'active') filtered = filtered.filter(v=>v.status!=='scrapped');
  else if (statusFilter === 'scrapped') filtered = filtered.filter(v=>v.status==='scrapped');
  if (!filtered.length) { listEl.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">該当する車両が見つかりません</div>`; return; }
  // 並び順: 現在の使用者のドライバーID順（未割当は車番順で末尾に）
  filtered = [...filtered].sort((a,b) => {
    const ida = vehicleUserDriver(a.car)?.drv?.supplier_id;
    const idb = vehicleUserDriver(b.car)?.drv?.supplier_id;
    if (ida && idb) return ida.localeCompare(idb, 'ja', {numeric:true}) || nm(a.car).localeCompare(nm(b.car));
    if (ida) return -1;
    if (idb) return 1;
    return nm(a.car).localeCompare(nm(b.car));
  });
  const canE = me && me.role !== 'viewer';
  const headerRow = `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 12px 6px;gap:12px;font-size:10.5px;color:var(--text2);font-weight:600">
    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;flex-wrap:wrap">
      <div style="width:125px;flex-shrink:0;">車番</div>
      <div style="width:100px;flex-shrink:0;">現在の使用者</div>
      <div style="width:60px;flex-shrink:0;">種別</div>
      <div style="width:115px;flex-shrink:0;">リース会社</div>
      <div style="width:110px;flex-shrink:0;">車検</div>
      <div style="width:110px;flex-shrink:0;">自賠責</div>
      <div style="width:110px;flex-shrink:0;">任意保険</div>
      <div style="flex:1;min-width:80px;">備考</div>
    </div>
    <div style="width:60px;flex-shrink:0;"></div>
  </div>`;
  listEl.innerHTML = headerRow + filtered.map(v => {
    const user = vehicleUserDriver(v.car);
    const drv = user?.drv || null;
    const scrapped = v.status === 'scrapped';
    return `<div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;padding:9px 12px;margin-bottom:6px;gap:12px;cursor:pointer" title="ダブルクリックで編集" ondblclick="editVehicle(${v.id})">
      <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;flex-wrap:wrap">
        <div style="width:125px;font-weight:600;font-size:13px;flex-shrink:0;overflow-wrap:break-word;word-break:break-word;">🚙 ${escHtml(v.car)}${scrapped?' <span class="bdg" style="background:var(--gray-bg);color:var(--gray-text)">廃車</span>':''}</div>
        <div style="width:100px;font-size:12px;flex-shrink:0;cursor:pointer;color:var(--blue)" onclick="event.stopPropagation();openVehicleHistM('${escAttrJs(v.car)}')" ondblclick="event.stopPropagation()" title="${drv?(user.fromAssign?'乗務履歴に登録された使用者\n':'ドライバー登録の担当車番から表示しています（乗務履歴は未登録）\n'):''}クリックで車両カルテの乗務履歴を開きます">${drv?escHtml(drv.name)+(user.fromAssign?'':'<span style="color:var(--text2)">*</span>'):'未割当'}</div>
        <div style="width:60px;font-size:11px;flex-shrink:0;${v.vehicle_type==='unclassified'?'color:var(--amber-text);font-weight:600':'color:var(--text2)'}" title="${v.vehicle_type==='unclassified'?'ドライバーの書類提出から自動登録されたため種別が未確認です。編集して自社所有／持ち込み／リースのいずれかを選択してください':''}">${v.vehicle_type==='unclassified'?'⚠ ':''}${vehicleTypeLabel(v)}</div>
        <div style="width:115px;font-size:11px;flex-shrink:0;color:var(--text2);overflow-wrap:break-word;word-break:break-word;">${v.vehicle_type==='lease'?escHtml(v.lease_company||'（未設定）'):'—'}</div>
        ${!scrapped ? `
        <div style="width:110px;font-size:11px;flex-shrink:0;">${v.shaken_expiry||'—'} ${docStatusPill({expiry_date:v.shaken_expiry})}</div>
        <div style="width:110px;font-size:11px;flex-shrink:0;">${v.jibai_expiry||'—'} ${docStatusPill({expiry_date:v.jibai_expiry})}</div>
        <div style="width:110px;font-size:11px;flex-shrink:0;">${v.nini_expiry||'—'} ${docStatusPill({expiry_date:v.nini_expiry})}</div>
        ` : `<div style="width:110px;font-size:11px;color:var(--text2);flex-shrink:0;">—</div><div style="width:110px;font-size:11px;color:var(--text2);flex-shrink:0;">—</div><div style="width:110px;font-size:11px;color:var(--text2);flex-shrink:0;">—</div>`}
        <div style="flex:1;min-width:80px;font-size:11px;color:var(--text2)">${v.note?escHtml(v.note):''}</div>
      </div>
      ${canE ? `<div style="width:60px;display:flex;gap:1px;flex-shrink:0;" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><button class="ibtn" onclick="editVehicle(${v.id})">✎</button><button class="ibtn" onclick="deleteVehicle(${v.id})">🗑</button></div>` : '<div style="width:60px;flex-shrink:0;"></div>'}
    </div>`;
  }).join('');
}

// 車両カルテのリース会社プルダウン（会社マスタでリース会社に指定した会社＋既存車両で使われている会社名を候補にする）
function populateVehicleLeaseSel(selected) {
  const sel = document.getElementById('vLeaseCompany');
  if (!sel) return;
  const fromMaster = leaseClients().map(c=>c.name);
  const fromVehicles = vehicles.map(v=>v.lease_company).filter(Boolean);
  const companies = [...new Set([...fromMaster, ...fromVehicles])].sort((a,b)=>nm(a).localeCompare(nm(b),'ja'));
  if (selected && !companies.includes(selected)) companies.push(selected);
  sel.innerHTML = '<option value="">（未設定）</option>'
    + companies.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')
    + '<option value="__new__">＋ 新しいリース会社を追加...</option>';
  enhanceSelectSearchable('vLeaseCompany');
  sel.value = selected || '';
}
// 種別（持ち込み/リース）切り替えでリース会社欄の表示を切り替える
function onVehicleTypeChange() {
  const isLease = document.getElementById('vType').value === 'lease';
  document.getElementById('vLeaseCompanyWrap').style.display = isLease ? '' : 'none';
}
// リース会社プルダウンで「＋新規追加」を選んだ場合、協力会社にリース会社として登録する（ドライバー登録の同機能と同じ流れ）
async function onVehicleLeaseSelChange() {
  const sel = document.getElementById('vLeaseCompany');
  if (!sel || sel.value !== '__new__') return;
  const name = (prompt('新しいリース会社名を入力してください:')||'').trim();
  if (!name) { sel.value = ''; return; }
  try {
    await ensureLeaseClient(name);
    populateVehicleLeaseSel(name);
  } catch(e) { showT('リース会社の追加に失敗しました: '+e.message, 'ter'); sel.value=''; }
}
/* 車両カルテを開く。追加も編集も同じ画面で、下半分に使用者・乗務履歴が付く。
   新規追加のときは車番がまだ決まっていないため、履歴の部分は保存後に使えるようにしておく */
function openVehicleM(car) {
  eVehicleId = null;
  vhCurrentCar = car || null;
  document.getElementById('mVehicleH').innerHTML = '車両カルテ（新規追加） <button class="ibtn" onclick="closeM(\'mVehicle\')">✕</button>';
  document.getElementById('vCar').value = car || '';
  document.getElementById('vCarSuggestList').innerHTML = getUnregisteredCarNumbers().map(c=>`<option value="${escHtml(c)}">`).join('');
  document.getElementById('vStatus').value = 'active';
  document.getElementById('vType').value = 'company';
  populateVehicleLeaseSel('');
  document.getElementById('vLeaseCompanyWrap').style.display = 'none';
  ['vDailyRate','vShakenExpiry','vJibaiExpiry','vNiniExpiry','vNote'].forEach(id => document.getElementById(id).value = '');
  setVehicleHistSection(false);
  document.getElementById('mVehicle').classList.add('on');
}
function editVehicle(id, focusHist) {
  const v = vehicles.find(x=>x.id===id); if (!v) return;
  eVehicleId = id;
  vhCurrentCar = v.car;
  document.getElementById('mVehicleH').innerHTML = `車両カルテ: ${escHtml(v.car)} <button class="ibtn" onclick="closeM('mVehicle')">✕</button>`;
  document.getElementById('vCar').value = v.car;
  document.getElementById('vStatus').value = v.status || 'active';
  // 旧データ(vehicle_type='own'。持ち込み・自社所有が未分離だった頃の値)は自社所有として編集フォームに出す。
  // 保存すると新しい値'company'として書き込まれ、以後は分類済みになる。
  // 'unclassified'（書類提出や車番の取り込みから自動登録され未確認）はそのまま選択欄に表示し、
  // 選択肢の中では選べない状態にすることで、必ずどれかへ選び直してもらう
  document.getElementById('vType').value = (!v.vehicle_type || v.vehicle_type === 'own') ? 'company' : v.vehicle_type;
  populateVehicleLeaseSel(v.lease_company || '');
  document.getElementById('vLeaseCompanyWrap').style.display = v.vehicle_type==='lease' ? '' : 'none';
  document.getElementById('vDailyRate').value = v.daily_rate ?? '';
  document.getElementById('vShakenExpiry').value = v.shaken_expiry || '';
  document.getElementById('vJibaiExpiry').value = v.jibai_expiry || '';
  document.getElementById('vNiniExpiry').value = v.nini_expiry || '';
  document.getElementById('vNote').value = v.note || '';
  setVehicleHistSection(true);
  document.getElementById('mVehicle').classList.add('on');
  if (focusHist) setTimeout(() => document.getElementById('vhSection')?.scrollIntoView({behavior:'smooth', block:'start'}), 60);
}
// 使用者・乗務履歴の欄を使える状態にする（車番が確定している車両のときだけ）
function setVehicleHistSection(on) {
  document.getElementById('vhSection').style.display = on ? '' : 'none';
  document.getElementById('vhSectionHint').style.display = on ? 'none' : '';
  if (!on) return;
  document.getElementById('vhDrvId').value = '';
  document.getElementById('vhDrvText').value = '';
  document.getElementById('vhStart').value = fmtLocalDate(new Date());
  document.getElementById('vhEnd').value = '';
  // 車両に日額リース料が登録済みならデフォルト値として入れておく（変更可）
  const vMaster = vehicles.find(v => nm(v.car) === nm(vhCurrentCar||''));
  document.getElementById('vhRate').value = vMaster?.daily_rate ?? '';
  document.getElementById('vhNote').value = '';
  document.getElementById('vhDrvList').innerHTML = activeDrvs().map(d=>`<option value="${escHtml(q0DrvOverrideLabel(d))}">`).join('');
  renderVehicleHist();
}
// 車両側の車検・保険期限が(手動で)変わったら、現在この車を使っているドライバーの提出書類（既に提出済みの分のみ）の
// 期限表示も合わせて更新する。ファイルの再アップロードは行わず、期限日付のみを同期する
async function syncDriverDocFromVehicleEdit(car, updates) {
  const targetDrv = currentVehicleDriver(car) || drvs.find(d => (d.cars||[]).some(c => nm(c)===nm(car)));
  if (!targetDrv) return;
  const fieldMap = { shaken_expiry: 'shaken', jibai_expiry: 'jibai', nini_expiry: 'nini' };
  for (const [vField, docType] of Object.entries(fieldMap)) {
    if (!(vField in updates)) continue;
    const existing = findDriverDoc(targetDrv.id, docType);
    if (!existing || existing.expiry_date === updates[vField]) continue;
    try {
      const {error} = await sb.from('driver_documents').update({expiry_date: updates[vField]}).eq('drv_id', targetDrv.id).eq('doc_type', docType);
      if (error) throw error;
      existing.expiry_date = updates[vField];
    } catch(e) { console.warn('syncDriverDocFromVehicleEdit:', e.message); }
  }
}
async function saveVehicle() {
  const car = document.getElementById('vCar').value.trim();
  if (!car) { alert('車番は必須です'); return; }
  const dup = vehicles.find(v => nm(v.car)===nm(car) && v.id !== eVehicleId);
  if (dup) { alert(`車番「${car}」は既に登録されています`); return; }
  const vType = document.getElementById('vType').value;
  const leaseCompanyVal = document.getElementById('vLeaseCompany').value;
  const obj = {
    car,
    status: document.getElementById('vStatus').value,
    vehicle_type: vType,
    lease_company: (vType === 'lease' && leaseCompanyVal && leaseCompanyVal !== '__new__') ? leaseCompanyVal : null,
    daily_rate: document.getElementById('vDailyRate').value === '' ? null : +document.getElementById('vDailyRate').value,
    shaken_expiry: document.getElementById('vShakenExpiry').value || null,
    jibai_expiry: document.getElementById('vJibaiExpiry').value || null,
    nini_expiry: document.getElementById('vNiniExpiry').value || null,
    note: document.getElementById('vNote').value.trim(),
  };
  showLoad(true);
  try {
    if (eVehicleId != null) {
      const {data, error} = await sb.from('vehicles').update(obj).eq('id', eVehicleId).select().single();
      if (error) throw error;
      const idx = vehicles.findIndex(v=>v.id===eVehicleId);
      if (idx>=0) vehicles[idx] = data;
      addLog('車両編集', car);
      await syncDriverDocFromVehicleEdit(car, { shaken_expiry: obj.shaken_expiry, jibai_expiry: obj.jibai_expiry, nini_expiry: obj.nini_expiry });
    } else {
      const {data, error} = await sb.from('vehicles').insert(obj).select().single();
      if (error) throw error;
      vehicles.push(data);
      addLog('車両追加', car);
    }
    closeM('mVehicle');
    renderVehicles();
    refreshPayAggIfVisible(); // 支払明細書作成タブから開いた場合、その場で集計テーブルにも反映する
    showT('保存しました');
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) {
      showT('⚠ vehiclesテーブルが未作成です。セットアップページのSQLを確認してください','twa');
    } else { showT('保存エラー: '+e.message, 'ter'); }
  }
  showLoad(false);
}
async function deleteVehicle(id) {
  const v = vehicles.find(x=>x.id===id); if (!v) return;
  if (!confirm(`車両「${v.car}」を削除しますか？（乗務履歴は残ります）`)) return;
  showLoad(true);
  try {
    const {error} = await sb.from('vehicles').delete().eq('id', id);
    if (error) throw error;
    vehicles = vehicles.filter(x=>x.id!==id);
    addLog('車両削除', v.car);
    renderVehicles();
    refreshPayAggIfVisible();
    showT('削除しました');
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
  showLoad(false);
}
// 支払明細書作成タブ（集計）の車番・ドライバー名リンクから車両・ドライバーをその場で編集した際、
// 裏で開いたままのpg6の集計テーブルにも即座に反映させる（タブを切り替えずに済むようにしたための追随処理）
function refreshPayAggIfVisible() {
  if (!document.getElementById('pg6')?.classList.contains('hide') && document.getElementById('aggPayTbody')) runAggPay();
}

/* ===== 車両乗務履歴（車番ごとに過去〜現在の使用ドライバーを記録） =====
   受注入力・請求明細の車番→ドライバー自動判定（drvs.cars）とは独立した履歴台帳。
   代車など自社車両を日額リースとして貸した場合、使用期間から金額を自動計算し
   ドライバーの「その他控除」への追加を提案できる。 */
let vehicleAssignments = [];
let vhCurrentCar = null;

async function loadVehicleAssignments() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('vehicle_assignments').select('*').order('start_date', {ascending:false}).order('id', {ascending:false}));
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) return;
      throw error;
    }
    vehicleAssignments = data || [];
    invalidateVehicleAssignIndex();
  } catch(e) { console.warn('loadVehicleAssignments:', e.message); }
}

/* --- 「その他の項目」上書きモーダル（支払集計の「その他」列から開く） --- */
let payAdjDrvId = null, payAdjFrom = '', payAdjTo = '', payAdjItems = [];

function openPayAdjM(drvId) {
  const d = drvPay(drvs.find(x => x.id === drvId));
  if (!d) return;
  // 期間キーは支払集計タブの集計期間ピッカーの値。ここが空だと期間を特定できないため上書きさせない
  payAdjFrom = document.getElementById('aggPayFrom')?.value || '';
  payAdjTo   = document.getElementById('aggPayTo')?.value || '';
  if (!payAdjFrom || !payAdjTo) { showT('先に集計期間を指定してください', 'ter'); return; }
  payAdjDrvId = drvId;
  const cur = otherItemsForPeriod(d, payAdjFrom, payAdjTo);
  payAdjItems = cur.items.map(it => ({name: it.name, amount: it.amount}));
  document.getElementById('mPayAdjH').innerHTML =
    `その他の項目: ${escHtml(d.name)} <button class="ibtn" onclick="closeM('mPayAdj')">✕</button>`;
  document.getElementById('payAdjPeriod').textContent = `集計期間 ${payAdjFrom} 〜 ${payAdjTo}`;
  document.getElementById('payAdjName').value = '';
  document.getElementById('payAdjAmt').value = '';
  renderPayAdjItems();
  document.getElementById('mPayAdj').classList.add('on');
}

function renderPayAdjItems() {
  const el = document.getElementById('payAdjList');
  const overridden = !!findPayAdj(payAdjDrvId, payAdjFrom, payAdjTo);
  const st = document.getElementById('payAdjState');
  if (st) st.innerHTML = overridden
    ? '<span class="bdg" style="background:var(--amber-bg);color:var(--amber-text)">上書き中</span> この期間は手入力した内訳を使っています'
    : '<span class="bdg" style="background:var(--gray-bg);color:var(--gray-text)">自動計算</span> ドライバー登録の控除項目＋代車リース代の自動計算です';
  const rb = document.getElementById('payAdjResetBtn');
  if (rb) rb.classList.toggle('hide', !overridden);
  if (!payAdjItems.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text3)">項目なし（＋追加で項目を作れます）</div>';
  } else {
    el.innerHTML = payAdjItems.map((it,i) => `<div style="display:flex;align-items:center;gap:5px">
      <input type="text" value="${escHtml(it.name)}" onchange="editPayAdjItem(${i},'name',this.value)" style="flex:2">
      <input type="number" step="1" value="${it.amount}" onchange="editPayAdjItem(${i},'amount',this.value)" style="flex:1;text-align:right">
      <button class="ibtn" onclick="rmPayAdjItem(${i})" title="削除">🗑</button>
    </div>`).join('');
  }
  const total = payAdjItems.reduce((a,it)=>a+(Number(it.amount)||0), 0);
  const tEl = document.getElementById('payAdjTotal');
  if (tEl) { tEl.textContent = yen(total); tEl.style.color = total < 0 ? '#e05b5b' : 'inherit'; }
}
function editPayAdjItem(i, field, val) {
  if (!payAdjItems[i]) return;
  payAdjItems[i][field] = field === 'amount' ? (Math.round(+val) || 0) : val;
  renderPayAdjItems();
}
function rmPayAdjItem(i) { payAdjItems.splice(i,1); renderPayAdjItems(); }
function addPayAdjItem() {
  const name = document.getElementById('payAdjName').value.trim();
  const amount = Math.round(+document.getElementById('payAdjAmt').value) || 0;
  if (!name) { showT('名称を入力してください', 'ter'); return; }
  payAdjItems.push({name, amount});
  document.getElementById('payAdjName').value = '';
  document.getElementById('payAdjAmt').value = '';
  renderPayAdjItems();
}

async function savePayAdj() {
  if (!sb || payAdjDrvId == null) return;
  const items = payAdjItems.map(it => ({name: it.name, amount: Number(it.amount)||0}));
  try {
    const {data, error} = await sb.from('pay_adjustments')
      .upsert({cli_id: payAdjDrvId, period_from: payAdjFrom, period_to: payAdjTo, items,
               updated_at: new Date().toISOString()}, {onConflict: 'drv_id,period_from,period_to'})
      .select().single();
    if (error) throw error;
    payAdjustments = payAdjustments.filter(a => !(String(a.cli_id)===String(payAdjDrvId) && a.period_from===payAdjFrom && a.period_to===payAdjTo));
    payAdjustments.push(data);
    closeM('mPayAdj');
    showT('保存しました');
    runAggPay();
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
}

async function resetPayAdj() {
  if (!sb || payAdjDrvId == null) return;
  const row = findPayAdj(payAdjDrvId, payAdjFrom, payAdjTo);
  if (!row) { closeM('mPayAdj'); return; }
  if (!confirm('この期間の上書きを削除して、自動計算に戻しますか？')) return;
  try {
    const {error} = await sb.from('pay_adjustments').delete().eq('id', row.id);
    if (error) throw error;
    payAdjustments = payAdjustments.filter(a => a.id !== row.id);
    closeM('mPayAdj');
    showT('自動計算に戻しました');
    runAggPay();
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
}

/* 一覧の「現在の使用者」から呼ばれる。車両カルテを開いて履歴欄まで送る。
   台帳に無い車番なら、その車番を入れた状態で新規追加として開く */
function openVehicleHistM(car) {
  const v = vehicles.find(x => nm(x.car) === nm(car));
  if (v) editVehicle(v.id, true);
  else openVehicleM(car);
}
function onVhDrvTextInput() {
  const val = document.getElementById('vhDrvText').value.trim();
  const match = drvs.find(d => q0DrvOverrideLabel(d) === val) || drvs.find(d => d.name === val);
  document.getElementById('vhDrvId').value = match ? match.id : '';
}
function vhDaysAndAmount(v) {
  if (!v.end_date || !v.daily_rate) return null;
  const days = Math.round((new Date(v.end_date) - new Date(v.start_date)) / 86400000) + 1;
  return { days, amt: days * v.daily_rate };
}
function renderVehicleHist() {
  const list = vehicleAssignments.filter(v => nm(v.car) === nm(vhCurrentCar)).sort((a,b)=> (b.start_date||'').localeCompare(a.start_date||''));
  const cur = list.find(v => !v.end_date);
  const curArea = document.getElementById('vhCurrentArea');
  if (cur) {
    const d = drvs.find(x=>x.id===cur.driver_id);
    curArea.innerHTML = `<div style="padding:8px 10px;background:var(--blue-bg);border-radius:var(--radius);font-size:12.5px">
      <b>現在の使用者:</b> ${d?escHtml(d.name):'（削除済みドライバー）'}　開始: ${cur.start_date}${cur.daily_rate?`　日額: ${yen(cur.daily_rate)}`:''}
      <button class="btn sml" style="margin-left:8px" onclick="endVehicleAssignment(${cur.id})">終了する</button>
    </div>`;
  } else {
    curArea.innerHTML = `<div style="padding:8px 10px;background:var(--bg2);border-radius:var(--radius);font-size:12.5px;color:var(--text2)">現在の使用者は記録されていません</div>`;
  }
  const histEl = document.getElementById('vhHistList');
  if (!list.length) { histEl.innerHTML = '<div style="font-size:11.5px;color:var(--text2)">履歴なし</div>'; return; }
  histEl.innerHTML = list.map(v => {
    const d = drvs.find(x=>x.id===v.driver_id);
    const period = `${v.start_date}〜${v.end_date||'（使用中）'}`;
    const calc = vhDaysAndAmount(v);
    const amtLabel = calc ? `　${calc.days}日 × ${yen(v.daily_rate)} = ${yen(calc.amt)}` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:5px 0;border-bottom:0.5px solid var(--border);font-size:12px">
      <div>${d?escHtml(d.name):'（削除済みドライバー）'}<div style="font-size:10.5px;color:var(--text2)">${period}${amtLabel}${v.note?`　${escHtml(v.note)}`:''}</div></div>
      <button class="ibtn" onclick="deleteVehicleAssignment(${v.id})" title="削除">🗑</button>
    </div>`;
  }).join('');
}
async function addVehicleAssignment() {
  const driverId = +document.getElementById('vhDrvId').value || null;
  if (!driverId) { alert('候補からドライバーを選択してください'); return; }
  const startDate = document.getElementById('vhStart').value;
  if (!startDate) { alert('開始日を入力してください'); return; }
  const endDate = document.getElementById('vhEnd').value || null;
  if (endDate && endDate < startDate) { alert('終了日は開始日より後の日付にしてください'); return; }
  const rateVal = document.getElementById('vhRate').value;
  const dailyRate = rateVal === '' ? null : +rateVal;
  const note = document.getElementById('vhNote').value.trim();
  showLoad(true);
  try {
    // 同じ車番で使用中(end_date未設定)の記録が既にあれば、新しい開始日の前日で自動的に終了させる（引き継ぎ）
    const openOnes = vehicleAssignments.filter(v => nm(v.car)===nm(vhCurrentCar) && !v.end_date);
    for (const o of openOnes) {
      const prevEnd = fmtLocalDate(new Date(new Date(startDate).getTime() - 86400000));
      const {error: uErr} = await sb.from('vehicle_assignments').update({end_date: prevEnd}).eq('id', o.id);
      if (!uErr) o.end_date = prevEnd;
    }
    // 終了日まで分かっている場合（短期の貸出予定など）は、その場で終了済みとして記録できる
    const {data, error} = await sb.from('vehicle_assignments').insert({car: vhCurrentCar, driver_id: driverId, start_date: startDate, end_date: endDate, daily_rate: dailyRate, note}).select().single();
    if (error) throw error;
    vehicleAssignments.push(data);
    invalidateVehicleAssignIndex();
    addLog('車両乗務履歴登録', `${vhCurrentCar} → ${drvs.find(d=>d.id===driverId)?.name||''}（${startDate}〜${endDate||''}）`);
    document.getElementById('vhDrvId').value=''; document.getElementById('vhDrvText').value='';
    document.getElementById('vhEnd').value='';
    document.getElementById('vhRate').value=''; document.getElementById('vhNote').value='';
    renderVehicleHist();
    renderVehicles(); // 背後の車両一覧「現在の使用者」列も即座に更新する
    showT('記録しました');
  } catch(e) {
    if (e.message.includes('does not exist')||e.message.includes('relation')) {
      showT('⚠ vehicle_assignmentsテーブルが未作成です。セットアップページのSQLを確認してください','twa');
    } else { showT('登録エラー: '+e.message, 'ter'); }
  }
  showLoad(false);
}
async function endVehicleAssignment(id) {
  const v = vehicleAssignments.find(x=>x.id===id);
  if (!v) return;
  const endDate = prompt('終了日を入力してください（例: 2026-07-20）', fmtLocalDate(new Date()));
  if (!endDate) return;
  showLoad(true);
  try {
    const {error} = await sb.from('vehicle_assignments').update({end_date: endDate}).eq('id', id);
    if (error) throw error;
    v.end_date = endDate;
    invalidateVehicleAssignIndex();
    const d = drvs.find(x=>x.id===v.driver_id);
    addLog('車両乗務履歴終了', `${v.car} ${d?.name||''} 〜${endDate}`);
    renderVehicleHist();
    renderVehicles(); // 使用者が「なし」に変わるため車両一覧も更新する
    // 日額リース料は支払集計(runAggPay)・支払明細書作成時にvehicleRentalForPeriod()が
    // この乗務履歴から対象期間分を自動計算するため、ここで控除を確定登録する必要はない
    showT(vhDaysAndAmount(v) ? '終了しました（対象期間の支払集計に日額リース料が自動反映されます）' : '終了しました');
  } catch(e) { showT('更新エラー: '+e.message, 'ter'); }
  showLoad(false);
}
/* ===== 支払明細書「その他の項目」の月別上書き（pay_adjustments） =====
   既定では drivers.other_deductions（毎月固定の保険料・家賃など）＋
   車両乗務履歴からの代車リース代の自動計算を「その他の項目」として使う。
   集計期間ごとに上書き行を保存すると、その期間だけ手入力した内訳に差し替わる。
   上書きを削除すれば自動計算に戻るため、翌月に金額を引きずらない。 */
let payAdjustments = [];

async function loadPayAdjustments() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('pay_adjustments').select('*').order('id'));
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) return;
      throw error;
    }
    payAdjustments = data || [];
  } catch(e) { console.warn('loadPayAdjustments:', e.message); }
}

// 集計期間はドライバーごとに変わらない（画面の集計期間ピッカーの値）ため、期間そのものをキーにする
function findPayAdj(cliId, from, to) {
  return (payAdjustments||[]).find(a =>
    String(a.cli_id) === String(cliId) && a.period_from === (from||'') && a.period_to === (to||'')) || null;
}

// その期間の「その他の項目」の内訳。上書きがあればそれを、無ければ自動計算した既定値を返す。
// 控除はマイナス金額で持つ（代車リース代は自動計算の絶対値をマイナスにして揃える）
function otherItemsForPeriod(drv, from, to) {
  const adj = drv ? findPayAdj(drv.id, from, to) : null;
  if (adj) {
    const items = (adj.items||[]).map(it => ({name: it.name||'', amount: Number(it.amount)||0}));
    return { items, total: items.reduce((s,it)=>s+it.amount, 0), overridden: true, lease: null };
  }
  const lease = drv ? vehicleRentalForPeriod(drv.id, from, to) : {total:0, items:[]};
  const items = [
    ...((drv?.other_deductions)||[]).map(od => ({name: od.name||'', amount: Number(od.amount)||0})),
    ...lease.items.map(it => ({name: `代車リース代（${it.car} ${it.from}〜${it.to}）`, amount: -Math.abs(it.amt)})),
  ];
  return { items, total: items.reduce((s,it)=>s+it.amount, 0), overridden: false, lease };
}

// 車両乗務履歴（日額設定のある代車の貸し出し記録）から、指定した支払集計期間に重なる日数分の
// リース料を自動計算する。ドライバーが今も使用中（end_date未設定）の場合は「今日まで」を仮の終了日として概算する。
// 「終了する」操作を待たずに、対象期間に含まれる日数分がそのまま支払集計・支払明細書に反映される。
function vehicleRentalForPeriod(driverId, from, to) {
  const todayStr = fmtLocalDate(new Date());
  const periodFrom = from || '0000-01-01';
  const periodTo = to || todayStr;
  let total = 0;
  const items = [];
  (vehicleAssignments||[]).forEach(v => {
    if (v.driver_id !== driverId || !v.daily_rate) return;
    const assignEnd = v.end_date || todayStr; // 使用中は今日までの分を概算計上する
    const overlapFrom = v.start_date > periodFrom ? v.start_date : periodFrom;
    const overlapTo = assignEnd < periodTo ? assignEnd : periodTo;
    if (overlapFrom > overlapTo) return; // この期間と重ならない
    const days = Math.round((new Date(overlapTo) - new Date(overlapFrom)) / 86400000) + 1;
    if (days <= 0) return;
    const amt = days * v.daily_rate;
    total += amt;
    items.push({ car: v.car, days, rate: v.daily_rate, amt, ongoing: !v.end_date, from: overlapFrom, to: overlapTo });
  });
  return { total, items };
}
async function deleteVehicleAssignment(id) {
  if (!confirm('この履歴を削除しますか？')) return;
  try {
    const {error} = await sb.from('vehicle_assignments').delete().eq('id', id);
    if (error) throw error;
    vehicleAssignments = vehicleAssignments.filter(v=>v.id!==id);
    invalidateVehicleAssignIndex();
    renderVehicleHist();
    renderVehicles(); // 履歴を消すと現在の使用者も変わるため車両一覧も更新する
    showT('削除しました');
  } catch(e) { showT('削除エラー: '+e.message, 'ter'); }
}

function renderDrv() {
  const grid = document.getElementById('drvGrid');
  const da = document.getElementById('dAlert');
  if (!grid) return;

  const unC = [...new Set(recs.filter(r => !recDrv(r)).map(r => r.car))];
  const docIssues = summarizeDocAlerts();
  if (da) {
    const bars = [];
    if (unC.length) bars.push(`<div class="alert-bar">⚠ 未配車: ${unC.join('、')}</div>`);
    if (docIssues.length) bars.push(`<div class="alert-bar">📄 書類期限に注意: ${docIssues.map(i=>`${i.drv.name}・${i.t.label}（${i.st.label}）`).join('、')} <button class="btn sml" style="margin-left:8px" onclick="openDocStatusM()">一覧を開く</button></div>`);
    if (bars.length) { da.classList.remove('hide'); da.innerHTML = bars.join(''); }
    else da.classList.add('hide');
  }
  const drvKpiEl = document.getElementById('drvKpi');
  if (drvKpiEl) {
    const expiredCnt = docIssues.filter(i=>i.st.cls==='expired').length;
    const soonCnt = docIssues.filter(i=>i.st.cls==='soon').length;
    const activeCnt = drvs.filter(d=>d.status!=='terminated').length;
    const terminatedCnt = drvs.filter(d=>d.status==='terminated').length;
    drvKpiEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-label">総ドライバー数</div><div class="kpi-val">${drvs.length}名</div><div class="kpi-diff kpi-eq">稼働中 ${activeCnt}名 ／ 解約 ${terminatedCnt}名</div></div>
      <div class="kpi-card"><div class="kpi-label">書類期限切れ</div><div class="kpi-val" style="color:${expiredCnt?'var(--red)':'var(--green)'}">${expiredCnt}件</div></div>
      <div class="kpi-card"><div class="kpi-label">書類期限間近</div><div class="kpi-val" style="color:${soonCnt?'var(--amber-text)':'var(--green)'}">${soonCnt}件</div></div>
      <div class="kpi-card"><div class="kpi-label">未読チャット</div><div class="kpi-val" style="color:${driverChatUnreadIds.size?'var(--amber-text)':'var(--green)'}">${driverChatUnreadIds.size}名</div></div>
    `;
  }

  const canE = me && me.role !== 'viewer';

  if (!drvs || !drvs.length) {
    grid.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px;grid-column:1/-1">ドライバーが登録されていません</div>`;
    return;
  }

  const q = nm(document.getElementById('drvSearch')?.value || '');
  const statusFilter = document.getElementById('drvStatusFilter')?.value ?? 'active';
  let filteredDrvs = q ? drvs.filter(d => nm(d.name).includes(q) || nm(d.company||'').includes(q) || (d.cars||[]).some(c=>nm(c).includes(q))) : drvs;
  if (statusFilter) filteredDrvs = filteredDrvs.filter(d => (d.status||'active') === statusFilter);

  if (!filteredDrvs.length) {
    grid.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px;grid-column:1/-1">該当するドライバーが見つかりません</div>`;
    return;
  }

  // 車番ごとの請求明細件数を先に1回だけ集計しておく（ドライバーごとに毎回recs全件を走査するとO(ドライバー数×件数)になり遅いため）
  const recCountByCar = new Map();
  recs.forEach(r => { const c = nm(r.car); recCountByCar.set(c, (recCountByCar.get(c)||0)+1); });
  const drvRecCount = d => (d.cars||[]).reduce((sum,c) => sum + (recCountByCar.get(nm(c))||0), 0);

  const sortedDrvs = [...filteredDrvs].sort((a, b) => {
    const idA = a.supplier_id ? parseInt(a.supplier_id, 10) || 999999 : 999999;
    const idB = b.supplier_id ? parseInt(b.supplier_id, 10) || 999999 : 999999;
    return idA - idB;
  });

  if (drvViewMode === 'card') {
    grid.className = 'cardgrid';
    grid.style.display = 'grid';
    grid.style.padding = '10px 14px';

    grid.innerHTML = sortedDrvs.map(d => {
      const ini = (d.name || '').replace(/\s/g, '').slice(-2) || '?';
      const cnt = drvRecCount(d);

      return `<div class="card" style="cursor:pointer" title="ダブルクリックで編集" ondblclick="editDrv(${d.id})">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
          <div class="av drv">${ini}</div>
          <div style="display:flex;gap:1px" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><button class="ibtn" title="チャット" style="position:relative" onclick="openDrvChatM(${d.id})">💬${chatUnreadBadgeHtml(d.id)}</button><button class="ibtn" title="提出書類" onclick="openDrvDocsM(${d.id})">📄</button>${canE ? `<button class="ibtn" title="この人宛の招待URLを発行" onclick="createDriverInviteFor(${d.id})">🔗</button><button class="ibtn" title="パスワードをリセット" onclick="resetDriverPassword(${d.id})">🔑</button>` : ''}${canE ? `<button class="ibtn" onclick="editDrv(${d.id})">✎</button><button class="ibtn" onclick="delDrv(${d.id})">🗑</button>` : ''}</div>
        </div>
        <div style="font-weight:600;font-size:13.5px;margin-bottom:2px">${escHtml(d.name)}${d.status==='terminated'?' <span class="bdg" style="background:var(--gray-bg);color:var(--gray-text)">解約済み</span>':''}${d.company?` <span style="font-size:10.5px;font-weight:500;color:var(--text2);padding:1px 5px;background:var(--bg2);border-radius:99px">${escHtml(d.company)}</span>`:''}</div>
        ${d.supplier_id ? `<div style="font-size:11.5px;color:var(--text2);margin-bottom:2px">仕入先ID: ${escHtml(d.supplier_id)}</div>` : ''}
        ${d.tel ? `<div style="font-size:11.5px;color:var(--text2);margin-bottom:5px">${escHtml(d.tel)}</div>` : '<div style="margin-bottom:5px"></div>'}
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:5px">
          ${(d.cars || []).length ? (d.cars || []).map(c => `<span class="cpill" style="cursor:pointer" title="クリックで乗務履歴を記録・確認" onclick="event.stopPropagation();openVehicleHistM('${escAttrJs(c)}')" ondblclick="event.stopPropagation()">🚗 ${escHtml(c)}</span>`).join('') : '<span style="font-size:11.5px;color:var(--text2)">車番未登録</span>'}
        </div>
        <div style="font-size:11.5px;color:var(--text2);margin-top:3px">締日: ${closingDayLabel(d.closing_day)}　支払日: ${drvPayScheduleLabel(d)}</div>
        <div style="font-size:11.5px;color:var(--text2)">請求明細書: ${cnt}件</div>
      </div>`;
    }).join('');

  } else {
    grid.className = '';
    grid.style.display = 'block';
    grid.style.padding = '10px 14px';

    const drvHeaderRow = `<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 12px 6px;gap:12px;font-size:10.5px;color:var(--text2);font-weight:600">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <div style="width:26px;flex-shrink:0;"></div>
        <div style="width:80px;flex-shrink:0;">ID</div>
        <div style="width:115px;flex-shrink:0;">ドライバー名</div>
        <div style="flex:1;min-width:100px;">担当車番</div>
        <div style="width:100px;flex-shrink:0;">電話番号</div>
        <div style="width:170px;flex-shrink:0;">協力会社</div>
        <div style="width:85px;flex-shrink:0;">締日</div>
        <div style="width:110px;flex-shrink:0;">支払日</div>
        <div style="width:70px;text-align:right;flex-shrink:0;">請求件数</div>
      </div>
      <div style="width:130px;flex-shrink:0;"></div>
    </div>`;
    grid.innerHTML = drvHeaderRow + sortedDrvs.map(d => {
      const ini = (d.name || '').replace(/\s/g, '').slice(-2) || '?';
      const cnt = drvRecCount(d);

      return `<div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;padding:9px 12px;margin-bottom:6px;gap:12px;cursor:pointer" title="ダブルクリックで編集" ondblclick="editDrv(${d.id})">
        <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;">
          <div class="av drv" style="width:26px;height:26px;font-size:11px;flex-shrink:0;">${ini}</div>
          <div style="width:80px;font-weight:700;color:var(--blue);font-size:12.5px;flex-shrink:0;">${escHtml(d.supplier_id ? 'ID: ' + d.supplier_id : 'ID: —')}</div>
          <div style="width:115px;font-weight:600;font-size:13.5px;flex-shrink:0;overflow-wrap:break-word;word-break:break-word;">${escHtml(d.name)}${d.status==='terminated'?' <span class="bdg" style="background:var(--gray-bg);color:var(--gray-text)">解約</span>':''}</div>
          <div style="flex:1;display:flex;flex-wrap:wrap;gap:3px;min-width:100px;">
            ${(d.cars || []).length ? (d.cars || []).map(c => `<span class="cpill" style="margin-top:0;cursor:pointer" title="クリックで乗務履歴を記録・確認" onclick="event.stopPropagation();openVehicleHistM('${escAttrJs(c)}')" ondblclick="event.stopPropagation()">🚗 ${escHtml(c)}</span>`).join('') : '<span style="font-size:11.5px;color:var(--text2)">車番未登録</span>'}
          </div>
          <div style="width:100px;color:var(--text2);font-size:12px;flex-shrink:0;">${escHtml(d.tel || '—')}</div>
          <div style="font-size:11.5px;color:var(--text2);display:flex;gap:6px;width:170px;flex-shrink:0;overflow-wrap:break-word;word-break:break-word;">
            ${d.company ? `<span style="padding:1px 6px;background:var(--bg2);border-radius:99px">${escHtml(d.company)}</span>` : ''}
          </div>
          <div style="width:85px;font-size:11.5px;color:var(--text2);flex-shrink:0;">締日:${closingDayLabel(d.closing_day)}</div>
          <div style="width:110px;font-size:11.5px;color:var(--text2);flex-shrink:0;">${drvPayScheduleLabel(d)}</div>
          <div style="width:70px;font-size:11.5px;color:var(--text2);text-align:right;flex-shrink:0;">請求:${cnt}件</div>
        </div>
        <div style="display:flex;gap:1px;flex-shrink:0;" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()"><button class="ibtn" title="チャット" style="position:relative" onclick="openDrvChatM(${d.id})">💬${chatUnreadBadgeHtml(d.id)}</button><button class="ibtn" title="提出書類" onclick="openDrvDocsM(${d.id})">📄</button>${canE ? `<button class="ibtn" title="この人宛の招待URLを発行" onclick="createDriverInviteFor(${d.id})">🔗</button><button class="ibtn" title="パスワードをリセット" onclick="resetDriverPassword(${d.id})">🔑</button>` : ''}${canE ? `<button class="ibtn" onclick="editDrv(${d.id})">✎</button><button class="ibtn" onclick="delDrv(${d.id})">🗑</button>` : ''}</div>
      </div>`;
    }).join('');
  }
}

/* =====================================================================
   支払明細書作成 (pg6) 【完全一本化・機能維持版】
   ===================================================================== */
// paySelectedMonth: 保存用ラベル・支払実行日算出などに使う「YYYY-MM」代表値（payFromの月）。changePayMonthRange()で同期。
let paySelectedMonth = '';
let payRows = [];
let paySourceMode = 'recs';

// 支払明細書CSV（明細一覧タブ・集計タブ共通）の1行分を組み立てる
function buildPayCsvRow(r, d, payDate, idx) {
  d = drvPay(d); // 協力会社フォールバック（手数料率など）を適用
  const cli = clients.find(c => c.id === r.cli);
  const cliName = cli ? (cli.short || cli.name) : '';
  const detail = [cliName, r.note].filter(Boolean).join(' ');
  return {
    invoice_id:     r.id,
    drv_id:         d.id,
    supplier_id:    d.supplier_id || '',
    fee_rate:       d.fee_rate != null ? d.fee_rate : -0.15,
    note_col:       '',
    admin_fee:      d.admin_fee != null ? d.admin_fee : -10000,
    vehicle_rental: d.vehicle_rental != null ? d.vehicle_rental : -30000,
    invoice_no:     d.supplier_id || '',
    issue_date:     '',
    payment_date:   payDate,
    no:             idx + 1,
    date:           r.date || '',
    car_info:       `${r.car||''} ${d.name||''}`.trim(),
    detail:         detail,
    // 受注入力で支払運賃が個別入力されていればそれを優先。未入力（旧データ等）は従来通り運賃を流用
    highway:        (r.pay_hw != null && r.pay_hw !== 0) ? r.pay_hw : (r.highway || 0),
    distance:       r.distance || '',
    qty:            r.qty !== undefined ? r.qty : 1,
    price:          (r.pay_fare != null && r.pay_fare !== 0) ? r.pay_fare : (r.price !== undefined ? r.price : (r.fare || 0)),
  };
}

function renderPayCore() {
  ensureMonthRangeDefault('payFrom', 'payTo');
  paySelectedMonth = (document.getElementById('payFrom')?.value || '').slice(0,7);

  const pd = document.getElementById('payDateInput');
  if (pd && !pd.value) {
    const to = document.getElementById('payTo')?.value;
    if (to) {
      const [y,m,d] = to.split('-').map(Number);
      const dt = new Date(y, m, 1); // 集計終了日の翌月1日
      pd.value = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
    }
  }

  if (paySourceMode === 'recs') {
    buildPayFromRecs();
  } else {
    renderPayTable();
  }
}

function buildPayFromRecs() {
  const from = document.getElementById('payFrom')?.value || '';
  const to = document.getElementById('payTo')?.value || '';
  const monthRecs = recs.filter(r => r.date && r.date >= from && r.date <= to);
  const payDate = document.getElementById('payDateInput')?.value || '';

  // ドライバーごとにグループ化（車番所有マッチだけでなく、手動選択(drv_id)を優先するrecDrv()で判定）
  const byDrv = {};
  monthRecs.forEach(r => {
    const d = recDrv(r);
    if (!d) return;
    if (!byDrv[d.id]) byDrv[d.id] = { drv: d, rows: [] };
    byDrv[d.id].rows.push(r);
  });

  payRows = [];
  Object.values(byDrv).forEach(({drv: d, rows: dRecs}) => {
    dRecs.sort((a,b) => (a.date||'').localeCompare(b.date||''));
    dRecs.forEach((r, idx) => payRows.push(buildPayCsvRow(r, d, payDate, idx)));
  });
  renderPayTable();
}


function changePayMonthRange() {
  paySelectedMonth = (document.getElementById('payFrom')?.value || '').slice(0,7);
  paySourceMode = 'recs';
  setSlipStatus('');
  const dropArea = document.getElementById('slipDropArea');
  if (dropArea) dropArea.style.display = '';
  buildPayFromRecs();
}

// n=0: 明細一覧（XLSX取込）, n=1-4: 集計グループ（1=ドライバー別集計, 2=支払スケジュール, 3=損益計算書, 4=月次締め）
// KPIカード（総件数/定期集配/チャーター/その他/未配車）クリックによる種別絞り込み
let aggPayTypeFilter = '';
function filterAggPayByType(type) {
  aggPayTypeFilter = (aggPayTypeFilter === type) ? '' : type;
  document.querySelectorAll('#pg6 .mets .met').forEach(el=>el.classList.remove('active'));
  const idMap = {'':'metTotP','regular':'metReP','charter':'metChP','other':'metOtP','un':'metUnP'};
  document.getElementById(idMap[aggPayTypeFilter])?.classList.add('active');
  runAggPay();
}

// pg6のKPIカード（総件数/定期集配/チャーター/その他/未配車）を集計期間ピッカーに合わせて更新
function updatePayMetCards() {
  if (!document.getElementById('mTotP')) return;
  const metRecsP=periodRecs('aggPayFrom','aggPayTo');
  document.getElementById('mTotP').textContent=metRecsP.length;
  document.getElementById('mChP').textContent=metRecsP.filter(r=>r.type==='charter').length;
  document.getElementById('mReP').textContent=metRecsP.filter(r=>r.type==='regular').length;
  document.getElementById('mOtP').textContent=metRecsP.filter(r=>r.type!=='charter'&&r.type!=='regular').length;
  document.getElementById('mUnP').textContent=metRecsP.filter(r=>!recDrv(r)).length;
  if (document.getElementById('payMonthlyBreakdown')?.style.display !== 'none') renderMonthlyBreakdownTable('payMonthlyBreakdown');
}
// pg6（支払明細書作成）の集計期間・種別・取引先・ドライバー検索の絞り込みを反映したrecsを返す。
// 上部の合計バー(renderPayMets)と下の集計テーブル(runAggPay)で条件を一致させるための共通ロジック
// （ドライバー検索が入っている場合のみ、ドライバーが特定できない行=未配車を除外する。
// 　検索が空の場合は、期間・種別・取引先だけで絞り込んだ「その範囲の全件」を返す）
function aggPayFilteredRecs() {
  const from = document.getElementById('aggPayFrom')?.value || '';
  const to = document.getElementById('aggPayTo')?.value || '';
  const drvSearch = nm(document.getElementById('aggPayDrvSearch')?.value||'');
  const cliFilterArr = getMSelValues('aggPayCli');
  return recs.filter(r => r.date && (!from || r.date >= from) && (!to || r.date <= to))
    .filter(r => matchesTypeFilter(r, aggPayTypeFilter))
    .filter(r => !cliFilterArr.length || cliFilterArr.includes(r.cli))
    .filter(r => {
      if (!drvSearch) return true;
      const d = recDrv(r);
      return !!d && (nm(d.name).includes(drvSearch) || nm(d.company||'').includes(drvSearch));
    });
}
function runAggPay() {
  renderPayMets(); // KPIカード(updatePayMetCards)と合計バーの両方をここで一括更新する
  const tbody = document.getElementById('aggPayTbody');
  const tfoot = document.getElementById('aggPayTfoot');
  const summary = document.getElementById('aggPaySummary');
  if (!tbody) return;
  const from = document.getElementById('aggPayFrom')?.value || '';
  const to = document.getElementById('aggPayTo')?.value || '';
  const cliFilterArr = getMSelValues('aggPayCli');

  // ドライバーの車番にひもづくrecsを集計期間・種別・取引先・ドライバー検索で絞り込み、ドライバー単位でグループ化
  // （フィルタ条件そのものはaggPayFilteredRecs()に集約し、上部の合計バーと一致させている）
  const groups = {};
  aggPayFilteredRecs().forEach(r => {
    const d = recDrv(r);
    if (!d) return; // マスタ未登録車番は対象外（明細一覧タブで確認可）
    if (!groups[d.id]) groups[d.id] = { drv: d, rows: [] };
    groups[d.id].rows.push(r);
  });
  window._aggPayGroups = groups; // 詳細展開・Excel出力用に保持
  populateAggPayPartnerSel(groups);

  if (Object.keys(groups).length === 0) {
    tbody.innerHTML = '<tr><td colspan="17" style="padding:30px;text-align:center;color:var(--text3)">対象データがありません</td></tr>';
    tfoot.innerHTML = '';
    summary.textContent = `0件見つかりました（集計期間:${from||'-'}〜${to||'-'}）`;
    return;
  }


  let gCnt=0, gGrossTax=0, gTaxAmt=0, gTakeHome=0, gBizFee=0, gNetIncl=0, gAdminFee=0, gVehRental=0, gAdvHw=0, gNonTax=0, gOther=0, gGross=0;
  // ドライバーIDが古い（数値の小さい）順に並べる。ID未登録は末尾にまとめる
  const sortedPayEntries = Object.entries(groups).sort(([,ga],[,gb]) => {
    const na = parseInt(ga.drv.supplier_id, 10);
    const nb = parseInt(gb.drv.supplier_id, 10);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });
  const rowsHtml = sortedPayEntries.map(([drvId,g]) => {
    const d = drvPay(g.drv); // 協力会社フォールバック（手数料率など）を適用し、明細書と集計表示を一致させる
    const rows = g.rows;
    const cnt = rows.length;
    const grossAll = rows.reduce((a,r)=>a+subBySide(r,'payment'),0); // 全明細の税別ベース額（非課税分を含む）
    const grossTax = rows.reduce((a,r)=>a+subBySide(r,'payment')+rtaxBySide(r,'payment'),0);
    const fb = rows.reduce((a,r)=>{const b=feeBreakdown(r,'payment');return{hw:a.hw+b.hw,oth:a.oth+b.oth,other:a.other+b.other,nonTax:a.nonTax+b.nonTax};},{hw:0,oth:0,other:0,nonTax:0});
    const nonTaxSum = rows.filter(r=>(r.tax||0)===0).reduce((a,r)=>a+subBySide(r,'payment'),0) + fb.nonTax; // 非課税額（税率0%明細の合計＋追加料金の非課税分）
    const gross = grossAll - (nonTaxSum - fb.nonTax); // 税別金額（課税対象分のみ。非課税分は業務手数料の対象外。追加料金は元々別枠のため差し引かない）
    const taxAmt = grossTax - grossAll; // 内消費税額（委託ドライバーへの支払に係る消費税）
    // 高速・立替代＝追加料金として入力した高速代・立替の合計（運賃欄由来のhw/othは税別・非課税額側に含まれるため除外し、二重表示を避ける）
    const baseHwOth = rows.reduce((a,r)=>a+hwRawBySide(r,'payment')+othRawBySide(r,'payment'),0);
    const advHwSum = fb.hw + fb.oth - baseHwOth;
    const feeRate = d.fee_rate ?? -0.15;
    const adminFee = d.admin_fee ?? -10000;
    const vehRental = d.vehicle_rental ?? -30000;
    const { bizFee, netSubtotal, netTax, bizFeeWithTax } = calcBizFeeWithTax(gross, taxAmt, feeRate);
    const netIncl = netSubtotal + netTax; // 差引合計(税込)＝（税別金額−業務手数料）＋消費税10%
    const extraFeeTotal = sumRecsExtraFees(rows, 'payment'); // 受注入力の追加料金（支払／両方指定分）
    // 車両管理の乗務履歴（日額設定のある代車）から、この集計期間に重なる日数分のリース料を自動計算する
    const othItems = otherItemsForPeriod(d, from, to);
    const otherTotal = othItems.total; // その他控除（保険料・家賃など＋代車リース代。期間ごとの上書きがあればそれを使う）
    const takeHome = grossTax+bizFeeWithTax+adminFee+vehRental+extraFeeTotal+otherTotal; // 支払合計金額（お支払い金額）
    gCnt+=cnt; gGrossTax+=grossTax; gTaxAmt+=taxAmt; gTakeHome+=takeHome;
    gBizFee+=bizFee; gNetIncl+=netIncl; gAdminFee+=adminFee; gVehRental+=vehRental; gAdvHw+=advHwSum; gNonTax+=nonTaxSum; gOther+=otherTotal; gGross+=gross;

    const safeKey = String(drvId);
    // 車番はドライバー登録の既定車両ではなく、実際にその明細で使われた車番を表示する（代車・車両交換・手動割当てを正しく反映するため）。
    // 「メイン車番」は明細に登場した順ではなく、この期間で最も使用件数が多い車番とする
    // （recsは新規登録が先頭に追加される順のため、登場順=直近入力順であって実際の主力車両とは限らないため）
    const carCounts = {};
    rows.forEach(r => { if (r.car) { const c = canonicalCar(r.car); carCounts[c] = (carCounts[c]||0) + 1; } });
    const carsUsed = Object.keys(carCounts).sort((a,b) => carCounts[b]-carCounts[a]);
    const carCellId = `payCarCell${safeKey}`;
    // 車番はクリックで車両管理を開けるようにする（未登録なら車番入りで車両追加を開く）。
    // 複数台ある場合は「他N台…」で全件表示に切り替えられ、展開後は各車番が個別にクリックできる
    const carLinkHtml = c => `<span data-car="${escHtml(c)}" onclick="event.stopPropagation();jumpToVehicleByCar(this.dataset.car)" style="cursor:pointer;color:var(--blue);text-decoration:underline dotted" title="車両管理で開く">${escHtml(c)}</span>`;
    const carToggleHtml = label => `<span onclick="event.stopPropagation();toggleCarCell('${carCellId}')" style="cursor:pointer;color:var(--text2);margin-left:4px" title="表示を切り替えます">${label}</span>`;
    const fallbackCar = (d.cars||[])[0] || '';
    const carShort = carsUsed.length
      ? carLinkHtml(carsUsed[0]) + (carsUsed.length>1 ? carToggleHtml(`他${carsUsed.length-1}台…`) : '')
      : (fallbackCar ? carLinkHtml(fallbackCar) : '—');
    const carFull = carsUsed.length
      ? carsUsed.map(carLinkHtml).join('、') + (carsUsed.length>1 ? carToggleHtml('閉じる') : '')
      : carShort;
    // 実行日：ドライバー（協力会社優先）の支払日設定を反映する（ドライバーごとに異なりうる）
    const sortedRowsForDate = rows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const execLabel = computePayExecDateLabel(d, sortedRowsForDate[sortedRowsForDate.length-1]?.date || to);
    return `<tr style="border-bottom:0.5px solid var(--border)">
      <td style="padding:6px 8px"><input type="checkbox" class="aggPayChk" value="${d.id}"></td>
      <td style="padding:6px 8px;color:var(--text2)">${escHtml(d.supplier_id||'—')}</td>
      <td id="${carCellId}" style="padding:6px 8px" data-short="${escHtml(carShort)}" data-full="${escHtml(carFull)}" data-state="short">${carShort}</td>
      <td style="padding:6px 8px"><span onclick="jumpToDriverEdit(${g.drv.id})" style="cursor:pointer;color:var(--blue);text-decoration:underline dotted" title="ドライバー管理で開く">${escHtml(d.name)}</span>${d.company?`<div style="font-size:9.5px;color:var(--text2)">${escHtml(d.company)}</div>`:''}</td>
      <td style="padding:6px 8px;white-space:nowrap;color:var(--text2)">${execLabel}</td>
      <td style="padding:6px 8px;text-align:right">${cnt}</td>
      <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(grossTax)}</td>
      <td style="padding:6px 8px;text-align:right" title="委託ドライバーへの支払に係る消費税額">${yen(taxAmt)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(gross)}</td>
      <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border);color:${bizFee<0?'#e05b5b':'inherit'}" title="税別金額（課税分）×手数料率${(feeRate*100).toFixed(1)}%">${yen(bizFee)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:500" title="（税別金額−業務手数料）＋消費税10%">${yen(netIncl)}</td>
      <td style="padding:6px 8px;text-align:right">${yen(advHwSum)}</td>
      <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border);color:${adminFee<0?'#e05b5b':'inherit'}">${yen(adminFee)}</td>
      <td style="padding:6px 8px;text-align:right;color:${vehRental<0?'#e05b5b':'inherit'}">${yen(vehRental)}${d.lease_company?`<div style="font-size:9.5px;color:var(--text2);font-weight:400">${escHtml(d.lease_company)}</div>`:''}</td>
      <td style="padding:6px 8px;text-align:right;color:${(nonTaxSum+otherTotal)<0?'#e05b5b':'inherit'}" title="クリックでこの集計期間の「その他の項目」を編集できます${nonTaxSum?'\n（非課税分 '+yen(nonTaxSum)+' を含む。非課税分はここでは編集できません）':''}\n${othItems.items.length?othItems.items.map(it=>`${it.name}: ${yen(it.amount)}`).join('\n'):'内訳なし'}">
        <span onclick="event.stopPropagation();openPayAdjM(${d.id})" style="cursor:pointer;text-decoration:underline dotted">${yen(nonTaxSum + otherTotal)}</span>
        ${othItems.overridden?'<div style="font-size:9px;color:var(--amber-text);font-weight:600">上書き中</div>':''}
      </td>
      <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--blue);border-left:0.5px solid var(--border)">${yen(takeHome)}</td>
      <td style="padding:6px 8px;white-space:nowrap">
        <button class="btn sml" onclick="openAggDetailFull('payment','${safeKey}')">明細</button>
      </td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rowsHtml;
  tfoot.innerHTML = `<tr style="font-weight:600;border-top:1px solid var(--border)">
    <td></td>
    <td style="padding:6px 8px" colspan="4">合計</td>
    <td style="padding:6px 8px;text-align:right">${gCnt}</td>
    <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(gGrossTax)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gTaxAmt)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gGross)}</td>
    <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(gBizFee)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gNetIncl)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gAdvHw)}</td>
    <td style="padding:6px 8px;text-align:right;border-left:0.5px solid var(--border)">${yen(gAdminFee)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gVehRental)}</td>
    <td style="padding:6px 8px;text-align:right">${yen(gNonTax + gOther)}</td>
    <td style="padding:6px 8px;text-align:right;color:var(--blue);border-left:0.5px solid var(--border)">${yen(gTakeHome)}</td>
    <td></td>
  </tr>`;
  const payFilterLabel = cliFilterArr.length ? `（絞込中: ${cliFilterArr.length}社）` : '';
  summary.innerHTML = `${Object.keys(groups).length}名のドライバー / ${gCnt}件見つかりました（集計期間:${from||'-'}〜${to||'-'}）${payFilterLabel} <span style="font-weight:600;color:var(--blue);margin-left:6px">合計 ${yen(gTakeHome)}</span>`;
}


// 選択した複数ドライバー分を1シートにまとめ、ドライバーごとに必ず改ページして出力する（タブは分けない）
async function bulkExportPayExcel() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const rowGroups = checked.map(drvId => window._aggPayGroups?.[String(drvId)]?.rows).filter(rows=>rows && rows.length);
  if (!rowGroups.length) { alert('対象データがありません'); return; }
  const wb = XLSX.utils.book_new();
  const { ws, rowBreaks } = buildStatementSheetStacked('payment', rowGroups, {});
  XLSX.utils.book_append_sheet(wb, ws, '支払明細書');
  await downloadXlsxWithPageSetup(wb, `支払明細書_選択分_${fmtLocalDate(new Date())}.xlsx`, [rowBreaks]);
  addLog('Excel出力', `支払明細書 選択${checked.length}件`);
}

// 選択した複数ドライバー分を「鑑」形式（表紙に各ドライバーの合計一覧→そのあと各ドライバーの支払明細を
// ページを分けて連続出力）でまとめて1枚のExcelに出力する。協力会社宛てが多いため、発行宛て（御中）を選べる
async function bulkExportPayExcelStacked() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const rowGroups = checked.map(drvId => window._aggPayGroups?.[String(drvId)]?.rows).filter(rows=>rows && rows.length);
  if (!rowGroups.length) { alert('対象データがありません'); return; }
  // 選択したドライバーの協力会社が1社に揃っていれば、発行宛てのデフォルト値として提案する
  const companies = [...new Set(rowGroups.map(rows => recDrv(rows[0])?.company).filter(Boolean))];
  const suggested = companies.length === 1 ? companies[0] : '';
  const addressee = await openKanAte(suggested);
  if (addressee === undefined) return; // キャンセル
  const wb = XLSX.utils.book_new();
  const { ws, rowBreaks } = buildStatementSheetStacked('payment', rowGroups, {withCover:true, addressee});
  XLSX.utils.book_append_sheet(wb, ws, '支払明細書');
  await downloadXlsxWithPageSetup(wb, `支払明細書_鑑_${fmtLocalDate(new Date())}.xlsx`, [rowBreaks]);
  addLog('Excel出力', `支払明細書（鑑形式） 選択${checked.length}件${addressee?' 宛て:'+addressee.name:''}`);
}

/* ===== 鑑の発行宛て選択モーダル =====
   会社マスタの会社をプルダウン候補（datalist）に出しつつ手入力・検索もできる。
   確定するとPromiseが {name, cli}（cli=一致した協力会社レコード。詳細自動記載用）または null（宛先なし）で
   解決し、キャンセル時は undefined で解決する */
let _kanAteResolve = null;
function openKanAte(suggested) {
  return new Promise(resolve => {
    _kanAteResolve = resolve;
    const dl = document.getElementById('kanAteList');
    dl.innerHTML = clients.map(c=>`<option value="${escHtml(c.name)}">`).join('');
    document.getElementById('kanAteInput').value = suggested||'';
    updateKanAteInfo();
    document.getElementById('mKanAte').classList.add('on');
  });
}
function findKanAteClient() {
  const name = document.getElementById('kanAteInput').value.trim();
  if (!name) return null;
  return clients.find(c=>nm(c.name)===nm(name)) || null;
}
function updateKanAteInfo() {
  const el = document.getElementById('kanAteInfo');
  const name = document.getElementById('kanAteInput').value.trim();
  if (!name) { el.innerHTML = '宛先なし（表紙に「御中」行を載せません）'; return; }
  const c = findKanAteClient();
  if (!c) { el.innerHTML = `「${name}」は会社マスタ未登録です（名前のみ表紙に記載されます）。<br>取引先・協力会社タブで登録すると住所などが自動記載されます`; return; }
  el.innerHTML = [
    '✓ 協力会社として登録済み',
    [c.zip?`〒${c.zip}`:'', c.address||''].filter(Boolean).join(' '),
    [c.person?`ご担当: ${c.person}`:'', c.tel?`TEL ${c.tel}`:''].filter(Boolean).join('　'),
    c.pay_out_day ? `支払日: ${monthOffsetLabel(c.pay_out_month_offset)}${c.pay_out_day==='end'?'末日':c.pay_out_day+'日'}` : '',
  ].filter(Boolean).join('<br>') || '詳細情報なし';
}
function confirmKanAte() {
  const name = document.getElementById('kanAteInput').value.trim();
  document.getElementById('mKanAte').classList.remove('on');
  const resolve = _kanAteResolve; _kanAteResolve = null;
  if (resolve) resolve(name ? { name, cli: findKanAteClient() } : null);
}
function closeKanAte() {
  document.getElementById('mKanAte').classList.remove('on');
  const resolve = _kanAteResolve; _kanAteResolve = null;
  if (resolve) resolve(undefined);
}

function toggleAggPayAll(checked) {
  document.querySelectorAll('.aggPayChk').forEach(el=>el.checked=checked);
}

// 支払集計の車番セル: 「メイン車番 他N台…」⇔ 全車番（読点区切り）の表示をクリックで切り替える
function toggleCarCell(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const showingFull = el.dataset.state === 'full';
  // 車番をクリックできるリンクとして描くため、テキストではなくHTMLを差し替える
  el.innerHTML = showingFull ? el.dataset.short : el.dataset.full;
  el.dataset.state = showingFull ? 'short' : 'full';
}

/* ===== 集計表からマスタ登録画面への導線 =====
   支払明細書（集計）の車番・ドライバー名から、そのまま車両管理・ドライバー管理を開けるようにする。
   未登録の車番は「車両追加」を車番入りで開き、その場で登録できる。 */
// 車番から車両マスタを探す。略式番号とフル表記が混在するため末尾番号でも突き合わせる
function findVehicleByCar(car) {
  if (!car) return null;
  const n = nm(car);
  let v = (vehicles||[]).find(x => nm(x.car) === n);
  if (v) return v;
  const t = carTailNumber(car);
  if (!t) return null;
  const cands = (vehicles||[]).filter(x => carTailNumber(x.car) === t);
  return cands.length === 1 ? cands[0] : null;  // 末尾番号が重複する場合は特定しない
}
// モーダルは他のページの上にも重ねて表示できるため、あえてタブを切り替えない。
// 支払明細書作成タブなどを見ながらその場で車両・ドライバー情報を訂正し、閉じれば元の画面に戻れるようにする
function jumpToVehicleByCar(car) {
  if (!car) return;
  const v = findVehicleByCar(car);
  if (v) { editVehicle(v.id); return; }
  // 車両マスタ未登録：車番を入れた状態で追加モーダルを開く
  openVehicleM();
  document.getElementById('vCar').value = canonicalCar(car);
  showT(`「${canonicalCar(car)}」は車両管理に未登録です。内容を確認して登録してください`, 'twa');
}
function jumpToDriverEdit(drvId) {
  const d = drvs.find(x => x.id === drvId);
  if (!d) { showT('ドライバーが見つかりませんでした', 'ter'); return; }
  editDrv(drvId);
}

// 集計（ドライバー別）タブでチェックしたドライバー分だけをCSV出力する
// （明細一覧タブのdownloadPayCsv()はpayRowsをそのまま使うため、集計タブのチェック状態を反映しない別関数として用意）
function downloadAggPayCsv() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const groups = checked.map(id => window._aggPayGroups?.[String(id)]).filter(g=>g && g.rows && g.rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const to = document.getElementById('aggPayTo')?.value || '';
  payRows = [];
  groups.forEach(({drv:d, rows:dRecs}) => {
    const sorted = dRecs.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    // 実行日：ドライバー（協力会社優先）の支払日設定を反映する
    const partner = lkCli(d.company_client_id);
    const workMonth = (sorted[sorted.length-1]?.date || to).slice(0,7);
    const offset = partner ? (partner.pay_out_month_offset ?? 2) : (d.pay_month_offset ?? 2);
    const payDay = partner ? (partner.pay_out_day || 'end') : (d.pay_day || 'end');
    const payDate = workMonth ? computeDueDate(workMonth, offset, payDay).replace(/-/g,'') : '';
    sorted.forEach((r, idx) => payRows.push(buildPayCsvRow(r, d, payDate, idx)));
  });
  openCsvColsM('payment');
}

function bulkCreatePaySlipPdf() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const groups = checked.map(drvId => window._aggPayGroups?.[String(drvId)]?.rows).filter(rows=>rows && rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtmlMulti('payment', groups));
}

// 今回の集計結果に含まれるドライバーの協力会社名を候補にプルダウンを更新する
function populateAggPayPartnerSel(groups) {
  const sel = document.getElementById('aggPayPartnerSel');
  if (!sel) return;
  const cur = sel.value;
  const companies = [...new Set(Object.values(groups||{}).map(g=>g.drv.company).filter(Boolean))].sort();
  sel.innerHTML = companies.length
    ? companies.map(c=>`<option value="${c}">${c}</option>`).join('')
    : '<option value="">（該当する協力会社なし）</option>';
  if (companies.includes(cur)) sel.value = cur;
}

// 現在集計中の支払データ（window._aggPayGroups）をもとに、車両リース代をリース会社ごとに合計して表示する
function openLeaseAggM() {
  const groups = window._aggPayGroups;
  if (!groups || !Object.keys(groups).length) { alert('先に支払明細書作成タブで「集計」を行ってください'); return; }
  renderLeaseAggBody(groups);
  document.getElementById('mLeaseAgg').classList.add('on');
}
function renderLeaseAggBody(groups) {
  const el = document.getElementById('leaseAggBody');
  if (!el) return;
  const buckets = {};
  Object.values(groups).forEach(g => {
    const d = g.drv;
    const amt = Math.abs(d.vehicle_rental ?? -30000);
    const key = d.lease_company || '未設定';
    if (!buckets[key]) buckets[key] = { total: 0, drivers: [] };
    buckets[key].total += amt;
    buckets[key].drivers.push(d.name);
  });
  const rows = Object.entries(buckets).sort(([,a],[,b]) => b.total - a.total);
  if (!rows.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">対象データがありません</div>'; return; }
  const grandTotal = rows.reduce((s,[,v])=>s+v.total,0);
  const grandCnt = rows.reduce((s,[,v])=>s+v.drivers.length,0);
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--bg2);color:var(--text2);text-align:left">
      <th style="padding:6px 8px">リース会社</th>
      <th style="padding:6px 8px;text-align:right">台数</th>
      <th style="padding:6px 8px;text-align:right">合計金額</th>
      <th style="padding:6px 8px"></th>
    </tr></thead>
    <tbody>${rows.map(([name,v])=>{
      const registered = name!=='未設定' && leaseClients().some(c=>nm(c.name)===nm(name));
      return `<tr style="border-bottom:0.5px solid var(--border)">
      <td style="padding:6px 8px" title="${escHtml(v.drivers.join('、'))}">${escHtml(name)}${registered?'':(name!=='未設定'?' <span style="font-size:10px;color:var(--amber-text)" title="協力会社管理でリース会社として未登録のため、明細書に住所などが自動記載されません">⚠未登録</span>':'')}</td>
      <td style="padding:6px 8px;text-align:right">${v.drivers.length}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:500">${yen(v.total)}</td>
      <td style="padding:6px 8px;text-align:center">${name!=='未設定'?`<button class="btn sml" onclick="printLeaseStatement('${escAttrJs(name)}')" title="このリース会社宛の車両リース代明細書（PDF印刷用）を作成します">📄 明細書</button>`:''}</td>
    </tr>`;}).join('')}</tbody>
    <tfoot><tr style="font-weight:600;border-top:1px solid var(--border)">
      <td style="padding:6px 8px">合計</td>
      <td style="padding:6px 8px;text-align:right">${grandCnt}</td>
      <td style="padding:6px 8px;text-align:right">${yen(grandTotal)}</td>
      <td></td>
    </tr></tfoot>
  </table>`;
}

// リース会社宛の車両リース代明細書（印刷用PDF）を作成する。
// 集計中の支払データ（_aggPayGroups）から該当リース会社のドライバーを抽出し、
// 会社マスタで「車両リース会社」登録済みなら住所・担当者などを宛先に自動記載する
function printLeaseStatement(company) {
  const groups = window._aggPayGroups || {};
  const entries = Object.values(groups).filter(g => (g.drv.lease_company||'') && nm(g.drv.lease_company) === nm(company));
  if (!entries.length) { alert('対象データがありません'); return; }
  const p = clients.find(x => nm(x.name) === nm(company)) || null;
  const from = document.getElementById('aggPayFrom')?.value || '';
  const to = document.getElementById('aggPayTo')?.value || '';
  const periodLabel = (from||to) ? `対象期間: ${from.replace(/-/g,'/')} 〜 ${to.replace(/-/g,'/')}` : '';
  const month = from.slice(0,7);
  const itemRows = entries
    .sort((a,b)=> (parseInt(a.drv.supplier_id,10)||999999) - (parseInt(b.drv.supplier_id,10)||999999))
    .map((g,i) => {
      // cars配列にはフル表記の車番と数字のみの略式車番が両方入っていることがあるため、
      // フル表記のみに絞って「同じ車を2台と誤表示」しないようにする
      const fullCars = (g.drv.cars||[]).filter(isFullPlateNumber);
      const cars = (fullCars.length ? fullCars : (g.drv.cars||[])).join('、') || '—';
      return { no:i+1, name:g.drv.name, cars, amt: Math.abs(g.drv.vehicle_rental ?? -30000) };
    });
  const total = itemRows.reduce((s,it)=>s+it.amt,0);
  const cAll = companySettings || {};
  const companyLines = [
    cAll.name || '株式会社ポーターガーデン',
    ...formatCompanyAddressLines(cAll),
    cAll.tel ? 'TEL '+cAll.tel : '',
    cAll.reg_no ? '登録番号 '+cAll.reg_no : '',
  ].filter(Boolean);
  const recipientMeta = p ? [
    [p.zip?`〒${p.zip}`:'', p.address||''].filter(Boolean).join(' '),
    [p.person?`ご担当: ${p.person}`:'', p.tel?`TEL ${p.tel}`:''].filter(Boolean).join('　'),
  ].filter(Boolean) : [];
  const docNo = `LS-${month.replace('-','')}-${String(p?.partner_no||'0').padStart(3,'0')}`;
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <title>車両リース代明細書_${escHtml(company)}御中_${month}</title>
  <style>${getDocCss()}${statementDocStyle()}</style></head><body>
  <div class="doc">
    <div class="doc-head">
      <div class="doc-no">No. ${docNo}</div>
      <div class="doc-title">車両リース代明細書</div>
      <div class="doc-date">${getStatementIssueDate()}</div>
    </div>
    <div class="doc-parties">
      <div class="party-to">
        <div class="name">${escHtml(company)}　御中</div>
        <div class="meta">${recipientMeta.map(escHtml).join('<br>')}</div>
      </div>
      <div class="party-from">
        <div>
          <div class="name">${escHtml(companyLines[0])}</div>
          <div class="meta">${companyLines.slice(1).map(escHtml).join('<br>')}</div>
        </div>
        ${cAll.stamp_image ? `<div class="hanko hanko-img" style="transform:rotate(${hankoStampRotationDeg()}deg);width:${hankoStampSizePx()}px;height:${hankoStampSizePx()}px"><img src="${cAll.stamp_image}"></div>` : `<div class="hanko"><span style="font-size:21px">印</span></div>`}
      </div>
    </div>
    <div class="period-bar"><span>${escHtml(periodLabel)}</span><span>対象月: <b>${month||'—'}</b></span></div>
    <table class="items">
      <thead><tr>
        <th style="width:8%">No</th><th style="width:30%">ドライバー名</th><th style="width:42%">車両番号</th><th class="num" style="width:20%">リース料（月額）</th>
      </tr></thead>
      <tbody>${itemRows.map(it=>`<tr>
        <td>${it.no}</td><td>${escHtml(it.name)}</td><td>${escHtml(it.cars)}</td><td class="num">${yen(it.amt)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <table class="summary-table" style="margin-top:10px">
      <tr><th>台数</th><th class="hl">支払合計金額</th></tr>
      <tr><td>${itemRows.length}台</td><td class="hl">${yen(total)}</td></tr>
    </table>
    ${p?.bank ? `<div style="font-size:11px;margin-top:10px">お支払先: ${escHtml(p.bank)}</div>` : ''}
  </div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;
  const win = window.open('','_blank');
  if (!writeStatementWindow(win, () => html)) return;
  addLog('リース代明細書作成', `${company} ${month} ${itemRows.length}台 ${yen(total)}`);
}

// 「出力形式」セレクト（通常／鑑）に応じてExcel・PDFボタンの動作を振り分ける（ボタン数を増やさず集約するため）。
// onclickからは結果を待たれない（fire-and-forget）ため、内部の非同期処理を必ずawaitしてtry/catchで
// 包み、失敗時に例外が握りつぶされて「何も起きない」ように見えることがないようにする
async function handlePayExcelOut() {
  const mode = document.getElementById('payOutMode')?.value;
  try {
    if (mode === 'cover') await bulkExportPayExcelStacked();
    else await bulkExportPayExcel();
  } catch(e) { alert('Excel作成に失敗しました: ' + e.message); console.error(e); }
}
async function handlePayPdfOut() {
  const mode = document.getElementById('payOutMode')?.value;
  try {
    if (mode === 'cover') await bulkCreatePaySlipPdfWithCover();
    else await bulkCreatePaySlipPdf();
  } catch(e) { alert('PDF作成に失敗しました: ' + e.message); console.error(e); }
}

// プルダウンで選んだ協力会社に所属する集計期間中のドライバーを全選択し、そのまま鑑を発行する
async function exportPartnerCover(format) {
  const company = document.getElementById('aggPayPartnerSel')?.value;
  if (!company) { alert('協力会社を選択してください'); return; }
  const groups = window._aggPayGroups || {};
  const targetIds = Object.values(groups).filter(g=>g.drv.company===company).map(g=>g.drv.id);
  if (!targetIds.length) { alert('該当するドライバーが集計結果内に見つかりません'); return; }
  document.querySelectorAll('.aggPayChk').forEach(el => { el.checked = targetIds.includes(+el.value); });
  try {
    if (format === 'excel') await bulkExportPayExcelStacked();
    else await bulkCreatePaySlipPdfWithCover();
  } catch(e) { alert((format==='excel'?'Excel':'PDF')+'作成に失敗しました: ' + e.message); console.error(e); }
}

// 鑑（表紙）付きの支払明細書PDFを、選択した複数ドライバー分まとめて作成する
async function bulkCreatePaySlipPdfWithCover() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const groups = checked.map(drvId => window._aggPayGroups?.[String(drvId)]?.rows).filter(rows=>rows && rows.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const companies = [...new Set(groups.map(rows => recDrv(rows[0])?.company).filter(Boolean))];
  const suggested = companies.length === 1 ? companies[0] : '';
  // クリック直後（ユーザー操作の一連の流れ）でなくなってからwindow.open()すると、
  // ブラウザにポップアップとしてブロックされる（宛先確定モーダルでの入力待ちをawaitで
  // 挟んだ後に開くと発生。「ポップアップがブロックされました」報告の原因だった）。
  // そのためクリック時に空タブを先に開いておく。ただし先に開くと新規タブへフォーカスが
  // 移ってしまい、宛先モーダルが元のタブに隠れたまま気付かれず応答待ちで止まって見える
  // （実質「発行できない」ように見える）ため、開いた直後に元のタブへフォーカスを戻し、
  // 宛先確定後にその開いたタブへ内容を書き込んで表に出す
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  window.focus();
  const addressee = await openKanAte(suggested);
  if (addressee === undefined) { win.close(); return; }
  if (!writeStatementWindow(win, () => buildStatementHtmlMultiWithCover('payment', groups, addressee))) return;
  win.focus();
  addLog('PDF出力', `支払明細書（鑑形式） 選択${checked.length}件${addressee?' 宛て:'+addressee.name:''}`);
}


/* ── XLSX読み込み（複数請求書対応・自動計算版） ── */
async function slipLoad(file, appendMode=false) {
  if (!file) return;
  const dropArea = document.getElementById('slipDropArea');
  if (dropArea) dropArea.style.display = 'none';
  setSlipStatus('📂 読み込み中... ' + file.name, 'info');
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array', cellText:true, cellDates:true});
    const sheet = wb.Sheets['invoice'] || wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('invoiceシートが見つかりません');

    const ref = sheet['!ref'] || 'A1';
    const maxRow = XLSX.utils.decode_range(ref).e.r + 1;

    // inlineStr セルは .v が null で .w に値が入る場合がある
    // 数値セルは .v が数値のまま保持される（raw:true相当）
    const cv = (col, row) => {
      const cell = sheet[`${col}${row}`];
      if (!cell) return null;
      // 数値型はそのまま返す
      if (typeof cell.v === 'number') return cell.v;
      // 文字列・inlineStr は .v 優先、なければ .w
      if (cell.v !== undefined && cell.v !== null && cell.v !== '') return cell.v;
      if (cell.w !== undefined && cell.w !== null && cell.w !== '') return cell.w;
      return null;
    };
    const cs = (col, row) => {
      const v = cv(col, row);
      return v === null || v === undefined ? '' : String(v).trim();
    };

    const blockStarts = [];
    for (let ri = 1; ri <= maxRow; ri++) {
      const v = cs('BP', ri);
      if (/^No\.\d+/.test(v)) blockStarts.push(ri);
    }
    if (blockStarts.length === 0) throw new Error('請求明細書ブロックが見つかりません（BP列にNo.XXXXが必要です）');

    const dataRows = [];
    let globalPaymentDate = '';
    let globalIssueDate = '';

    for (let bi = 0; bi < blockStarts.length; bi++) {
      const startRow = blockStarts[bi];
      const endRow   = bi + 1 < blockStarts.length ? blockStarts[bi+1] - 1 : maxRow;

      const invoiceNoRaw = cs('BP', startRow);
      const invoiceNo = invoiceNoRaw.replace(/^No\.0*/, '') || '';

      let issueDate = '';
      for (let ri = startRow; ri <= startRow + 5; ri++) {
        const v = cs('Q', ri);
        const m = v.match(/(\d{4})年\s*(\d{1,2})月(\d{1,2})日/);
        if (m) { issueDate = `${m[1]}${m[2].padStart(2,'0')}${m[3].padStart(2,'0')}`; break; }
      }
      if (issueDate && !globalIssueDate) globalIssueDate = issueDate;

      let paymentDate = '';
      for (let ri = startRow; ri <= endRow; ri++) {
        const v = cs('B', ri);
        if (v.includes('支払実行日')) {
          const m = v.match(/支払実行日[:：](\d{4})年(\d{2})月(\d{2})日/);
          if (m) { paymentDate = `${m[1]}${m[2]}${m[3]}`; break; }
        }
      }
      if (paymentDate && !globalPaymentDate) globalPaymentDate = paymentDate;

      // 宛名（B列の「〜様」「〜御中」の行）を取り出す。この明細書1枚分のドライバー特定に使う。
      // 宛名が長いと2行に折り返されることがあるため（例:「石原」＋「宏美 （名古屋支社）　様」）、
      // 直前行に数字が含まれない＝住所・電話番号・登録番号ではない場合だけ連結する
      let addressee = '';
      let addrRow = -1;
      for (let ri = startRow; ri <= endRow; ri++) {
        const v = cs('B', ri);
        if (/(様|御中)$/.test(v)) { addressee = v; addrRow = ri; break; }
      }
      if (addrRow > startRow) {
        const prev = cs('B', addrRow - 1);
        if (prev && !/\d/.test(prev) && !/(様|御中)$/.test(prev)) addressee = prev + addressee;
      }
      addressee = addressee.replace(/[\s　]*(様|御中)$/, '');
      // 明細書1枚につきドライバーは1人のため、宛名からの特定はブロック単位で1回だけ行う
      const blockDrv = lkDByName(addressee);

      let dataStart = -1;
      for (let ri = startRow; ri <= endRow; ri++) {
        if (cs('BF', ri) === '数量') { dataStart = ri + 1; break; }
      }
      if (dataStart < 0) {
        for (let ri = startRow; ri <= endRow; ri++) {
          if (cv('B', ri) === 1) { dataStart = ri; break; }
        }
      }
      if (dataStart < 0) continue;

      let taxableTotal = 0;
      let feeAmount    = 0;
      let taxAmount    = null;
      let adminFee     = 0;  let adminFeeFound = false;
      let vehicleRental= 0;  let vehicleRentalFound = false;
      const extraDeductions = [];

      for (let ri = dataStart; ri <= endRow; ri++) {
        const label = cs('BF', ri);
        const amount = typeof cv('BR', ri) === 'number' ? cv('BR', ri) : 0;
        // *マーク付き経費行（ガソリン代など）
        if (cs('BZ', ri) === '*') {
          const expLabel = cs('N', ri) || label || '経費';
          if (expLabel && amount !== 0) extraDeductions.push({ label: expLabel, amount });
          continue;
        }
        if (label === '外税対象小計') { taxableTotal = amount; }
        else if (label === '業務手数料' || label === 'グループ手数料') { feeAmount = amount; }
        else if (label.includes('事務') && (label.includes('手数料') || label.includes('登録')))  { adminFee = amount; adminFeeFound = true; }
        else if (label.includes('リース') || label.includes('レンタル') || label.includes('持込')) { vehicleRental = amount; vehicleRentalFound = true; }
        // 参考消費税はComtruck側の記載額をそのまま採用する（自前で再計算すると端数処理の方式が微妙に異なり数円ずれるため）
        else if (label.startsWith('参考消費税')) { taxAmount = amount; }
        else if (label === '合計' || label === '高速代など小計') { /* skip */ }
        else if (label === '住宅賃料') { extraDeductions.push({ label, amount }); }
        else if (label && amount < 0) {
          extraDeductions.push({ label, amount });
        }
      }

      // 表示用の手数料率（実際の合計計算にはfeeAmount/taxAmountの記載額そのものを使うため、ここは目安表示にのみ使用）
      const calcFeeRate = taxableTotal !== 0 ? +(feeAmount / taxableTotal).toFixed(4) : null;

      for (let ri = dataStart; ri <= endRow; ri++) {
        const no = cv('B', ri);
        if (typeof no !== 'number' || no < 1 || no > 999 || !Number.isInteger(no)) continue;

        const dateVal   = cs('E', ri);
        const carVal    = cs('I', ri);
        const detailRaw = cs('N', ri).replace(/\n/g, ' ');
        const qtyRaw    = cv('BF', ri);
        const priceRaw  = cs('BL', ri);
        const hwRaw     = cv('AT', ri);
        const distRaw   = cv('AZ', ri);
        const brAmount  = typeof cv('BR', ri) === 'number' ? cv('BR', ri) : null;
        const isExpense = cs('BZ', ri) === '*';  // *マーク付き = 経費行、明細には含めない

        // 経費行はスキップ（高速代など小計の内訳として別管理）
        if (isExpense) continue;

        // 数量もBR金額もない行はスキップ
        const hasQty = qtyRaw != null && !isNaN(parseFloat(String(qtyRaw).replace(/,/g,'')));
        const hasBR  = brAmount !== null;
        if (!hasQty && !hasBR) continue;

        const qty = hasQty ? (parseFloat(String(qtyRaw).replace(/,/g,'')) || '') : '';
        let price = '';
        if (priceRaw) {
          const pm = priceRaw.match(/([\d,]+\.?\d*)/);
          if (pm) {
            const pf = parseFloat(pm[1].replace(/,/g,''));
            price = Number.isInteger(pf) ? pf : parseFloat(pf.toFixed(2));
          }
        }
        // 数量・単価ともに空で金額(BR)だけある行 → 単価=BR金額、数量=空のまま
        if (!hasQty && !priceRaw && hasBR) {
          price = brAmount;
        }
        // 数量あり・単価なし・金額あり → 単価は空、金額をそのまま price に（CSV高速代他列へ）
        // ※ BL（単価テキスト）がある場合のみ単価を使い、ない場合は金額直接
        let directAmount = null; // 単価なし・金額直接の場合
        if (hasQty && !priceRaw && hasBR && qty !== '') {
          directAmount = brAmount; // 金額列に出す
          price = '';              // 単価は空
        }
        const highway = typeof hwRaw === 'number' ? hwRaw : 0;
        const distance = distRaw != null ? String(distRaw) : '';

        // ドライバー特定は氏名のみで行う（車番では引かない）。
        // コムトラックから車番データを丸ごと引き継いでおり解約者分の登録が残っているため、
        // 同じ車番が複数人に紐づいていて車番からは乗務者を一意に決められない。
        // 宛名は明細書1枚につき1人で確実なため宛名を最優先し、次に車番セル内の氏名を使う
        const drv = blockDrv || lkDByCarCellName(carVal);

        const feeRate = calcFeeRate ?? (drv ? (drvPay(drv).fee_rate ?? -0.15) : -0.15);

        // 仕入先IDはドライバー登録値を優先、なければ請求書Noを使用
        const suppId = drv?.supplier_id || invoiceNo;
        // 請求明細書番号は仕入先IDと一致させる（ドライバー照合済みの場合）
        const invNo  = drv?.supplier_id ? drv.supplier_id : invoiceNo;

        dataRows.push({
          supplier_id:      suppId,
          drv_id:           drv?.id ?? null,  // 特定済みドライバーを保持し、集計時に車番から引き直さないようにする
          addressee,                          // 未照合時にどの明細書か分かるよう宛名も保持する
          fee_rate:         feeRate,
          note_col:         '',
          admin_fee:        adminFeeFound      ? adminFee      : (drv?.admin_fee      ?? -10000),
          vehicle_rental:   vehicleRentalFound ? vehicleRental : (drv?.vehicle_rental ?? -30000),
          extra_deductions: extraDeductions,
          invoice_no:       invNo,
          issue_date:       issueDate,
          payment_date:     paymentDate,
          no,
          date:             dateVal,
          car_info:         carVal,
          detail:           detailRaw,
          highway,
          distance,
          qty,
          price,
          direct_amount:    directAmount,  // 数量あり・単価なし時の金額直接値
          _taxable_total:   taxableTotal,
          _fee_amount:      feeAmount,
          _tax_amount:      taxAmount,
        });
      }
    }

    if (dataRows.length === 0) throw new Error('データ行が見つかりません');

    if (globalPaymentDate) {
      const pd = document.getElementById('payDateInput');
      if (pd) pd.value = globalPaymentDate;
    }

    // 未照合＝宛名でも車番でもドライバーを特定できなかった明細。宛名を出した方が誰の分か分かりやすい
    const unmatched = [...new Set(
      dataRows.filter(r => r.drv_id == null).map(r => r.addressee || splitCarInfoCell(r.car_info).carNum)
    )].filter(Boolean);

    const invoiceCount = blockStarts.length;
    const totalRows = appendMode ? payRows.length : dataRows.length; // appendMode時は合計件数
    if (unmatched.length > 0) {
      setSlipStatus(`⚠️ ${invoiceCount}枚・${dataRows.length}件読み込み（累計${totalRows}件）。未照合: ${unmatched.join(' / ')}`, 'warn');
    } else {
      setSlipStatus(`✓ ${invoiceCount}枚・${dataRows.length}件読み込み（累計${totalRows}件）。全ドライバー照合済み`, 'ok');
    }

    // ② 追記モード：既存データに追記（同一invoice_noは上書き）
    if (appendMode && payRows.length > 0) {
      const existingInvoices = new Set(dataRows.map(r => r.invoice_no));
      const kept = payRows.filter(r => !existingInvoices.has(r.invoice_no));
      payRows = [...kept, ...dataRows];
    } else {
      payRows = dataRows;
    }
    paySourceMode = 'xlsx';

    // ④ 対象期間を支払実行日から自動セット（YYYYMMDD → 当該月の1日〜末日）
    if (globalPaymentDate) {
      const m = String(globalPaymentDate).match(/^(\d{4})(\d{2})/);
      if (m) {
        const target = `${m[1]}-${m[2]}`;
        const range = monthToRange(target);
        const fromEl = document.getElementById('payFrom');
        const toEl = document.getElementById('payTo');
        if (fromEl && toEl) { fromEl.value = range.from; toEl.value = range.to; }
        paySelectedMonth = target;
      }
    }

    renderPayTable();

  } catch(e) {
    setSlipStatus('✗ 読み込みエラー: ' + e.message, 'err');
    if (document.getElementById('slipDropArea')) document.getElementById('slipDropArea').style.display = '';
  }
  document.getElementById('slipFileIn').value = '';
}

// ② 複数ファイル追記ラッパー
async function slipLoadMulti(files, appendMode) {
  if (!files || files.length === 0) return;
  const arr = Array.from(files);
  // ファイル名でソートして順番を安定させる
  arr.sort((a,b) => a.name.localeCompare(b.name, 'ja'));
  let first = true;
  for (const f of arr) {
    const useAppend = appendMode !== undefined ? (appendMode || !first) : true;
    await slipLoad(f, useAppend);
    first = false;
  }
  document.getElementById('slipFileIn').value = '';
}

// ② クリア
function clearPayRows() {
  if (payRows.length > 0 && !confirm('読み込み済みデータをすべてクリアしますか？')) return;
  payRows = [];
  paySourceMode = 'xlsx';
  setSlipStatus('');
  const dropArea = document.getElementById('slipDropArea');
  if (dropArea) dropArea.style.display = '';
  renderPayTable();
}

function setSlipStatus(msg, type) {
  const el = document.getElementById('slipStatus');
  const el2 = document.getElementById('slipStatus2');
  const colors = { info:'var(--text2)', ok:'var(--blue)', warn:'#d97706', err:'#e05b5b' };
  if (el) {
    if (!msg) { el.style.display='none'; } else {
      el.style.display = 'block';
      el.style.color = colors[type] || 'var(--text2)';
      el.textContent = msg;
    }
  }
  if (el2) {
    el2.style.color = colors[type] || 'var(--text2)';
    el2.textContent = msg || '';
  }
}

// 取込明細（全項目）テーブルの行削除
// 受注入力由来（invoice_idあり＝recsモード）の行は元のinvoicesレコードも削除しないと、
// 次回の再集計（タブ切替・期間変更・再読込）時にbuildPayFromRecs()がrecsから再構築して復活してしまう。
// ファイル取込由来（invoice_idなし＝xlsxモード）の行はinvoicesに実体が無いためプレビュー配列からのみ削除する。
async function deletePayRow(i) {
  if (!payRows || !payRows[i]) return;
  if (!confirm('この行を削除しますか？')) return;
  await deletePayRowsByIndex([i]);
}

// 取込明細（全項目）テーブルのチェックボックス一括選択/解除
function togglePayRowAll(checked) {
  document.querySelectorAll('.payRowChk').forEach(el => el.checked = checked);
  const all = document.getElementById('payRowChkAll');
  if (all) all.checked = checked;
}

// 選択した行をまとめて削除（インデックスの大きい方から削除して、ずれを防ぐ）
async function bulkDeletePayRows() {
  const checked = Array.from(document.querySelectorAll('.payRowChk:checked')).map(el => +el.value);
  if (!checked.length) { alert('削除する行を選択してください'); return; }
  if (!confirm(`選択した${checked.length}件を削除しますか？`)) return;
  await deletePayRowsByIndex(checked);
}

async function deletePayRowsByIndex(indices) {
  const rows = indices.map(i => payRows[i]).filter(Boolean);
  const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
  if (invoiceIds.length) {
    showLoad(true);
    try {
      const { error } = await sb.from('invoices').delete().in('id', invoiceIds);
      if (error) throw error;
      recs = recs.filter(r => !invoiceIds.includes(r.id));
      addLog('取込明細削除', `${invoiceIds.length}件`);
    } catch(e) {
      showLoad(false);
      showT('削除エラー: ' + e.message, 'ter');
      return;
    }
    showLoad(false);
  }
  indices.slice().sort((a,b) => b-a).forEach(i => payRows.splice(i, 1));
  renderPayTable();
  showT('削除しました');
}

// ⑦ インライン編集ヘルパー
// 車番(car_info)の修正は、明細一覧の表示だけでなく元の受注データ(invoices/recs)にも書き戻す。
// これをしないと「明細一覧では車番が変わっているのに他の画面（ダッシュボード・集計など）には反映されない」問題が起きるため。
function editCell(el, rowIdx, field, isNum=false) {
  const cur = String(payRows[rowIdx][field] ?? '');
  const inp = document.createElement('input');
  inp.value = cur;
  inp.style.cssText = 'width:100%;border:1px solid var(--blue);border-radius:3px;padding:1px 4px;font-size:11px;background:var(--bg);color:var(--text)';
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus(); inp.select();
  const commit = async () => {
    let v = inp.value.trim();
    if (isNum && v !== '') { const n = parseFloat(v.replace(/,/g,'')); v = isNaN(n) ? payRows[rowIdx][field] : n; }
    const row = payRows[rowIdx];
    if (field === 'car_info' && row.invoice_id != null && v !== cur) {
      const newCar = v.split(/[\s　]/)[0];
      showLoad(true);
      try {
        const { error } = await sb.from('invoices').update({ car: newCar }).eq('id', row.invoice_id);
        if (error) throw error;
        const rec = recs.find(r => r.id === row.invoice_id);
        if (rec) rec.car = newCar;
        addLog('明細一覧 車番修正', `${cur} → ${newCar}`);
        showT('車番を更新しました（他の画面にも反映されます）');
        buildPayFromRecs();
      } catch(e) {
        showT('車番の更新に失敗しました: ' + e.message, 'ter');
        renderPayTable();
      }
      showLoad(false);
      return;
    }
    row[field] = v;
    renderPayTable();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => { if(e.key==='Enter') inp.blur(); if(e.key==='Escape'){inp.value=cur;inp.blur();} });
}

const editStyle = 'cursor:text;' ;

// Comtruck取込データ（payRows）の1グループ（ドライバー単位）の手取り合計を計算する。
// これまでは単純にprice+highwayを合算するだけで、fee_rate/admin_fee/vehicle_rentalを一切使っていなかったため
// Comtruck自身の計算結果（外税対象小計に業務手数料・消費税をかけ、高速代は内税対象として税・手数料の対象外で
// そのまま加算する方式）と大きくずれていた。Comtruckの計算方式に合わせて修正する。
// 業務手数料・消費税はComtruck明細に記載されている金額（_fee_amount/_tax_amount）をそのまま使う。
// fee_rate（4桁に丸めた比率）から自前で再計算すると、丸め誤差でComtruckの記載額と数円ズレることがあるため。
function calcPayRowGroupTotal(rowItems) {
  const rows = rowItems.map(item => item.r || item);
  if (!rows.length) return 0;
  const taxableTotal = rows.reduce((s,r) => s + (Number(r.direct_amount ?? r.price)||0), 0);
  const highwayTotal = rows.reduce((s,r) => s + (Number(r.highway)||0), 0);
  const adminFee = rows[0].admin_fee ?? -10000;
  const vehicleRental = rows[0].vehicle_rental ?? -30000;
  // extra_deductionsはブロック内の全行が同じ配列を共有しているため、先頭行からのみ取得する（合算すると行数分重複してしまう）
  const extraDeductionsTotal = (rows[0].extra_deductions||[]).reduce((s,ed)=>s+(Number(ed.amount)||0),0);
  const feeAmount = rows[0]._fee_amount != null ? rows[0]._fee_amount : roundHalfUp(taxableTotal * (rows[0].fee_rate ?? -0.15));
  const netSubtotal = taxableTotal + feeAmount;
  const tax = rows[0]._tax_amount != null ? rows[0]._tax_amount : roundHalfUp(netSubtotal * 0.10);
  return netSubtotal + tax + adminFee + vehicleRental + extraDeductionsTotal + highwayTotal;
}

function updatePayImportPreview() {
  const el = document.getElementById('payImportPreview');
  const bar = document.getElementById('payListSummaryBar');
  if (!payRows || payRows.length === 0) {
    if (el) el.textContent = '取込データはまだありません';
    if (bar) bar.textContent = '取込データはまだありません';
    return;
  }
  const { groups } = groupPayRowsByDriver(payRows.map((r,i)=>({r,i})));
  const total = Object.values(groups).reduce((s,g) => s + calcPayRowGroupTotal(g.rows), 0);
  const cars = new Set(payRows.map(r=>r.car_info)).size;
  const monthLabel = paySelectedMonth || '';
  const html = `<b>${payRows.length}件</b> 取込済み（車番/ドライバー ${cars}件）　対象月: ${monthLabel}　支払合計目安: <b>¥${total.toLocaleString()}</b>`;
  if (el) el.innerHTML = html;
  if (bar) bar.innerHTML = html;
}

function renderPayTable() {
  const tbodyF0 = document.getElementById('f0PaySlipTbody');
  updatePayImportPreview();
  renderPayTbodyGrouped();
  if (tbodyF0) tbodyF0.innerHTML = buildPayRowsHtml(true);
}

/* ===== 明細一覧: 検索・並び替え・ドライバー別グループ表示 ===== */
let paySortDir = 'asc';
let payGroupCollapsed = new Set();

function setPayListSort(dir) {
  paySortDir = dir;
  document.getElementById('payListSortAsc')?.classList.toggle('on', dir==='asc');
  document.getElementById('payListSortDesc')?.classList.toggle('on', dir==='desc');
  renderPayTable();
}

function togglePayGroup(key) {
  if (payGroupCollapsed.has(key)) payGroupCollapsed.delete(key); else payGroupCollapsed.add(key);
  renderPayTable();
}

function setAllPayGroupsCollapsed(collapsed) {
  if (collapsed) {
    const { order } = groupPayRowsByDriver(filterPayRowsIndexed());
    payGroupCollapsed = new Set(order);
  } else {
    payGroupCollapsed = new Set();
  }
  renderPayTable();
}

function filterPayRowsIndexed() {
  const q = (document.getElementById('payListSearch')?.value || '').trim().toLowerCase();
  let indexed = (payRows||[]).map((r,i)=>({r,i}));
  if (q) {
    indexed = indexed.filter(({r}) => {
      const hay = [r.car_info, r.detail, r.supplier_id, r.invoice_no, r.date].map(v=>String(v||'').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  return indexed;
}

// drv_id（手動選択・自動判定済み）があればそれを優先し、なければcar_infoからドライバーを特定してグループ化（未照合は末尾にまとめる）
function groupPayRowsByDriver(indexed) {
  const groups = {};
  const order = [];
  const idIdx = driverIndexes().id;
  // 取込済みのdrv_id（宛名から特定済み）を最優先し、無ければ車番セル内の氏名で引く。
  // 車番では引かない（解約者分の登録が残っていて同じ車番が複数人に紐づいているため）
  indexed.forEach(item => {
    const carNum = splitCarInfoCell(item.r.car_info).carNum;
    const drv = (item.r.drv_id != null ? idIdx.get(item.r.drv_id) : null)
      || lkDByCarCellName(item.r.car_info);
    const key = drv ? 'd'+drv.id : (item.r.supplier_id ? 'sup'+item.r.supplier_id : 'u'+(carNum||'unknown'));
    const label = drv ? drv.name : (item.r.supplier_id ? `未登録（ドライバーID:${item.r.supplier_id}）` : (carNum || '車番未照合'));
    if (!groups[key]) { groups[key] = {key, label, rows:[]}; order.push(key); }
    groups[key].rows.push(item);
  });
  order.forEach(key => {
    groups[key].rows.sort((a,b) => {
      const cmp = String(a.r.date||'').localeCompare(String(b.r.date||''));
      return paySortDir==='asc' ? cmp : -cmp;
    });
  });
  order.sort((ka,kb) => {
    const ua = ka.startsWith('u'), ub = kb.startsWith('u');
    if (ua !== ub) return ua ? 1 : -1;
    return groups[ka].label.localeCompare(groups[kb].label, 'ja');
  });
  return { groups, order };
}

function renderPayTbodyGrouped() {
  const tbody = document.getElementById('payTbody');
  if (!tbody) return;
  if (!payRows || payRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" style="padding:40px;text-align:center;color:var(--text3)">対象月を選択するか、XLSXをアップロードしてください</td></tr>';
    return;
  }
  const indexed = filterPayRowsIndexed();
  if (indexed.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" style="padding:40px;text-align:center;color:var(--text3)">検索条件に一致するデータがありません</td></tr>';
    return;
  }
  const { groups, order } = groupPayRowsByDriver(indexed);
  const rows = [];
  order.forEach(key => {
    const g = groups[key];
    const collapsed = payGroupCollapsed.has(key);
    const cnt = g.rows.length;
    const total = calcPayRowGroupTotal(g.rows);
    rows.push(`<tr style="background:var(--bg2);cursor:pointer;border-bottom:0.5px solid var(--border)" onclick="togglePayGroup('${key}')">
      <td colspan="13" style="padding:6px 8px;font-weight:600">
        <span style="display:inline-block;width:12px">${collapsed?'▶':'▼'}</span> ${g.label}
        <span style="font-weight:400;color:var(--text2);font-size:10px;margin-left:8px">${cnt}件 ／ 支払合計 ¥${total.toLocaleString()}</span>
      </td>
    </tr>`);
    if (collapsed) return;
    g.rows.forEach(({r,i}, idxInGroup) => {
      const isFirst = idxInGroup === 0 || g.rows[idxInGroup-1].r.invoice_no !== r.invoice_no;
      const supColor = r.supplier_id ? 'var(--blue)' : '#e05b5b';
      const ec = (field, isNum=false) => `ondblclick="editCell(this,${i},'${field}',${isNum})" title="ダブルクリックで編集"`;
      const zebra = idxInGroup % 2 === 1 ? ';background:var(--bg2)' : '';
      rows.push(`<tr class="payrow" style="border-bottom:0.5px solid var(--border2)${isFirst?';border-top:1px solid var(--border)':''}${zebra}">
        <td style="padding:6px 8px;font-weight:600;color:${supColor};${editStyle}" ${isFirst?ec('supplier_id'):''}>
          ${isFirst ? (escHtml(r.supplier_id)||'<span style="color:#e05b5b">未照合</span>') : ''}</td>
        <td style="padding:6px 8px;color:var(--text2)"></td>
        <td style="padding:6px 8px;color:var(--text2)">${isFirst ? escHtml(r.invoice_no||'') : ''}</td>
        <td style="padding:6px 8px;color:var(--text2)">${isFirst ? escHtml(r.issue_date||'') : ''}</td>
        <td style="padding:6px 8px">${escHtml(r.payment_date)}</td>
        <td style="padding:6px 8px;text-align:center;color:var(--text3)">${r.no}</td>
        <td style="padding:6px 8px;${editStyle}" ${ec('date')}>${escHtml(r.date)}</td>
        <td style="padding:6px 8px;font-weight:500;${editStyle}" ${ec('car_info')}>${escHtml(r.car_info)}</td>
        <td style="padding:6px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${editStyle}" ${ec('detail')} title="${escHtml(r.detail)}">${escHtml(r.detail)}</td>
        <td style="padding:6px 8px;text-align:right;${editStyle}" ${ec('highway',true)}>${r.highway ? '¥'+Number(r.highway).toLocaleString() : ''}</td>
        <td style="padding:6px 8px;color:var(--text2);${editStyle}" ${ec('distance')}>${escHtml(r.distance)}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:500;${editStyle}" ${ec('qty',true)}>${r.qty!=='' ? Number(r.qty).toLocaleString() : ''}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:500;${editStyle}" ${ec('price',true)}>${(r.direct_amount != null ? r.direct_amount : r.price)!=='' ? '¥'+Number(r.direct_amount ?? r.price).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2}) : ''}</td>
      </tr>`);
      const isLastInGroup = idxInGroup === g.rows.length-1 || g.rows[idxInGroup+1].r.invoice_no !== r.invoice_no;
      if (isLastInGroup && r.extra_deductions && r.extra_deductions.length > 0) {
        r.extra_deductions.forEach(ed => {
          rows.push(`<tr style="border-bottom:0.5px solid var(--border2);background:rgba(224,91,91,0.04)">
            <td colspan="2" style="padding:4px 8px;text-align:right;color:var(--text2);font-size:11px">${ed.label}</td>
            <td colspan="11" style="padding:4px 8px;color:#e05b5b;font-size:11px">¥${Number(ed.amount).toLocaleString()}</td>
          </tr>`);
        });
      }
    });
  });
  tbody.innerHTML = rows.join('');
}

// extended=false: 支払明細書作成タブ（従来通り13列）
// extended=true : 支払明細書作成タブの「取込明細（全項目）」（業務手数料率・事務手数料・車両レンタル・メモ・削除ボタンを追加した18列）
function buildPayRowsHtml(extended) {
  const colspan = extended ? 19 : 13;
  if (!payRows || payRows.length === 0) {
    return `<tr><td colspan="${colspan}" style="padding:40px;text-align:center;color:var(--text3)">対象データがありません</td></tr>`;
  }
  const rows = [];
  payRows.forEach((r, i) => {
    const isFirst = i === 0 || payRows[i-1].invoice_no !== r.invoice_no;
    const supColor = r.supplier_id ? 'var(--blue)' : '#e05b5b';
    const ec = (field, isNum=false) => `ondblclick="editCell(this,${i},'${field}',${isNum})" title="ダブルクリックで編集"`;

    rows.push(`<tr style="border-bottom:0.5px solid var(--border2)${isFirst?';border-top:2px solid var(--blue)':''}">${extended ? `
      <td style="padding:6px 8px"><input type="checkbox" class="payRowChk" value="${i}"></td>` : ''}
      <td style="padding:6px 8px;font-weight:600;color:${supColor};${editStyle}" ${isFirst?ec('supplier_id'):''}>
        ${isFirst ? (escHtml(r.supplier_id)||'<span style="color:#e05b5b">未照合</span>') : ''}</td>
      <td style="padding:6px 8px;color:var(--text2)"></td>
      <td style="padding:6px 8px;color:var(--text2)">${isFirst ? escHtml(r.invoice_no||'') : ''}</td>
      <td style="padding:6px 8px;color:var(--text2)">${isFirst ? escHtml(r.issue_date||'') : ''}</td>
      <td style="padding:6px 8px">${escHtml(r.payment_date)}</td>
      <td style="padding:6px 8px;text-align:center;color:var(--text3)">${r.no}</td>
      <td style="padding:6px 8px;${editStyle}" ${ec('date')}>${escHtml(r.date)}</td>
      <td style="padding:6px 8px;font-weight:500;${editStyle}" ${ec('car_info')}>${escHtml(r.car_info)}</td>
      <td style="padding:6px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${editStyle}" ${ec('detail')} title="${escHtml(r.detail)}">${escHtml(r.detail)}</td>
      <td style="padding:6px 8px;text-align:right;${editStyle}" ${ec('highway',true)}>${r.highway ? '¥'+Number(r.highway).toLocaleString() : ''}</td>
      <td style="padding:6px 8px;color:var(--text2);${editStyle}" ${ec('distance')}>${escHtml(r.distance)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:500;${editStyle}" ${ec('qty',true)}>${r.qty!=='' ? Number(r.qty).toLocaleString() : ''}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:500;${editStyle}" ${ec('price',true)}>${(r.direct_amount != null ? r.direct_amount : r.price)!=='' ? '¥'+Number(r.direct_amount ?? r.price).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2}) : ''}</td>${extended ? `
      <td style="padding:6px 8px;text-align:right;color:var(--text2)">${isFirst && r.fee_rate!=null ? (r.fee_rate*100).toFixed(1)+'%' : ''}</td>
      <td style="padding:6px 8px;text-align:right;color:var(--text2)">${isFirst && r.admin_fee ? '¥'+Number(r.admin_fee).toLocaleString() : ''}</td>
      <td style="padding:6px 8px;text-align:right;color:var(--text2)">${isFirst && r.vehicle_rental ? '¥'+Number(r.vehicle_rental).toLocaleString() : ''}</td>
      <td style="padding:6px 8px;color:var(--text2)">${isFirst ? escHtml(r.note_col||'') : ''}</td>
      <td style="padding:6px 8px;text-align:center"><button class="ibtn" style="color:#e05b5b" onclick="deletePayRow(${i})" title="この行を削除">🗑</button></td>` : ''}
    </tr>`);

    const isLast = i === payRows.length-1 || payRows[i+1].invoice_no !== r.invoice_no;
    if (isLast && r.extra_deductions && r.extra_deductions.length > 0) {
      r.extra_deductions.forEach(ed => {
        rows.push(`<tr style="border-bottom:0.5px solid var(--border2);background:rgba(224,91,91,0.04)">
          <td colspan="2" style="padding:4px 8px;text-align:right;color:var(--text2);font-size:11px">${ed.label}</td>
          <td colspan="${colspan-2}" style="padding:4px 8px;color:#e05b5b;font-size:11px">¥${Number(ed.amount).toLocaleString()}</td>
        </tr>`);
      });
    }
  });
  return rows.join('');
}

/* ===== 支払明細書 保存・読み込み（Supabase: payment_slips） ===== */

function openSlipSave() {
  if (!payRows || payRows.length === 0) { alert('保存するデータがありません'); return; }
  // デフォルト保存名を対象月から生成
  const mo = paySelectedMonth || '';
  const defaultLabel = mo ? mo.replace('-', '年') + '月分' : new Date().toLocaleDateString('ja-JP') + '分';
  document.getElementById('slipSaveLabel').value = defaultLabel;
  document.getElementById('slipSaveCount').textContent = `${payRows.length}件のデータを保存します`;
  document.getElementById('mSlipSave').classList.add('on');
}

/* ===== payment_slips / invoice_slips 共通CRUDヘルパー（保存名・対象月の列名が違うだけで処理は同じ） ===== */
async function saveSlipRow(table, monthField, label, month, rows) {
  const { error } = await sb.from(table).insert({
    label, [monthField]: month || null, rows, saved_at: new Date().toISOString(), saved_by: me?.name || '—',
  });
  if (error) throw error;
}
async function listSlipRows(table, monthField) {
  const { data, error } = await fetchAllRows(() => sb.from(table)
    .select(`id,label,${monthField},saved_at,saved_by`)
    .order('saved_at', { ascending: false })
    .order('id', { ascending: false }));
  if (error) throw error;
  return data || [];
}
async function getSlipRow(table, id) {
  const { data, error } = await sb.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}
async function deleteSlipRow(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
}
function renderSlipSlotList(el, rows, monthField, loadFn, delFn) {
  if (!rows.length) { el.innerHTML = '<div style="text-align:center;color:var(--text2);font-size:12px;padding:20px">保存済みデータがありません</div>'; return; }
  el.innerHTML = rows.map(s => {
    const dt = new Date(s.saved_at).toLocaleString('ja-JP', { hour12: false });
    return `<div class="slip-slot">
      <div class="slip-slot-info">
        <div class="slip-slot-label">${escHtml(s.label)}</div>
        <div class="slip-slot-meta">${s[monthField] ? s[monthField] + ' ／ ' : ''}${dt}  保存者: ${escHtml(s.saved_by||'—')}</div>
      </div>
      <button class="btn" style="font-size:11px;white-space:nowrap" onclick="${loadFn}(${s.id})">📂 読み込み</button>
      <button class="ibtn" style="color:#e05b5b" onclick="${delFn}(${s.id}, this)" title="削除">🗑</button>
    </div>`;
  }).join('');
}

async function doSaveSlip() {
  const label = document.getElementById('slipSaveLabel').value.trim();
  if (!label) { alert('保存名を入力してください'); return; }
  if (!payRows || payRows.length === 0) { alert('保存するデータがありません'); return; }
  const mo = paySelectedMonth || '';
  showLoad(true);
  try {
    await saveSlipRow('payment_slips', 'pay_month', label, mo, payRows);
    closeM('mSlipSave');
    await addLog('支払明細書保存', label + ' ' + payRows.length + '件');
    showT('保存しました: ' + label);
  } catch(e) {
    // テーブル未作成の場合はガイドを表示
    if (e.message && e.message.includes('does not exist')) {
      showT('payment_slipsテーブルが未作成です。下記SQLをSupabaseで実行してください。', 'ter');
      showSlipTableSql();
    } else {
      showT('保存エラー: ' + e.message, 'ter');
    }
  }
  showLoad(false);
}

async function openSlipLoad() {
  document.getElementById('mSlipLoad').classList.add('on');
  const list = document.getElementById('slipSlotList');
  list.innerHTML = '<div style="text-align:center;color:var(--text2);font-size:12px;padding:20px">読み込み中...</div>';
  try {
    const rows = await listSlipRows('payment_slips', 'pay_month');
    renderSlipSlotList(list, rows, 'pay_month', 'loadSlip', 'deleteSlip');
  } catch(e) {
    if (e.message && e.message.includes('does not exist')) {
      list.innerHTML = '<div style="color:#e05b5b;font-size:11px;padding:10px">payment_slipsテーブルが未作成です。</div>';
      showSlipTableSql();
    } else {
      list.innerHTML = `<div style="color:#e05b5b;font-size:11px;padding:10px">読み込みエラー: ${e.message}</div>`;
    }
  }
}

async function loadSlip(id) {
  showLoad(true);
  try {
    const data = await getSlipRow('payment_slips', id);
    payRows = data.rows || [];
    paySourceMode = 'xlsx';
    // 対象期間をセット
    if (data.pay_month) {
      const range = monthToRange(data.pay_month);
      const fromEl = document.getElementById('payFrom');
      const toEl = document.getElementById('payTo');
      if (fromEl && toEl) { fromEl.value = range.from; toEl.value = range.to; }
      paySelectedMonth = data.pay_month;
    }
    closeM('mSlipLoad');
    const dropArea = document.getElementById('slipDropArea');
    if (dropArea) dropArea.style.display = 'none';
    setSlipStatus(`✓ 「${data.label}」を読み込みました（${payRows.length}件）`, 'ok');
    renderPayTable();
    await addLog('支払明細書読み込み', data.label);
  } catch(e) {
    showT('読み込みエラー: ' + e.message, 'ter');
  }
  showLoad(false);
}

async function deleteSlip(id, btn) {
  if (!confirm('この保存データを削除しますか？')) return;
  try {
    await deleteSlipRow('payment_slips', id);
    btn.closest('.slip-slot').remove();
    showT('削除しました');
    await addLog('支払明細書削除', 'id:' + id);
  } catch(e) {
    showT('削除エラー: ' + e.message, 'ter');
  }
}

/* ===== 請求明細書 保存・読み込み（Supabase: invoice_slips） ===== */

function openInvoiceSlipSave() {
  if (!_aggDetailSelected.size) { alert('保存する明細を選択してください（レ点でチェック）'); return; }
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  const month = rows[0]?.date?.slice(0,7) || '';
  const defaultLabel = [_aggDetailGroupLabel, month && (month.replace('-','年')+'月分')].filter(Boolean).join(' ');
  document.getElementById('invSlipSaveLabel').value = defaultLabel;
  document.getElementById('invSlipSaveCount').textContent = `${rows.length}件のデータを保存します`;
  document.getElementById('mInvSlipSave').classList.add('on');
}

async function doSaveInvoiceSlip() {
  const label = document.getElementById('invSlipSaveLabel').value.trim();
  if (!label) { alert('保存名を入力してください'); return; }
  if (!_aggDetailSelected.size) { alert('保存する明細を選択してください'); return; }
  const rows = _aggDetailRows.filter(r=>_aggDetailSelected.has(r.id));
  const month = rows[0]?.date?.slice(0,7) || '';
  showLoad(true);
  try {
    await saveSlipRow('invoice_slips', 'invoice_month', label, month, rows);
    closeM('mInvSlipSave');
    await addLog('請求明細書保存', label + ' ' + rows.length + '件');
    showT('保存しました: ' + label);
  } catch(e) {
    showT('保存エラー: ' + e.message, 'ter');
  }
  showLoad(false);
}

async function openInvoiceSlipLoad() {
  document.getElementById('mInvSlipLoad').classList.add('on');
  const list = document.getElementById('invSlipSlotList');
  list.innerHTML = '<div style="text-align:center;color:var(--text2);font-size:12px;padding:20px">読み込み中...</div>';
  try {
    const rows = await listSlipRows('invoice_slips', 'invoice_month');
    renderSlipSlotList(list, rows, 'invoice_month', 'loadInvoiceSlip', 'deleteInvoiceSlip');
  } catch(e) {
    list.innerHTML = `<div style="color:#e05b5b;font-size:11px;padding:10px">読み込みエラー: ${e.message}</div>`;
  }
}

async function loadInvoiceSlip(id) {
  showLoad(true);
  try {
    const data = await getSlipRow('invoice_slips', id);
    _aggDetailSide = 'billing';
    _aggDetailRows = data.rows || [];
    _aggDetailSelected = new Set(_aggDetailRows.map(r=>r.id));
    _aggDetailGroupLabel = data.label;
    document.getElementById('aggDetailTitle').textContent = `📋 明細　${data.label}（保存データ）`;
    closeM('mInvSlipLoad');
    renderAggDetailFull();
    showT(`「${data.label}」を読み込みました（${_aggDetailRows.length}件）`);
    await addLog('請求明細書読み込み', data.label);
  } catch(e) {
    showT('読み込みエラー: ' + e.message, 'ter');
  }
  showLoad(false);
}

async function deleteInvoiceSlip(id, btn) {
  if (!confirm('この保存データを削除しますか？')) return;
  try {
    await deleteSlipRow('invoice_slips', id);
    btn.closest('.slip-slot').remove();
    showT('削除しました');
    await addLog('請求明細書削除', 'id:' + id);
  } catch(e) {
    showT('削除エラー: ' + e.message, 'ter');
  }
}

function showSlipTableSql() { openSetupSqlGuide('payment_slips'); }

const CSV_COLS_PAYMENT = ['ドライバーID','業務手数料率','備考','事務手数料','車両レンタル','請求明細書番号','支払実行日','№','月日','車番・名前','作業明細','高速代他','距離/時間','数量','単価'];
function downloadPayCsv() {
  if (!payRows || payRows.length === 0) { alert('ダウンロードするデータがありません'); return; }
  openCsvColsM('payment');
}
function doDownloadPayCsv(idxs) {
  const payDate = document.getElementById('payDateInput')?.value || '';
  const pick = (arr) => idxs.map(i => arr[i]);
  const lines = [pick(CSV_COLS_PAYMENT).join(',')];

  // 日付を YYYY.M.D 形式（ドット・ゼロ埋めなし）に変換
  function fmtDate(s, baseYear) {
    if (!s) return '';
    // YYYYMMDD
    const m8 = String(s).match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m8) return `${m8[1]}.${parseInt(m8[2])}.${parseInt(m8[3])}`;
    // YYYY-MM-DD or YYYY/MM/DD
    const md = String(s).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (md) return `${md[1]}.${parseInt(md[2])}.${parseInt(md[3])}`;
    // MM/DD → baseYear.M.D
    const mmd = String(s).match(/^(\d{1,2})[/](\d{1,2})$/);
    if (mmd && baseYear) return `${baseYear}.${parseInt(mmd[1])}.${parseInt(mmd[2])}`;
    return s;
  }

  // 値をCSVセル化（数値・数値文字列はクォートなし、その他の文字列もクォートなし）
  function cell(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const s = csvSafe(String(v).trim());
    // ダブルクォートを含む場合のみエスケープしてクォート
    if (s.includes('"') || s.includes(',') || s.includes('\r') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  // 請求書ブロックごとにNoの続き番号を管理
  let lastInvoice = null;
  let runningNo = 0;
  payRows.forEach((r, i) => {
    const pd = fmtDate(r.payment_date || payDate);
    const isFirst = lastInvoice !== r.invoice_no;
    if (isFirst) { lastInvoice = r.invoice_no; runningNo = 0; }
    runningNo++;

    // 月日の年を支払実行日から取得（YYYYMMDD → YYYY）
    const baseYear = (r.payment_date || payDate || '').toString().match(/^(\d{4})/)?.[1] || '';

    lines.push(pick([
      cell(isFirst ? r.supplier_id : ''),
      cell(isFirst ? r.fee_rate : ''),
      cell(isFirst ? (r.note_col||'') : ''),
      cell(isFirst ? r.admin_fee : ''),
      cell(isFirst ? r.vehicle_rental : ''),
      cell(isFirst ? r.invoice_no : ''),
      cell(pd),
      cell(runningNo),
      cell(fmtDate(r.date, baseYear)),
      cell(r.car_info || ''),
      cell(r.detail),
      cell(r.highway || ''),
      cell(r.distance || ''),
      cell(r.qty),
      cell(r.direct_amount != null ? r.direct_amount : r.price)
    ]).join(','));

    const isLast = i === payRows.length-1 || payRows[i+1].invoice_no !== r.invoice_no;
    if (isLast && r.extra_deductions && r.extra_deductions.length > 0) {
      r.extra_deductions.forEach(ed => {
        runningNo++;
        lines.push(pick([
          '','','','','','',
          cell(pd),
          cell(runningNo),
          cell(fmtDate(r.date, baseYear)),
          cell(r.car_info || ''),
          cell(ed.label),
          cell(ed.amount),
          '','',''
        ]).join(','));
      });
    }
  });

  const bom = new Uint8Array([0xEF,0xBB,0xBF]);
  const blob = new Blob([bom, lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const suffix = payRows[0]?.payment_date || paySelectedMonth;
  a.download = `支払明細_${suffix}.csv`;
  a.click();
}
