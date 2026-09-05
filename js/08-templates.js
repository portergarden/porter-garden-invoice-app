/* js/08-templates.js
   テンプレート・マッピングの読み込みと、セットアップSQLの案内

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

/* ============================================================
   v12: テンプレート・マッピング Supabase移行
        + localStorage旧データ自動移行
   ============================================================ */

/* ===== テンプレート読込 ===== */
async function loadTemplates() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('input_templates').select('*').order('name').order('id'));
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) {
        // localStorageの旧データを移行
        const old = JSON.parse(localStorage.getItem('pg_templates')||'[]');
        if (old.length) {
          q0Templates = old;
          showT('⚠ input_templatesテーブルが未作成です','twa');
        }
        return;
      }
      throw error;
    }
    q0Templates = data || [];
    // localStorage旧データがあれば自動移行
    const oldLocal = JSON.parse(localStorage.getItem('pg_templates')||'[]');
    if (oldLocal.length && !q0Templates.length) {
      await migrateTemplatesFromLocal(oldLocal);
    }
  } catch(e) { console.warn('loadTemplates:', e.message); }
}

async function migrateTemplatesFromLocal(localData) {
  try {
    const rows = localData.map(t=>({
      name: t.name||'',
      cli: t.cli||null,
      car: t.car||'',
      type: t.type||'regular',
      fare: t.fare||0,
      hw: t.hw||0,
      oth: t.oth||0,
      tax: t.tax??10,
      note: t.note||'',
      created_by: me?.name||'',
    }));
    const {data, error} = await sb.from('input_templates').insert(rows).select();
    if (!error) {
      q0Templates = data||[];
      localStorage.removeItem('pg_templates');
      showT(`テンプレート${rows.length}件をSupabaseに移行しました`);
    }
  } catch(e) { console.warn('migrate templates:', e.message); }
}

/* ===== マッピング読込 ===== */
async function loadMappings() {
  if (!sb) return;
  try {
    const {data, error} = await fetchAllRows(() => sb.from('file_mappings').select('*').order('id'));
    if (error) {
      if (error.message.includes('does not exist')||error.message.includes('relation')) {
        // localStorageの旧データを移行
        const old = JSON.parse(localStorage.getItem('pg_file_mappings')||'{}');
        if (Object.keys(old).length) {
          fileMappings = old;
          showT('⚠ file_mappingsテーブルが未作成です','twa');
        }
        return;
      }
      throw error;
    }
    // cli_idをキーにしたオブジェクトに変換
    fileMappings = {};
    (data||[]).forEach(m => { fileMappings[m.cli_id] = m; });
    // localStorage旧データがあれば自動移行
    const oldLocal = JSON.parse(localStorage.getItem('pg_file_mappings')||'{}');
    if (Object.keys(oldLocal).length && !Object.keys(fileMappings).length) {
      await migrateMappingsFromLocal(oldLocal);
    }
  } catch(e) { console.warn('loadMappings:', e.message); }
}

async function migrateMappingsFromLocal(localData) {
  try {
    const rows = Object.entries(localData).map(([cliId, m])=>({
      cli_id: +cliId,
      col_date: m.date||0,
      col_driver: m.driver||0,
      col_fare: m.fare||0,
      col_hw: m.hw||0,
      col_note: m.note||0,
      skip_rows: m.skip||1,
    }));
    const {data, error} = await sb.from('file_mappings').insert(rows).select();
    if (!error) {
      fileMappings = {};
      (data||[]).forEach(m=>{ fileMappings[m.cli_id]=m; });
      localStorage.removeItem('pg_file_mappings');
      showT(`マッピング設定${rows.length}件をSupabaseに移行しました`);
    }
  } catch(e) { console.warn('migrate mappings:', e.message); }
}

/* ===== SQL案内 ===== */
function showTemplateSql() { openSetupSqlGuide('input_templates / file_mappings'); }

function showMappingSql() { showTemplateSql(); }
