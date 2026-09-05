/* js/05-driver-portal.js
   ドライバーポータル、提出書類、LINE/メール通知、チャット、支払明細の配信、掲示板、年報、PDF帳票

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   v9: ドライバーポータル・年報・掲示板・バックアップ・PDF帳票
   ============================================================ */

/* ===== ドライバーポータル ===== */
function applyDriverPortal() {
  // メイン画面を非表示、ポータルを表示
  const main = document.getElementById('pgMain');
  if (main) { main.classList.add('hide'); main.style.display = 'none'; }
  const portal = document.getElementById('pgDriver');
  if (portal) { portal.classList.remove('hide'); portal.style.display = 'flex'; }
  document.body.classList.add('drv-lock'); // iOSでトップバー/タブが固定されるようbodyごとロックする

  // 名前・バッジセット
  document.getElementById('drvPortalName').textContent = me.name || '';
  document.getElementById('drvPortalBdg').textContent = 'ドライバー';

  // 初期ページ
  const now = new Date();
  const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const drvMrEl = document.getElementById('drvMrMonth');
  if (drvMrEl) drvMrEl.value = thisM;
  const drvDmEl = document.getElementById('drvDailyMonth');
  if (drvDmEl) drvDmEl.value = thisM;

  // 協力会社経由で支払うなど、ポータルで支払明細書を見せないドライバーは「支払明細書」タブごと非表示にする
  const hideStatement = !!me?.driver_data?.hide_statement;
  const stmtTabEl = document.getElementById('dnt2');
  if (stmtTabEl) stmtTabEl.style.display = hideStatement ? 'none' : '';

  const savedDpage = getSavedHistoryPage('dpage');
  const savedDtab = savedDpage !== null ? document.querySelector(`.ntab[onclick="goDrvPage(${savedDpage},this)"]`) : null;
  // 支払明細書を隠す設定のドライバーが該当タブ(dnt2)に復元されないよう、非表示タブは既定ページに倒す
  if (savedDpage !== null && document.getElementById('dpg'+savedDpage) && savedDtab && savedDtab.style.display !== 'none') {
    _skipHistoryPush = true;
    try { goDrvPage(savedDpage, savedDtab); }
    finally { _skipHistoryPush = false; }
  } else {
    goDrvPage(3, document.getElementById('dnt3'));
  }

  // 自分の提出書類の期限切れ・期限間近をログイン時に知らせる
  setTimeout(()=>{ checkDriverOwnDocAlerts().catch(()=>{}); }, 1500);
  // 管理者からの未読チャットがあればナビに赤丸を出す
  setTimeout(()=>{ checkDriverOwnChatAlerts().catch(()=>{}); }, 1500);
  // 参加しているグループチャットに未読があればナビに赤丸を出す
  setTimeout(()=>{ checkDriverOwnGroupChatAlerts().catch(()=>{}); }, 1500);

  // 未読の明細書があればログイン時に知らせる（タブ自体を非表示にしているドライバーには出さない）
  if (me?.driver_id && sb && !hideStatement) {
    sb.from('driver_statements').select('id').eq('drv_id', me.driver_id).is('read_at', null)
      .then(({data}) => { if (data?.length) showT(`📬 未読の支払明細書が${data.length}件あります（支払明細書タブで確認）`, 'twa'); })
      .catch?.(()=>{});
  }
  // 掲示板は既定タブとしてログイン直後に表示されるため（goDrvPage(3,...)がloadBoardとmarkBoardSeenを行う）、
  // ここで別途トースト通知は出さない
}

function goDrvPage(n, el) {
  for (let i=0; i<7; i++) {
    const p = document.getElementById('dpg'+i);
    if (p) p.style.display = i===n ? ((i===5||i===6)?'flex':'block') : 'none';
    const t = document.getElementById('dnt'+i);
    // チャット(5)・グループチャット(6)はお知らせと同じ「連絡」タブ(dnt3)配下のサブページ扱い
    if (t) t.classList.toggle('on', i===n || ((n===5||n===6) && i===3));
  }
  if (n===0) loadDriverDailyList();
  if (n===1) renderDriverMonthly();
  if (n===2) { loadDriverStatements(); }
  if (n===3) { loadBoard(true); renderBoardTo('drvBoardList'); }
  if (n===4) renderDriverPortalDocs();
  if (n===5) loadDrvPortalChat();
  if (n===6) loadMyChatGroups();
  // スマホの「戻る」でドライバーポータルの前のタブに戻れるよう、タブ切替のたびに履歴を積む（popstateからの復元時は積み直さない）
  if (!_skipHistoryPush) {
    try { history.pushState({dpage:n}, '', location.href); } catch(e) {}
  }
}

/* ===== ドライバー提出書類（免許証・車検証・自賠責・任意保険） ===== */
// hasStart: 保険開始日欄を表示 / hasNumber・numberRequired: 番号欄を表示・必須化 / hasAttendDate: 受講日欄を表示 / noExpiry: 期限欄を表示せず提出済み/未提出のみで判定
const DRIVER_DOC_TYPES = [
  { key:'license',    label:'運転免許証',       expLabel:'有効期限' },
  { key:'shaken',     label:'車検証',           expLabel:'車検満了日' },
  { key:'jibai',      label:'自賠責保険',       expLabel:'保険期間満了日', hasStart:true, startLabel:'保険開始日' },
  { key:'nini',       label:'任意保険',         expLabel:'保険期間満了日', hasStart:true, startLabel:'保険開始日' },
  { key:'anzenkanri', label:'安全管理者証明書', expLabel:'有効期限（任意）', hasNumber:true, numberLabel:'安全運転管理者番号', numberRequired:true, hasAttendDate:true, attendLabel:'受講日' },
  { key:'invoice',    label:'インボイス登録',   expLabel:'登録日（任意）', hasNumber:true, numberLabel:'インボイス登録番号', numberRequired:true, noExpiry:true },
];
const DOC_WARN_DAYS = 30; // 期限の何日前から「期限間近」扱いにするか
let driverDocs = []; // driver_documents全件キャッシュ

async function loadDriverDocs() {
  if (!sb) return;
  try {
    const {data, error} = await sb.from('driver_documents').select('*');
    if (error) throw error;
    driverDocs = data || [];
  } catch(e) { console.warn('loadDriverDocs:', e.message); }
}

function findDriverDoc(drvId, docType) {
  return driverDocs.find(d => d.drv_id === drvId && d.doc_type === docType);
}

// 書類の状態判定: none(未提出) / noexp(期限未登録) / expired / soon / ok
function docStatusOf(doc) {
  if (!doc) return { cls:'none', label:'未提出', bg:'var(--gray-bg)', fg:'var(--gray-text)' };
  if (!doc.expiry_date) return { cls:'noexp', label:'期限未登録', bg:'var(--blue-bg)', fg:'var(--blue-text)' };
  const today = fmtLocalDate(new Date());
  const warn = new Date(); warn.setDate(warn.getDate()+DOC_WARN_DAYS);
  if (doc.expiry_date < today) return { cls:'expired', label:'期限切れ', bg:'var(--red-bg)', fg:'var(--red-text)' };
  if (doc.expiry_date <= fmtLocalDate(warn)) return { cls:'soon', label:'期限間近', bg:'var(--amber-bg)', fg:'var(--amber-text)' };
  return { cls:'ok', label:'有効', bg:'var(--green-bg)', fg:'var(--green-text)' };
}

function docStatusPill(doc) {
  const st = docStatusOf(doc);
  return `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:${st.bg};color:${st.fg};white-space:nowrap">${st.label}</span>`;
}

// 提出書類のアップロード上限（圧縮後）。これを超える場合はエラーとして拒否する
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
function fmtBytes(n) { return n >= 1024*1024 ? (n/1024/1024).toFixed(1)+'MB' : Math.round(n/1024)+'KB'; }

// 画像ファイル1枚を縮小してcanvas化
function imageFileToCanvas(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// PDFの各ページ（最大3ページ）をcanvas化する
async function pdfFileToCanvases(file, maxSize, maxPages) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const canvases = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxSize / Math.max(baseVp.width, baseVp.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    canvases.push(canvas);
  }
  return canvases;
}
// 複数枚のcanvasを縦に並べて1枚のJPEGにまとめる（裏表など複数ページを1ファイルに統合するため）
function stackCanvasesToJpegBlob(canvases) {
  const totalW = Math.max(...canvases.map(c => c.width));
  const totalH = canvases.reduce((s, c) => s + c.height, 0);
  const combined = document.createElement('canvas');
  combined.width = totalW; combined.height = totalH;
  const ctx = combined.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, totalW, totalH);
  let y = 0;
  canvases.forEach(c => { ctx.drawImage(c, 0, y); y += c.height; });
  return new Promise((resolve, reject) => {
    combined.toBlob(b => b ? resolve(b) : reject(new Error('画像変換に失敗しました')), 'image/jpeg', 0.85);
  });
}
// 画像・PDF・複数ファイル（裏表など）いずれも軽量化した1枚のJPEG Blobにまとめて返す。
// PDFはページを画像化し、複数ファイル選択時はすべてのページ・画像を縦に結合する。
// 圧縮してもUPLOAD_MAX_BYTESを超える場合はエラーにする
async function resizeImageToBlob(fileOrFiles, maxSize) {
  const files = (fileOrFiles instanceof FileList || Array.isArray(fileOrFiles)) ? Array.from(fileOrFiles) : [fileOrFiles];
  const maxTotalPages = 6; // 複数ファイル×PDF複数ページの合計枚数の上限（暴走・巨大化防止）
  let canvases = [];
  for (const file of files) {
    if (file.type === 'application/pdf') {
      canvases.push(...(await pdfFileToCanvases(file, maxSize, 3)));
    } else {
      canvases.push(await imageFileToCanvas(file, maxSize));
    }
    if (canvases.length >= maxTotalPages) { canvases = canvases.slice(0, maxTotalPages); break; }
  }
  const blob = await stackCanvasesToJpegBlob(canvases);
  if (blob.size > UPLOAD_MAX_BYTES) {
    throw new Error(`圧縮後も${fmtBytes(blob.size)}あり、上限の10MBを超えています。ファイル数やページ数を減らすか、解像度の低いファイルで再度お試しください`);
  }
  return blob;
}

// 1書類分の登録・更新（ファイルは任意。期限だけの更新も可能）
// ドライバーが車検証・自賠責・任意保険を提出/更新したら、そのドライバーが現在使用している車両(vehicles)の
// 対応する期限へ自動反映する。誰が乗っても本来同じ値になる車両側の情報なので、ドライバー申請を正として扱う。
// 対象の車が車両管理に未登録なら、フル表記の車番で新規に自動登録する
async function syncVehicleExpiryFromDriverDoc(drvId, docType, expiry) {
  const fieldMap = { shaken: 'shaken_expiry', jibai: 'jibai_expiry', nini: 'nini_expiry' };
  const field = fieldMap[docType];
  if (!field) return; // license/anzenkanriは車両に紐づく情報ではないため対象外
  const d = drvs.find(x => x.id === drvId);
  const cars = (d?.cars || []).filter(c => c && !c.includes('----'));
  if (!cars.length) return;
  try {
    const vehicle = vehicles.find(v => cars.some(c => nm(v.car) === nm(c)));
    if (vehicle) {
      if (vehicle[field] === expiry) return;
      const {error} = await sb.from('vehicles').update({[field]: expiry}).eq('id', vehicle.id);
      if (error) throw error;
      vehicle[field] = expiry;
    } else {
      const full = cars.filter(isFullPlateNumber);
      const car = full[0] || cars[0];
      // ドライバーが書類を提出したというだけでは、自社所有・持ち込み・リースのどれかは判断できない
      // （リース車・自社の代車でも、乗っているドライバーが書類を提出することがあるため）。
      // 誤った種別で確定登録してしまわないよう、未分類のまま登録し、事務所側での分類を促す
      const {data, error} = await sb.from('vehicles').insert({ car, vehicle_type: 'unclassified', [field]: expiry }).select().single();
      if (error) throw error;
      vehicles.push(data);
    }
    if (!document.getElementById('pg26')?.classList.contains('hide')) renderVehicles();
  } catch(e) { console.warn('syncVehicleExpiryFromDriverDoc:', e.message); }
}
async function saveDriverDoc(drvId, docType) {
  const t = DRIVER_DOC_TYPES.find(x => x.key === docType);
  const fileEl = document.getElementById(`dd_file_${drvId}_${docType}`);
  const expEl = document.getElementById(`dd_exp_${drvId}_${docType}`);
  const numEl = document.getElementById(`dd_num_${drvId}_${docType}`);
  const startEl = document.getElementById(`dd_start_${drvId}_${docType}`);
  const attendEl = document.getElementById(`dd_attend_${drvId}_${docType}`);
  const files = fileEl?.files;
  const expiry = expEl?.value || null;
  const docNumber = numEl?.value.trim() || null;
  const startDate = startEl?.value || null;
  const attendDate = attendEl?.value || null;
  const existing = findDriverDoc(drvId, docType);
  if (!files?.length && !existing) { showT('写真ファイルを選択してください', 'twa'); return; }
  // インボイス登録番号・安全運転管理者番号など、番号必須の書類は未入力のまま保存できないようにする
  if (t?.numberRequired && !docNumber) { showT(`${t.numberLabel}を入力してください`, 'twa'); return; }
  showLoad(true);
  try {
    let filePath = existing?.file_path || '';
    let sizeMsg = '';
    let sizeFields = {};
    if (files?.length) {
      const origSize = Array.from(files).reduce((s,f)=>s+f.size, 0);
      const blob = await resizeImageToBlob(files, 1600);
      filePath = `drv${drvId}/${docType}_${Date.now()}.jpg`;
      const {error: upErr} = await sb.storage.from('driver-docs').upload(filePath, blob, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      // 旧ファイルは差し替え成功後に削除（失敗しても本体処理は続行）
      if (existing?.file_path && existing.file_path !== filePath) {
        sb.storage.from('driver-docs').remove([existing.file_path]).catch?.(()=>{});
      }
      sizeMsg = `（${fmtBytes(origSize)} → ${fmtBytes(blob.size)}）`;
      sizeFields = { orig_size_bytes: origSize, compressed_size_bytes: blob.size };
    }
    const row = { drv_id: drvId, doc_type: docType, file_path: filePath, expiry_date: expiry, doc_number: docNumber, start_date: startDate, attend_date: attendDate, uploaded_by: me?.name || '' , updated_at: new Date().toISOString(), ...sizeFields };
    const {data, error} = await sb.from('driver_documents').upsert(row, { onConflict: 'drv_id,doc_type' }).select().single();
    if (error) throw error;
    driverDocs = driverDocs.filter(d => !(d.drv_id===drvId && d.doc_type===docType));
    driverDocs.push(data);
    if (fileEl) fileEl.value = '';
    addLog('書類登録', `drv:${drvId} ${docType}${expiry?` 期限:${expiry}`:''}${sizeMsg}`);
    await syncVehicleExpiryFromDriverDoc(drvId, docType, expiry);
    showT('書類を保存しました'+sizeMsg);
    refreshDocViews(drvId);
  } catch(e) { showT('保存エラー: ' + e.message, 'ter'); }
  showLoad(false);
}

// 書類写真を署名付きURLで開く（バケットは非公開のため直接URLでは見られない）
async function viewDriverDoc(drvId, docType) {
  const doc = findDriverDoc(drvId, docType);
  if (!doc?.file_path) { showT('ファイルがありません', 'twa'); return; }
  // signedUrl取得(await)の後にwindow.open()すると、ブラウザがユーザー操作から切り離されたと
  // 判断してポップアップブロックする（特にSafari）ため、クリック時に空タブを先に開いておき、
  // 取得後にそのタブへ遷移させる
  const win = window.open('', '_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'twa'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  try {
    const {data, error} = await sb.storage.from('driver-docs').createSignedUrl(doc.file_path, 3600);
    if (error) throw error;
    win.location.href = data.signedUrl;
  } catch(e) { win.close(); showT('表示エラー: ' + e.message, 'ter'); }
}

async function deleteDriverDoc(drvId, docType) {
  const doc = findDriverDoc(drvId, docType);
  if (!doc) return;
  if (!confirm('この書類を削除しますか？')) return;
  showLoad(true);
  try {
    const {error} = await sb.from('driver_documents').delete().eq('id', doc.id);
    if (error) throw error;
    if (doc.file_path) await sb.storage.from('driver-docs').remove([doc.file_path]);
    driverDocs = driverDocs.filter(d => d.id !== doc.id);
    addLog('書類削除', `drv:${drvId} ${docType}`);
    showT('削除しました');
    refreshDocViews(drvId);
  } catch(e) { showT('削除エラー: ' + e.message, 'ter'); }
  showLoad(false);
}

// 保存・削除後に開いている書類ビューを再描画する
function refreshDocViews(drvId) {
  if (document.getElementById('mDrvDocs')?.classList.contains('on')) renderDrvDocsMBody(drvId);
  if (document.getElementById('dpg4')?.style.display !== 'none' && me?.driver_id) renderDriverPortalDocs();
  if (document.getElementById('mDocStatus')?.classList.contains('on')) renderDocStatusBody();
}

// 書類1件分の編集行（ポータル・管理モーダル共通）
function docRowHtml(drvId, t, canDelete) {
  const doc = findDriverDoc(drvId, t.key);
  const statusPill = t.noExpiry
    ? (doc ? `<span class="bdg" style="background:var(--green-bg);color:var(--green-text)">提出済み</span>` : `<span class="bdg" style="background:var(--gray-bg);color:var(--gray-text)">未提出</span>`)
    : docStatusPill(doc);
  return `<div style="border:0.5px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-weight:600;font-size:13px">${t.label}</span>
      ${statusPill}
      ${t.hasStart && doc?.start_date ? `<span style="font-size:11px;color:var(--text2)">${t.startLabel}: ${doc.start_date}</span>` : ''}
      ${!t.noExpiry && doc?.expiry_date ? `<span style="font-size:11px;color:var(--text2)">${t.expLabel}: ${doc.expiry_date}</span>` : ''}
      ${t.hasAttendDate && doc?.attend_date ? `<span style="font-size:11px;color:var(--text2)">${t.attendLabel}: ${doc.attend_date}</span>` : ''}
      ${t.hasNumber && doc?.doc_number ? `<span style="font-size:11px;color:var(--text2)">${t.numberLabel}: ${escHtml(doc.doc_number)}</span>` : ''}
      ${doc ? `<span style="font-size:10px;color:var(--text3)">更新: ${(doc.updated_at||'').slice(0,10)}${doc.uploaded_by?` (${doc.uploaded_by})`:''}</span>` : ''}
      ${doc?.compressed_size_bytes ? `<span style="font-size:10px;color:var(--text3)" title="アップロード時に自動で軽量化されたファイルサイズ">📎 ${fmtBytes(doc.orig_size_bytes||doc.compressed_size_bytes)} → ${fmtBytes(doc.compressed_size_bytes)}</span>` : ''}
      <div style="flex:1"></div>
      ${doc?.file_path ? `<button class="btn sml" onclick="viewDriverDoc(${drvId},'${t.key}')">🔍 表示</button>` : ''}
      ${doc && canDelete ? `<button class="ibtn" style="color:#e05b5b" onclick="deleteDriverDoc(${drvId},'${t.key}')">🗑</button>` : ''}
    </div>
    <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap">
      <div class="fld" style="margin-bottom:0;flex:1;min-width:180px"><label>写真（カメラ撮影可・PDF可・裏表など複数枚可）</label>
        <input type="file" id="dd_file_${drvId}_${t.key}" accept="image/*,application/pdf" multiple style="width:100%;font-size:12px">
      </div>
      ${t.hasNumber ? `<div class="fld" style="margin-bottom:0"><label>${t.numberLabel}${t.numberRequired?' ※必須':'（任意）'}</label>
        <input type="text" id="dd_num_${drvId}_${t.key}" value="${escHtml(doc?.doc_number||'')}" style="width:160px">
      </div>` : ''}
      ${t.hasStart ? `<div class="fld" style="margin-bottom:0"><label>${t.startLabel}</label>
        <input type="date" id="dd_start_${drvId}_${t.key}" value="${doc?.start_date||''}">
      </div>` : ''}
      ${!t.noExpiry ? `<div class="fld" style="margin-bottom:0"><label>${t.expLabel}</label>
        <input type="date" id="dd_exp_${drvId}_${t.key}" value="${doc?.expiry_date||''}">
      </div>` : ''}
      ${t.hasAttendDate ? `<div class="fld" style="margin-bottom:0"><label>${t.attendLabel}</label>
        <input type="date" id="dd_attend_${drvId}_${t.key}" value="${doc?.attend_date||''}">
      </div>` : ''}
      <button class="btn pri sml" onclick="saveDriverDoc(${drvId},'${t.key}')">💾 保存</button>
    </div>
  </div>`;
}

// ドライバーポータル「書類」タブ
async function renderDriverPortalDocs() {
  const listEl = document.getElementById('drvDocsList');
  const bannerEl = document.getElementById('drvDocsBanner');
  if (!listEl) return;
  const drvId = me?.driver_id;
  if (!drvId) { listEl.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center;font-size:12px">ドライバー情報が見つかりません</div>'; return; }
  await loadDriverDocs();
  const warns = DRIVER_DOC_TYPES.map(t => ({t, doc:findDriverDoc(drvId, t.key), st:docStatusOf(findDriverDoc(drvId, t.key))}))
    .filter(x => x.st.cls==='expired' || x.st.cls==='soon' || x.st.cls==='none');
  if (bannerEl) {
    bannerEl.innerHTML = warns.length
      ? `<div class="alert-bar" style="margin-top:8px">⚠ 確認が必要な書類: ${warns.map(x=>`${x.t.label}（${x.st.label}）`).join('、')}</div>`
      : '';
  }
  listEl.innerHTML = DRIVER_DOC_TYPES.map(t => docRowHtml(drvId, t, false)).join('');
}

// 管理側: ドライバーごとの書類モーダル
async function openDrvDocsM(drvId) {
  const d = drvs.find(x => x.id === drvId);
  if (!d) return;
  document.getElementById('mDrvDocsH').innerHTML = `📄 ${escHtml(d.name)} の提出書類 <button class="ibtn" onclick="closeM('mDrvDocs')">✕</button>`;
  document.getElementById('mDrvDocs').classList.add('on');
  document.getElementById('drvDocsMBody').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">読み込み中...</div>';
  await loadDriverDocs();
  renderDrvDocsMBody(drvId);
}
function renderDrvDocsMBody(drvId) {
  const el = document.getElementById('drvDocsMBody');
  if (!el) return;
  const canDel = me && (me.role === 'admin' || me.role === 'editor');
  el.innerHTML = DRIVER_DOC_TYPES.map(t => docRowHtml(drvId, t, canDel)).join('');
}

/* ===== ドライバーへのLINE/メール通知 ===== */
// ベストエフォート送信: Edge Function側でLINE連携済みならLINE、未連携ならメール、どちらも無ければスキップ。
// APIキー未設定でもアプリ動作には影響させない（エラーはconsoleのみ）
async function notifyDrivers(drvIds, kind, ref, title, body, dedupe=false){
  if (!sb || !drvIds?.length) return;
  try {
    const { data, error } = await sb.functions.invoke('send-driver-notify', { body: { drv_ids: drvIds, kind, ref, title, body, dedupe } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  } catch(e) { console.warn('notifyDrivers:', e.message); }
}
// LINE連携コード生成（ドライバーがLINE公式アカウントにこのコードを送ると紐付く）
function genDriverLinkCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(I/O/0/1)を除外
  let s = '';
  const rnd = new Uint8Array(6); crypto.getRandomValues(rnd);
  rnd.forEach(v => s += chars[v % chars.length]);
  return 'PG-' + s;
}
// 既存ドライバーへの連携コード一括発行（管理者ログイン時に不足分だけ埋める）
async function ensureLineLinkCodes(){
  if (!sb) return;
  const missing = drvs.filter(d => !d.line_link_code);
  for (const d of missing) {
    try {
      const code = genDriverLinkCode();
      const { error } = await sb.from('drivers').update({ line_link_code: code }).eq('id', d.id);
      if (!error) d.line_link_code = code;
    } catch(e) { console.warn('ensureLineLinkCodes:', e.message); break; }
  }
}
// ドライバーポータルの掲示板タブ上部に、LINE通知の連携案内（未連携時）または連携済み表示を出す
function renderDrvLineBanner(){
  const el = document.getElementById('drvLineBanner');
  if (!el || !me?.driver_data) return;
  const d = me.driver_data;
  const addUrl = companySettings?.line_add_url || '';
  if (d.line_user_id) { el.innerHTML = ''; return; } // 連携済みなら何も出さない
  if (!addUrl || !d.line_link_code) { el.innerHTML = ''; return; } // 会社側が未設定なら案内しない
  el.innerHTML = `<div style="padding:10px 12px;background:var(--green-bg,#e8f5e9);border:0.5px solid var(--green,#43a047);border-radius:var(--radius);font-size:12px;line-height:1.7">
    <b>🔔 お知らせをLINEで受け取れます</b><br>
    ① <a href="${escHtml(addUrl)}" target="_blank" rel="noopener" style="color:var(--blue)">会社のLINE公式アカウントを友だち追加</a><br>
    ② 追加したLINEにあなたの連携コード <b style="font-size:14px;letter-spacing:1px">${escHtml(d.line_link_code)}</b> をそのまま送信
  </div>`;
}

/* ===== チャットのリアルタイム反映（LINEのように、更新せず双方に即時反映） =====
   Supabase Realtime（driver_messagesテーブルの変更をpostgres_changesで購読）を使う。
   1スレッド分だけ購読するシンプルな作りなので、管理側は開いているモーダルのドライバーが
   切り替わるたびに、ドライバー側はポータルにログインしている間ずっと購読し続ける */
let drvChatRealtimeChannel = null;
function subscribeDrvChatRealtime(drvId, onInsert) {
  unsubscribeDrvChatRealtime();
  if (!sb?.channel) return;
  drvChatRealtimeChannel = sb.channel(`driver_messages_${drvId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_messages', filter: `drv_id=eq.${drvId}` },
      (payload) => onInsert(payload.new))
    .subscribe();
}
function unsubscribeDrvChatRealtime() {
  if (drvChatRealtimeChannel) { sb?.removeChannel(drvChatRealtimeChannel); drvChatRealtimeChannel = null; }
}

// チャット専用タブ用: 開いている間は全ドライバー分のdriver_messages挿入を購読し、
// 選択中スレッドだけでなく一覧の未読バッジ・プレビュー・並び順もリアルタイムに更新する
let chatTabRealtimeChannel = null;
function subscribeChatTabRealtime() {
  unsubscribeChatTabRealtime();
  if (!sb?.channel) return;
  chatTabRealtimeChannel = sb.channel('chat_tab_all_messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_messages' },
      (payload) => onChatTabRealtimeInsert(payload.new))
    .subscribe();
}
function unsubscribeChatTabRealtime() {
  if (chatTabRealtimeChannel) { sb?.removeChannel(chatTabRealtimeChannel); chatTabRealtimeChannel = null; }
}
async function onChatTabRealtimeInsert(msg) {
  chatTabLastMsgByDrv[msg.drv_id] = msg;
  if (msg.drv_id === chatTabDrvId) {
    if (!chatTabMessages.some(m => m.id === msg.id)) {
      chatTabMessages.push(msg);
      renderChatTabMessages();
    }
    if (msg.sender_role === 'driver') {
      await markDrvChatRead(chatTabDrvId, 'driver');
      driverChatUnreadIds.delete(chatTabDrvId);
      delete driverChatUnreadCounts[chatTabDrvId];
    }
  } else if (msg.sender_role === 'driver') {
    driverChatUnreadIds.add(msg.drv_id);
    driverChatUnreadCounts[msg.drv_id] = (driverChatUnreadCounts[msg.drv_id]||0) + 1;
  }
  renderChatTabDrvList();
  if (!document.getElementById('pg2')?.classList.contains('hide')) renderDrv();
}

/* ===== ドライバーとのチャット（管理側） ===== */
let eChatDrvId = null; // 現在チャットモーダルで開いているドライバーID
let drvChatMessages = []; // 開いているスレッドのメッセージキャッシュ
let driverChatUnreadIds = new Set(); // ドライバー発言の未読メッセージがあるドライバーID一覧（ドライバー管理一覧のバッジ用）
let driverChatUnreadCounts = {}; // drvId -> 未読メッセージ件数（LINEのような件数バッジ表示用）

// ドライバー管理タブを開いたときに、各ドライバーの未読チャット件数をまとめて取得する
async function loadDriverChatUnread() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('driver_messages').select('drv_id').eq('sender_role','driver').is('read_at', null);
    if (error) throw error;
    driverChatUnreadCounts = {};
    (data||[]).forEach(m => { driverChatUnreadCounts[m.drv_id] = (driverChatUnreadCounts[m.drv_id]||0) + 1; });
    driverChatUnreadIds = new Set(Object.keys(driverChatUnreadCounts).map(Number));
  } catch(e) { console.warn('loadDriverChatUnread:', e.message); }
}
// チャット未読件数バッジ（LINEのような赤丸+数字）。styleでボタン右上の絶対配置／リスト行の通常配置を切り替え
function chatUnreadBadgeHtml(drvId, style) {
  const n = driverChatUnreadCounts[drvId] || 0;
  if (!n) return '';
  return `<span class="chat-badge" style="${style||'position:absolute;top:2px;right:2px'}">${n>99?'99+':n}</span>`;
}

async function openDrvChatM(drvId) {
  const d = drvs.find(x => x.id === drvId);
  if (!d) return;
  eChatDrvId = drvId;
  document.getElementById('mDrvChatH').innerHTML = `💬 ${escHtml(d.name)} とのチャット <button class="ibtn" onclick="closeDrvChatM()">✕</button>`;
  document.getElementById('drvChatList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  clearChatFile('drvChatFileInput','drvChatFileChip');
  document.getElementById('mDrvChat').classList.add('on');
  await loadDrvChatMessages(drvId);
  await markDrvChatRead(drvId, 'driver');
  driverChatUnreadIds.delete(drvId);
  delete driverChatUnreadCounts[drvId];
  renderDrv();
  // ドライバーからの返信をLINEのように即時反映する（開いている間だけ購読）
  subscribeDrvChatRealtime(drvId, async (msg) => {
    if (drvChatMessages.some(m => m.id === msg.id)) return; // 自分の送信分は既にローカルに反映済み
    drvChatMessages.push(msg);
    renderDrvChatMessages();
    if (msg.sender_role === 'driver') {
      await markDrvChatRead(drvId, 'driver');
      driverChatUnreadIds.delete(drvId);
      delete driverChatUnreadCounts[drvId];
      renderDrv();
    }
  });
}
function closeDrvChatM() {
  unsubscribeDrvChatRealtime();
  closeM('mDrvChat');
}

async function loadDrvChatMessages(drvId) {
  try {
    const { data, error } = await sb.from('driver_messages').select('*').eq('drv_id', drvId).order('created_at', {ascending:true});
    if (error) throw error;
    drvChatMessages = data || [];
    renderDrvChatMessages();
  } catch(e) {
    const el = document.getElementById('drvChatList');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}

/* ===== チャット共通: ファイル添付・吹き出し描画（モーダル/チャットタブ/ドライバーポータルで共有） ===== */
const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
let chatFileUrlCache = {}; // storageパス -> 署名付きURL（1時間有効。取得済みはキャッシュして再利用）

// 画像は縮小してJPEG化、それ以外（PDF等）はそのままアップロードする
async function prepareChatAttachment(file) {
  if (file.type && file.type.startsWith('image/')) {
    const canvas = await imageFileToCanvas(file, 1600);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像変換に失敗しました')), 'image/jpeg', 0.85));
    if (blob.size > CHAT_FILE_MAX_BYTES) throw new Error(`画像を圧縮しても${fmtBytes(blob.size)}あり、上限の10MBを超えています`);
    return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg' };
  }
  if (file.size > CHAT_FILE_MAX_BYTES) throw new Error(`ファイルサイズが${fmtBytes(file.size)}あり、上限の10MBを超えています`);
  return { blob: file, name: file.name, type: file.type || 'application/octet-stream' };
}
// 添付ファイルをchat-filesバケットにアップロードし、driver_messagesに保存するフィールドを返す
async function uploadChatAttachment(file, drvId) {
  const prepared = await prepareChatAttachment(file);
  const safeName = prepared.name.replace(/[\\/:*?"<>|]/g, '_');
  const path = `drv${drvId}/${Date.now()}_${safeName}`;
  const { error } = await sb.storage.from('chat-files').upload(path, prepared.blob, { contentType: prepared.type });
  if (error) throw error;
  return { file_path: path, file_name: safeName, file_type: prepared.type, file_size: prepared.blob.size };
}
// 添付ファイルの表示（画像はサムネイル、それ以外はダウンロードリンク）。署名付きURL未取得の間は読み込み中表示にする
function chatFileChipHtml(m) {
  if (!m.file_path) return '';
  const url = chatFileUrlCache[m.file_path];
  const mt = m.body ? '6px' : '0';
  if (!url) return `<div style="font-size:11px;color:var(--text2);padding-top:${mt}">📎 ${escHtml(m.file_name||'ファイル')}（読み込み中…）</div>`;
  if ((m.file_type||'').startsWith('image/')) {
    return `<a href="${url}" target="_blank" rel="noopener" style="display:block;margin-top:${mt}"><img src="${url}" style="max-width:200px;max-height:200px;border-radius:8px;display:block"></a>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:5px;font-size:11.5px;padding:6px 8px;background:var(--bg2);border-radius:8px;margin-top:${mt};color:inherit;text-decoration:none">📎 ${escHtml(m.file_name||'ファイル')}${m.file_size?` (${fmtBytes(m.file_size)})`:''}</a>`;
}
// 1件分の吹き出しHTML（本文・添付ファイル共通）。mineRoleは「自分側」とみなすsender_role（管理側は'admin'、ドライバーポータルは'driver'）
function chatBubbleHtml(m, mineRole) {
  const mine = m.sender_role === mineRole;
  const dt = m.created_at ? new Date(m.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  const nameLabel = m.sender_name || (m.sender_role==='admin' ? '管理者' : 'ドライバー');
  return `<div style="align-self:${mine?'flex-end':'flex-start'};max-width:80%">
    <div style="font-size:10px;color:var(--text2);margin-bottom:2px;${mine?'text-align:right':''}">${escHtml(nameLabel)} ・ ${dt}</div>
    <div style="padding:7px 10px;border-radius:12px;background:${mine?'var(--blue)':'var(--bg2)'};color:${mine?'#fff':'var(--text)'};font-size:12px;white-space:pre-wrap;line-height:1.5">${m.body?escHtml(m.body):''}${chatFileChipHtml(m)}</div>
  </div>`;
}
// メッセージ一覧の共通描画。添付ファイルの署名付きURLが未取得なら取得後に再描画する
function renderChatMessagesInto(elId, messages, mineRole) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!messages.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">まだメッセージがありません</div>'; return; }
  el.innerHTML = messages.map(m => chatBubbleHtml(m, mineRole)).join('');
  el.scrollTop = el.scrollHeight;
  const missing = [...new Set(messages.filter(m=>m.file_path && !chatFileUrlCache[m.file_path]).map(m=>m.file_path))];
  if (missing.length && sb?.storage) {
    sb.storage.from('chat-files').createSignedUrls(missing, 3600).then(({data,error}) => {
      if (error) return;
      (data||[]).forEach(d => { if (d.signedUrl) chatFileUrlCache[d.path] = d.signedUrl; });
      renderChatMessagesInto(elId, messages, mineRole);
    }).catch(()=>{});
  }
}
// ファイル選択時のプレビュー表示・解除（3つのチャットUIで共通利用）
function onChatFileSelected(fileInputId, chipId) {
  const f = document.getElementById(fileInputId)?.files?.[0];
  const chip = document.getElementById(chipId);
  if (!chip) return;
  chip.innerHTML = f ? `📎 ${escHtml(f.name)}（${fmtBytes(f.size)}） <span style="cursor:pointer;color:var(--red-text)" onclick="clearChatFile('${fileInputId}','${chipId}')">✕</span>` : '';
}
function clearChatFile(fileInputId, chipId) {
  const fi = document.getElementById(fileInputId); if (fi) fi.value = '';
  const chip = document.getElementById(chipId); if (chip) chip.innerHTML = '';
}

function renderDrvChatMessages() { renderChatMessagesInto('drvChatList', drvChatMessages, 'admin'); }

async function sendDrvChatMessage() {
  const input = document.getElementById('drvChatInput');
  const body = input.value.trim();
  const file = document.getElementById('drvChatFileInput')?.files?.[0];
  if ((!body && !file) || !eChatDrvId) return;
  showLoad(true);
  try {
    let fileFields = {};
    if (file) fileFields = await uploadChatAttachment(file, eChatDrvId);
    const { data, error } = await sb.from('driver_messages').insert({drv_id: eChatDrvId, sender_role:'admin', sender_name: me?.name||'', body: body||'', ...fileFields}).select().single();
    if (error) throw error;
    drvChatMessages.push(data);
    renderDrvChatMessages();
    input.value = '';
    clearChatFile('drvChatFileInput','drvChatFileChip');
    // LINE/メール通知（1時間に1回まで: refに時間バケットを含めdedupeさせ、連投で通知が溢れないようにする）
    const hourBucket = new Date().toISOString().slice(0,13);
    notifyDrivers([eChatDrvId], 'chat', `chat-${eChatDrvId}-${hourBucket}`, '管理者からメッセージ', 'ポータルのチャットに新着メッセージがあります。', true);
  } catch(e) { showT('送信エラー: '+e.message, 'ter'); }
  showLoad(false);
}

/* ===== チャット専用タブ（掲示板の右隣）=====
   モーダル版(openDrvChatM等)と同じdriver_messagesテーブル・既読管理を使い、
   一覧（左）と選択中スレッド（右）を1画面に並べて素早く返信できるようにする */
let chatTabDrvId = null; // 現在選択中のドライバーID
let chatTabMessages = []; // 選択中スレッドのメッセージキャッシュ
let chatTabLastMsgByDrv = {}; // drv_id -> 直近メッセージ（一覧のプレビュー・並び替え用）
async function initChatTab() {
  await loadDriverChatUnread();
  try {
    const { data, error } = await sb.from('driver_messages').select('drv_id, body, created_at, sender_role').order('created_at', {ascending:false}).limit(500);
    if (!error) {
      chatTabLastMsgByDrv = {};
      (data||[]).forEach(m => { if (!chatTabLastMsgByDrv[m.drv_id]) chatTabLastMsgByDrv[m.drv_id] = m; });
    }
  } catch(e) { console.warn('initChatTab:', e.message); }
  renderChatTabDrvList();
  subscribeChatTabRealtime();
}
function formatChatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nOnly - dOnly) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
  if (diffDays === 1) return '昨日';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}
// 解約済みドライバーは既定では一覧から隠すが、未読メッセージが残っている場合は
// 見落とし防止のため隠さない（解約後にやり取りが必要になるケースがあるため）
let chatTabShowTerminated = false;
function toggleChatTabShowTerminated() {
  chatTabShowTerminated = !chatTabShowTerminated;
  const btn = document.getElementById('chatTabShowTerminatedBtn');
  if (btn) { btn.textContent = chatTabShowTerminated ? '稼働中のみ表示' : '解約済みを表示'; btn.classList.toggle('pri', chatTabShowTerminated); }
  renderChatTabDrvList();
}
function renderChatTabDrvList() {
  const el = document.getElementById('chatTabDrvList');
  if (!el) return;
  const q = nm(document.getElementById('chatTabSearch')?.value || '');
  const base = chatTabShowTerminated ? drvs : drvs.filter(d => d.status !== 'terminated' || driverChatUnreadIds.has(d.id));
  let list = q ? base.filter(d => nm(d.name).includes(q)) : base.slice();
  list.sort((a,b) => {
    const au = driverChatUnreadIds.has(a.id) ? 1 : 0, bu = driverChatUnreadIds.has(b.id) ? 1 : 0;
    if (au !== bu) return bu - au; // 未読を先頭に
    const at = chatTabLastMsgByDrv[a.id]?.created_at || '', bt = chatTabLastMsgByDrv[b.id]?.created_at || '';
    return bt.localeCompare(at); // メッセージが新しい順
  });
  if (!list.length) { el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text2);font-size:12px">該当するドライバーがいません</div>'; return; }
  el.innerHTML = list.map(d => {
    const unread = driverChatUnreadIds.has(d.id);
    const last = chatTabLastMsgByDrv[d.id];
    const active = d.id === chatTabDrvId;
    return `<div onclick="openChatTabDrv(${d.id})" style="padding:9px 12px;cursor:pointer;border-bottom:0.5px solid var(--border);${active?'background:var(--blue-bg)':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <span style="font-weight:${unread?'700':'500'};font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(d.name)}${d.status==='terminated'?' <span class="bdg" style="background:var(--gray-bg);color:var(--gray-text);font-weight:500">解約済み</span>':''}</span>
        ${last?`<span style="font-size:9.5px;color:var(--text2);flex-shrink:0">${formatChatListTime(last.created_at)}</span>`:''}
        ${chatUnreadBadgeHtml(d.id, 'flex-shrink:0')}
      </div>
      ${last?`<div style="font-size:10.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${last.sender_role==='admin'?'自分: ':''}${escHtml(last.body)}</div>`:''}
    </div>`;
  }).join('');
}
async function openChatTabDrv(drvId) {
  const d = drvs.find(x => x.id === drvId);
  if (!d) return;
  chatTabDrvId = drvId;
  document.getElementById('chatTabHeader').textContent = `💬 ${d.name}`;
  document.getElementById('chatTabInputArea').style.display = 'flex';
  document.getElementById('chatTabMsgList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  clearChatFile('chatTabFileInput','chatTabFileChip');
  renderChatTabDrvList();
  await loadChatTabMessages(drvId);
  await markDrvChatRead(drvId, 'driver');
  driverChatUnreadIds.delete(drvId);
  delete driverChatUnreadCounts[drvId];
  renderChatTabDrvList();
  if (!document.getElementById('pg2')?.classList.contains('hide')) renderDrv();
  // メッセージのリアルタイム反映はチャットタブ全体で1本の購読(subscribeChatTabRealtime)にまとめて処理する
}
async function loadChatTabMessages(drvId) {
  try {
    const { data, error } = await sb.from('driver_messages').select('*').eq('drv_id', drvId).order('created_at', {ascending:true});
    if (error) throw error;
    chatTabMessages = data || [];
    renderChatTabMessages();
  } catch(e) {
    const el = document.getElementById('chatTabMsgList');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}
function renderChatTabMessages() { renderChatMessagesInto('chatTabMsgList', chatTabMessages, 'admin'); }
async function sendChatTabMessage() {
  const input = document.getElementById('chatTabInput');
  const body = input.value.trim();
  const file = document.getElementById('chatTabFileInput')?.files?.[0];
  if ((!body && !file) || !chatTabDrvId) return;
  showLoad(true);
  try {
    let fileFields = {};
    if (file) fileFields = await uploadChatAttachment(file, chatTabDrvId);
    const { data, error } = await sb.from('driver_messages').insert({drv_id: chatTabDrvId, sender_role:'admin', sender_name: me?.name||'', body: body||'', ...fileFields}).select().single();
    if (error) throw error;
    chatTabMessages.push(data);
    renderChatTabMessages();
    chatTabLastMsgByDrv[chatTabDrvId] = data;
    renderChatTabDrvList();
    input.value = '';
    clearChatFile('chatTabFileInput','chatTabFileChip');
    const hourBucket = new Date().toISOString().slice(0,13);
    notifyDrivers([chatTabDrvId], 'chat', `chat-${chatTabDrvId}-${hourBucket}`, '管理者からメッセージ', 'ポータルのチャットに新着メッセージがあります。', true);
  } catch(e) { showT('送信エラー: '+e.message, 'ter'); }
  showLoad(false);
}

// 一斉メッセージ: 選択した複数ドライバーのチャットに同文を個別送信する（掲示板は全員向け、個別連絡はチャットという役割分担のための補助機能）
function openBulkChatM(){
  const list = document.getElementById('bulkChatDrvList');
  const sorted = [...activeDrvs()].sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999));
  list.innerHTML = sorted.map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="bulkChatChk" value="${d.id}" style="width:auto">${escHtml(d.name)}${d.company?`<span style="color:var(--text2);font-size:10.5px">（${escHtml(d.company)}）</span>`:''}</label>`).join('') || '<div style="font-size:11px;color:var(--text2)">ドライバーが登録されていません</div>';
  document.getElementById('bulkChatBody').value = '';
  document.getElementById('mBulkChat').classList.add('on');
}
async function sendBulkChat(){
  const ids = [...document.querySelectorAll('.bulkChatChk:checked')].map(c=>+c.value);
  const body = document.getElementById('bulkChatBody').value.trim();
  if (!ids.length) { alert('送信先を選択してください'); return; }
  if (!body) { alert('メッセージを入力してください'); return; }
  if (!confirm(`${ids.length}名のドライバーにチャットで送信しますか？`)) return;
  showLoad(true);
  let ok = 0, errs = [];
  const hourBucket = new Date().toISOString().slice(0,13);
  for (const drvId of ids) {
    try {
      const { error } = await sb.from('driver_messages').insert({drv_id: drvId, sender_role:'admin', sender_name: me?.name||'', body});
      if (error) throw error;
      ok++;
      notifyDrivers([drvId], 'chat', `chat-${drvId}-${hourBucket}`, '管理者からメッセージ', 'ポータルのチャットに新着メッセージがあります。', true);
    } catch(e) { errs.push(`${drvs.find(d=>d.id===drvId)?.name||drvId}: ${e.message}`); }
  }
  showLoad(false);
  closeM('mBulkChat');
  addLog('一斉メッセージ送信', `${ok}名`);
  if (errs.length) showT(`${ok}名に送信、${errs.length}件失敗: ${errs[0]}`,'twa');
  else showT(`${ok}名のチャットに送信しました`);
}

/* ===== グループチャット（複数の社内メンバー・ドライバーが同時参加できるチャット。管理側） =====
   個別チャット(driver_messages)とは別テーブル(chat_groups/chat_group_messages)。
   吹き出し・添付ファイル表示は個別チャットと同じ共通関数(chatFileChipHtml等)を再利用する */
let chatGroups = [];
let chatGroupSelId = null;
let chatGroupMsgs = [];
let chatGroupMyReads = {}; // group_id -> 自分の最終既読時刻(ISO)
let chatGroupLastMsgById = {}; // group_id -> 直近メッセージ（一覧のプレビュー・並び替え用）
let chatGroupRealtimeChannel = null;
let eChatGroupId = null; // 編集中グループ（新規作成時はnull）

async function loadChatGroups() {
  try {
    const { data, error } = await sb.from('chat_groups').select('*').order('created_at', {ascending:false});
    if (error) throw error;
    chatGroups = data || [];
  } catch(e) { console.warn('loadChatGroups:', e.message); }
}
async function loadChatGroupLastMsgs() {
  try {
    const { data, error } = await sb.from('chat_group_messages').select('group_id, body, created_at, sender_name').order('created_at', {ascending:false}).limit(500);
    if (!error) {
      chatGroupLastMsgById = {};
      (data||[]).forEach(m => { if (!chatGroupLastMsgById[m.group_id]) chatGroupLastMsgById[m.group_id] = m; });
    }
  } catch(e) { console.warn('loadChatGroupLastMsgs:', e.message); }
}
async function loadMyChatGroupReads() {
  if (!me) return;
  try {
    const { data, error } = await sb.from('chat_group_reads').select('*').eq('member_key', 'staff:'+me.id);
    if (!error) { chatGroupMyReads = {}; (data||[]).forEach(r => { chatGroupMyReads[r.group_id] = r.last_read_at; }); }
  } catch(e) { console.warn('loadMyChatGroupReads:', e.message); }
}
function isChatGroupUnread(g) {
  const last = chatGroupLastMsgById[g.id];
  if (!last) return false;
  const readAt = chatGroupMyReads[g.id];
  return !readAt || readAt < last.created_at;
}
async function initGroupChatTab() {
  await Promise.all([loadChatGroups(), loadChatGroupLastMsgs(), loadMyChatGroupReads()]);
  renderChatGroupList();
  subscribeChatGroupRealtime();
}
function renderChatGroupList() {
  const el = document.getElementById('chatGroupList');
  if (!el) return;
  if (!chatGroups.length) { el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text2);font-size:12px">グループがありません（「＋ 新規グループ」から作成してください）</div>'; return; }
  const sorted = [...chatGroups].sort((a,b) => {
    const at = chatGroupLastMsgById[a.id]?.created_at || a.created_at;
    const bt = chatGroupLastMsgById[b.id]?.created_at || b.created_at;
    return bt.localeCompare(at);
  });
  el.innerHTML = sorted.map(g => {
    const unread = isChatGroupUnread(g);
    const last = chatGroupLastMsgById[g.id];
    const active = g.id === chatGroupSelId;
    const memberCount = (g.driver_ids||[]).length + (g.staff_user_ids||[]).length;
    return `<div onclick="openChatGroup(${g.id})" style="padding:9px 12px;cursor:pointer;border-bottom:0.5px solid var(--border);${active?'background:var(--blue-bg)':''}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <span style="font-weight:${unread?'700':'500'};font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">👥 ${escHtml(g.name)}</span>
        ${last?`<span style="font-size:9.5px;color:var(--text2);flex-shrink:0">${formatChatListTime(last.created_at)}</span>`:''}
        ${unread?`<span style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0"></span>`:''}
      </div>
      <div style="font-size:10.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${memberCount}名${last?`　${last.sender_name?escHtml(last.sender_name)+': ':''}${escHtml(last.body||'📎ファイル')}`:''}</div>
    </div>`;
  }).join('');
}
async function openChatGroup(id) {
  const g = chatGroups.find(x=>x.id===id);
  if (!g) return;
  chatGroupSelId = id;
  document.getElementById('chatGroupHeader').innerHTML = `👥 ${escHtml(g.name)} <button class="ibtn" onclick="openEditChatGroupM(${g.id})" title="メンバー編集" style="margin-left:6px">✎</button>`;
  document.getElementById('chatGroupInputArea').style.display = 'flex';
  document.getElementById('chatGroupMsgList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  clearChatFile('chatGroupFileInput','chatGroupFileChip');
  renderChatGroupList();
  await loadChatGroupMessages(id);
  await markChatGroupRead(id);
  renderChatGroupList();
}
async function loadChatGroupMessages(id) {
  try {
    const { data, error } = await sb.from('chat_group_messages').select('*').eq('group_id', id).order('created_at', {ascending:true});
    if (error) throw error;
    chatGroupMsgs = data || [];
    renderChatGroupMessages();
  } catch(e) {
    const el = document.getElementById('chatGroupMsgList');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}
// 1件分の吹き出しHTML（グループチャット用。sender_keyで「自分の発言か」を判定する）
function chatGroupBubbleHtml(m) {
  const mine = m.sender_key === ('staff:'+me?.id);
  const dt = m.created_at ? new Date(m.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  return `<div style="align-self:${mine?'flex-end':'flex-start'};max-width:80%">
    <div style="font-size:10px;color:var(--text2);margin-bottom:2px;${mine?'text-align:right':''}">${escHtml(m.sender_name||(m.sender_type==='driver'?'ドライバー':'担当者'))} ・ ${dt}</div>
    <div style="padding:7px 10px;border-radius:12px;background:${mine?'var(--blue)':'var(--bg2)'};color:${mine?'#fff':'var(--text)'};font-size:12px;white-space:pre-wrap;line-height:1.5">${m.body?escHtml(m.body):''}${chatFileChipHtml(m)}</div>
  </div>`;
}
function renderChatGroupMessages() {
  const el = document.getElementById('chatGroupMsgList');
  if (!el) return;
  if (!chatGroupMsgs.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">まだメッセージがありません</div>'; return; }
  el.innerHTML = chatGroupMsgs.map(chatGroupBubbleHtml).join('');
  el.scrollTop = el.scrollHeight;
  const missing = [...new Set(chatGroupMsgs.filter(m=>m.file_path && !chatFileUrlCache[m.file_path]).map(m=>m.file_path))];
  if (missing.length && sb?.storage) {
    sb.storage.from('chat-files').createSignedUrls(missing, 3600).then(({data,error}) => {
      if (error) return;
      (data||[]).forEach(d => { if (d.signedUrl) chatFileUrlCache[d.path] = d.signedUrl; });
      renderChatGroupMessages();
    }).catch(()=>{});
  }
}
// 添付ファイルをchat-filesバケットの grp{group_id}/ 配下にアップロードする（個別チャットのdrv{id}/と対になるプレフィックス）
async function uploadChatGroupAttachment(file, groupId) {
  const prepared = await prepareChatAttachment(file);
  const safeName = prepared.name.replace(/[\\/:*?"<>|]/g, '_');
  const path = `grp${groupId}/${Date.now()}_${safeName}`;
  const { error } = await sb.storage.from('chat-files').upload(path, prepared.blob, { contentType: prepared.type });
  if (error) throw error;
  return { file_path: path, file_name: safeName, file_type: prepared.type, file_size: prepared.blob.size };
}
async function sendChatGroupMessage() {
  const input = document.getElementById('chatGroupInput');
  const body = input.value.trim();
  const file = document.getElementById('chatGroupFileInput')?.files?.[0];
  if ((!body && !file) || !chatGroupSelId) return;
  showLoad(true);
  try {
    let fileFields = {};
    if (file) fileFields = await uploadChatGroupAttachment(file, chatGroupSelId);
    const { data, error } = await sb.from('chat_group_messages').insert({group_id: chatGroupSelId, sender_type:'staff', sender_name: me?.name||'', sender_key: 'staff:'+me.id, body: body||'', ...fileFields}).select().single();
    if (error) throw error;
    chatGroupMsgs.push(data);
    renderChatGroupMessages();
    chatGroupLastMsgById[chatGroupSelId] = data;
    renderChatGroupList();
    input.value = '';
    clearChatFile('chatGroupFileInput','chatGroupFileChip');
    await markChatGroupRead(chatGroupSelId);
    const g = chatGroups.find(x=>x.id===chatGroupSelId);
    if (g?.driver_ids?.length) {
      const hourBucket = new Date().toISOString().slice(0,13);
      notifyDrivers(g.driver_ids, 'chat', `chatgrp-${chatGroupSelId}-${hourBucket}`, `グループ「${g.name}」に新着メッセージ`, 'ポータルのグループチャットに新着メッセージがあります。', true);
    }
  } catch(e) { showT('送信エラー: '+e.message, 'ter'); }
  showLoad(false);
}
async function markChatGroupRead(id) {
  if (!me) return;
  try {
    await sb.from('chat_group_reads').upsert({group_id:id, member_key:'staff:'+me.id, last_read_at:new Date().toISOString()}, {onConflict:'group_id,member_key'});
    chatGroupMyReads[id] = new Date().toISOString();
  } catch(e) { console.warn('markChatGroupRead:', e.message); }
}
function subscribeChatGroupRealtime() {
  unsubscribeChatGroupRealtime();
  chatGroupRealtimeChannel = sb.channel('chat_group_messages_all')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_group_messages' }, payload => {
      const m = payload.new;
      chatGroupLastMsgById[m.group_id] = m;
      if (m.group_id === chatGroupSelId) {
        if (!chatGroupMsgs.some(x=>x.id===m.id)) chatGroupMsgs.push(m);
        renderChatGroupMessages();
        markChatGroupRead(m.group_id);
      }
      renderChatGroupList();
    })
    .subscribe();
}
function unsubscribeChatGroupRealtime() {
  if (chatGroupRealtimeChannel) { sb?.removeChannel(chatGroupRealtimeChannel); chatGroupRealtimeChannel = null; }
}

/* グループ作成・編集モーダル */
function openNewChatGroupM() {
  eChatGroupId = null;
  document.getElementById('mChatGroupH').innerHTML = '新規グループ作成 <button class="ibtn" onclick="closeM(\'mChatGroup\')">✕</button>';
  document.getElementById('chatGroupNameInput').value = '';
  renderChatGroupMemberPickers([], []);
  document.getElementById('mChatGroup').classList.add('on');
}
function openEditChatGroupM(id) {
  const g = chatGroups.find(x=>x.id===id);
  if (!g) return;
  eChatGroupId = id;
  document.getElementById('mChatGroupH').innerHTML = 'グループ編集 <button class="ibtn" onclick="closeM(\'mChatGroup\')">✕</button>';
  document.getElementById('chatGroupNameInput').value = g.name;
  renderChatGroupMemberPickers(g.driver_ids||[], g.staff_user_ids||[]);
  document.getElementById('mChatGroup').classList.add('on');
}
function renderChatGroupMemberPickers(driverIds, staffIds) {
  const drvSet = new Set(driverIds), staffSet = new Set(staffIds);
  const drvList = document.getElementById('chatGroupDrvList');
  const sortedDrvs = [...activeDrvs()].sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999));
  drvList.innerHTML = sortedDrvs.map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="chatGroupDrvChk" value="${d.id}" ${drvSet.has(d.id)?'checked':''} style="width:auto">${escHtml(d.name)}</label>`).join('') || '<div style="font-size:11px;color:var(--text2)">ドライバーが登録されていません</div>';
  const staffList = document.getElementById('chatGroupStaffList');
  const staffUsers = users.filter(u=>u.role!=='driver');
  staffList.innerHTML = staffUsers.map(u=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="chatGroupStaffChk" value="${escHtml(u.id)}" ${staffSet.has(u.id)?'checked':''} style="width:auto">${escHtml(u.name)}</label>`).join('') || '<div style="font-size:11px;color:var(--text2)">社内ユーザーが登録されていません</div>';
}
async function saveChatGroup() {
  const name = document.getElementById('chatGroupNameInput').value.trim();
  if (!name) { alert('グループ名を入力してください'); return; }
  const driverIds = [...document.querySelectorAll('.chatGroupDrvChk:checked')].map(c=>+c.value);
  const staffIds = [...document.querySelectorAll('.chatGroupStaffChk:checked')].map(c=>c.value);
  if (!driverIds.length && !staffIds.length) { alert('メンバーを1名以上選択してください'); return; }
  showLoad(true);
  try {
    if (eChatGroupId) {
      const { data, error } = await sb.from('chat_groups').update({name, driver_ids:driverIds, staff_user_ids:staffIds}).eq('id', eChatGroupId).select().single();
      if (error) throw error;
      const idx = chatGroups.findIndex(g=>g.id===eChatGroupId);
      if (idx>=0) chatGroups[idx] = data;
      addLog('グループチャット編集', name);
    } else {
      const { data, error } = await sb.from('chat_groups').insert({name, driver_ids:driverIds, staff_user_ids:staffIds, created_by: me?.name||''}).select().single();
      if (error) throw error;
      chatGroups.unshift(data);
      addLog('グループチャット作成', name);
    }
    closeM('mChatGroup');
    renderChatGroupList();
    if (chatGroupSelId) openChatGroup(chatGroupSelId);
    showT(eChatGroupId ? '更新しました' : '作成しました');
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
  showLoad(false);
}

// forSenderRole側が送った未読メッセージを既読にする（管理側が開いたら'driver'発言を、ドライバー側が開いたら'admin'発言を既読化）
async function markDrvChatRead(drvId, forSenderRole) {
  try {
    await sb.from('driver_messages').update({read_at: new Date().toISOString()}).eq('drv_id', drvId).eq('sender_role', forSenderRole).is('read_at', null);
  } catch(e) { console.warn('markDrvChatRead:', e.message); }
}

// 管理側: 全ドライバー書類状況一覧
async function openDocStatusM() {
  document.getElementById('mDocStatus').classList.add('on');
  document.getElementById('docStatusBody').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">読み込み中...</div>';
  await loadDriverDocs();
  renderDocStatusBody();
}
// 期限切れ・期限間近の書類を全ドライバー横断で抽出（管理側の警告表示用）
function summarizeDocAlerts() {
  const issues = [];
  activeDrvs().forEach(d => {
    DRIVER_DOC_TYPES.forEach(t => {
      const st = docStatusOf(findDriverDoc(d.id, t.key));
      if (st.cls === 'expired' || st.cls === 'soon') issues.push({ drv: d, t, st });
    });
  });
  return issues;
}
// ドライバー本人へ、自分の提出書類の期限切れ・期限間近をログイン時に知らせる（管理側とは別に本人にも直接注意喚起する）
async function checkDriverOwnDocAlerts() {
  if (!sb || !me?.driver_id) return;
  try {
    const { data, error } = await sb.from('driver_documents').select('*').eq('drv_id', me.driver_id);
    if (error) throw error;
    const myDocs = data || [];
    const issues = DRIVER_DOC_TYPES
      .map(t => ({ t, st: docStatusOf(myDocs.find(d=>d.doc_type===t.key)) }))
      .filter(x => x.st.cls === 'expired' || x.st.cls === 'soon');
    setNavWarnDot('dnt4', issues.length>0);
    if (!issues.length) return;
    const expired = issues.filter(i => i.st.cls === 'expired').map(i=>i.t.label);
    const soon = issues.filter(i => i.st.cls === 'soon').map(i=>i.t.label);
    const msg = `📄 ${expired.length?`期限切れ: ${expired.join('、')}`:''}${expired.length&&soon.length?' / ':''}${soon.length?`期限間近: ${soon.join('、')}`:''}（書類タブから更新してください）`;
    showT(msg, 'twa');
  } catch(e) { console.warn('checkDriverOwnDocAlerts:', e.message); }
}

/* ===== ドライバーとのチャット（ドライバーポータル側） ===== */
async function loadDrvPortalChat() {
  if (!me?.driver_id) return;
  const el = document.getElementById('drvChatPortalList');
  if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  try {
    const { data, error } = await sb.from('driver_messages').select('*').eq('drv_id', me.driver_id).order('created_at', {ascending:true});
    if (error) throw error;
    drvChatMessages = data || [];
    renderDrvPortalChatMessages();
    await markDrvChatRead(me.driver_id, 'admin');
    setNavWarnDot('dnt3', false); // 連絡タブ（お知らせ＋チャット統合）の赤丸を消す
    setNavWarnDot('drvSubChat3', false);
    // 管理者からの返信をLINEのように即時反映する（ポータルに滞在している間だけ購読）
    subscribeDrvChatRealtime(me.driver_id, async (msg) => {
      if (drvChatMessages.some(m => m.id === msg.id)) return; // 自分の送信分は既にローカルに反映済み
      drvChatMessages.push(msg);
      renderDrvPortalChatMessages();
      if (msg.sender_role === 'admin') await markDrvChatRead(me.driver_id, 'admin');
    });
  } catch(e) {
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}

function renderDrvPortalChatMessages() { renderChatMessagesInto('drvChatPortalList', drvChatMessages, 'driver'); }

async function sendDrvPortalChatMessage() {
  const input = document.getElementById('drvChatPortalInput');
  const body = input.value.trim();
  const file = document.getElementById('drvChatPortalFileInput')?.files?.[0];
  if ((!body && !file) || !me?.driver_id) return;
  showLoad(true);
  try {
    let fileFields = {};
    if (file) fileFields = await uploadChatAttachment(file, me.driver_id);
    const { data, error } = await sb.from('driver_messages').insert({drv_id: me.driver_id, sender_role:'driver', sender_name: me?.name||'', body: body||'', ...fileFields}).select().single();
    if (error) throw error;
    drvChatMessages.push(data);
    renderDrvPortalChatMessages();
    input.value = '';
    clearChatFile('drvChatPortalFileInput','drvChatPortalFileChip');
  } catch(e) { showT('送信エラー: '+e.message, 'ter'); }
  showLoad(false);
}

// ログイン時、管理者からの未読メッセージがあればナビに赤丸を出す（チャットタブは既定タブではないため、掲示板と違い直後には開かれない）
async function checkDriverOwnChatAlerts() {
  if (!sb || !me?.driver_id) return;
  try {
    const { data, error } = await sb.from('driver_messages').select('id').eq('drv_id', me.driver_id).eq('sender_role','admin').is('read_at', null);
    if (error) throw error;
    // チャットはお知らせと同じ「連絡」タブ(dnt3)に統合されたため、タブ本体とサブタブの両方に赤丸を出す
    setNavWarnDot('dnt3', (data||[]).length>0);
    setNavWarnDot('drvSubChat3', (data||[]).length>0);
  } catch(e) { console.warn('checkDriverOwnChatAlerts:', e.message); }
}

/* ===== グループチャット（ドライバーポータル側） =====
   管理側(chatGroups等)とは別の状態を持つ。RLSにより自分が参加しているグループのみ取得される */
let myChatGroups = [];
let myChatGroupSelId = null;
let myChatGroupMsgs = [];
let myChatGroupLastMsgById = {};
let myChatGroupMyReads = {};
let myChatGroupRealtimeChannel = null;

async function loadMyChatGroups() {
  if (!me?.driver_id) return;
  const listEl = document.getElementById('drvChatGroupListWrap');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  try {
    const [{data:groups, error:e1}, {data:reads, error:e2}] = await Promise.all([
      sb.from('chat_groups').select('*').order('created_at', {ascending:false}),
      sb.from('chat_group_reads').select('*').eq('member_key', 'driver:'+me.driver_id)
    ]);
    if (e1) throw e1;
    myChatGroups = groups || [];
    myChatGroupMyReads = {};
    if (!e2) (reads||[]).forEach(r => { myChatGroupMyReads[r.group_id] = r.last_read_at; });
    myChatGroupLastMsgById = {};
    if (myChatGroups.length) {
      const { data: msgs } = await sb.from('chat_group_messages').select('group_id, body, created_at, sender_name').in('group_id', myChatGroups.map(g=>g.id)).order('created_at', {ascending:false}).limit(500);
      (msgs||[]).forEach(m => { if (!myChatGroupLastMsgById[m.group_id]) myChatGroupLastMsgById[m.group_id] = m; });
    }
    renderMyChatGroupList();
    setNavWarnDot('drvSubGroupChat3', myChatGroups.some(isMyChatGroupUnread));
    subscribeMyChatGroupRealtime();
  } catch(e) {
    if (listEl) listEl.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}
function isMyChatGroupUnread(g) {
  const last = myChatGroupLastMsgById[g.id];
  if (!last) return false;
  const readAt = myChatGroupMyReads[g.id];
  return !readAt || readAt < last.created_at;
}
function renderMyChatGroupList() {
  const el = document.getElementById('drvChatGroupListWrap');
  if (!el) return;
  if (!myChatGroups.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">参加しているグループがありません</div>'; return; }
  const sorted = [...myChatGroups].sort((a,b) => {
    const at = myChatGroupLastMsgById[a.id]?.created_at || a.created_at;
    const bt = myChatGroupLastMsgById[b.id]?.created_at || b.created_at;
    return bt.localeCompare(at);
  });
  el.innerHTML = sorted.map(g => {
    const unread = isMyChatGroupUnread(g);
    const last = myChatGroupLastMsgById[g.id];
    return `<div onclick="openMyChatGroup(${g.id})" style="padding:10px 12px;margin-bottom:6px;border:0.5px solid var(--border);border-radius:var(--radius);cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <span style="font-weight:${unread?'700':'500'};font-size:13px">👥 ${escHtml(g.name)}</span>
        ${unread?`<span style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0"></span>`:''}
      </div>
      ${last?`<div style="font-size:11px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${last.sender_name?escHtml(last.sender_name)+': ':''}${escHtml(last.body||'📎ファイル')}</div>`:''}
    </div>`;
  }).join('');
}
async function openMyChatGroup(id) {
  const g = myChatGroups.find(x=>x.id===id);
  if (!g) return;
  myChatGroupSelId = id;
  document.getElementById('drvChatGroupListWrap').style.display = 'none';
  document.getElementById('drvChatGroupThreadWrap').style.display = 'flex';
  document.getElementById('drvChatGroupHeader').innerHTML = `← グループ一覧　👥 ${escHtml(g.name)}`;
  document.getElementById('drvChatGroupMsgList').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">読み込み中...</div>';
  clearChatFile('drvChatGroupFileInput','drvChatGroupFileChip');
  await loadMyChatGroupMessages(id);
  await markMyChatGroupRead(id);
  renderMyChatGroupList();
  setNavWarnDot('drvSubGroupChat3', myChatGroups.some(isMyChatGroupUnread));
}
function closeMyChatGroupThread() {
  myChatGroupSelId = null;
  document.getElementById('drvChatGroupThreadWrap').style.display = 'none';
  document.getElementById('drvChatGroupListWrap').style.display = 'block';
  renderMyChatGroupList();
}
async function loadMyChatGroupMessages(id) {
  try {
    const { data, error } = await sb.from('chat_group_messages').select('*').eq('group_id', id).order('created_at', {ascending:true});
    if (error) throw error;
    myChatGroupMsgs = data || [];
    renderMyChatGroupMessages();
  } catch(e) {
    const el = document.getElementById('drvChatGroupMsgList');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}
function myChatGroupBubbleHtml(m) {
  const mine = m.sender_key === ('driver:'+me?.driver_id);
  const dt = m.created_at ? new Date(m.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  return `<div style="align-self:${mine?'flex-end':'flex-start'};max-width:80%">
    <div style="font-size:10px;color:var(--text2);margin-bottom:2px;${mine?'text-align:right':''}">${escHtml(m.sender_name||(m.sender_type==='staff'?'担当者':'ドライバー'))} ・ ${dt}</div>
    <div style="padding:7px 10px;border-radius:12px;background:${mine?'var(--blue)':'var(--bg2)'};color:${mine?'#fff':'var(--text)'};font-size:12px;white-space:pre-wrap;line-height:1.5">${m.body?escHtml(m.body):''}${chatFileChipHtml(m)}</div>
  </div>`;
}
function renderMyChatGroupMessages() {
  const el = document.getElementById('drvChatGroupMsgList');
  if (!el) return;
  if (!myChatGroupMsgs.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:12px">まだメッセージがありません</div>'; return; }
  el.innerHTML = myChatGroupMsgs.map(myChatGroupBubbleHtml).join('');
  el.scrollTop = el.scrollHeight;
  const missing = [...new Set(myChatGroupMsgs.filter(m=>m.file_path && !chatFileUrlCache[m.file_path]).map(m=>m.file_path))];
  if (missing.length && sb?.storage) {
    sb.storage.from('chat-files').createSignedUrls(missing, 3600).then(({data,error}) => {
      if (error) return;
      (data||[]).forEach(d => { if (d.signedUrl) chatFileUrlCache[d.path] = d.signedUrl; });
      renderMyChatGroupMessages();
    }).catch(()=>{});
  }
}
async function sendMyChatGroupMessage() {
  const input = document.getElementById('drvChatGroupInput');
  const body = input.value.trim();
  const file = document.getElementById('drvChatGroupFileInput')?.files?.[0];
  if ((!body && !file) || !myChatGroupSelId || !me?.driver_id) return;
  showLoad(true);
  try {
    let fileFields = {};
    if (file) fileFields = await uploadChatGroupAttachment(file, myChatGroupSelId);
    const { data, error } = await sb.from('chat_group_messages').insert({group_id: myChatGroupSelId, sender_type:'driver', sender_name: me?.name||'', sender_key: 'driver:'+me.driver_id, body: body||'', ...fileFields}).select().single();
    if (error) throw error;
    myChatGroupMsgs.push(data);
    renderMyChatGroupMessages();
    myChatGroupLastMsgById[myChatGroupSelId] = data;
    input.value = '';
    clearChatFile('drvChatGroupFileInput','drvChatGroupFileChip');
    await markMyChatGroupRead(myChatGroupSelId);
  } catch(e) { showT('送信エラー: '+e.message, 'ter'); }
  showLoad(false);
}
async function markMyChatGroupRead(id) {
  if (!me?.driver_id) return;
  try {
    await sb.from('chat_group_reads').upsert({group_id:id, member_key:'driver:'+me.driver_id, last_read_at:new Date().toISOString()}, {onConflict:'group_id,member_key'});
    myChatGroupMyReads[id] = new Date().toISOString();
  } catch(e) { console.warn('markMyChatGroupRead:', e.message); }
}
function subscribeMyChatGroupRealtime() {
  unsubscribeMyChatGroupRealtime();
  if (!myChatGroups.length) return;
  myChatGroupRealtimeChannel = sb.channel('my_chat_group_messages')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_group_messages' }, payload => {
      const m = payload.new;
      if (!myChatGroups.some(g=>g.id===m.group_id)) return;
      myChatGroupLastMsgById[m.group_id] = m;
      if (m.group_id === myChatGroupSelId) {
        if (!myChatGroupMsgs.some(x=>x.id===m.id)) myChatGroupMsgs.push(m);
        renderMyChatGroupMessages();
        markMyChatGroupRead(m.group_id);
      } else {
        renderMyChatGroupList();
        setNavWarnDot('drvSubGroupChat3', true);
      }
    })
    .subscribe();
}
function unsubscribeMyChatGroupRealtime() {
  if (myChatGroupRealtimeChannel) { sb?.removeChannel(myChatGroupRealtimeChannel); myChatGroupRealtimeChannel = null; }
}
// ログイン時、参加グループに未読メッセージがあればナビに赤丸を出す
async function checkDriverOwnGroupChatAlerts() {
  if (!sb || !me?.driver_id) return;
  try {
    const [{data:groups, error:e1}, {data:reads, error:e2}] = await Promise.all([
      sb.from('chat_groups').select('id'),
      sb.from('chat_group_reads').select('group_id, last_read_at').eq('member_key', 'driver:'+me.driver_id)
    ]);
    if (e1) throw e1;
    if (!groups?.length) return;
    const { data: msgs } = await sb.from('chat_group_messages').select('group_id, created_at').in('group_id', groups.map(g=>g.id)).order('created_at', {ascending:false}).limit(500);
    const lastByGroup = {};
    (msgs||[]).forEach(m => { if (!lastByGroup[m.group_id]) lastByGroup[m.group_id] = m.created_at; });
    const readByGroup = {};
    if (!e2) (reads||[]).forEach(r => { readByGroup[r.group_id] = r.last_read_at; });
    const unread = groups.some(g => { const last = lastByGroup[g.id]; if (!last) return false; const read = readByGroup[g.id]; return !read || read < last; });
    // dnt3（連絡タブ）は個別チャットの未読チェック(checkDriverOwnChatAlerts)とドットを共有するため、
    // こちらの結果だけでOFFにはせず、どちらかが未読なら点灯を保つ
    if (unread || !document.getElementById('dnt3')?.querySelector('.nav-warn-dot')) setNavWarnDot('dnt3', unread);
    setNavWarnDot('drvSubGroupChat3', unread);
  } catch(e) { console.warn('checkDriverOwnGroupChatAlerts:', e.message); }
}
function renderDocStatusBody() {
  const el = document.getElementById('docStatusBody');
  if (!el) return;
  const activeList = activeDrvs();
  if (!activeList.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">ドライバーが登録されていません</div>'; return; }
  const sorted = [...activeList].sort((a,b)=>{
    const na = parseInt(a.supplier_id,10)||999999, nb = parseInt(b.supplier_id,10)||999999;
    return na - nb;
  });
  const cellStyle = 'padding:6px 8px;border:0.5px solid var(--border);text-align:center';
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    <thead><tr style="background:var(--bg2)">
      <th style="${cellStyle};text-align:left">ドライバー</th>
      ${DRIVER_DOC_TYPES.map(t=>`<th style="${cellStyle}">${t.label}</th>`).join('')}
      <th style="${cellStyle}"></th>
    </tr></thead>
    <tbody>${sorted.map(d => `<tr>
      <td style="${cellStyle};text-align:left;font-weight:500">${escHtml(d.name)}</td>
      ${DRIVER_DOC_TYPES.map(t => {
        const doc = findDriverDoc(d.id, t.key);
        const clickable = !!doc?.file_path;
        return `<td style="${cellStyle}${clickable?';cursor:pointer' : ''}"${clickable?` onclick="viewDriverDoc(${d.id},'${t.key}')" title="クリックして書類を表示"`:''}>${docStatusPill(doc)}${doc?.expiry_date?`<div style="font-size:10px;color:var(--text2);margin-top:2px">${doc.expiry_date}</div>`:''}</td>`;
      }).join('')}
      <td style="${cellStyle}"><button class="ibtn" title="書類を開く" onclick="closeM('mDocStatus');openDrvDocsM(${d.id})">📄</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

/* ===== 支払明細書のポータル配信（正式版・既読管理付き） ===== */
// 配信用の明細書HTML: 印刷用と同じ内容だが自動印刷せず、画面上部に印刷ボタンを付ける
function buildStatementHtmlForDelivery(rows) {
  const d = buildStatementSheetData('payment', rows);
  const inner = buildStatementDocInner('payment', rows);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statementFileTitle('payment', d)}</title>
  <style>${getDocCss()}${statementDocStyle()}
  .dl-bar{text-align:right;padding:10px 16px}
  .dl-bar button{font-size:13px;padding:6px 14px;cursor:pointer}
  @media print{.dl-bar{display:none}}
  </style></head><body>
  <div class="dl-bar"><button onclick="window.print()">🖨 印刷 / PDF保存</button></div>
  <div class="doc-scale-wrap">
  ${inner}
  </div>
  <script>
  // スマホ画面ではA4デザインをそのまま(.docのpx幅は変えず)画面幅に合わせて縮小表示する。
  // PDFビューアの「幅に合わせる」表示と同じ考え方で、列幅・文字サイズを個別に変えないため
  // レイアウト崩れ（支払金額がはみ出る等）が起きない
  (function(){
    function fitDoc(){
      var doc = document.querySelector('.doc');
      var wrap = document.querySelector('.doc-scale-wrap');
      if (!doc || !wrap) return;
      if (window.innerWidth > 600) { doc.style.transform=''; wrap.style.height=''; return; }
      doc.style.transform = '';
      var naturalWidth = doc.offsetWidth;
      var naturalHeight = doc.offsetHeight;
      var scale = wrap.clientWidth / naturalWidth;
      doc.style.transformOrigin = 'top left';
      doc.style.transform = 'scale(' + scale + ')';
      wrap.style.height = (naturalHeight * scale) + 'px';
    }
    window.addEventListener('resize', fitDoc);
    window.addEventListener('orientationchange', fitDoc);
    window.addEventListener('load', fitDoc);
    // 印刷時は画面表示用の縮小(transform)を必ず解除する（CSS側のtransform:none!importantと二重の保険）。
    // 印刷が終わったら（キャンセル含む）画面表示用の縮小表示に戻す
    window.addEventListener('beforeprint', () => {
      const doc = document.querySelector('.doc');
      const wrap = document.querySelector('.doc-scale-wrap');
      if (doc) doc.style.transform = 'none';
      if (wrap) wrap.style.height = 'auto';
    });
    window.addEventListener('afterprint', fitDoc);
    fitDoc();
  })();
  <\/script>
  </body></html>`;
}

// pg6で選択したドライバーのポータルへ明細書を配信する
async function publishPayStatements() {
  const checked = Array.from(document.querySelectorAll('.aggPayChk:checked')).map(el=>+el.value);
  if (!checked.length) { alert('ドライバーを選択してください'); return; }
  const groups = checked.map(id => window._aggPayGroups?.[String(id)]).filter(g=>g?.rows?.length);
  if (!groups.length) { alert('対象データがありません'); return; }
  const month = (document.getElementById('aggPayFrom')?.value||'').slice(0,7);
  if (!confirm(`${groups.length}名のドライバーのポータルに支払明細書を配信しますか？\n対象月: ${month||'—'}\n※同じ月に配信済みのドライバーは最新の内容・レイアウトで上書きされます`)) return;
  showLoad(true);
  let ok = 0, fails = [];
  for (const g of groups) {
    try {
      const rows = g.rows.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      const d = buildStatementSheetData('payment', rows);
      const html = buildStatementHtmlForDelivery(rows);
      const path = `drv${g.drv.id}/${month||'unknown'}_${Date.now()}.html`;
      const {error: upErr} = await sb.storage.from('driver-statements').upload(path, new Blob([html], {type:'text/html'}), {contentType:'text/html'});
      if (upErr) throw upErr;
      // 同じドライバー×同じ月の配信済み明細書があれば上書き（重複配信を作らない）。
      // 明細書HTMLは配信時点の内容で固定保存されるため、レイアウト修正後の作り直しもこの再配信で行う
      const {data: exist} = await sb.from('driver_statements').select('id,file_path').eq('drv_id', g.drv.id).eq('month', month||'');
      if (exist?.length) {
        const keep = exist[0];
        const {error} = await sb.from('driver_statements').update({
          title: `${month||''}分 支払明細書（${d.docNo}）`,
          file_path: path, amount: d.summary.grand, published_by: me?.name||'',
          read_at: null,  // 内容が変わったので未読に戻す
        }).eq('id', keep.id);
        if (error) throw error;
        // 過去に重複して配信された行があれば整理し、置き換え済みの旧HTMLファイルも削除する
        const dupIds = exist.slice(1).map(x=>x.id);
        if (dupIds.length) await sb.from('driver_statements').delete().in('id', dupIds);
        const oldPaths = [...new Set(exist.map(x=>x.file_path).filter(p=>p&&p!==path))];
        if (oldPaths.length) await sb.storage.from('driver-statements').remove(oldPaths);
      } else {
        const {error} = await sb.from('driver_statements').insert({
          drv_id: g.drv.id, month: month||'', title: `${month||''}分 支払明細書（${d.docNo}）`,
          file_path: path, amount: d.summary.grand, published_by: me?.name||'',
        });
        if (error) throw error;
      }
      ok++;
      // LINE/メール通知（同じ月の再配信では通知を重複させない）
      notifyDrivers([g.drv.id], 'statement', `stmt-${g.drv.id}-${month}`, '支払明細書が届きました', `${month}分の支払明細書をポータルに配信しました。ログインしてご確認ください。`, true);
    } catch(e) { fails.push(`${g.drv.name}: ${e.message}`); }
  }
  showLoad(false);
  if (ok) addLog('明細書配信', `${month} ${ok}名`);
  if (fails.length) showT(`${ok}名に配信、${fails.length}件失敗: ${fails[0]}`, 'twa');
  else showT(`${ok}名のポータルに明細書を配信しました`);
}

// 管理側: 配信状況一覧
async function openStmtStatusM() {
  document.getElementById('mStmtStatus').classList.add('on');
  const el = document.getElementById('stmtStatusBody');
  el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">読み込み中...</div>';
  try {
    const {data, error} = await sb.from('driver_statements').select('*').order('created_at', {ascending:false}).limit(200);
    if (error) throw error;
    if (!data?.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text2);font-size:12px">配信済みの明細書はありません</div>'; return; }
    const cs = 'padding:6px 8px;border:0.5px solid var(--border)';
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:var(--bg2)">
        <th style="${cs}">配信日</th><th style="${cs}">ドライバー</th><th style="${cs}">対象月</th><th style="${cs};text-align:right">金額</th><th style="${cs}">既読</th><th style="${cs}">受領確認</th><th style="${cs}"></th>
      </tr></thead>
      <tbody>${data.map(s => {
        const ack = statementAckStatus(s);
        return `<tr>
        <td style="${cs}">${(s.created_at||'').slice(0,10)}</td>
        <td style="${cs};font-weight:500">${drvs.find(d=>d.id===s.drv_id)?.name||`ID:${s.drv_id}`}</td>
        <td style="${cs}">${s.month||'—'}</td>
        <td style="${cs};text-align:right">${yen(s.amount||0)}</td>
        <td style="${cs};text-align:center">${s.read_at
          ? `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--green-bg);color:var(--green-text)">既読 ${(s.read_at||'').slice(0,10)}</span>`
          : `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--amber-bg);color:var(--amber-text)">未読</span>`}</td>
        <td style="${cs};text-align:center">${ack.acked
          ? `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--green-bg);color:var(--green-text)">${ack.auto?'自動確認済み':'受領確認済み'}</span>`
          : `<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--red-bg);color:var(--red-text)">未確認</span>`}</td>
        <td style="${cs};text-align:center;white-space:nowrap">
          <button class="ibtn" title="内容を確認" onclick="viewStatementFile('${s.file_path}')">🔍</button>
          <button class="ibtn" style="color:#e05b5b" title="配信を取り消す" onclick="deleteStatement(${s.id},'${s.file_path}')">🗑</button>
        </td>
      </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch(e) { el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red-text);font-size:12px">読み込みエラー: ${e.message}</div>`; }
}
// Supabase Storageの署名付きURLはHTMLファイルでも安全のためContent-Type: text/plainで配信される。
// 直接window.open(signedUrl)すると生のソースがそのまま表示され文字化けもするため、
// fetchで本文を取得してから自分でウィンドウに書き込む（既存のPDF表示と同じ方式）
async function viewStatementFile(path) {
  const win = window.open('','_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'ter'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  try {
    const {data, error} = await sb.storage.from('driver-statements').createSignedUrl(path, 3600);
    if (error) throw error;
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error('ファイルの取得に失敗しました（' + res.status + '）');
    const html = await res.text();
    win.document.open(); win.document.write(html); win.document.close();
  } catch(e) { win.close(); showT('表示エラー: ' + e.message, 'ter'); }
}
async function deleteStatement(id, path) {
  if (!confirm('この明細書の配信を取り消しますか？（ドライバーからも見えなくなります）')) return;
  try {
    const {error} = await sb.from('driver_statements').delete().eq('id', id);
    if (error) throw error;
    if (path) await sb.storage.from('driver-statements').remove([path]);
    addLog('明細書配信取消', `id:${id}`);
    showT('配信を取り消しました');
    openStmtStatusM();
  } catch(e) { showT('取消エラー: ' + e.message, 'ter'); }
}

// 支払明細書の受領確認状態を判定する。ドライバー本人が押していなくても、
// 配信から2週間経過していれば「自動的に受領済み」扱いとする（催促の手間を減らすため）
const STATEMENT_AUTO_ACK_DAYS = 14;
function statementAckStatus(s) {
  if (s.acknowledged_at) return { acked:true, auto:false, label:`受領確認済み ${s.acknowledged_at.slice(0,10)}` };
  const days = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 86400000);
  if (days >= STATEMENT_AUTO_ACK_DAYS) return { acked:true, auto:true, label:`受領確認済み（自動・${STATEMENT_AUTO_ACK_DAYS}日経過）` };
  return { acked:false, auto:false, label:`未確認（配信後${days}日）` };
}
// ドライバーポータル側: 自分宛の明細書一覧（既読管理付き）
async function loadDriverStatements() {
  const el = document.getElementById('drvStmtList');
  if (!el || !me?.driver_id) return;
  try {
    const {data, error} = await sb.from('driver_statements').select('*').eq('drv_id', me.driver_id).order('created_at', {ascending:false}).limit(24);
    if (error) throw error;
    if (!data?.length) { el.innerHTML = '<span style="color:var(--text2)">配信された明細書はまだありません</span>'; return; }
    el.innerHTML = data.map(s => {
      const ack = statementAckStatus(s);
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;color:var(--text)">${s.title||s.month+'分 支払明細書'}</div>
        <div style="font-size:10px;color:var(--text2)">配信日: ${(s.created_at||'').slice(0,10)}　${yen(s.amount||0)}</div>
        <div style="font-size:10px;color:${ack.acked?'var(--green-text)':'var(--red-text)'};margin-top:2px">${ack.acked?'✓ ':'⚠ '}${ack.label}</div>
      </div>
      ${s.read_at ? '' : '<span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--red-bg);color:var(--red-text)">未読</span>'}
      <button class="btn sml pri" onclick="openDriverStatement(${s.id},'${s.file_path}',${s.read_at?'true':'false'})">📄 開く</button>
      <button class="btn sml" onclick="downloadDriverStatement(${s.id},'${escAttrJs(s.file_path||'')}','${escAttrJs(s.title||s.month+'分支払明細書')}',${s.read_at?'true':'false'})">⬇ ダウンロード</button>
      ${!s.acknowledged_at ? `<button class="btn sml" onclick="acknowledgeStatement(${s.id})">✓ 受領確認する</button>` : ''}
    </div>`;
    }).join('');
  } catch(e) { el.innerHTML = `<span style="color:var(--red-text)">読み込みエラー: ${e.message}</span>`; }
}
// ドライバー本人が支払明細書の内容を確認したことを明示的に記録するボタン。
// 押さなくても配信から2週間経つと自動的に受領済み扱いになるため、催促・未確認の取りこぼしを防げる
async function acknowledgeStatement(id) {
  if (!confirm('この支払明細書の内容を確認済みとして記録します。よろしいですか？')) return;
  try {
    // テーブルを直接更新すると金額や添付まで書き換えられてしまうため、
    // 既読・受領だけを立てるRPCを通す（自分の明細以外は1行も動かない）
    const {error} = await sb.rpc('mark_driver_statement', {p_id: id, p_ack: true});
    if (error) throw error;
    showT('受領確認しました。ご確認ありがとうございます');
    loadDriverStatements();
  } catch(e) { showT('更新エラー: ' + e.message, 'ter'); }
}
async function openDriverStatement(id, path, isRead) {
  const win = window.open('','_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'ter'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  try {
    const {data, error} = await sb.storage.from('driver-statements').createSignedUrl(path, 3600);
    if (error) throw error;
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error('ファイルの取得に失敗しました（' + res.status + '）');
    const html = await res.text();
    win.document.open(); win.document.write(html); win.document.close();
    if (!isRead) {
      await sb.rpc('mark_driver_statement', {p_id: id, p_ack: false});
      loadDriverStatements();
    }
  } catch(e) { win.close(); showT('表示エラー: ' + e.message, 'ter'); }
}

// 明細書HTML文字列を非表示iframeにレンダリングし、.doc単位（印刷CSSでA4 1ページ分に相当）で
// 1ページずつ画像化してPDFに追い込み、ファイルとしてダウンロードする（表示専用の「開く」とは別の導線）
async function exportHtmlToPdf(html, filename) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:1200px;border:0';
  document.body.appendChild(iframe);
  try {
    await new Promise((resolve) => { iframe.onload = resolve; iframe.srcdoc = html; });
    await new Promise(r => setTimeout(r, 300)); // 画像・フォント等の描画待ち
    const doc = iframe.contentDocument;
    const pages = doc.querySelectorAll('.doc');
    const targets = pages.length ? Array.from(pages) : [doc.body];
    const { jsPDF } = jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    for (let i = 0; i < targets.length; i++) {
      const canvas = await html2canvas(targets[i], { scale: 2, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = Math.min(pageH, canvas.height * pageW / canvas.width);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, imgH);
    }
    pdf.save(`${filename}.pdf`);
  } finally {
    document.body.removeChild(iframe);
  }
}
// ドライバーポータル: 支払明細書をPDFファイルとしてダウンロードする（印刷ボタンとは別導線。既読は「開く」と同様に付ける）
async function downloadDriverStatement(id, path, title, isRead) {
  showLoad(true);
  try {
    const {data, error} = await sb.storage.from('driver-statements').createSignedUrl(path, 3600);
    if (error) throw error;
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error('ファイルの取得に失敗しました（' + res.status + '）');
    const html = await res.text();
    await exportHtmlToPdf(html, title || '支払明細書');
    if (!isRead) {
      await sb.rpc('mark_driver_statement', {p_id: id, p_ack: false});
      loadDriverStatements();
    }
  } catch(e) { showT('ダウンロードエラー: ' + e.message, 'ter'); }
  showLoad(false);
}

async function loadDriverDailyList() {
  if (!sb || !me?.driver_id) return;
  const drvData = me.driver_data;
  const dCars = (drvData?.cars || []);
  const month = document.getElementById('drvDailyMonth')?.value || '';
  // 60件で打ち切っていたため、月で絞らずに開くと自分の過去の日報が途中から見えなかった。
  // RLSで自分の分しか返らず、1人あたり年に約250件なので全件読んで問題ない
  const build = () => {
    let q = sb.from('daily_reports').select('*').order('date', {ascending:false}).order('id', {ascending:false});
    if (dCars.length) q = q.in('car', dCars);
    if (month) { const [y,m]=month.split('-'); q=q.gte('date',`${y}-${m}-01`).lte('date',fmtLocalDate(new Date(+y,+m,0))); }
    return q;
  };
  try {
    const {data, error} = await fetchAllRows(build);
    if (error) throw error;
    // 編集ボタン（showDailyForm）はdailyReportsから該当行を探すため、ここでも共有配列に反映しておく
    dailyReports = data || [];
    const el = document.getElementById('drvDailyList');
    if (!el) return;
    if (!data?.length) { el.innerHTML='<div style="color:var(--text2);padding:20px;text-align:center;font-size:12px">日報がありません</div>'; return; }
    el.innerHTML = data.map(r => {
      const alcWarn = +r.alc_before>=0.15||+r.alc_after>=0.15;
      const inspFailed = ['tire','brake','light','wiper','engine','mirror','horn','battery','cargo','fuel']
        .some(k=>r['insp_'+k]===false);
      return `<div class="dr-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div>
            <div style="font-weight:500;font-size:12px">${r.date} ${r.status==='rejected'?'<span class="dr-status rejected">差戻し</span>':''}
              ${alcWarn?'<span style="color:var(--red);font-size:10px;margin-left:4px">🚨 ALC</span>':''}
              ${inspFailed?'<span style="color:var(--amber-text);font-size:10px;margin-left:4px">⚠ 点検</span>':''}
            </div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">
              走行${r.distance_km||0}km · 宅配便${r.qty_takkyubin||0} · ポスト便${r.qty_nekopos||0} · チャーター便${r.qty_charter||0}
            </div>
            ${r.note?`<div style="font-size:10px;color:var(--text2)">${escHtml(r.note)}</div>`:''}
          </div>
          <button class="ibtn" onclick="showDailyForm(${r.id})" title="編集">✎</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('drvDailyList').innerHTML = `<div style="color:var(--red);padding:12px;font-size:11px">${e.message}</div>`;
  }
}

async function renderDriverMonthly() {
  const drvData = me?.driver_data;
  if (!drvData) return;
  const month = document.getElementById('drvMrMonth')?.value || '';
  const el = document.getElementById('drvMonthlyBody');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text2);font-size:11px;padding:10px">読み込み中...</div>';
  try {
    const [y,m] = month.split('-');
    const {data, error} = await sb.from('daily_reports').select('*')
      .in('car', drvData.cars||[]).gte('date',`${y}-${m}-01`).lte('date',fmtLocalDate(new Date(+y,+m,0))).order('date');
    if (error) throw error;
    const reps = data||[];
    // 月報CSV出力（exportDriverMonthlyCsv）が「今表示中の月」を正しく参照できるよう、共有配列にも反映しておく
    dailyReports = reps;
    const totalKm = reps.reduce((a,r)=>a+(+r.distance_km||0),0);
    const totalTak = reps.reduce((a,r)=>a+(+r.qty_takkyubin||0),0);
    const totalNeko = reps.reduce((a,r)=>a+(+r.qty_nekopos||0),0);
    const totalCharter = reps.reduce((a,r)=>a+(+r.qty_charter||0),0);
    const workDays = new Set(reps.map(r=>r.date)).size;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
        <div class="kpi-card"><div class="kpi-label">稼働日数</div><div class="kpi-val">${workDays}日</div></div>
        <div class="kpi-card"><div class="kpi-label">走行距離</div><div class="kpi-val">${totalKm.toLocaleString()}km</div></div>
        <div class="kpi-card"><div class="kpi-label">配送個数</div><div class="kpi-val">${(totalTak+totalNeko).toLocaleString()}個</div></div>
      </div>
      <div class="pnl-row"><span>宅配便</span><span>${totalTak.toLocaleString()}個</span></div>
      <div class="pnl-row"><span>ポスト便</span><span>${totalNeko.toLocaleString()}個</span></div>
      <div class="pnl-row"><span>チャーター便</span><span>${totalCharter.toLocaleString()}件</span></div>
      <div style="margin-top:12px;border-top:0.5px solid var(--border);padding-top:8px">
        <div style="font-size:10px;color:var(--text2);margin-bottom:4px;font-weight:500">日別明細</div>
        ${reps.map(r=>`<div class="pnl-row sub"><span>${r.date}</span><span>${r.distance_km||0}km / 宅${r.qty_takkyubin||0} ポスト${r.qty_nekopos||0}</span></div>`).join('')}
      </div>`;
  } catch(e) { el.innerHTML = `<div style="color:var(--red);font-size:11px">${e.message}</div>`; }
}

function exportDriverMonthlyCsv() {
  // 管理画面用のexportDailyReportCsvは管理側の日付絞り込み欄（drListFrom等）を見るため、
  // ドライバーポータルでは選択中の月報タブの月（drvMrMonth）で自分のdailyReportsを直接絞り込む
  const month = document.getElementById('drvMrMonth')?.value || '';
  const list = month ? dailyReports.filter(r=>r.date&&r.date.startsWith(month)) : dailyReports;
  if (!list.length) { showT('対象の日報がありません', 'twa'); return; }
  downloadDailyReportCsv([...list].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.id-b.id)), month);
  showT('月報CSVをダウンロードしました');
}

// ドライバーポータル向けA4月報印刷。printMonthlyReportA4()と同じ日めくりレイアウトを使うが、
// 自分（me.driver_data）の分のみを対象とし、他ドライバーのデータには一切触れない。
async function printDriverMonthlyReportA4() {
  const d = me?.driver_data;
  if (!d) return;
  const month = document.getElementById('drvMrMonth')?.value || '';
  if (!month) { showT('対象月を選択してください', 'twa'); return; }
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStr = `${y}-${String(m).padStart(2,'0')}`;
  const monthFrom = `${monthStr}-01`;
  const monthTo = `${monthStr}-${String(lastDay).padStart(2,'0')}`;

  // await(データ取得)の後にwindow.open()すると、ブラウザがユーザー操作から切り離されたと
  // 判断してポップアップブロックする（特にSafari）ため、クリック時に空タブを先に開いておき、
  // データが揃ってからそのタブへ内容を書き込む
  const win = window.open('','_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'twa'); return; }

  let dReports = [];
  try {
    const {data, error} = await sb.from('daily_reports').select('*')
      .in('car', d.cars||[]).gte('date', monthFrom).lte('date', monthTo).order('date');
    if (error) throw error;
    dReports = data || [];
  } catch(e) { win.close(); showT('日報データの取得に失敗しました: ' + e.message, 'twa'); return; }

  if (!dReports.length) { win.close(); showT('対象月の日報データがありません', 'twa'); return; }

  const weekdayLabel = ['日','月','火','水','木','金','土'];
  const cAll = companySettings || {};
  const byDate = {};
  dReports.forEach(r => { byDate[r.date] = r; });

  const partner = lkCli(d.company_client_id);

  const drWorkDays = dReports.length;
  const drKm  = dReports.reduce((a,r)=>a+(+r.distance_km||0),0);
  const drTak = dReports.reduce((a,r)=>a+(+r.qty_takkyubin||0),0);
  const drNeko= dReports.reduce((a,r)=>a+(+r.qty_nekopos||0),0);
  const drChar= dReports.reduce((a,r)=>a+(+r.qty_charter||0),0);
  const drOtherQty=dReports.reduce((a,r)=>a+(+r.qty_other||0),0);

  const dayRows = [];
  for (let day=1; day<=lastDay; day++) {
    const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`;
    const wd = new Date(y, m-1, day).getDay();
    const holName = jpHolidayName(dateStr);
    const r = byDate[dateStr];
    const alcWarn = r && (+r.alc_before>=0.15||+r.alc_after>=0.15);
    const site = r ? lkC(r.cli) : null;
    const rowCls = alcWarn ? 'alc' : holName ? 'hol' : wd===0 ? 'sun' : wd===6 ? 'sat' : '';
    dayRows.push(`<tr${rowCls?` class="${rowCls}"`:''}>
      <td class="center"${holName?` title="${escHtml(holName)}"`:''}>${day}</td>
      <td class="center"${holName?` title="${escHtml(holName)}"`:''}>${weekdayLabel[wd]}</td>
      <td class="car">${r?escHtml(r.car||''):''}</td>
      <td class="center">${r&&(r.start_time||r.end_time)?`${r.start_time||'?'}-${r.end_time||'?'}`:''}</td>
      <td class="site" title="${r&&site?escHtml(site.name):''}">${r&&site?escHtml(site.short||site.name):''}</td>
      <td class="num">${r?(r.distance_km||0):''}</td>
      <td class="num">${r?(r.qty_takkyubin||0):''}</td>
      <td class="num">${r?(r.qty_nekopos||0):''}</td>
      <td class="num">${r?(r.qty_charter||0):''}</td>
      <td class="center">${r?`${r.alc_before??'—'}/${r.alc_after??'—'}`:''}</td>
      <td class="center">${r?({good:'良',normal:'普',bad:'不'}[r.health_before||'good']):''}</td>
      <td class="center">${r&&r.status==='rejected'?'差戻し':''}</td>
    </tr>`);
  }

  const page = `<div class="mr-page">
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
        <th style="width:4%">日</th><th style="width:4%">曜</th><th style="width:11%">車番</th><th style="width:11%">稼働時間</th><th style="width:13%">稼働先</th><th style="width:8%">走行km</th><th style="width:8%">宅配便</th><th style="width:8%">ポスト便</th><th style="width:8%">チャーター便</th><th style="width:11%">Alc前/後</th><th style="width:6%">体調</th><th style="width:8%">状態</th>
      </tr></thead>
      <tbody>${dayRows.join('')}</tbody>
    </table>
  </div>`;

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
    table.mr-table th,table.mr-table td{border:1px solid #666;padding:2px 3px}
    table.mr-table th{background:#eee;font-weight:600}
    table.mr-table td.num{text-align:right}
    table.mr-table td.center{text-align:center}
    table.mr-table td.car,table.mr-table td.site{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    tr.sun td:first-child,tr.sun td:nth-child(2){color:#c0392b}
    tr.sat td:first-child,tr.sat td:nth-child(2){color:#2874a6}
    tr.hol td:first-child,tr.hol td:nth-child(2){color:#c0392b;font-weight:700}
    tr.alc{background:#fdeaea}
  </style></head><body>
  ${page}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  writeStatementWindow(win, () => html);
}

/* ===== 掲示板 ===== */
let boardPosts = [];

// markSeen=true: このタブを実際に開いたときに呼び、既読位置（localStorage）を更新する
async function loadBoard(markSeen) {
  if (!sb) return;
  try {
    const {data, error} = await sb.from('board_posts').select('*').order('created_at', {ascending:false}).limit(50);
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) {
        const el = document.getElementById('boardList');
        if (el) el.innerHTML = '<div style="padding:16px;color:var(--amber-text);font-size:12px">⚠ board_postsテーブルが未作成です。<br>月次締めページのバックアップからSQLを確認できます。<button class="btn sml" style="margin-top:6px" onclick="showBoardSql()">SQL確認</button></div>';
        return;
      }
      throw error;
    }
    boardPosts = data || [];
    renderBoardTo('boardList');
    renderBoardTo('drvBoardList');
    if (markSeen) markBoardSeen();
    // 投稿ボタンは管理者/editorのみ
    const bBtn = document.getElementById('bBoardPost');
    if (bBtn) bBtn.style.display = me&&(me.role==='admin'||me.role==='editor') ? 'block' : 'none';
  } catch(e) {
    const el = document.getElementById('boardList');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:11px;padding:12px">${e.message}</div>`;
  }
}
// 掲示板の既読位置はユーザーごとにブラウザのlocalStorageで管理する（既読管理用のテーブルは持たない簡易実装）
function boardSeenKey() { return `pgbase_board_seen_${me?.id||''}`; }
function markBoardSeen() {
  if (!me || !boardPosts.length) return;
  localStorage.setItem(boardSeenKey(), boardPosts[0].created_at || new Date().toISOString());
}
// 予約投稿(publish_at)がまだ先の場合はtrue（＝まだ公開されていない）
function isBoardPostPending(p) { return !!p.publish_at && new Date(p.publish_at) > new Date(); }

// ログイン時に新着の掲示板投稿があればトーストで知らせる（まだ公開時刻が来ていない予約投稿は対象外）
async function checkBoardAlerts() {
  if (!sb || !me) return null;
  await loadBoard();
  if (!boardPosts.length) return null;
  const lastSeen = localStorage.getItem(boardSeenKey()) || '';
  const unseen = boardPosts.filter(p => !isBoardPostPending(p) && (p.created_at||'') > lastSeen);
  if (!unseen.length) return null;
  return `📢 新着の掲示板投稿が${unseen.length}件あります: ${unseen[0].title}`;
}

function renderBoardTo(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const isDrvView = elId === 'drvBoardList';
  // ドライバー側は「全員」または自分（drv_id）が対象に含まれる投稿のみ、かつ予約投稿は公開時刻が来たものだけを表示する。
  // 管理側は絞り込み・予約状況の確認のため、未公開の予約投稿も含め全件表示する
  const list = isDrvView
    ? boardPosts.filter(p => !isBoardPostPending(p) && (!(p.target_driver_ids||[]).length || (p.target_driver_ids||[]).includes(me?.driver_id)))
    : boardPosts;
  if (!list.length) { el.innerHTML='<div style="text-align:center;padding:28px;color:var(--text2);font-size:12px">投稿がありません</div>'; return; }
  const canDel = me && (me.role==='admin'||me.role==='editor');
  el.innerHTML = list.map(p => {
    const pending = isBoardPostPending(p);
    const priColor = p.priority==='urgent'?'var(--red)':p.priority==='important'?'var(--amber-text)':'var(--blue)';
    const priLabel = {urgent:'緊急',important:'重要',normal:'通常'}[p.priority||'normal'];
    const dt = p.created_at ? new Date(p.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    const targetCnt = (p.target_driver_ids||[]).length;
    const targetNames = targetCnt ? drvs.filter(d=>p.target_driver_ids.includes(d.id)).map(d=>d.name).join('、') : '';
    return `<div style="border:0.5px solid ${p.priority==='urgent'?'var(--red)':p.priority==='important'?'var(--amber-border)':'var(--border)'};border-radius:var(--radius-lg);padding:10px 12px;margin-bottom:8px;background:var(--bg)${p.priority==='urgent'?';background:var(--red-bg)':''}${pending?';opacity:0.65':''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:8px">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
          <span style="font-size:10px;padding:1px 6px;border-radius:99px;border:0.5px solid ${priColor};color:${priColor}">${priLabel}</span>
          ${pending?`<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:var(--amber-bg);color:var(--amber-text)" title="この投稿はドライバーにはまだ表示されません">⏰ 予約中: ${new Date(p.publish_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          ${p.recurrence_id?`<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:var(--bg2);color:var(--text2)" title="繰り返し投稿の一部です">🔁 繰り返し</span>`:''}
          ${targetCnt?`<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:var(--bg2);color:var(--text2)" title="${escHtml(targetNames)}">🎯 ${targetCnt}名限定</span>`:''}
          <span style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.title)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:10px;color:var(--text2)">${escHtml(p.author)} ${dt}</span>
          ${canDel?`<button class="ibtn" style="color:var(--red)" onclick="deleteBoardPost(${p.id})">🗑</button>`:''}
        </div>
      </div>
      <div style="font-size:12px;white-space:pre-wrap;line-height:1.6">${escHtml(p.body)}</div>
      ${p.attachment_path?`<button class="btn sml" style="margin-top:6px" onclick="openBoardAttachment('${escHtml(p.attachment_path)}')">📎 ${escHtml(p.attachment_name||'添付ファイル')}</button>`:''}
    </div>`;
  }).join('');
}

// 掲示板の配属先絞り込み（対象ドライバーのIDの集合）。投稿モーダルを開いている間だけ保持する一時状態
let pendBoardTargetIds = new Set();
function renderBoardTargetDrvList() {
  const listEl = document.getElementById('boardTargetDrvList');
  const cntEl = document.getElementById('boardTargetCount');
  if (!listEl) return;
  const sorted = [...activeDrvs()].sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999));
  listEl.innerHTML = sorted.map(d => `<label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;cursor:pointer">
    <input type="checkbox" style="width:auto" ${pendBoardTargetIds.has(d.id)?'checked':''} onchange="toggleBoardTargetDrv(${d.id})">${escHtml(d.name)}${d.company?`<span style="color:var(--text2);font-size:10.5px">（${escHtml(d.company)}）</span>`:''}
  </label>`).join('') || '<div style="font-size:11px;color:var(--text2)">ドライバーが登録されていません</div>';
  cntEl.textContent = pendBoardTargetIds.size ? `${pendBoardTargetIds.size}名を選択中（未選択の場合は全員に表示されます）` : '未選択（全員に表示）';
}
function toggleBoardTargetDrv(id) {
  if (pendBoardTargetIds.has(id)) pendBoardTargetIds.delete(id); else pendBoardTargetIds.add(id);
  renderBoardTargetDrvList();
}
function clearBoardTarget() { pendBoardTargetIds = new Set(); renderBoardTargetDrvList(); }
// 選択した取引先向けの実績（invoices.cli）がある車番から、紐づくドライバーを選出する
async function selectBoardTargetByClient() {
  const cliId = +document.getElementById('boardTargetClientSel')?.value || null;
  if (!cliId) { alert('取引先を選択してください'); return; }
  try {
    // 1取引先で1000件を超えるため、ここも読み継がないと車番を取りこぼす
    const { data, error } = await fetchAllRows(()=>sb.from('invoices').select('car').eq('cli', cliId).order('id'));
    if (error) throw error;
    const cars = [...new Set((data||[]).map(r=>r.car).filter(Boolean))];
    pendBoardTargetIds = new Set(drvs.filter(d => (d.cars||[]).some(c => cars.some(rc=>nm(rc)===nm(c)))).map(d=>d.id));
    renderBoardTargetDrvList();
    showT(`${pendBoardTargetIds.size}名を選出しました`);
  } catch(e) { showT('選出エラー: '+e.message, 'ter'); }
}

function openBoardPost() {
  document.getElementById('boardTitle').value='';
  document.getElementById('boardBody').value='';
  document.getElementById('boardPriority').value='normal';
  const fileEl = document.getElementById('boardAttachFile');
  if (fileEl) fileEl.value = '';
  const nameEl = document.getElementById('boardAttachName');
  if (nameEl) nameEl.textContent = '';
  const schedChk = document.getElementById('boardScheduleOn');
  if (schedChk) schedChk.checked = false;
  const schedAt = document.getElementById('boardScheduleAt');
  if (schedAt) { schedAt.value = ''; schedAt.style.display = 'none'; }
  const recurChk = document.getElementById('boardRecurOn');
  if (recurChk) recurChk.checked = false;
  const recurFld = document.getElementById('boardRecurFld');
  if (recurFld) recurFld.style.display = 'none';
  ['boardRecurStart','boardRecurEndDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('boardRecurInterval').value = '1';
  document.getElementById('boardRecurUnit').value = 'week';
  document.getElementById('boardRecurEndCount').value = '4';
  const cliSel = document.getElementById('boardTargetClientSel');
  if (cliSel) { cliSel.innerHTML = '<option value="">取引先を選択</option>' + [...clients].sort((a,b)=>nm(a.name).localeCompare(nm(b.name),'ja')).map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join(''); enhanceSelectSearchable('boardTargetClientSel'); }
  pendBoardTargetIds = new Set();
  renderBoardTargetDrvList();
  document.getElementById('mBoard').classList.add('on');
}

// 予約投稿と繰り返し投稿は同時に使う意味がないため、片方をONにしたらもう片方は自動でOFFにする
function onBoardScheduleToggle() {
  const on = document.getElementById('boardScheduleOn').checked;
  document.getElementById('boardScheduleAt').style.display = on ? '' : 'none';
  if (on) {
    document.getElementById('boardRecurOn').checked = false;
    document.getElementById('boardRecurFld').style.display = 'none';
  }
}
function onBoardRecurToggle() {
  const on = document.getElementById('boardRecurOn').checked;
  document.getElementById('boardRecurFld').style.display = on ? 'flex' : 'none';
  if (on) {
    document.getElementById('boardScheduleOn').checked = false;
    document.getElementById('boardScheduleAt').style.display = 'none';
  }
}
// 開始日時から間隔ごとに繰り返す投稿日時の一覧を計算する（無限ループ防止のため最大24件でも打ち切る）
const BOARD_RECUR_MAX = 24;
function computeBoardRecurDates(startVal, interval, unit, endType, endDate, endCount) {
  const dates = [];
  let cur = new Date(startVal);
  while (dates.length < BOARD_RECUR_MAX) {
    if (endType === 'date' && endDate && fmtLocalDate(cur) > endDate) break;
    dates.push(new Date(cur));
    if (endType === 'count' && dates.length >= endCount) break;
    if (unit === 'day') cur.setDate(cur.getDate() + interval);
    else if (unit === 'week') cur.setDate(cur.getDate() + interval*7);
    else cur.setMonth(cur.getMonth() + interval);
  }
  return dates;
}

async function submitBoardPost() {
  const title = document.getElementById('boardTitle').value.trim();
  const body = document.getElementById('boardBody').value.trim();
  const priority = document.getElementById('boardPriority').value;
  const targetIds = pendBoardTargetIds.size ? [...pendBoardTargetIds] : null;
  const file = document.getElementById('boardAttachFile')?.files?.[0] || null;
  if (!title||!body) { alert('タイトルと本文は必須です'); return; }

  const scheduleOn = document.getElementById('boardScheduleOn')?.checked;
  let publish_at = null;
  if (scheduleOn) {
    const v = document.getElementById('boardScheduleAt')?.value;
    if (!v) { alert('予約する日時を選択してください'); return; }
    const d = new Date(v);
    if (d <= new Date()) { alert('予約日時は未来の日時を指定してください'); return; }
    publish_at = d.toISOString();
  }

  const recurOn = document.getElementById('boardRecurOn')?.checked;
  let recurDates = null;
  if (recurOn) {
    const startVal = document.getElementById('boardRecurStart').value;
    if (!startVal) { alert('繰り返し投稿の開始日時を入力してください'); return; }
    const interval = +document.getElementById('boardRecurInterval').value || 1;
    const unit = document.getElementById('boardRecurUnit').value;
    const endType = document.querySelector('input[name="boardRecurEndType"]:checked').value;
    const endDate = document.getElementById('boardRecurEndDate').value;
    const endCount = +document.getElementById('boardRecurEndCount').value || 1;
    if (endType === 'date' && !endDate) { alert('繰り返しの終了日を入力してください'); return; }
    recurDates = computeBoardRecurDates(startVal, interval, unit, endType, endDate, endCount);
    if (!recurDates.length) { alert('繰り返し条件を確認してください（終了日が開始日時より前になっていないか等）'); return; }
  }

  showLoad(true);
  try {
    let attachment_path = null, attachment_name = null;
    if (file) {
      const path = `${Date.now()}_${file.name}`;
      const { error: upErr } = await sb.storage.from('board-attachments').upload(path, file);
      if (upErr) throw new Error('添付ファイルのアップロードに失敗しました: ' + upErr.message);
      attachment_path = path; attachment_name = file.name;
    }
    if (recurOn) {
      const recurrence_id = `rec_${Date.now()}`;
      const rows = recurDates.map(d => ({title,body,priority,author:me?.name||'',target_driver_ids:targetIds,attachment_path,attachment_name,publish_at:d.toISOString(),recurrence_id}));
      const {data, error} = await sb.from('board_posts').insert(rows).select();
      if (error) throw error;
      boardPosts = [...data, ...boardPosts].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
      closeM('mBoard');
      renderBoardTo('boardList');
      addLog('掲示板投稿（繰り返し）', `${title}（${recurDates.length}件）`);
      showT(`繰り返し投稿を${recurDates.length}件登録しました`);
    } else {
      const {data, error} = await sb.from('board_posts').insert({title,body,priority,author:me?.name||'',target_driver_ids:targetIds,attachment_path,attachment_name,publish_at}).select().single();
      if (error) throw error;
      boardPosts.unshift(data);
      closeM('mBoard');
      renderBoardTo('boardList');
      addLog('掲示板投稿', title + (publish_at?`（予約: ${new Date(publish_at).toLocaleString('ja-JP')}）`:''));
      showT(publish_at ? `予約投稿しました（${new Date(publish_at).toLocaleString('ja-JP')}に公開）` : '投稿しました');
      // 即時公開の投稿はLINE/メール通知も送る（予約・繰り返し投稿は公開タイミングが未来のため対象外）
      if (!publish_at) {
        const notifyIds = targetIds || drvs.map(d=>d.id);
        notifyDrivers(notifyIds, 'board', `post-${data.id}`, `掲示板: ${title}`, body.length>200?body.slice(0,200)+'…':body);
      }
    }
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

async function openBoardAttachment(path) {
  // signedUrl取得(await)の後にwindow.open()すると、ブラウザがユーザー操作から切り離されたと
  // 判断してポップアップブロックする（特にSafari）ため、クリック時に空タブを先に開いておき、
  // 取得後にそのタブへ遷移させる
  const win = window.open('', '_blank');
  if (!win) { showT('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください', 'twa'); return; }
  // 元のタブと切り離し、PDFタブを閉じた後に元画面の操作が効かなくなる問題を防ぐ
  try { win.opener = null; } catch(_) {}
  try {
    const { data, error } = await sb.storage.from('board-attachments').createSignedUrl(path, 3600);
    if (error) throw error;
    win.location.href = data.signedUrl;
  } catch(e) { win.close(); showT('表示エラー: ' + e.message, 'ter'); }
}

async function deleteBoardPost(id) {
  const post = boardPosts.find(p=>p.id===id);
  if (!post) return;
  // 繰り返し投稿の一つなら、この1件だけ消すか、シリーズ全体を消すか選べるようにする
  let deleteWholeSeries = false;
  if (post.recurrence_id) {
    const seriesCount = boardPosts.filter(p=>p.recurrence_id===post.recurrence_id).length;
    deleteWholeSeries = confirm(`この投稿は繰り返し投稿の一部です（全${seriesCount}件）。\n\nOK: 未公開分も含めシリーズ全体を削除\nキャンセル: この投稿だけ削除するか選び直す`);
    if (!deleteWholeSeries && !confirm('この投稿だけ削除しますか？')) return;
  } else if (!confirm('この投稿を削除しますか？')) return;
  try {
    const targets = deleteWholeSeries ? boardPosts.filter(p=>p.recurrence_id===post.recurrence_id) : [post];
    const ids = targets.map(p=>p.id);
    const {error} = await sb.from('board_posts').delete().in('id', ids);
    if (error) throw error;
    const attachPaths = [...new Set(targets.map(p=>p.attachment_path).filter(Boolean))];
    if (attachPaths.length) await sb.storage.from('board-attachments').remove(attachPaths);
    boardPosts = boardPosts.filter(p=>!ids.includes(p.id));
    renderBoardTo('boardList');
    renderBoardTo('drvBoardList');
    addLog('掲示板削除', deleteWholeSeries ? `シリーズ全体 ${ids.length}件` : 'id:'+id);
    showT(deleteWholeSeries ? `シリーズ全体（${ids.length}件）を削除しました` : '削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}


function showSchedSql() { openSetupSqlGuide('payment_schedules'); }
function showBoardSql() {
  const sql = `-- board_posts テーブル作成SQL
CREATE TABLE IF NOT EXISTS board_posts (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  body text,
  priority text DEFAULT 'normal',
  author text,
  created_at timestamptz DEFAULT now(),
  target_driver_ids integer[],
  attachment_path text,
  attachment_name text,
  publish_at timestamptz,
  recurrence_id text
);
ALTER TABLE board_posts ENABLE ROW LEVEL SECURITY;
-- ドライバーは「公開済み かつ 自分宛（または全員宛）」の投稿のみ。管理側ロールは全件
CREATE POLICY "board_posts_select" ON board_posts FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR ((publish_at IS NULL OR publish_at <= now()) AND (target_driver_ids IS NULL OR cardinality(target_driver_ids) = 0 OR (SELECT driver_id FROM users WHERE auth_uid = auth.uid()) = ANY(target_driver_ids))));
CREATE POLICY "board_posts_insert" ON board_posts FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
CREATE POLICY "board_posts_update" ON board_posts FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
CREATE POLICY "board_posts_delete" ON board_posts FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));`;
  const win = window.open('','_blank','width=660,height=400');
  win.document.write(`<html><body style="font-family:monospace;padding:20px"><h3>SQL Editor で実行</h3><pre style="background:#f5f5f5;padding:12px;font-size:12px">${sql}</pre><button onclick="navigator.clipboard.writeText(\`${sql}\`)">コピー</button></body></html>`);
}

// ダッシュボード・年報で共通の年選択セレクトを構築（includeAll=trueなら「全期間」を先頭に追加）
function populateYearSelect(selId, includeAll) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const cur = sel.value;
  const now = new Date().getFullYear();
  const years = [...new Set(recs.map(r=>r.date?.slice(0,4)).filter(Boolean))].sort().reverse();
  if (!years.includes(String(now))) years.unshift(String(now));
  const opts = (includeAll ? ['<option value="">全期間</option>'] : []).concat(
    years.map(y=>`<option value="${y}">${y}年</option>`)
  );
  sel.innerHTML = opts.join('');
  // 「全期間」は選択肢としては残すが、初期表示は現在の年を既定にする（年間サマリー等をすぐ見られるように）
  sel.value = cur || String(now);
}

/* ===== 年報（ダッシュボードに統合済み。年を選択したときだけ年間サマリー＋月次実績を表示する） ===== */
// 指定年の年間集計を1パスで作る（月別売上・件数、ドライバー別の月次内訳）。
// KPI・マトリクス表・CSVで共有し、レコード数×ドライバー数×12回の走査を避ける
// cliFilter を渡すとドライバー別集計(drvRows)だけをその取引先の実績に絞り込む（月別合計・取引先別集計は常に全体）
function buildYearStats(year, cliFilter) {
  const monthlyAmt = new Array(12).fill(0), monthlyCnt = new Array(12).fill(0);
  const byDrv = new Map(); // drv.id -> { d, amts:[12] }
  const byCli = new Map(); // cli.id -> { c, amts:[12] }
  recs.forEach(r => {
    if (!r.date?.startsWith(year)) return;
    const mi = +r.date.slice(5,7) - 1;
    if (mi < 0 || mi > 11) return;
    const amt = totR(r,'inc');
    monthlyAmt[mi] += amt; monthlyCnt[mi]++;
    const c = lkC(r.cli);
    if (c) {
      if (!byCli.has(c.id)) byCli.set(c.id, { c, amts: new Array(12).fill(0) });
      byCli.get(c.id).amts[mi] += amt;
    }
    if (cliFilter!=null && cliFilter!=='' && r.cli!==cliFilter) return;
    const d = recDrv(r);
    if (!d) return;
    if (!byDrv.has(d.id)) byDrv.set(d.id, { d, amts: new Array(12).fill(0) });
    byDrv.get(d.id).amts[mi] += amt;
  });
  const drvRows = [...byDrv.values()].sort((a,b)=>(a.d.supplier_id||'999').localeCompare(b.d.supplier_id||'999'));
  const cliRows = [...byCli.values()].sort((a,b)=>(parseInt(a.c.client_no,10)||999999)-(parseInt(b.c.client_no,10)||999999));
  return { monthlyAmt, monthlyCnt, drvRows, cliRows };
}

// 前年・前月など「過去との比較」表示で共通利用する差分バッジ（▲/▼と増減率・増減件数）
function periodDiffBadge(diff, pct, unit, eqLabel) {
  if (diff === 0) return `<span class="kpi-eq">— ${eqLabel}</span>`;
  const cls = diff>0 ? 'kpi-up' : 'kpi-dn', arrow = diff>0 ? '▲' : '▼';
  const pctPart = (pct!=null && isFinite(pct) && pct!==0) ? `${pct>0?'+':''}${pct}% ` : '';
  return `<span class="${cls}">${arrow} ${pctPart}${unit==='yen'?yen(Math.abs(diff)):Math.abs(diff)+'件'}</span>`;
}

function setYrDrvCliFilter(v){ yrDrvCliFilter = v ? +v : ''; renderDrvAnalysis(); }
function setAnaCliCompareYear(v){ anaCliCompareYear = +v; renderCliAnalysis(); }
function setAnaDrvCompareYear(v){ anaDrvCompareYear = +v; renderDrvAnalysis(); }

// 実績データが存在する年の一覧（比較年セレクトの選択肢作成に使用）
function allDataYears(){
  return [...new Set(recs.map(r=>r.date?.slice(0,4)).filter(Boolean).map(Number))].sort((a,b)=>a-b);
}
// 「比較年」セレクトのHTML。表示中の期間に関係なく実績のある全年から任意の年（例: 2020と2026）を選んで比較できるようにする
function compareYearSelectHtml(id, onchangeFn, currentYear, selectedCompareYear){
  const years = allDataYears();
  if (!years.includes(+currentYear)) years.push(+currentYear);
  years.sort((a,b)=>b-a);
  const opts = years.map(yr=>`<option value="${yr}" ${selectedCompareYear===yr?'selected':''}>${yr}年</option>`).join('');
  return `<select id="${id}" onchange="${onchangeFn}(this.value)" style="padding:3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)" title="任意の年を選んで比較できます">${opts}</select>`;
}
// 単月（1ヶ月分）の前年比・前月比を計算。prevAmtsは1年前の12ヶ月分の金額（無ければnull扱い）
function monthlyYoyMomPcts(amts, prevAmts){
  const yoyPcts = amts.map((v,i)=>{
    const p = prevAmts ? prevAmts[i] : 0;
    return p>0 ? Math.round((v-p)/p*100) : null;
  });
  const momPcts = amts.map((v,i)=>{
    const p = i===0 ? (prevAmts ? prevAmts[11] : 0) : amts[i-1];
    return p>0 ? Math.round((v-p)/p*100) : null;
  });
  return { yoyPcts, momPcts };
}
// 月次マトリクス表のセルに添える前年比・前月比の小さな表示（金額の下に一行で）
function monthCellPctLine(yoyPct, momPct){
  const part = (label, pct) => pct==null ? '' : `<span class="${pct>0?'kpi-up':pct<0?'kpi-dn':'kpi-eq'}">${label}${pct>0?'+':''}${pct}%</span>`;
  const y = part('前年', yoyPct), m = part('前月', momPct);
  if (!y && !m) return '';
  return `<div style="font-size:8.5px;line-height:1.5;white-space:nowrap">${y}${y&&m?' ':''}${m}</div>`;
}

// ドライバー別・取引先別の12ヶ月マトリクス表（右端に合計列・下端に合計行）を共通生成
// opts: { prevAmtsById: Map(id->前年12ヶ月分) で単月の前年比・前月比を表示、compareYear/compareTotalsById: Map(id->年間合計) で年間合計の比較列を表示（省略時は列自体を出さない）
function monthMatrixTableHtml(rows, rowLabelHeader, emptyMsg, opts={}) {
  const { prevAmtsById=null, compareYear=null, compareTotalsById=null } = opts;
  const cell = 'padding:5px 4px;text-align:right;border-bottom:0.5px solid var(--border)';
  if (!rows.length) return `<div style="color:var(--text2);font-size:11px;padding:6px 0">${emptyMsg}</div>`;
  const colTotals = new Array(12).fill(0);
  rows.forEach(r => r.amts.forEach((v,i)=>colTotals[i]+=v));
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap">
    <thead><tr style="background:var(--bg2)">
      <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">${rowLabelHeader}</th>
      ${Array.from({length:12},(_,i)=>`<th style="${cell}">${i+1}月</th>`).join('')}
      <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">合計</th>
      ${compareYear!=null?`<th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">${compareYear}年比</th>`:''}
    </tr></thead>
    <tbody>${rows.map(r => {
      const prevAmts = prevAmtsById ? prevAmtsById.get(r.id) : null;
      const { yoyPcts, momPcts } = monthlyYoyMomPcts(r.amts, prevAmts);
      const total = r.amts.reduce((a,v)=>a+v,0);
      const compareTotal = compareTotalsById ? compareTotalsById.get(r.id) : null;
      const cmpDiff = compareTotal!=null ? total-compareTotal : null;
      const cmpPct = (compareTotal!=null && compareTotal>0) ? Math.round(cmpDiff/compareTotal*100) : null;
      return `<tr>
      <td style="padding:5px 8px;border-bottom:0.5px solid var(--border);font-weight:500">${escHtml(r.label)}</td>
      ${r.amts.map((v,i)=>`<td style="${cell}"><div style="font-size:10px">${v?yen(v):''}</div>${monthCellPctLine(yoyPcts[i],momPcts[i])}</td>`).join('')}
      <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-weight:600">${yen(total)}</td>
      ${compareYear!=null?`<td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-size:10px">${compareTotal!=null?periodDiffBadge(cmpDiff,cmpPct,'yen',`${compareYear}年と同額`):'<span style="color:var(--text2)">—</span>'}</td>`:''}
    </tr>`;
    }).join('')}</tbody>
    <tfoot><tr style="font-weight:600;background:var(--bg2)">
      <td style="padding:5px 8px">合計</td>
      ${colTotals.map(v=>`<td style="${cell};font-size:10px">${v?yen(v):''}</td>`).join('')}
      <td style="padding:5px 8px;text-align:right">${yen(colTotals.reduce((a,v)=>a+v,0))}</td>
      ${compareYear!=null?'<td></td>':''}
    </tr></tfoot>
  </table></div>`;
}

function setDashYearSpan(v){ dashYearSpan = v==='all' ? 'all' : +v; renderDash(); }
function setDashCompareYear(v){ dashCompareYear = +v; renderDash(); }

// 選択中の対象年（year）を基準に、表示期間内の各年がどれだけ増減しているかを横並びで比較できる一覧表
function buildFiveYearTableHtml(year) {
  const y = +year;
  let years;
  if (dashYearSpan === 'all') {
    const allYears = [...new Set(recs.map(r=>r.date?.slice(0,4)).filter(Boolean).map(Number))];
    const minYear = allYears.length ? Math.min(...allYears, y) : y;
    years = Array.from({length: Math.max(1,y-minYear+1)}, (_,i) => minYear+i);
  } else {
    years = Array.from({length:dashYearSpan}, (_,i) => y-dashYearSpan+1+i);
  }
  const cell = 'padding:5px 4px;text-align:right;border-bottom:0.5px solid var(--border)';
  const rows = years.map(yr => {
    const { monthlyAmt } = buildYearStats(String(yr));
    return { yr, monthlyAmt, total: monthlyAmt.reduce((a,v)=>a+v,0) };
  });
  // 各行の単月・前年比を出すため、表示範囲より前の年（最古年-1）が要る場合だけ追加取得する
  const monthlyAmtByYear = new Map(rows.map(r=>[r.yr, r.monthlyAmt]));
  const minDisplayedYear = years[0];
  if (!monthlyAmtByYear.has(minDisplayedYear-1)) {
    monthlyAmtByYear.set(minDisplayedYear-1, buildYearStats(String(minDisplayedYear-1)).monthlyAmt);
  }
  const colTotals = new Array(12).fill(0);
  rows.forEach(r=>r.monthlyAmt.forEach((v,i)=>colTotals[i]+=v));
  const hasAny = rows.some(r=>r.total>0);
  // 年間合計の比較基準年（未選択なら現在表示中の年）。表示範囲外の年（例: 2020）も選べるようにする
  const compareYear = dashCompareYear || y;
  const compareRow = rows.find(r=>r.yr===compareYear);
  const baseTotal = compareRow ? compareRow.total : buildYearStats(String(compareYear)).monthlyAmt.reduce((a,v)=>a+v,0);
  const spanOptions = [3,5,10].map(n=>`<option value="${n}" ${dashYearSpan===n?'selected':''}>${n}年</option>`).join('')
    + `<option value="all" ${dashYearSpan==='all'?'selected':''}>全期間</option>`;
  return `<div class="cwrap" style="grid-column:1/-1">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;flex-wrap:wrap;gap:10px">
      <div class="ctitle" style="margin-bottom:0">📊 全体売上表（${years[0]}〜${years[years.length-1]}年・税込）</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">比較年 ${compareYearSelectHtml('dashCompareYearSel','setDashCompareYear', y, compareYear)}</div>
        <select onchange="setDashYearSpan(this.value)" style="padding:3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
          ${spanOptions}
        </select>
      </div>
    </div>
    ${hasAny ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap">
      <thead><tr style="background:var(--bg2)">
        <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">年</th>
        ${Array.from({length:12},(_,i)=>`<th style="${cell}">${i+1}月</th>`).join('')}
        <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">年間合計</th>
        <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">${compareYear}年比</th>
      </tr></thead>
      <tbody>${rows.map(r=>{
        const diff = r.total-baseTotal;
        const pct = baseTotal>0 ? Math.round(diff/baseTotal*100) : null;
        const prevAmts = monthlyAmtByYear.get(r.yr-1);
        const { yoyPcts, momPcts } = monthlyYoyMomPcts(r.monthlyAmt, prevAmts);
        const rowStyle = r.yr===y ? ' style="background:var(--blue-bg)"' : (r.yr===compareYear ? ' style="background:var(--amber-bg)"' : '');
        return `<tr${rowStyle}>
          <td style="padding:5px 8px;border-bottom:0.5px solid var(--border);font-weight:500">${r.yr}年${r.yr===compareYear?' <span style="font-size:9px;color:var(--text2)">(比較基準)</span>':''}</td>
          ${r.monthlyAmt.map((v,i)=>`<td style="${cell}"><div style="font-size:10px">${v?yen(v):''}</div>${monthCellPctLine(yoyPcts[i],momPcts[i])}</td>`).join('')}
          <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-weight:600">${yen(r.total)}</td>
          <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-size:10px">${periodDiffBadge(diff,pct,'yen',`${compareYear}年と同額`)}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr style="font-weight:600;background:var(--bg2)">
        <td style="padding:5px 8px">合計</td>
        ${colTotals.map(v=>`<td style="${cell};font-size:10px">${v?yen(v):''}</td>`).join('')}
        <td style="padding:5px 8px;text-align:right">${yen(colTotals.reduce((a,v)=>a+v,0))}</td>
        <td></td>
      </tr></tfoot>
    </table></div>` : `<div style="color:var(--text2);font-size:11px;padding:6px 0">表示期間内の実績データがありません</div>`}
  </div>`;
}

/* ===== 取引先・ドライバー個別比較レポート（1社/1名を選んで過去の売上と比較する。会議用に印刷対応） ===== */
let entityCompareType = 'client'; // 'client' または 'driver'

function entityMatches(r, entityType, entityId) {
  return entityType==='client' ? r.cli===entityId : recDrv(r)?.id===entityId;
}
// 指定エンティティ(取引先 or ドライバー)1件分の年間集計（buildYearStatsのエンティティ絞り込み版）
function buildEntityYearStats(entityType, entityId, year) {
  const monthlyAmt = new Array(12).fill(0), monthlyCnt = new Array(12).fill(0);
  recs.forEach(r => {
    if (!r.date?.startsWith(year)) return;
    if (!entityMatches(r, entityType, entityId)) return;
    const mi = +r.date.slice(5,7) - 1;
    if (mi < 0 || mi > 11) return;
    monthlyAmt[mi] += totR(r,'inc'); monthlyCnt[mi]++;
  });
  return { monthlyAmt, monthlyCnt };
}
// buildFiveYearTableHtmlのエンティティ絞り込み版（表題・対象のみ差し替え、レイアウトは統一）
function buildEntityFiveYearTableHtml(entityType, entityId, entityName, year, span) {
  const y = +year;
  const years = Array.from({length:span}, (_,i) => y-span+1+i);
  const cell = 'padding:5px 4px;text-align:right;border-bottom:0.5px solid var(--border)';
  const rows = years.map(yr => {
    const { monthlyAmt } = buildEntityYearStats(entityType, entityId, String(yr));
    return { yr, monthlyAmt, total: monthlyAmt.reduce((a,v)=>a+v,0) };
  });
  const colTotals = new Array(12).fill(0);
  rows.forEach(r=>r.monthlyAmt.forEach((v,i)=>colTotals[i]+=v));
  const hasAny = rows.some(r=>r.total>0);
  const baseTotal = rows.find(r=>r.yr===y)?.total ?? 0;
  return `<div class="cwrap" style="margin-bottom:10px">
    <div class="ctitle">${entityType==='client'?'🏢':'🚚'} ${escHtml(entityName)}（${years[0]}〜${years[years.length-1]}年・税込）</div>
    ${hasAny ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap">
      <thead><tr style="background:var(--bg2)">
        <th style="padding:5px 8px;text-align:left;border-bottom:0.5px solid var(--border)">年</th>
        ${Array.from({length:12},(_,i)=>`<th style="${cell}">${i+1}月</th>`).join('')}
        <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">年間合計</th>
        <th style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border)">${y}年比</th>
      </tr></thead>
      <tbody>${rows.map(r=>{
        const diff = r.total-baseTotal;
        const pct = baseTotal>0 ? Math.round(diff/baseTotal*100) : null;
        return `<tr${r.yr===y?' style="background:var(--blue-bg)"':''}>
          <td style="padding:5px 8px;border-bottom:0.5px solid var(--border);font-weight:500">${r.yr}年</td>
          ${r.monthlyAmt.map(v=>`<td style="${cell};font-size:10px">${v?yen(v):''}</td>`).join('')}
          <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-weight:600">${yen(r.total)}</td>
          <td style="padding:5px 8px;text-align:right;border-bottom:0.5px solid var(--border);font-size:10px">${periodDiffBadge(diff,pct,'yen',`${y}年と同額`)}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr style="font-weight:600;background:var(--bg2)">
        <td style="padding:5px 8px">合計</td>
        ${colTotals.map(v=>`<td style="${cell};font-size:10px">${v?yen(v):''}</td>`).join('')}
        <td style="padding:5px 8px;text-align:right">${yen(colTotals.reduce((a,v)=>a+v,0))}</td>
        <td></td>
      </tr></tfoot>
    </table></div>` : `<div style="color:var(--text2);font-size:11px;padding:6px 0">表示期間内の実績データがありません</div>`}
  </div>`;
}
// 任意の日付範囲での比較（直前の同じ日数分の期間と自動比較する）
function computeEntityRangeComparison(entityType, entityId, from, to) {
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const prevTo = fmtLocalDate(new Date(new Date(from).getTime() - 86400000));
  const prevFrom = fmtLocalDate(new Date(new Date(from).getTime() - days*86400000));
  const curRecs = recs.filter(r => r.date>=from && r.date<=to && entityMatches(r, entityType, entityId));
  const prevRecs = recs.filter(r => r.date>=prevFrom && r.date<=prevTo && entityMatches(r, entityType, entityId));
  const curTotal = curRecs.reduce((a,r)=>a+totR(r,'inc'),0);
  const prevTotal = prevRecs.reduce((a,r)=>a+totR(r,'inc'),0);
  return { curTotal, curCnt: curRecs.length, prevTotal, prevCnt: prevRecs.length, prevFrom, prevTo };
}
function openEntityCompareM(entityType) {
  entityCompareType = entityType;
  document.getElementById('entityCompareH').innerHTML = `📊 ${entityType==='client'?'取引先':'ドライバー'}個別比較レポート <button class="ibtn" onclick="closeM('mEntityCompare')">✕</button>`;
  document.getElementById('entityCompareListLabel').textContent = `対象の${entityType==='client'?'取引先':'ドライバー'}を選択（複数可）`;
  const list = document.getElementById('entityCompareList');
  const entities = entityType==='client'
    ? [...clients].sort((a,b)=>(parseInt(a.client_no,10)||999999)-(parseInt(b.client_no,10)||999999)).map(c=>({id:c.id,name:c.name}))
    : [...drvs].sort((a,b)=>(parseInt(a.supplier_id,10)||999999)-(parseInt(b.supplier_id,10)||999999)).map(d=>({id:d.id,name:d.name}));
  list.innerHTML = entities.map(e=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer"><input type="checkbox" class="entityCompareChk" value="${e.id}" style="width:auto">${escHtml(e.name)}</label>`).join('') || '<div style="font-size:11px;color:var(--text2)">登録がありません</div>';
  populateYearSelect('entityCompareYear', false);
  document.getElementById('entityCompareRangeFld').style.display = 'none';
  document.getElementById('entityCompareYearFld').style.display = '';
  document.querySelector('input[name="entityCompareMode"][value="year"]').checked = true;
  document.getElementById('entityCompareReport').innerHTML = '';
  document.getElementById('entityComparePrintBar').style.display = 'none';
  document.getElementById('mEntityCompare').classList.add('on');
}
function onEntityCompareModeChange() {
  const mode = document.querySelector('input[name="entityCompareMode"]:checked').value;
  document.getElementById('entityCompareYearFld').style.display = mode==='year' ? '' : 'none';
  document.getElementById('entityCompareRangeFld').style.display = mode==='range' ? '' : 'none';
}
function renderEntityCompareReport() {
  const ids = [...document.querySelectorAll('.entityCompareChk:checked')].map(el=>+el.value);
  const reportEl = document.getElementById('entityCompareReport');
  if (!ids.length) { reportEl.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:8px 0">対象を1件以上選択してください</div>'; document.getElementById('entityComparePrintBar').style.display = 'none'; return; }
  const entities = entityCompareType==='client' ? clients : drvs;
  const mode = document.querySelector('input[name="entityCompareMode"]:checked').value;
  let html = '';
  if (mode === 'year') {
    const year = document.getElementById('entityCompareYear').value;
    html = ids.map(id => {
      const name = entities.find(e=>e.id===id)?.name || '（不明）';
      return buildEntityFiveYearTableHtml(entityCompareType, id, name, year, 5);
    }).join('');
  } else {
    const from = document.getElementById('entityCompareFrom').value;
    const to = document.getElementById('entityCompareTo').value;
    if (!from || !to || from > to) { reportEl.innerHTML = '<div style="font-size:11px;color:var(--red);padding:8px 0">期間を正しく指定してください</div>'; document.getElementById('entityComparePrintBar').style.display = 'none'; return; }
    html = ids.map(id => {
      const name = entities.find(e=>e.id===id)?.name || '（不明）';
      const c = computeEntityRangeComparison(entityCompareType, id, from, to);
      const diff = c.curTotal - c.prevTotal;
      const pct = c.prevTotal>0 ? Math.round(diff/c.prevTotal*100) : null;
      return `<div class="cwrap" style="margin-bottom:10px">
        <div class="ctitle">${entityCompareType==='client'?'🏢':'🚚'} ${escHtml(name)}（${from}〜${to}）</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
          <div class="kpi-card"><div class="kpi-label">対象期間（${from}〜${to}）</div><div class="kpi-val">${yen(c.curTotal)}</div><div class="kpi-diff">${c.curCnt}件</div></div>
          <div class="kpi-card"><div class="kpi-label">直前の同期間（${c.prevFrom}〜${c.prevTo}）</div><div class="kpi-val">${yen(c.prevTotal)}</div><div class="kpi-diff">${c.prevCnt}件</div></div>
        </div>
        <div style="margin-top:6px">${periodDiffBadge(diff,pct,'yen','直前の同期間と同額')}</div>
      </div>`;
    }).join('');
  }
  reportEl.innerHTML = html;
  document.getElementById('entityComparePrintBar').style.display = 'flex';
}
// 個別比較レポートのモーダルを開いた状態で印刷したときは、レポート内容だけを印刷する（他のページ内容は隠す）
window.addEventListener('beforeprint', () => {
  if (document.getElementById('mEntityCompare')?.classList.contains('on')) document.body.classList.add('print-modal-only');
});
window.addEventListener('afterprint', () => document.body.classList.remove('print-modal-only'));

// ダッシュボードの年間サマリー（年間KPI＋月次推移＋5年比較表）。renderDashから年選択時のみ呼ばれる。
// 取引先別の内訳は「取引先分析」タブ（buildCliYearAnalysisHtml）、ドライバー別の内訳は「ドライバー分析」タブ（buildDrvYearAnalysisHtml）の担当。
// 前年同期間との比較（過去データとの比較）も併せて表示する
function buildYearReportHtml(year, statusHtml) {
  const { monthlyAmt, monthlyCnt } = buildYearStats(year);
  const totalAmt = monthlyAmt.reduce((a,v)=>a+v,0);
  const totalCnt = monthlyCnt.reduce((a,v)=>a+v,0);
  const activeMonths = monthlyAmt.filter(v=>v>0).length;
  const avgAmt = activeMonths ? Math.round(totalAmt/activeMonths) : 0;
  const peakM = monthlyAmt.indexOf(Math.max(...monthlyAmt));

  // 前年比較（同じ年内の月までで揃える。例えば今年が7月までのデータなら前年も1〜7月で比較する）
  const prevYear = String(+year - 1);
  const prevStats = buildYearStats(prevYear);
  const lastActiveM = monthlyAmt.reduce((last,v,i)=>v>0?i:last, -1);
  const cmpUpTo = lastActiveM>=0 ? lastActiveM+1 : 12;
  const amtSoFar = monthlyAmt.slice(0,cmpUpTo).reduce((a,v)=>a+v,0);
  const cntSoFar = monthlyCnt.slice(0,cmpUpTo).reduce((a,v)=>a+v,0);
  const prevAmtSoFar = prevStats.monthlyAmt.slice(0,cmpUpTo).reduce((a,v)=>a+v,0);
  const prevCntSoFar = prevStats.monthlyCnt.slice(0,cmpUpTo).reduce((a,v)=>a+v,0);
  const diffAmt = amtSoFar - prevAmtSoFar, diffCnt = cntSoFar - prevCntSoFar;
  const diffAmtPct = prevAmtSoFar>0 ? Math.round(diffAmt/prevAmtSoFar*100) : null;
  const hasPrevData = prevStats.monthlyAmt.some(v=>v>0);

  const kpiHtml = `<div class="cwrap" style="grid-column:1/-1">
    <div class="ctitle">📈 ${year}年 年間サマリー（税込）</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
      <div class="kpi-card"><div class="kpi-label">年間売上</div><div class="kpi-val">${yen(totalAmt)}</div>${hasPrevData?`<div class="kpi-diff">${periodDiffBadge(diffAmt,diffAmtPct,'yen',`${prevYear}年同期間比同額`)}</div>`:''}</div>
      <div class="kpi-card"><div class="kpi-label">月平均売上（稼働月）</div><div class="kpi-val">${yen(avgAmt)}</div></div>
      <div class="kpi-card"><div class="kpi-label">年間件数</div><div class="kpi-val">${totalCnt}件</div>${hasPrevData?`<div class="kpi-diff">${periodDiffBadge(diffCnt,null,'cnt',`${prevYear}年同期間比同数`)}</div>`:''}</div>
      <div class="kpi-card"><div class="kpi-label">最高月</div><div class="kpi-val" style="font-size:12px">${totalAmt ? `${peakM+1}月 ${yen(monthlyAmt[peakM])}` : '—'}</div></div>
    </div>
    ${hasPrevData?`<div style="font-size:10px;color:var(--text2);margin-top:6px">${prevYear}年 1〜${cmpUpTo}月 実績: ${yen(prevAmtSoFar)}（${prevCntSoFar}件）と比較</div>`:''}
  </div>`;

  const maxMonthAmt = Math.max(1, ...monthlyAmt, ...prevStats.monthlyAmt);
  // 内訳・ステータス（renderDashから渡される）と横並びにするため、ここは全幅指定しない
  const barHtml = `<div class="cwrap">
    <div class="ctitle">📅 月次売上推移（${year}年・税込）</div>
    ${Array.from({length:12},(_,i)=>{
      const pct = Math.round(monthlyAmt[i]/maxMonthAmt*100);
      const prevAmt = prevStats.monthlyAmt[i];
      const diff = monthlyAmt[i] - prevAmt;
      const diffPct = prevAmt>0 ? Math.round(diff/prevAmt*100) : null;
      const diffBadge = hasPrevData ? periodDiffBadge(diff, diffPct, 'yen', '前年同月と同額') : '';
      return `<div class="brow"><div class="blbl">${i+1}月</div><div class="btrack"><div class="bfill" style="width:${pct}%;background:var(--blue)"></div></div><div class="bval">${yen(monthlyAmt[i])} <span style="color:var(--text2)">${monthlyCnt[i]}件</span>${diffBadge?` ${diffBadge}`:''}</div></div>`;
    }).join('')}
  </div>`;

  return kpiHtml + barHtml + (statusHtml||'') + buildFiveYearTableHtml(year);
}

// 「取引先分析」タブの年選択時の内容（取引先別 月次実績マトリクス）。renderCliAnalysisから呼ばれる。
function buildCliYearAnalysisHtml(year) {
  const { cliRows } = buildYearStats(year);
  const y = +year;
  const compareYear = anaCliCompareYear || (y-1); // 未選択時は前年比をデフォルトに
  const prevRows = buildYearStats(String(y-1)).cliRows;
  const prevAmtsById = new Map(prevRows.map(({c,amts})=>[c.id,amts]));
  const compareRows = compareYear===y-1 ? prevRows : buildYearStats(String(compareYear)).cliRows;
  const compareTotalsById = new Map(compareRows.map(({c,amts})=>[c.id, amts.reduce((a,v)=>a+v,0)]));
  return `<div class="cwrap" style="grid-column:1/-1">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;flex-wrap:wrap;gap:10px">
      <div class="ctitle" style="margin-bottom:0">🏢 取引先別 月次実績（${year}年・税込）</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">比較年 ${compareYearSelectHtml('anaCliCompareYearSel','setAnaCliCompareYear', y, compareYear)}</div>
    </div>
    ${monthMatrixTableHtml(cliRows.map(({c,amts})=>({id:c.id,label:c.name,amts})), '取引先', 'この年の実績データがありません', {prevAmtsById, compareYear, compareTotalsById})}
  </div>`;
}

// 「ドライバー分析」タブの年選択時の内容（ドライバー別 月次実績マトリクス、取引先で絞込可）。renderDrvAnalysisから呼ばれる。
function buildDrvYearAnalysisHtml(year) {
  const { drvRows } = buildYearStats(year, yrDrvCliFilter||null);
  const cliOptions = [...clients].sort((a,b)=>(parseInt(a.client_no,10)||999999)-(parseInt(b.client_no,10)||999999))
    .map(c=>`<option value="${c.id}" ${yrDrvCliFilter===c.id?'selected':''}>${escHtml(c.name)}</option>`).join('');
  const y = +year;
  const compareYear = anaDrvCompareYear || (y-1); // 未選択時は前年比をデフォルトに
  const prevRows = buildYearStats(String(y-1), yrDrvCliFilter||null).drvRows;
  const prevAmtsById = new Map(prevRows.map(({d,amts})=>[d.id,amts]));
  const compareRows = compareYear===y-1 ? prevRows : buildYearStats(String(compareYear), yrDrvCliFilter||null).drvRows;
  const compareTotalsById = new Map(compareRows.map(({d,amts})=>[d.id, amts.reduce((a,v)=>a+v,0)]));
  return `<div class="cwrap" style="grid-column:1/-1">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;flex-wrap:wrap;gap:10px">
      <div class="ctitle" style="margin-bottom:0">👥 ドライバー別 月次実績（${year}年・税込）</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)">比較年 ${compareYearSelectHtml('anaDrvCompareYearSel','setAnaDrvCompareYear', y, compareYear)}</div>
        <select onchange="setYrDrvCliFilter(this.value)" style="padding:3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text)">
          <option value="">全取引先</option>
          ${cliOptions}
        </select>
      </div>
    </div>
    ${monthMatrixTableHtml(drvRows.map(({d,amts})=>({id:d.id,label:d.name,amts})), 'ドライバー', yrDrvCliFilter?'この取引先の実績データがありません':'この年の実績データがありません', {prevAmtsById, compareYear, compareTotalsById})}
  </div>`;
}

function exportYearCsv() {
  const year = document.getElementById('anaDrvYear')?.value;
  if (!year) { alert('年を選択してください（全期間ではCSV出力できません）'); return; }
  const { drvRows } = buildYearStats(year, yrDrvCliFilter||null);
  const headers = ['ドライバー', ...Array.from({length:12},(_,i)=>`${i+1}月`), '合計'];
  const rows = drvRows.map(({d,amts}) => [d.name, ...amts, amts.reduce((a,v)=>a+v,0)].join(','));
  const bom=new Uint8Array([0xEF,0xBB,0xBF]);
  const blob=new Blob([bom,[headers.join(','),...rows].join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`年報_${year}.csv`;a.click();
  addLog('年報CSV出力', year+'年');
}

/* ===== バックアップ・復元 =====
   Supabase無料プランには自動バックアップ（日次バックアップ・PITR）が無いため、
   このJSONエクスポートが唯一のバックアップ手段。全テーブルを対象にする */
const BACKUP_TABLES = [
  'invoices','drivers','clients','partner_companies','users','daily_reports',
  'payment_schedules','receipt_schedules','payment_in',
  'company_settings','board_posts','price_master','input_templates',
  'file_mappings','driver_documents','driver_statements','partner_company_docs','payment_slips','invoice_slips'
];
async function backupAllData() {
  showLoad(true);
  try {
    const results = await Promise.all(BACKUP_TABLES.map(t => sb.from(t).select('*').order('id').limit(20000)));
    for (let i=0;i<BACKUP_TABLES.length;i++) { if (results[i].error) throw results[i].error; }
    const backup = { version: 10, exported_at: new Date().toISOString() };
    BACKUP_TABLES.forEach((t,i) => {
      const data = results[i].data || [];
      backup[t] = t==='users' ? data.map(u=>({...u,pw:'[HASHED]'})) : data;
    });
    const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`PGBase_backup_${fmtLocalDate(new Date())}.json`;
    a.click();
    localStorage.setItem('pgbase_last_backup_at', new Date().toISOString());
    addLog('バックアップ', `全データ ${backup.invoices.length}件`);
    showT('バックアップを作成しました');
  } catch(e) { showT('バックアップエラー: '+e.message,'ter'); }
  showLoad(false);
}

async function restoreFromBackup(file) {
  if (!file) return;
  if (!confirm('⚠ 復元すると保存済みのデータが上書きされます（ユーザーを除く）。続けますか？')) return;
  showLoad(true);
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.version || !backup.invoices) throw new Error('バックアップファイルの形式が不正です');
    // usersはauth_uidの不整合でログインが壊れる可能性があるため復元対象から除外
    const chunk=(arr,n)=>Array.from({length:Math.ceil(arr.length/n)},(_,i)=>arr.slice(i*n,(i+1)*n));
    for (const t of BACKUP_TABLES.filter(t=>t!=='users')) {
      for (const ch of chunk(backup[t]||[],50)) {
        const {error}=await sb.from(t).upsert(ch,{onConflict:'id'});
        if(error) throw error;
      }
    }
    await loadAll();
    addLog('データ復元', `バックアップから復元 (v${backup.version} ${backup.exported_at?.slice(0,10)})`);
    showT('復元が完了しました');
  } catch(e) { showT('復元エラー: '+e.message,'ter'); }
  showLoad(false);
}

/* ===== PDF帳票（手取り明細書） ===== */
/* ===== 帳票共通スタイル・ヘルパー ===== */
function getDocCss() {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap');
  :root{
    --blue:#1E3A5F; --blue-light:#EFF6FF;
    --text:#1A1A1A; --text2:#555555; --text3:#888888;
    --border:#333333; --border2:#999999;
    --bg2:#F5F5F3; --red:#B0281E;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans JP',sans-serif;background:#DDE1E6;padding:32px 16px;color:var(--text)}
  .doc{max-width:840px;margin:0 auto;background:#fff;border:1.5px solid var(--border);padding:28px 34px}
  .doc-head{text-align:center;position:relative;margin-bottom:6px}
  /* 文字色は（印影の赤を除き）var(--text)一色に統一し、強調は請求・支払金額欄のみ文字サイズで行う */
  .doc-no{position:absolute;top:0;right:0;font-size:11px;color:var(--text);font-weight:500}
  .doc-title{font-size:25px;font-weight:700;letter-spacing:.3em;text-indent:.3em;border-bottom:2.5px solid var(--text);display:inline-block;padding:0 6px 8px}
  .doc-date{font-size:12px;color:var(--text);margin-top:8px}
  .doc-parties{display:flex;justify-content:space-between;margin:14px 0 12px;gap:24px}
  .party-to{flex:1.1}
  .party-to .name{font-size:17px;font-weight:700;border-bottom:2px solid var(--text);padding-bottom:6px;display:inline-block;margin-bottom:8px}
  .party-to .meta{font-size:11px;color:var(--text);line-height:1.8}
  .party-from{flex:1;display:flex;justify-content:flex-end;align-items:flex-start;gap:10px;text-align:right}
  .party-from .name{font-size:13px;font-weight:700;margin-bottom:5px}
  .party-from .meta{font-size:10.5px;color:var(--text);line-height:1.75}
  .hanko{
    flex-shrink:0;width:54px;height:54px;border-radius:50%;
    border:2px solid var(--red);color:var(--red);
    display:flex;align-items:center;justify-content:center;text-align:center;
    font-size:10px;font-weight:700;letter-spacing:1px;line-height:1.3;
    transform:rotate(-6deg);opacity:.82;mix-blend-mode:multiply;
  }
  .hanko.hanko-img{border:none;opacity:.9}
  .hanko.hanko-img img{max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply}
  .period-bar{display:flex;justify-content:space-between;align-items:center;background:var(--bg2);border:1px solid var(--border2);padding:6px 13px;margin-bottom:10px;font-size:11.5px;color:var(--text)}
  .period-bar b{color:var(--text);font-weight:600}
  table.summary-table{width:100%;border-collapse:collapse;margin-bottom:10px;table-layout:fixed}
  table.summary-table th,table.summary-table td{border:1px solid var(--border);text-align:center;padding:5px 4px;color:var(--text)}
  table.summary-table th{background:var(--bg2);font-size:10.5px;font-weight:500}
  table.summary-table td{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
  /* 請求・支払金額欄のみ、色ではなく文字サイズで強調する */
  table.summary-table th.hl{background:var(--bg2)}
  table.summary-table td.hl{font-size:18px}
  table.summary-table td.neg{color:var(--text)}
  table.items{width:100%;border-collapse:collapse;margin-bottom:0;table-layout:fixed}
  table.items th,table.items td{border:1px solid var(--border);color:var(--text)}
  table.items thead th{background:var(--bg2);font-size:9.5px;font-weight:600;padding:4px 5px;text-align:center}
  table.items thead th.num{text-align:right}
  table.items tbody td{padding:3px 6px;font-size:10px;vertical-align:middle;text-align:center}
  table.items tbody td.task{text-align:left}
  table.items tbody td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .detail-sub{font-size:9px;color:var(--text);margin-top:1px}
  /* 備考欄(左75%)・内訳欄(右25%)：普通のtableで組む（flexboxのborderは印刷時に描画が
     不安定になることがあるため、このアプリの他の表と同じtable+border-collapseに統一する）。
     内訳欄の縦線は、上の明細表の「数量」欄の左の線（No+日付+車番名前+作業明細+高速立替代+距離時間
     ＝5+8+13+29+11+9＝75%）と同じ位置に揃える */
  table.bottom-table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:0}
  table.bottom-table td{border:1px solid var(--border);vertical-align:top;color:var(--text)}
  td.notes-cell{width:75%;padding:6px 10px;font-size:9.5px;line-height:1.55}
  td.notes-cell .lbl{font-size:9px;font-weight:600;margin-bottom:3px}
  td.breakdown-cell{width:25%;padding:2px 6px}
  td.breakdown-cell .lbl2{display:block;font-size:8px;line-height:1.2}
  td.breakdown-cell .val{display:block;font-size:9.5px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  td.breakdown-cell.last{background:var(--bg2);border-top:1.5px solid var(--text);font-weight:700}
  td.breakdown-cell.last .lbl2{font-size:8.5px}
  td.breakdown-cell.last .val{font-size:12px}
  td.breakdown-cell .val.neg{color:var(--text)}
  /* ブラウザは既定で印刷時に背景色を省略する（インク節約のため）。この設定がないと、
     支払金額・請求金額欄など「濃い背景色＋白文字」の箇所が、背景だけ印刷されず
     文字色（白）だけ残って薄く・読めなくなる（PDF出力時に色が薄く見える不具合の原因） */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
  @page{size:A4 portrait;margin:10mm}
  /* スマホ表示用にJSで.docへ掛けたtransform:scale()は、印刷時にそのまま残ると
     レイアウトが縮小されたまま左上に寄って印刷されてしまうため、印刷時は必ず解除する */
  @media print{body{background:#fff;padding:0}.doc{border:none;padding:12mm;max-width:none;transform:none!important}.doc-scale-wrap{height:auto!important;overflow:visible!important}@page{size:A4 portrait;margin:10mm}}
  /* スマホ画面での表示時のみ：列幅・文字サイズを個別に変えると9列の密な表で文字が潰れたり
     支払金額欄がはみ出たりするため、A4のデザインは一切変えずに.doc-scale-wrap内でJSにより
     画面幅に合わせて縮小表示する（PDFビューアの「幅に合わせる」表示と同じ考え方。印刷結果には影響しない） */
  @media screen and (max-width:600px){
    body{padding:8px 0}
    .doc-scale-wrap{overflow:hidden}
    .doc{width:840px;max-width:840px}
  }
  `;
}

function getCompanyBlock() {
  const c = companySettings || {};
  const addrLines = formatCompanyAddressLines(c);
  return `
    <div class="name">${escHtml(c.name || '株式会社ポーターガーデン')}</div>
    <div class="meta">
      ${addrLines.map(l=>`${l}<br>`).join('')}
      ${escHtml(c.tel ? 'TEL ' + c.tel : '')}<br>
      ${escHtml(c.reg_no ? '登録番号　' + c.reg_no : '')}${c.bank ? '<br>' + escHtml(c.bank) : ''}
    </div>`;
}

/* ===== 明細書PDF（請求書／支払明細書 共通・Excel帳票と統一デザイン） ===== */
// buildStatementSheetData()（Excel帳票と共通のデータ組み立て関数）の結果を.doc要素へ組み立てる（1件分）
function buildStatementDocInner(side, rows) {
  const d = buildStatementSheetData(side, rows);
  const isBilling = side === 'billing';
  const notesHtml = escHtml(d.notes || 'なし').replace(/\n/g, '<br>');
  const itemRows = d.items.map(it=>`<tr>
    <td>${it.no}</td><td>${escHtml(it.date.slice(5).replace('-','/'))}</td><td>${escHtml(it.car)}${it.driverName?' '+escHtml(it.driverName):''}</td>
    <td class="task">${escHtml(it.task)}</td>
    <td class="num">${it.hw?yen(it.hw):'—'}</td>
    <td>${it.distTime||'—'}</td>
    <td class="num">${it.qty}</td>
    <td class="num">${yen(it.unitPrice)}</td>
    <td class="num">${yen(it.amount)}</td>
  </tr>`).join('');

  return `<div class="doc">
    <div class="doc-head">
      <div class="doc-no">No. ${d.docNo}</div>
      <div class="doc-title">${d.headLabel}</div>
      <div class="doc-date">${d.issueDate}</div>
    </div>
    <div class="doc-parties">
      <div class="party-to">
        <div class="name">${d.recipientLines[0]||''}</div>
        <div class="meta">${d.recipientLines.slice(1).filter(Boolean).join('<br>')}</div>
      </div>
      <div class="party-from">
        <div>
          <div class="name">${d.companyLines[0]||''}</div>
          <div class="meta">${d.companyLines.slice(1).filter(Boolean).join('<br>')}</div>
        </div>
        ${(companySettings||{}).stamp_image ? `<div class="hanko hanko-img" style="transform:rotate(${hankoStampRotationDeg()}deg);width:${hankoStampSizePx()}px;height:${hankoStampSizePx()}px"><img src="${companySettings.stamp_image}"></div>` : `<div class="hanko"><span style="font-size:21px">印</span></div>`}
      </div>
    </div>
    <div class="period-bar"><span>${d.periodLabel}</span><span>${d.dateLabel}: <b>${d.dateValue}</b></span></div>
    <table class="summary-table">
      <tr>
        <th>税込金額</th><th>内消費税額</th><th>非課税額</th><th>高速・立替代</th><th class="hl">${isBilling?'請求金額':'支払金額'}</th>
      </tr>
      <tr>
        <td>${yen(d.summary.taxed)}</td><td>${yen(d.summary.taxOnly)}</td><td>${yen(d.summary.nonTax)}</td>
        <td>${yen(d.summary.advHw ?? d.summary.oth)}</td>
        <td class="hl">${yen(d.summary.grand)}</td>
      </tr>
    </table>
    <table class="items">
      <thead><tr>
        <th style="width:5%">No</th><th style="width:8%">日付</th><th style="width:13%">車番・名前</th>
        <th style="width:29%">作業明細</th><th class="num small" style="width:11%">高速・立替代</th><th class="small" style="width:9%">距離・時間</th>
        <th class="num small" style="width:6%">数量</th><th class="num small" style="width:9%">単価</th><th class="num" style="width:10%">金額</th>
      </tr></thead>
      <tbody>${itemRows || '<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:20px">対象データがありません</td></tr>'}</tbody>
    </table>
    <table class="bottom-table"><tbody>
      ${d.breakdownRows.length ? d.breakdownRows.map(([label,val], i) => `<tr>
        ${i===0 ? `<td class="notes-cell" rowspan="${d.breakdownRows.length}"><div class="lbl">（備考）</div>${notesHtml}</td>` : ''}
        <td class="breakdown-cell${i===d.breakdownRows.length-1?' last':''}"><span class="lbl2">${escHtml(label)}</span><span class="val${val<0?' neg':''}">${yen(val)}</span></td>
      </tr>`).join('') : `<tr><td class="notes-cell"><div class="lbl">（備考）</div>${notesHtml}</td><td class="breakdown-cell"></td></tr>`}
    </tbody></table>
  </div>`;
}

function statementDocStyle() {
  return `table.items thead th.small{font-size:9px}
  /* 備考・内訳の箱はページの途中で分断させない：残りスペースに収まらない場合は
     箱ごと次ページへ送る（.bottom-boxes時代のセレクタが要素のtable化で外れて
     再発していたため、現行のtable.bottom-tableに合わせて再設定） */
  table.bottom-table{page-break-inside:avoid;break-inside:avoid}
  table.bottom-table tr{page-break-inside:avoid;break-inside:avoid}
  table.items tr{page-break-inside:avoid;break-inside:avoid}
  .doc-parties,.period-bar,table.summary-table{page-break-inside:avoid;break-inside:avoid}`;
}

// window.open()したポップアップへ帳票HTMLを書き込む共通処理。
// document.write中に例外が発生しても画面が無反応にならないよう、必ず利用者に見える形でエラーを通知する
// （htmlBuilderFnは遅延評価にして、構築時の例外もここで一括して捕捉する）
// 注意: window.open()の第3引数に'noopener'を付けてはいけない。noopener指定はタブが開いても
// 戻り値がnullになる仕様のため、ここへwinを渡せず「ポップアップがブロックされました」と
// 誤判定して発行不能になる（実際に全PDFボタンが発行できなくなる障害の原因だった）。
// 元のタブとの分離（閉じた後にボタンが効かなくなる問題の対策）は、参照を受け取った上で
// opener切断（win.opener=null）によって行う
function writeStatementWindow(win, htmlBuilderFn) {
  try {
    if (!win || win.closed) throw new Error('PDF表示用のウィンドウが閉じられました。ポップアップブロックの設定をご確認のうえ、再度お試しください');
    try { win.opener = null; } catch(_) {}
    const html = htmlBuilderFn();
    win.document.open();
    win.document.write(html);
    win.document.close();
    return true;
  } catch(e) {
    try { win.close(); } catch(_) {}
    alert('PDFの作成に失敗しました: ' + (e && e.message ? e.message : e));
    console.error('PDF生成エラー:', e);
    return false;
  }
}

// PDFのタイトル（＝印刷/保存ダイアログが提案するファイル名の元）を組み立てる。
// 宛先が取引先（請求）または会社登録のドライバー（is_company）なら「御中」、個人ドライバー（支払）なら「様」を付け、
// 対象月も添えて「支払明細書_佐々木誠弥様_2026-06」のように、保存時にそのまま使える名前にする
function statementFileTitle(side, d) {
  const honorific = d.isCompanyPayee ? '御中' : '様';
  const ym = d.docNo.match(/-(\d{4})(\d{2})-/);
  const monthPart = ym ? `_${ym[1]}-${ym[2]}` : '';
  return `${d.headLabel}_${d.groupLabel}${honorific}${monthPart}`;
}
// 1件分の請求書／支払明細書HTML（単票PDF用）
function buildStatementHtml(side, rows) {
  const d = buildStatementSheetData(side, rows);
  const inner = buildStatementDocInner(side, rows);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <title>${statementFileTitle(side, d)}</title>
  <style>${getDocCss()}${statementDocStyle()}</style></head><body>
  ${inner}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;
}

// 複数件分（一括作成用）：1つのウィンドウにページ区切りでまとめて1回だけwindow.openする
function buildStatementHtmlMulti(side, rowGroups) {
  const inners = rowGroups.map(rows => buildStatementDocInner(side, rows)).join('');
  const title = side === 'billing' ? '請求明細書_一括作成' : '支払明細書_一括作成';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>${getDocCss()}${statementDocStyle()}
  .doc{page-break-after:always}
  .doc:last-child{page-break-after:auto}
  </style></head><body>
  ${inners}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;
}

// 「鑑」表紙ページ（PDF/HTML版）。Excel版のwriteCoverPage()と同じ内容（No・ID・氏名・協力会社・
// コムトラ同様の金額5項目・合計行・独立した太字合計）を1枚の.docとして作成する。
// addressee: {name, cli} 形式（cliがあれば住所・TEL・担当者を自動記載）
function buildCoverPageHtml(side, rowGroups, addressee) {
  const isBilling = side === 'billing';
  const c = addressee?.cli;
  const addresseeBlock = addressee?.name ? `
    <div class="cover-addressee">${escHtml(addressee.name)}　御中</div>
    ${c ? `<div class="cover-addressee-meta">
      ${escHtml([c.zip?`〒${c.zip}`:'', c.address||''].filter(Boolean).join(' '))}<br>
      ${escHtml([c.person?`ご担当: ${c.person}`:'', c.tel?`TEL ${c.tel}`:''].filter(Boolean).join('　'))}
    </div>` : ''}
  ` : '<div></div>';
  // 右側：自社情報（個別明細書の会社欄と同じ内容・印影も表示）
  const companyBlock = getCompanyBlock();
  const hankoBlock = (companySettings||{}).stamp_image
    ? `<div class="hanko hanko-img" style="transform:rotate(${hankoStampRotationDeg()}deg);width:${hankoStampSizePx()}px;height:${hankoStampSizePx()}px"><img src="${companySettings.stamp_image}"></div>`
    : `<div class="hanko"><span style="font-size:21px">印</span></div>`;

  const allDates = rowGroups.flat().map(x=>x.date).filter(Boolean).sort();
  let periodLine = '';
  if (allDates.length) {
    periodLine = `集計期間: ${allDates[0]} ～ ${allDates[allDates.length-1]}`;
    if (!isBilling) {
      periodLine += `　　支払実行日: ${computeGroupPayExecDateLabel(rowGroups)}`;
    }
  }

  const dataList = rowGroups.map(rows => buildStatementSheetData(side, rows));
  const grandTotal = dataList.reduce((a,d)=>a+d.summary.grand, 0);
  const rowsHtml = rowGroups.map((rows, gi) => {
    const d = dataList[gi];
    const s = d.summary;
    const idCell = isBilling
      ? (clients.find(cc=>cc.id===rows[0].cli)?.client_no || '—')
      : (recDrv(rows[0])?.supplier_id || '—');
    const nameCell = isBilling
      ? (clients.find(cc=>cc.id===rows[0].cli)?.name || '（未設定）')
      : (recDrv(rows[0])?.name || '（未設定）');
    const companyCell = isBilling ? '' : `<td>${escHtml(recDrv(rows[0])?.company||'')}</td>`;
    // どの明細書ページに対応するか一目でわかるよう、名称の下に支払明細番号（docNo）を併記する
    return `<tr>
      <td class="num">${gi+1}</td><td class="num">${escHtml(idCell)}</td><td class="cname">${escHtml(nameCell)}<div class="doc-no-ref">${escHtml(d.docNo)}</div></td>${companyCell}
      <td class="num">${yen(s.taxed)}</td><td class="num">${yen(s.taxOnly)}</td><td class="num">${yen(s.nonTax)}</td>
      <td class="num">${yen(s.advHw ?? s.oth)}</td><td class="num total">${yen(s.grand)}</td>
    </tr>`;
  }).join('');

  return `<div class="doc cover-doc">
    <div class="doc-head">
      <div class="doc-title" style="font-size:22px">${isBilling?'請求明細書 発行一覧（鑑）':'支払明細書 発行一覧（鑑）'}</div>
      <div class="doc-date">${getStatementIssueDate()}</div>
    </div>
    <div class="doc-parties">
      <div class="party-to">${addresseeBlock}</div>
      <div class="party-from"><div>${companyBlock}</div>${hankoBlock}</div>
    </div>
    ${periodLine ? `<div class="period-bar"><span>${periodLine}</span></div>` : ''}
    <div class="cover-total-box"><span>${isBilling?'請求金額':'支払金額'}</span><span class="val">${yen(grandTotal)}</span></div>
    <table class="cover-table">
      <thead><tr>
        <th style="width:5%">No</th><th style="width:9%">${isBilling?'取引先ID':'ドライバーID'}</th>
        <th style="width:${isBilling?'22':'14'}%">${isBilling?'取引先名':'ドライバー名'}</th>
        ${isBilling?'':'<th style=\"width:12%\">協力会社</th>'}
        <th>(10%)税込金額</th><th>(内消費税額)</th><th>非課税額</th><th>高速・立替代</th><th>合計金額</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr class="cover-total-row">
        <td colspan="${isBilling?7:8}">合計金額</td><td class="num total">${yen(grandTotal)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

// 鑑（表紙）付きの一括PDF：表紙ページ→各件の明細書をページを分けて連続出力する
function buildStatementHtmlMultiWithCover(side, rowGroups, addressee) {
  const cover = buildCoverPageHtml(side, rowGroups, addressee);
  const inners = rowGroups.map(rows => buildStatementDocInner(side, rows)).join('');
  const title = side === 'billing' ? '請求明細書_鑑' : '支払明細書_鑑';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>${getDocCss()}${statementDocStyle()}
  .doc{page-break-after:always}
  .doc:last-child{page-break-after:auto}
  .cover-addressee{font-size:16px;font-weight:700;margin:18px 0 4px}
  .cover-addressee-meta{font-size:11px;color:var(--text);line-height:1.8;margin-bottom:14px}
  table.cover-table{width:100%;border-collapse:collapse;margin:14px 0;table-layout:fixed}
  table.cover-table th,table.cover-table td{border:1px solid var(--border);padding:6px 5px;font-size:10.5px;text-align:center;color:var(--text)}
  table.cover-table th{background:var(--bg2);font-weight:600}
  table.cover-table td.cname{text-align:left}
  table.cover-table td.num{font-variant-numeric:tabular-nums}
  /* 合計金額欄のみ、色ではなく文字サイズで強調する */
  table.cover-table td.total{font-size:13px;font-weight:700}
  table.cover-table tfoot td{background:var(--bg2);font-weight:700}
  .cover-total-box{display:flex;justify-content:space-between;align-items:center;border:1.5px solid var(--border);padding:12px 18px;margin:4px 0 14px;font-size:15px;font-weight:700}
  .cover-total-box .val{font-size:19px}
  .doc-no-ref{font-size:9px;color:var(--text);font-weight:400;margin-top:2px}
  </style></head><body>
  ${cover}
  ${inners}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;
}

/* ===== 支払明細書PDF（ドライバー向け） ===== */
function printPnlPdf(drvId, month, explicitRows) {
  const drv = drvs.find(d=>d.id===drvId);
  if (!drv) return;
  const monthRecs = explicitRows || recs.filter(r=>r.date?.startsWith(month)&&(drv.cars||[]).some(c=>nm(c)===nm(r.car)));
  if (!monthRecs.length) { alert('対象データがありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtml('payment', monthRecs));
}

/* ===== 請求書PDF（取引先向け） ===== */
function printInvoicePdf(cliId, month, explicitRows) {
  const cli = clients.find(c=>c.id===cliId);
  if (!cli) return;
  const monthRecs = explicitRows || recs.filter(r=>r.date?.startsWith(month)&&r.cli===cliId);
  if (!monthRecs.length) { alert('対象データがありません'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtml('billing', monthRecs));
}
