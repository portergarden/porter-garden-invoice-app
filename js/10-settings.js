/* js/10-settings.js
   会社設定、セットアップページ、入金管理、銀行明細CSVの取込と自動消込

   このファイルは index.html から読み込まれます。読み込む順番に意味があるので、
   index.html の <script> の並びを入れ替えないでください。 */

const SETUP_SQL = `-- ポーターガーデン Supabase セットアップSQL（全テーブル・現行スキーマ準拠）
-- SQL EditorにコピーしてRunをクリック
-- 認証はSupabase Authに一本化されています。新規導入時は本SQL実行後、
-- Authでユーザーを1人作成し、そのauth_uidを使って手動で最初のadminユーザーを
-- 1行だけ登録してください（例は末尾のコメントを参照）。以降のユーザー管理はアプリのUIから行えます。

-- ============================================================
-- 1. テーブル定義
-- ============================================================

-- 取引先
CREATE TABLE IF NOT EXISTS clients (
  id bigserial PRIMARY KEY, name text NOT NULL,
  short text, person text, tel text, note text,
  closing_day text DEFAULT 'end', fee_rate numeric DEFAULT 0,
  zip text, address text,
  pay_month_offset int DEFAULT 1, pay_day text DEFAULT 'end',
  invoice_no text,
  client_no text UNIQUE,  -- 表示・並び替え用の会社ID。支店は「親ID-枝番」（例: 147-3）で持つ
  send_method text, -- 請求書の既定の送付方式（タスク管理タブで毎月の既定値として使う）
  name_kana text,   -- 会社名の読み（アイウエオ順の並び替え用）。未入力なら名称から自動生成した読みを使う
  -- ここから下は、旧 partner_companies（協力会社管理）を統合したときに合流した項目。
  -- 同じ会社が取引先と協力会社の2レコードに割れていて、住所や締日は取引先側、
  -- 支払サイクルや振込先は協力会社側にしか無い状態だったため、1社1レコードにまとめた。
  kind text NOT NULL DEFAULT 'customer'
    CHECK (kind IN ('customer','supplier','lease','branch')),  -- 主区分: 取引先 / 協力会社 / リース会社 / 自社支店
  is_lease boolean NOT NULL DEFAULT false,  -- 車両リース会社としても使う（区分と兼務できる）
  bank text,                                -- 支払先の振込先
  pay_out_month_offset int DEFAULT 2,       -- ドライバー供給を受けた場合の支払サイクル
  pay_out_day text DEFAULT 'end',
  pay_out_fee_rate numeric DEFAULT 0,
  legacy_partner_id bigint                  -- 統合前の協力会社ID（追跡・切り戻し用）
);

-- 協力会社（ドライバーを供給している会社・仕事をくれる会社・車両リース会社のマスタ）
-- ⚠ 旧テーブル。2026-09 に clients へ統合済みで、アプリはもう読み書きしない。
--    切り戻しできるよう当面は残しているが、新規の登録は clients 側に行う。
CREATE TABLE IF NOT EXISTS partner_companies (
  id bigserial PRIMARY KEY, name text NOT NULL,
  partner_no text UNIQUE,       -- 協力会社ID（他タブのclient_no/supplier_idと同形式の連番）
  is_lease boolean NOT NULL DEFAULT false, -- 車両リース会社（ドライバーの車両リース代の支払先）として使う
  kind text NOT NULL DEFAULT 'partner' CHECK (kind IN ('branch','lease','partner')), -- 主区分: 'branch'（自社支店・支社）| 'lease'（車両リース会社）| 'partner'（協力会社）。兵ねている役割は is_lease / client_id / drivers.partner_id から派生するバッジで併記する
  short text, zip text, address text, person text, tel text,
  bank text, invoice_no text,
  pay_out_month_offset int DEFAULT 2, pay_out_day text DEFAULT 'end', pay_out_fee_rate numeric DEFAULT 0, -- 支払設定（ドライバー供給時）
  fee_rate numeric DEFAULT 0,
  pay_month_offset int DEFAULT 1, pay_day text DEFAULT 'end', -- 入金設定（仕事をくれる取引先時）
  client_id integer REFERENCES clients(id) ON DELETE SET NULL UNIQUE, -- 同じ会社を取引先としても登録している場合の対応レコード（表示・相互リンク専用）
  note text, created_at timestamptz NOT NULL DEFAULT now()
);

-- 協力会社の添付書類（契約書・許可証など。種別は固定せず自由入力）
CREATE TABLE IF NOT EXISTS partner_company_docs (
  id bigserial PRIMARY KEY,
  client_id bigint REFERENCES clients(id) ON DELETE CASCADE,  -- 添付先の会社（統合後はこちらを使う）
  partner_id bigint,  -- 統合前の協力会社ID（切り戻し用）
  title text NOT NULL, file_path text NOT NULL, expiry_date date,
  note text DEFAULT '', uploaded_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ドライバー
CREATE TABLE IF NOT EXISTS drivers (
  id bigserial PRIMARY KEY, name text NOT NULL,
  cars text[] DEFAULT '{}', tel text, supplier_id text UNIQUE,
  fee_rate numeric DEFAULT -0.15, admin_fee int DEFAULT -10000,
  vehicle_rental int DEFAULT -30000,
  closing_day text DEFAULT 'end',
  pay_month_offset int DEFAULT 2, pay_day text DEFAULT 'end',
  invoice_no text, other_deductions jsonb NOT NULL DEFAULT '[]',
  bank text, company text, note text, lease_company text,
  company_client_id bigint REFERENCES clients(id) ON DELETE SET NULL, -- 所属会社（会社マスタへの直接紐づけ。companyは表示・集計用の複製）
  partner_id bigint, -- 統合前の協力会社ID。参照はしていないが切り戻し用に残している
  hide_statement boolean NOT NULL DEFAULT false,
  is_company boolean NOT NULL DEFAULT false,  -- 旧：会社を支払先とするドライバーレコード。2026-09に会社マスタへ移し、現在は常にfalse
  email text,           -- LINE未連携時の通知先メールアドレス
  line_user_id text,    -- LINE通知の宛先（webhook経由で連携コード照合時に自動設定）
  line_link_code text,  -- ドライバーがLINE公式アカウントに送信する連携コード
  status text NOT NULL DEFAULT 'active' -- 'active'（稼働中） | 'terminated'（解約済み）
);

-- 車両乗務履歴（車番ごとに過去〜現在の使用ドライバーを記録。drivers.carsの自動判定とは独立した台帳）
CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id bigserial PRIMARY KEY,
  car text NOT NULL,
  driver_id bigint REFERENCES drivers(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date,          -- 未設定=現在も使用中
  daily_rate int,         -- 自社の代車などを日額リースとして貸す場合の単価（任意）
  note text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_assignments_car_idx ON vehicle_assignments (car);

-- 支払明細書「その他の項目」の集計期間ごとの上書き
-- 行が無ければ drivers.other_deductions（毎月固定の控除）＋vehicle_assignmentsからの代車リース自動計算を使う。
-- 行があれば items をそのままその期間の「その他の項目」として使う（削除すれば自動計算に戻る）
CREATE TABLE IF NOT EXISTS pay_adjustments (
  id bigserial PRIMARY KEY,
  cli_id bigint NOT NULL REFERENCES clients(id) ON DELETE CASCADE,  -- 対象の会社（会社マスタ）
  period_from date NOT NULL,   -- 支払集計タブの集計期間（開始）
  period_to date NOT NULL,     -- 支払集計タブの集計期間（終了）
  items jsonb NOT NULL DEFAULT '[]',  -- [{name, amount}] 控除はマイナス金額
  note text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (cli_id, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS pay_adjustments_cli_idx ON pay_adjustments(cli_id);
ALTER TABLE pay_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_adjustments_select" ON pay_adjustments FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "pay_adjustments_insert" ON pay_adjustments FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
CREATE POLICY "pay_adjustments_update" ON pay_adjustments FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
CREATE POLICY "pay_adjustments_delete" ON pay_adjustments FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 車両マスタ。車両に関する登録はここに集約し、車両管理タブの「車両カルテ」1画面で
-- 種別・リース会社・車検/保険の期限・日額リース料・使用者（vehicle_assignments）まで扱う。
-- ドライバー登録で車番を追加すると、この表にも種別「未分類」で自動作成される。
-- ドライバー登録済みで台帳に無い車番は、車両管理の「未登録の車番を取り込む」でまとめて入れられる
-- （取り込むのは稼働中ドライバーのフル表記の車番のみ。数字だけの略式車番と解約済みドライバーの車番は入れない）。
CREATE TABLE IF NOT EXISTS vehicles (
  id bigserial PRIMARY KEY,
  car text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'scrapped'（廃車）
  vehicle_type text NOT NULL DEFAULT 'company', -- 'company'（自社所有） | 'brought'（持ち込み・ドライバー所有） | 'lease'（リース会社から借用）。'own'は旧値（持ち込み・自社所有が未分離だった頃）で、編集時に'company'へ移行される
  lease_company text,      -- vehicle_type='lease'の場合の借用元会社名（協力会社管理のリース会社と同名で紐づけ）
  shaken_expiry date,      -- 車検満了日（ドライバーの車検証提出と自動連動）
  jibai_expiry date,       -- 自賠責保険満了日（ドライバーの自賠責保険提出と自動連動）
  nini_expiry date,        -- 任意保険満了日（ドライバーの任意保険提出と自動連動）
  daily_rate int,          -- 代車として貸す場合の日額（乗務履歴の記録時にデフォルト値として使用）
  note text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 通知送信履歴（LINE/メール通知の重複送信防止と送達確認用。書き込みはEdge Function(service role)のみ）
CREATE TABLE IF NOT EXISTS notify_log (
  id bigserial PRIMARY KEY,
  drv_id integer REFERENCES drivers(id) ON DELETE CASCADE,
  kind text NOT NULL,            -- 'board' | 'chat' | 'doc_expiry' | 'statement'
  ref text NOT NULL DEFAULT '',  -- 対象の識別子（投稿ID・書類種別+期限日など）
  channel text NOT NULL,         -- 'line' | 'email'
  status text NOT NULL DEFAULT 'sent',  -- 'sent' | 'error' | 'skipped'
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notify_log_dedupe_idx ON notify_log (drv_id, kind, ref);

-- ドライバー招待（QR/URL経由の自己登録用）
CREATE TABLE IF NOT EXISTS driver_invites (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  token text NOT NULL UNIQUE,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  driver_id integer REFERENCES drivers(id) ON DELETE SET NULL, -- ドライバー削除時にFK違反で失敗しないよう、招待履歴側はNULLにするだけにする
  -- 発行時に決めた宛先。入っていると、その招待では指定した1人にしか合流できない。
  -- 無いと招待URLの持ち主が他人の氏名を入力して、そのドライバーとして登録できてしまう
  target_driver_id integer REFERENCES drivers(id) ON DELETE SET NULL,
  created_new boolean,          -- 新規ドライバーを作った登録か、既存へ合流した登録か
  login_issued_at timestamptz   -- 1枚の招待で発行できるログインは1つだけ（削除済みアカウントの復活を防ぐ）
);

-- ユーザー（認証はSupabase Auth。pwは廃止済み・互換用にnullable列のみ残置）
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text NOT NULL, pw text,
  role text NOT NULL DEFAULT 'viewer',
  auth_uid uuid UNIQUE REFERENCES auth.users(id),
  driver_id int REFERENCES drivers(id),
  must_change_password boolean NOT NULL DEFAULT false
);

-- 従業員予定管理（管理・編集・閲覧ユーザーのスケジュール登録）
CREATE TABLE IF NOT EXISTS staff_schedules (
  id bigserial PRIMARY KEY,
  user_id text REFERENCES users(id),
  title text NOT NULL,
  date date NOT NULL,
  start_time text,
  end_time text,
  note text,
  created_by text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_schedules_select" ON staff_schedules FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "staff_schedules_insert" ON staff_schedules FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "staff_schedules_update" ON staff_schedules FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "staff_schedules_delete" ON staff_schedules FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));

-- タスク管理
CREATE TABLE IF NOT EXISTS tasks (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  assignee_user_id text REFERENCES users(id),
  due_date date,
  status text NOT NULL DEFAULT 'todo',    -- 'todo' | 'doing' | 'done'
  priority text NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high'
  note text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  requester_user_id text REFERENCES users(id),  -- 依頼者。担当者と別なら「依頼」として扱う
  acknowledged_at timestamptz  -- 依頼を受け取った担当者本人がレ点を付けた日時。未入力の依頼だけがダッシュボードのお知らせに出る
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));

-- 請求書・支払明細書の月次送付進行管理（送付管理タブ。取引先×対象月で1行）
-- 取引先マスタを毎月の行として自動で並べ、請求金額・請求日は invoices から自動集計するため、
-- ここに保存するのは進行状況（送付方式の上書き・ステータス・担当者・提出日・備考）だけ
CREATE TABLE IF NOT EXISTS billing_progress (
  id bigserial PRIMARY KEY,
  month text NOT NULL,                      -- 対象月 'YYYY-MM'
  cli_id bigint NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- 請求書発行の実務の流れ順。「今月は取引がない」は進捗ではないので target 側で持つ
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','drafting','review','issued','awaiting_send','sent','done')),
    -- todo=未着手 / drafting=作成中 / review=確認待ち / issued=発行済
    -- awaiting_send=送付待ち / sent=送付済 / done=完了
  target boolean NOT NULL DEFAULT true,     -- 当月この取引先の請求業務があるか（OFFなら集計から除外）
  send_method text,                         -- 提出方法 'mail'/'fax'/'post'/'hand'/'web'/'mail_post'
  arrival_method text,                      -- 到着方法（同じ選択肢）
  assignee_user_id text REFERENCES users(id),
  check_user_id text REFERENCES users(id),
  checked boolean NOT NULL DEFAULT false,   -- チェック担当者のチェックが完了したか
  arrival_date date,      -- 明細到着日（取引先から支払明細が届いた日）
  submitted_date date,    -- 明細提出日（入力するとステータスが自動で送付済になる）
  planned_date date,      -- 提出期限。未設定なら clients の提出ルールから毎月自動計算する
  manual boolean NOT NULL DEFAULT false,    -- 手動で一覧に追加した行か（請求実績が無くても表示する）
  manual_amt integer,                       -- 手動追加行の請求金額（請求合計にも加算する）
  note text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (month, cli_id)
);
-- 取引先ごとの提出ルール（タスク管理の提出期限を毎月自動計算するためのマスタ）
-- submit_rule_type: 'day'=毎月N日 / 'month_end'=月末 / 'next_month_day'=翌月N日 / 'none'=期限なし
ALTER TABLE clients ADD COLUMN IF NOT EXISTS submit_rule_type text
  CHECK (submit_rule_type IS NULL OR submit_rule_type IN ('day','month_end','next_month_day','none'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS submit_rule_day integer
  CHECK (submit_rule_day IS NULL OR (submit_rule_day BETWEEN 1 AND 31));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS send_memo text;
-- 親会社（本社）。支店・営業所ごとに1件ずつ登録した取引先を、請求はそのままに一覧上でまとめるために使う
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES clients(id) ON DELETE SET NULL;  -- 送付時の注意書き（タスク管理の一覧に表示）
CREATE INDEX IF NOT EXISTS billing_progress_month_idx ON billing_progress(month);
ALTER TABLE billing_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_progress_select" ON billing_progress FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "billing_progress_insert" ON billing_progress FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "billing_progress_update" ON billing_progress FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
CREATE POLICY "billing_progress_delete" ON billing_progress FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 請求書・受注データ
CREATE TABLE IF NOT EXISTS invoices (
  id bigserial PRIMARY KEY,
  date text NOT NULL, car text NOT NULL, type text NOT NULL DEFAULT 'regular',
  fare int DEFAULT 0, hw int DEFAULT 0, oth int DEFAULT 0,
  tax int DEFAULT 10, st int DEFAULT 0, cli bigint REFERENCES clients(id),
  note text, created_at timestamptz DEFAULT now(),
  pay_fare int DEFAULT 0, pay_hw int DEFAULT 0, pay_oth int DEFAULT 0,
  delivery_status text DEFAULT 'unconfirmed',
  call_number text, requester text, shipper text,
  pickup_date text, pickup_time text, pickup_done boolean DEFAULT false, pickup_location text,
  delivery_time text, delivery_done boolean DEFAULT false, delivery_location text,
  task_name text, qty numeric, distance_time text, pay_count_note text, receiver text,
  fare_calc_method text DEFAULT 'qty', pay_calc_method text DEFAULT 'qty',
  fare_tax_class text DEFAULT 'excl', pay_tax_class text DEFAULT 'excl',
  extra_fees jsonb DEFAULT '[]', driver_note text,
  sales_date text, invoice_payment_date text,
  drv_id bigint, tax_round text, tax_amount numeric
);

-- 監査ログ
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, ts text, who text, action text, detail text, role text,
  created_at timestamptz DEFAULT now()
);

-- 支払明細書（保存済みPDF元データ）
CREATE TABLE IF NOT EXISTS payment_slips (
  id bigserial PRIMARY KEY, label text NOT NULL, pay_month text,
  rows jsonb NOT NULL DEFAULT '[]', saved_at timestamptz NOT NULL DEFAULT now(), saved_by text
);

-- 請求明細書（保存済みPDF元データ）
CREATE TABLE IF NOT EXISTS invoice_slips (
  id bigserial PRIMARY KEY, label text NOT NULL, invoice_month text,
  rows jsonb NOT NULL DEFAULT '[]', saved_at timestamptz NOT NULL DEFAULT now(), saved_by text
);

-- 乗務日報（貨物軽自動車運送事業 法定様式準拠）
CREATE TABLE IF NOT EXISTS daily_reports (
  id bigserial PRIMARY KEY, date date NOT NULL, car text NOT NULL,
  driver_name text, start_time time, end_time time, distance_km numeric,
  type text DEFAULT 'regular', alc_before numeric, alc_after numeric,
  alc_device text, health_before text DEFAULT 'good', health_after text DEFAULT 'good',
  -- 点呼記録簿の法定記録事項（貨物自動車運送事業輸送安全規則 第7条／
  -- 国交省「貨物軽自動車運送事業者の皆様へ（点呼記録簿の例）」）。
  -- 運転者名・車両番号・酒気帯び・日常点検は上下の既存列で満たしている。
  -- 中間点呼は一般貨物のみ（貨物軽の様式に欄が無い）ため列を作らない。
  tenko_executor text,          -- ① 点呼執行者名。貨物軽の一人事業者は自ら実施でき対面扱い
  tenko_before_at time,         -- ④ 乗務前の点呼日時
  tenko_after_at time,          -- ④ 乗務後の点呼日時
  alc_detector_used boolean NOT NULL DEFAULT true,  -- ⑤イ アルコール検知器の使用の有無
  tenko_method text NOT NULL DEFAULT 'face'
    CHECK (tenko_method IN ('face','phone','remote','auto','other')),  -- ⑤ロ 点呼方法
  tenko_method_note text,       -- ⑤ロ 対面でない場合の具体的方法
  health_illness_ok boolean NOT NULL DEFAULT true,  -- ⑦ 疾病
  health_fatigue_ok boolean NOT NULL DEFAULT true,  -- ⑦ 疲労
  health_sleep_ok   boolean NOT NULL DEFAULT true,  -- ⑦ 睡眠不足
  tenko_instructions text,      -- ⑨ 指示事項
  route_report text,            -- 業務後⑥ 自動車・道路及び運行の状況
  handover_note text,           -- 業務後⑦ 交替運転者等に対する通告
  -- 対面以外を選んだら具体的方法を必ず残す（監査で見られるのは記録そのものなのでDB側で担保する）
  CONSTRAINT daily_reports_tenko_method_note_check
    CHECK (tenko_method = 'face' OR COALESCE(btrim(tenko_method_note), '') <> ''),
  cli bigint, qty_takkyubin int DEFAULT 0, qty_nekopos int DEFAULT 0, qty_charter int DEFAULT 0,
  qty_other int DEFAULT 0, fare int DEFAULT 0, hw int DEFAULT 0, oth int DEFAULT 0,
  note text, status text DEFAULT 'pending', submitted_by text,
  reviewed_by text, reviewed_at timestamptz,
  insp_tire bool DEFAULT true, insp_brake bool DEFAULT true,
  insp_light bool DEFAULT true, insp_wiper bool DEFAULT true,
  insp_engine bool DEFAULT true, insp_mirror bool DEFAULT true,
  insp_horn bool DEFAULT true, insp_battery bool DEFAULT true,
  insp_cargo bool DEFAULT true, insp_fuel bool DEFAULT true,
  insp_note text, created_at timestamptz DEFAULT now(),
  start_location text, end_location text,
  rest_start time, rest_end time, rest_location text, -- 旧形式（後方互換用）。新規記録はrestsを使用
  rests jsonb DEFAULT '[]', -- 複数回の休憩を[{start,end,location}]の配列で記録
  -- 1日に複数回の運行（チャーターを午前・午後で別の取引先など）。
  -- 運行ごとに日報を分けると点呼記録まで分かれてしまうため、日報は1日1枚のままにして運行だけを配列で持つ。
  -- [{cli_id, cli_name, start, end, start_loc, end_loc, qty_tak, qty_neko, qty_charter, qty_other, note}]
  -- 上の start_time / end_time / cli / qty_* にはこの配列から積み上げた値を入れており、
  -- 月報・分析・CSV・印刷は従来どおりそちらを参照する。取引先は運行ごとに必須。
  trips jsonb NOT NULL DEFAULT '[]',
  -- 車のメーター（オドメーター）。乗務前・乗務後の点呼のときはドライバーが車の前にいるので、
  -- その場で読み取れる。両方入っていれば distance_km は差分から自動計算する。
  -- 代車への乗り換えなどでメーターが連続しない日もあるため、メーターは任意・距離は必須のまま。
  start_odometer integer,
  end_odometer integer,
  CONSTRAINT daily_reports_odometer_check
    CHECK (start_odometer IS NULL OR end_odometer IS NULL OR end_odometer >= start_odometer),
  wait_flag boolean DEFAULT false, wait_start time, wait_end time, wait_location text,
  cargo_work_flag boolean DEFAULT false, cargo_work_start time, cargo_work_end time,
  shipper_confirmed boolean DEFAULT false,
  incident_flag boolean DEFAULT false, incident_cause text, incident_prevention text,
  drv_id int REFERENCES drivers(id)
);

-- 支払スケジュール（ドライバーへの支払予定）
CREATE TABLE IF NOT EXISTS payment_schedules (
  id bigserial PRIMARY KEY, drv_id bigint, drv_name text,
  date date NOT NULL, amt int DEFAULT 0, month text, note text,
  done bool DEFAULT false, created_at timestamptz DEFAULT now(),
  source text DEFAULT 'manual'
);

-- 入金予定（取引先からの入金予定）
CREATE TABLE IF NOT EXISTS receipt_schedules (
  id bigserial PRIMARY KEY, cli_id bigint, cli_name text,
  date date NOT NULL, amt int DEFAULT 0, month text, note text,
  done bool DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'manual'
);

-- 掲示板
CREATE TABLE IF NOT EXISTS board_posts (
  id bigserial PRIMARY KEY, title text NOT NULL, body text,
  priority text DEFAULT 'normal', author text,
  created_at timestamptz DEFAULT now(),
  target_driver_ids integer[], attachment_path text, attachment_name text,
  publish_at timestamptz, recurrence_id text
);

-- ドライバーとのチャット（管理者/editor ⇔ 本人）
CREATE TABLE IF NOT EXISTS driver_messages (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  drv_id integer NOT NULL REFERENCES drivers(id),
  sender_role text NOT NULL CHECK (sender_role IN ('admin','driver')),
  sender_name text,
  body text,                 -- ファイル添付のみの送信も許可するためNULL可
  file_path text,             -- 添付ファイル（chat-filesバケット内のパス）
  file_name text,
  file_type text,
  file_size int,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
-- チャットを更新せず双方向にリアルタイム反映させるため、Realtimeのpublicationに追加する
ALTER PUBLICATION supabase_realtime ADD TABLE driver_messages;
-- チャット添付ファイル用ストレージバケット（drv{driver_id}/配下に保存。RLSはdriver-docsと同じ本人フォルダ制限パターン）
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-files', 'chat-files', false) ON CONFLICT (id) DO NOTHING;

-- 手入力テンプレート
CREATE TABLE IF NOT EXISTS input_templates (
  id bigserial PRIMARY KEY, name text NOT NULL, cli bigint,
  car text, type text DEFAULT 'regular', fare int DEFAULT 0,
  hw int DEFAULT 0, oth int DEFAULT 0, tax int DEFAULT 10,
  note text, created_by text, created_at timestamptz DEFAULT now(),
  tax_class text DEFAULT 'excl'
);

-- ファイル取込マッピング
CREATE TABLE IF NOT EXISTS file_mappings (
  id bigserial PRIMARY KEY, cli_id bigint UNIQUE NOT NULL,
  col_date int DEFAULT 0, col_driver int DEFAULT 0,
  col_fare int DEFAULT 0, col_hw int DEFAULT 0,
  col_note int DEFAULT 0, skip_rows int DEFAULT 1,
  mapping_name text, created_at timestamptz DEFAULT now(),
  col_car int DEFAULT 0, col_detail int DEFAULT 0, col_qty int DEFAULT 0,
  col_price int DEFAULT 0, col_amount int DEFAULT 0,
  default_type text NOT NULL DEFAULT 'regular',
  default_tax_round text NOT NULL DEFAULT 'round',
  hw_as_advance boolean NOT NULL DEFAULT false,
  default_type_by_month jsonb DEFAULT '{}'
);

-- 単価マスタ
CREATE TABLE IF NOT EXISTS price_master (
  id bigserial PRIMARY KEY, cli_id bigint NOT NULL,
  service_name text NOT NULL, unit_price int NOT NULL,
  unit text DEFAULT '個', created_at timestamptz DEFAULT now(),
  UNIQUE(cli_id, service_name)
);

-- 入金管理（実績）
CREATE TABLE IF NOT EXISTS payment_in (
  id bigserial PRIMARY KEY, date date NOT NULL, amt int NOT NULL,
  cli_id bigint, target_month text, type text DEFAULT 'transfer',
  note text, matched bool DEFAULT false, matched_inv_ids jsonb,
  created_at timestamptz DEFAULT now()
);

-- 銀行明細CSVの振込人名と取引先の対応表（取込時に選ぶと学習し、次回から自動マッチング）
CREATE TABLE IF NOT EXISTS bank_payer_aliases (
  id bigserial PRIMARY KEY,
  payer_name text NOT NULL UNIQUE,
  cli_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 会社設定（1行のみ）
CREATE TABLE IF NOT EXISTS company_settings (
  id int PRIMARY KEY DEFAULT 1, reg_no text, name text,
  zip text, address text, tel text, bank text,
  updated_at timestamptz DEFAULT now(), stamp_image text,
  line_add_url text,  -- LINE公式アカウントの友だち追加URL（ドライバーポータルの連携案内に表示）
  supabase_plan text NOT NULL DEFAULT 'free' -- セットアップページのSupabase使用量表示で基準にするプラン（'free'|'pro'）
);

-- ドライバー提出書類（免許証・車検証等）
CREATE TABLE IF NOT EXISTS driver_documents (
  id bigserial PRIMARY KEY, drv_id int NOT NULL REFERENCES drivers(id),
  doc_type text NOT NULL, file_path text NOT NULL,
  expiry_date date, note text DEFAULT '', uploaded_by text DEFAULT '',
  orig_size_bytes bigint,        -- 圧縮前のファイルサイズ（提出書類一覧に表示）
  compressed_size_bytes bigint,  -- 圧縮後のファイルサイズ（提出書類一覧に表示）
  doc_number text,   -- インボイス登録番号・安全運転管理者番号など
  start_date date,   -- 自賠責・任意保険の開始日
  attend_date date,  -- 安全管理者講習の受講日
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

-- ドライバー向け支払明細書配信
CREATE TABLE IF NOT EXISTS driver_statements (
  id bigserial PRIMARY KEY, drv_id int NOT NULL REFERENCES drivers(id),
  month text NOT NULL, title text NOT NULL DEFAULT '', file_path text NOT NULL,
  amount int DEFAULT 0, published_by text DEFAULT '',
  created_at timestamptz DEFAULT now(), read_at timestamptz,
  acknowledged_at timestamptz -- ドライバー本人が「受領確認」した日時（未確認でも配信から2週間経過で自動的に確認済み扱いにする）
);

-- ============================================================
-- 2. 権限判定用ヘルパー関数（SECURITY DEFINER: usersテーブルのRLSに関係なく
--    ログイン中ユーザー自身の行だけを安全に参照する）
-- ============================================================
CREATE OR REPLACE FUNCTION public."current_role"()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT role FROM public.users WHERE auth_uid = auth.uid() LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id FROM public.users WHERE auth_uid = auth.uid() LIMIT 1;
$function$;

-- ドライバーが取引先名だけを参照できるようにする窓口（clients本体はadmin/editor/viewer限定のため）。
-- ログイン済み専用（anonに開けると取引先名一覧が誰でも取得できてしまう）
CREATE OR REPLACE FUNCTION public.list_client_names()
RETURNS TABLE(id bigint, name text) LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id, name FROM clients ORDER BY name;
$function$;
REVOKE EXECUTE ON FUNCTION public.list_client_names() FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_client_names() FROM public;
GRANT EXECUTE ON FUNCTION public.list_client_names() TO authenticated;

-- セットアップページのSupabase使用量表示用（DB容量・ストレージ容量・認証ユーザー数）。管理者/編集者のみ実行可
CREATE OR REPLACE FUNCTION public.get_supabase_usage()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  result jsonb;
BEGIN
  IF public."current_role"() NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  SELECT jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'storage_bytes', (SELECT COALESCE(SUM((o.metadata->>'size')::bigint),0) FROM storage.objects o),
    'auth_users', (SELECT COUNT(*) FROM auth.users)
  ) INTO result;
  RETURN result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_supabase_usage() TO authenticated;

-- 初回パスワード変更完了フラグをドライバー本人が消すための専用RPC
-- （usersテーブルのUPDATEポリシーはadmin専用のため、本人の直接UPDATEは0行で静かに失敗する）
CREATE OR REPLACE FUNCTION public.clear_own_password_flag()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.users SET must_change_password = false WHERE auth_uid = auth.uid();
$function$;
REVOKE EXECUTE ON FUNCTION public.clear_own_password_flag() FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_own_password_flag() FROM public;
GRANT EXECUTE ON FUNCTION public.clear_own_password_flag() TO authenticated;

-- 招待トークンの有効性を確認する（匿名で呼べるが、渡したトークン1件の結果のみ返し、一覧は返さない）
CREATE OR REPLACE FUNCTION public.check_driver_invite(p_token text)
RETURNS TABLE(valid boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_row public.driver_invites%rowtype;
BEGIN
  SELECT * INTO v_row FROM public.driver_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid';
  ELSIF v_row.used_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'used';
  ELSIF v_row.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired';
  ELSE
    RETURN QUERY SELECT true, 'ok';
  END IF;
END;
$function$;

-- 招待トークンを使ってドライバーを自己登録する（匿名で呼べるが、有効なトークンの場合のみ処理を実行する）。
-- 電話番号または氏名（空白除去して比較）が既存ドライバーと一致する場合は新規作成せず、
-- 既存レコードに車番だけ追記する（招待リンクの誤使用・再送による二重登録を防止）。
-- 新規作成時はドライバーID(supplier_id)を「既存の数値の最大値+1」で自動採番する
-- （管理側の「＋ドライバー追加」と同じ採番規則。ログインIDにもこの番号が使われる）。
-- 協力会社名が入力された場合は、既存を探して無ければ partner_companies に作成して紐づける
-- （新規作成時は協力会社番号(partner_no)も自動採番する）
CREATE OR REPLACE FUNCTION public.submit_driver_registration(
  p_token text, p_name text, p_tel text, p_cars text[], p_partner_name text DEFAULT NULL)
RETURNS TABLE(driver_id integer, merged boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row public.driver_invites%rowtype;
  v_existing public.drivers%rowtype;
  v_new_driver_id integer;
  v_merged_cars text[];
  v_car text;
  v_tel text;
  v_next_supplier_id integer;
  v_company_id integer;
  v_partner_name text;
  v_cars_clean text[];
  v_next_client_no integer;
  v_attempt int := 0;
BEGIN
  SELECT * INTO v_row FROM public.driver_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  ELSIF v_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_already_used';
  ELSIF v_row.expires_at < now() THEN
    RAISE EXCEPTION 'token_expired';
  END IF;

  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN RAISE EXCEPTION 'name_required'; END IF;
  v_tel := nullif(trim(coalesce(p_tel,'')),'');
  IF v_tel IS NULL THEN RAISE EXCEPTION 'tel_required'; END IF;

  SELECT array_agg(trim(x)) INTO v_cars_clean FROM unnest(coalesce(p_cars,'{}')) x WHERE trim(x) <> '';
  IF v_cars_clean IS NULL OR array_length(v_cars_clean,1) IS NULL THEN RAISE EXCEPTION 'car_required'; END IF;

  IF v_row.target_driver_id IS NOT NULL THEN
    -- 宛先が決まっている招待。氏名や電話番号での探索はせず、指定された1人にだけ合流する。
    -- URLが第三者に渡っても、別のドライバーになりすますことはできない
    SELECT * INTO v_existing FROM public.drivers WHERE id = v_row.target_driver_id;
    IF v_existing.id IS NULL THEN RAISE EXCEPTION 'target_driver_missing'; END IF;
  ELSE
    -- 宛先未指定の招待。従来どおり電話番号→氏名の順で既存を探すが、
    -- 既存へ合流した場合はログインを自動発行しない（created_new=false をEdge Functionが見る）
    SELECT * INTO v_existing FROM public.drivers WHERE tel = v_tel LIMIT 1;
    IF v_existing.id IS NULL THEN
      SELECT * INTO v_existing FROM public.drivers
        WHERE regexp_replace(name, '\s', '', 'g') = regexp_replace(trim(p_name), '\s', '', 'g') LIMIT 1;
    END IF;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    v_merged_cars := coalesce(v_existing.cars, '{}');
    FOR v_car IN SELECT unnest(v_cars_clean) LOOP
      IF NOT (regexp_replace(v_car, '\s', '', 'g') = ANY(
           SELECT regexp_replace(x, '\s', '', 'g') FROM unnest(v_merged_cars) x)) THEN
        v_merged_cars := array_append(v_merged_cars, v_car);
      END IF;
    END LOOP;
    UPDATE public.drivers
       SET cars = v_merged_cars,
           tel = coalesce(nullif(trim(coalesce(v_existing.tel,'')),''), v_tel)
     WHERE id = v_existing.id;
    UPDATE public.driver_invites
       SET used_at = now(), driver_id = v_existing.id, created_new = false
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_existing.id, true;
  ELSE
    SELECT COALESCE(MAX(supplier_id::int), 0) + 1 INTO v_next_supplier_id
      FROM public.drivers WHERE supplier_id ~ '^\d+$';

    v_company_id := NULL;
    v_partner_name := nullif(trim(coalesce(p_partner_name,'')),'');
    IF v_partner_name IS NOT NULL THEN
      -- 空白を無視して同名の会社を探す（「有限会社　小山運送」と「有限会社小山運送」を同じ会社とみなす）
      SELECT id INTO v_company_id FROM public.clients
        WHERE regexp_replace(name, '\s', '', 'g') = regexp_replace(v_partner_name, '\s', '', 'g') LIMIT 1;
      IF v_company_id IS NULL THEN
        LOOP
          v_attempt := v_attempt + 1;
          SELECT COALESCE(MAX(client_no::int), 0) + 1 INTO v_next_client_no
            FROM public.clients WHERE client_no ~ '^\d+$';
          BEGIN
            INSERT INTO public.clients (name, client_no, kind)
            VALUES (v_partner_name, v_next_client_no::text, 'supplier') RETURNING id INTO v_company_id;
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            IF v_attempt >= 20 THEN
              INSERT INTO public.clients (name, kind)
              VALUES (v_partner_name, 'supplier') RETURNING id INTO v_company_id;
              EXIT;
            END IF;
          END;
        END LOOP;
      END IF;
    END IF;

    INSERT INTO public.drivers (name, tel, cars, supplier_id, company_client_id, company)
    VALUES (trim(p_name), v_tel, v_cars_clean, v_next_supplier_id::text, v_company_id, v_partner_name)
    RETURNING id INTO v_new_driver_id;
    UPDATE public.driver_invites
       SET used_at = now(), driver_id = v_new_driver_id, created_new = true
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_new_driver_id, false;
  END IF;
END;
$function$;

-- ドライバー本人の登録画面用: 入力された車番のうち、既に登録済みのものを返す。
-- 匿名ユーザーが呼ぶため、誰に登録されているか（氏名など）は返さず、入力された車番自体だけを返す。
-- 有効な招待トークンを持つ場合のみ実行できる
CREATE OR REPLACE FUNCTION public.check_cars_registered(p_token text, p_cars text[])
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_row public.driver_invites%rowtype;
  v_dups text[] := '{}';
  v_car text;
BEGIN
  SELECT * INTO v_row FROM public.driver_invites WHERE token = p_token;
  IF NOT FOUND OR v_row.used_at IS NOT NULL OR v_row.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_cars IS NULL THEN RETURN v_dups; END IF;
  FOR v_car IN SELECT unnest(p_cars) LOOP
    CONTINUE WHEN v_car IS NULL OR length(trim(v_car)) = 0;
    IF EXISTS (
      SELECT 1 FROM public.drivers d, unnest(d.cars) c
      WHERE regexp_replace(c, '\s', '', 'g') = regexp_replace(trim(v_car), '\s', '', 'g')
    ) THEN
      v_dups := array_append(v_dups, trim(v_car));
    END IF;
  END LOOP;
  RETURN v_dups;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_driver_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_driver_registration(text, text, text, text[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_cars_registered(text, text[]) TO anon, authenticated;

-- ============================================================
-- 3. RLS有効化＋ポリシー（allow_allではなく役割ベースの安全な制御）
--    admin/editor/viewer=社内ユーザー、driver=業務委託ドライバー本人のみ
-- ============================================================

-- 取引先: 社内のみ閲覧・編集可
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "clients_insert" ON clients;
CREATE POLICY "clients_insert" ON clients FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "clients_update" ON clients;
CREATE POLICY "clients_update" ON clients FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "clients_delete" ON clients;
CREATE POLICY "clients_delete" ON clients FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 協力会社: 社内のみ閲覧・編集可
ALTER TABLE partner_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_companies_select" ON partner_companies;
CREATE POLICY "partner_companies_select" ON partner_companies FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "partner_companies_insert" ON partner_companies;
CREATE POLICY "partner_companies_insert" ON partner_companies FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "partner_companies_update" ON partner_companies;
CREATE POLICY "partner_companies_update" ON partner_companies FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "partner_companies_delete" ON partner_companies;
CREATE POLICY "partner_companies_delete" ON partner_companies FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 車両乗務履歴: 社内は全件、ドライバーは自分の行のみ閲覧可（日報入力で自分が使用中の代車を選択肢に出すため）。編集は社内のみ
ALTER TABLE vehicle_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vehicle_assignments_select" ON vehicle_assignments;
CREATE POLICY "vehicle_assignments_select" ON vehicle_assignments FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR driver_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "vehicle_assignments_insert" ON vehicle_assignments;
CREATE POLICY "vehicle_assignments_insert" ON vehicle_assignments FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "vehicle_assignments_update" ON vehicle_assignments;
CREATE POLICY "vehicle_assignments_update" ON vehicle_assignments FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "vehicle_assignments_delete" ON vehicle_assignments;
CREATE POLICY "vehicle_assignments_delete" ON vehicle_assignments FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 車両マスタ: 社内は全件、ドライバーは自分の車番のみ閲覧・書類提出時の自動連動用に更新可
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated USING (
  "current_role"() = ANY(ARRAY['admin','editor','viewer'])
  OR car = ANY(SELECT unnest(cars) FROM drivers WHERE id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert" ON vehicles FOR INSERT TO authenticated WITH CHECK (
  "current_role"() = ANY(ARRAY['admin','editor'])
  OR car = ANY(SELECT unnest(cars) FROM drivers WHERE id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update" ON vehicles FOR UPDATE TO authenticated USING (
  "current_role"() = ANY(ARRAY['admin','editor'])
  OR car = ANY(SELECT unnest(cars) FROM drivers WHERE id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()))
) WITH CHECK (
  "current_role"() = ANY(ARRAY['admin','editor'])
  OR car = ANY(SELECT unnest(cars) FROM drivers WHERE id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete" ON vehicles FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 協力会社の添付書類: 社内のみ閲覧・編集可
ALTER TABLE partner_company_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_company_docs_select" ON partner_company_docs;
CREATE POLICY "partner_company_docs_select" ON partner_company_docs FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "partner_company_docs_insert" ON partner_company_docs;
CREATE POLICY "partner_company_docs_insert" ON partner_company_docs FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "partner_company_docs_update" ON partner_company_docs;
CREATE POLICY "partner_company_docs_update" ON partner_company_docs FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "partner_company_docs_delete" ON partner_company_docs;
CREATE POLICY "partner_company_docs_delete" ON partner_company_docs FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ドライバー: 社内は全件、ドライバー本人は自分の行のみ閲覧可
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drivers_select" ON drivers;
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "drivers_insert" ON drivers;
CREATE POLICY "drivers_insert" ON drivers FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "drivers_update" ON drivers;
CREATE POLICY "drivers_update" ON drivers FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "drivers_delete" ON drivers;
CREATE POLICY "drivers_delete" ON drivers FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ユーザー: 編集・削除はadminのみ。
-- 閲覧は「自分の行」に加えて、社内メンバー(admin/editor/viewer)は社内ユーザーの行も読める。
-- 以前は自分の行しか読めず、予定管理の色分け凡例・担当者プルダウンやタスク管理の担当者選択に
-- 自分しか出てこなかったため。ドライバーのログインアカウントは業務上参照しないのでadminのみに限定する
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users FOR SELECT TO authenticated USING (
  auth_uid = auth.uid()
  OR "current_role"() = 'admin'
  OR ("current_role"() = ANY(ARRAY['editor','viewer']) AND role <> 'driver')
);
DROP POLICY IF EXISTS "users_insert" ON users;
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK ("current_role"() = 'admin');
DROP POLICY IF EXISTS "users_update" ON users;
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated USING ("current_role"() = 'admin') WITH CHECK ("current_role"() = 'admin');
DROP POLICY IF EXISTS "users_delete" ON users;
CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated USING ("current_role"() = 'admin');

-- 請求書・受注データ: 社内は全件、ドライバーは自分の車番の行のみ閲覧可
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR car IN (SELECT unnest(d.cars) FROM drivers d WHERE d.id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid())));
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update" ON invoices FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete" ON invoices FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 監査ログ: 社内のみ閲覧・追記可（更新・削除は不可＝改ざん防止）
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- 閲覧はadminのみ。操作ログタブ(nt4)が画面上も管理者専用のため、権限設定をそれに揃えている
-- （以前はeditor/viewerも読める設定で、画面には出ないがAPIからは取得できる状態だった）
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT TO authenticated USING ("current_role"() = 'admin');
-- 書き込みは add_audit_log RPC 経由に一本化（who/roleをサーバ側でauth.uid()から確定し偽装を防止）。
-- クライアントからの直接INSERTは許可しない（INSERTポリシーを置かない）。
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE OR REPLACE FUNCTION public.add_audit_log(p_action text, p_detail text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_who text; v_role text;
BEGIN
  -- 未ログインからの書き込みを拒む。anonに実行権が残っていると偽の証跡を無制限に挿し込める
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_logged_in'; END IF;
  SELECT name, role INTO v_who, v_role FROM public.users WHERE auth_uid = auth.uid() LIMIT 1;
  INSERT INTO public.audit_logs (ts, who, action, detail, role)
  VALUES (to_char(now() AT TIME ZONE 'Asia/Tokyo','YYYY/MM/DD HH24:MI:SS'), COALESCE(v_who,'—'), p_action, p_detail, v_role);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.add_audit_log(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_audit_log(text,text) TO authenticated;

-- 支払明細書・請求明細書: 社内のみ閲覧・編集可
ALTER TABLE payment_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_slips_select" ON payment_slips;
CREATE POLICY "payment_slips_select" ON payment_slips FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "payment_slips_insert" ON payment_slips;
CREATE POLICY "payment_slips_insert" ON payment_slips FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_slips_update" ON payment_slips;
CREATE POLICY "payment_slips_update" ON payment_slips FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_slips_delete" ON payment_slips;
CREATE POLICY "payment_slips_delete" ON payment_slips FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE invoice_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_slips_select" ON invoice_slips;
CREATE POLICY "invoice_slips_select" ON invoice_slips FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "invoice_slips_insert" ON invoice_slips;
CREATE POLICY "invoice_slips_insert" ON invoice_slips FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "invoice_slips_update" ON invoice_slips;
CREATE POLICY "invoice_slips_update" ON invoice_slips FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "invoice_slips_delete" ON invoice_slips;
CREATE POLICY "invoice_slips_delete" ON invoice_slips FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 乗務日報: 社内は全件、ドライバーは自分の日報のみ閲覧・編集可（他人の日報は不可）
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_reports_select" ON daily_reports;
CREATE POLICY "daily_reports_select" ON daily_reports FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "daily_reports_insert" ON daily_reports;
-- ドライバーが投入する日報は drv_id が本人と一致する場合のみ許可（他ドライバーを騙った日報の投入を防止）
CREATE POLICY "daily_reports_insert" ON daily_reports FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "daily_reports_update" ON daily_reports;
CREATE POLICY "daily_reports_update" ON daily_reports FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid())) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "daily_reports_delete" ON daily_reports;
CREATE POLICY "daily_reports_delete" ON daily_reports FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 支払スケジュール・入金予定: 社内のみ
ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_schedules_select" ON payment_schedules;
CREATE POLICY "payment_schedules_select" ON payment_schedules FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "payment_schedules_insert" ON payment_schedules;
CREATE POLICY "payment_schedules_insert" ON payment_schedules FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_schedules_update" ON payment_schedules;
CREATE POLICY "payment_schedules_update" ON payment_schedules FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_schedules_delete" ON payment_schedules;
CREATE POLICY "payment_schedules_delete" ON payment_schedules FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE receipt_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipt_schedules_select" ON receipt_schedules;
CREATE POLICY "receipt_schedules_select" ON receipt_schedules FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "receipt_schedules_insert" ON receipt_schedules;
CREATE POLICY "receipt_schedules_insert" ON receipt_schedules FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "receipt_schedules_update" ON receipt_schedules;
CREATE POLICY "receipt_schedules_update" ON receipt_schedules FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "receipt_schedules_delete" ON receipt_schedules;
CREATE POLICY "receipt_schedules_delete" ON receipt_schedules FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 掲示板: 管理側ロールは全件。ドライバーは「公開済み かつ 自分宛（または全員宛）」のみ。投稿・編集・削除は社内のみ
ALTER TABLE board_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_posts_select" ON board_posts;
CREATE POLICY "board_posts_select" ON board_posts FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR ((publish_at IS NULL OR publish_at <= now()) AND (target_driver_ids IS NULL OR cardinality(target_driver_ids) = 0 OR (SELECT driver_id FROM users WHERE auth_uid = auth.uid()) = ANY(target_driver_ids))));
DROP POLICY IF EXISTS "board_posts_insert" ON board_posts;
CREATE POLICY "board_posts_insert" ON board_posts FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "board_posts_update" ON board_posts;
CREATE POLICY "board_posts_update" ON board_posts FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "board_posts_delete" ON board_posts;
CREATE POLICY "board_posts_delete" ON board_posts FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 手入力テンプレート: 全員閲覧可、編集は社内のみ
ALTER TABLE input_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "input_templates_select" ON input_templates;
CREATE POLICY "input_templates_select" ON input_templates FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "input_templates_insert" ON input_templates;
CREATE POLICY "input_templates_insert" ON input_templates FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "input_templates_update" ON input_templates;
CREATE POLICY "input_templates_update" ON input_templates FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "input_templates_delete" ON input_templates;
CREATE POLICY "input_templates_delete" ON input_templates FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ファイル取込マッピング・単価マスタ・入金管理・経費管理: 社内のみ
ALTER TABLE file_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "file_mappings_select" ON file_mappings;
CREATE POLICY "file_mappings_select" ON file_mappings FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "file_mappings_insert" ON file_mappings;
CREATE POLICY "file_mappings_insert" ON file_mappings FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "file_mappings_update" ON file_mappings;
CREATE POLICY "file_mappings_update" ON file_mappings FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "file_mappings_delete" ON file_mappings;
CREATE POLICY "file_mappings_delete" ON file_mappings FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE price_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_master_select" ON price_master;
CREATE POLICY "price_master_select" ON price_master FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "price_master_insert" ON price_master;
CREATE POLICY "price_master_insert" ON price_master FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "price_master_update" ON price_master;
CREATE POLICY "price_master_update" ON price_master FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "price_master_delete" ON price_master;
CREATE POLICY "price_master_delete" ON price_master FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE bank_payer_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bank_payer_aliases_select" ON bank_payer_aliases;
CREATE POLICY "bank_payer_aliases_select" ON bank_payer_aliases FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "bank_payer_aliases_insert" ON bank_payer_aliases;
CREATE POLICY "bank_payer_aliases_insert" ON bank_payer_aliases FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "bank_payer_aliases_update" ON bank_payer_aliases;
CREATE POLICY "bank_payer_aliases_update" ON bank_payer_aliases FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "bank_payer_aliases_delete" ON bank_payer_aliases;
CREATE POLICY "bank_payer_aliases_delete" ON bank_payer_aliases FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE payment_in ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_in_select" ON payment_in;
CREATE POLICY "payment_in_select" ON payment_in FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "payment_in_insert" ON payment_in;
CREATE POLICY "payment_in_insert" ON payment_in FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_in_update" ON payment_in;
CREATE POLICY "payment_in_update" ON payment_in FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "payment_in_delete" ON payment_in;
CREATE POLICY "payment_in_delete" ON payment_in FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- 会社設定: 全員閲覧可、編集は社内のみ
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_settings_select" ON company_settings;
-- 社印画像・銀行口座・登録番号を持つため社内のみ。ドライバーには get_company_public_info() で必要項目だけ返す
CREATE POLICY "company_settings_select" ON company_settings FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "company_settings_insert" ON company_settings;
CREATE POLICY "company_settings_insert" ON company_settings FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "company_settings_update" ON company_settings;
CREATE POLICY "company_settings_update" ON company_settings FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "company_settings_delete" ON company_settings;
CREATE POLICY "company_settings_delete" ON company_settings FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ドライバー提出書類: 社内は全件、ドライバーは自分の書類のみ
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_documents_select" ON driver_documents;
CREATE POLICY "driver_documents_select" ON driver_documents FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_documents_insert" ON driver_documents;
CREATE POLICY "driver_documents_insert" ON driver_documents FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_documents_update" ON driver_documents;
CREATE POLICY "driver_documents_update" ON driver_documents FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid())) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_documents_delete" ON driver_documents;
CREATE POLICY "driver_documents_delete" ON driver_documents FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ドライバーとのチャット: 社内は全件、ドライバーは自分のスレッドのみ
ALTER TABLE driver_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_messages_select" ON driver_messages;
CREATE POLICY "driver_messages_select" ON driver_messages FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_messages_insert" ON driver_messages;
CREATE POLICY "driver_messages_insert" ON driver_messages FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_messages_update" ON driver_messages;
CREATE POLICY "driver_messages_update" ON driver_messages FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid())) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));

-- 通知送信履歴: 閲覧は社内のみ。書き込みはEdge Function（service role）のみのためINSERT/UPDATE/DELETEポリシーは作らない
ALTER TABLE notify_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notify_log_select" ON notify_log;
CREATE POLICY "notify_log_select" ON notify_log FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ドライバー招待: 社内のみテーブルを直接操作できる（匿名ユーザーはcheck_driver_invite/submit_driver_registrationのRPC経由でのみ利用）
ALTER TABLE driver_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_invites_select" ON driver_invites;
CREATE POLICY "driver_invites_select" ON driver_invites FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "driver_invites_insert" ON driver_invites;
CREATE POLICY "driver_invites_insert" ON driver_invites FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "driver_invites_update" ON driver_invites;
CREATE POLICY "driver_invites_update" ON driver_invites FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));

-- ドライバー向け支払明細書配信: 社内は全件、ドライバーは自分宛のみ
ALTER TABLE driver_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_statements_select" ON driver_statements;
CREATE POLICY "driver_statements_select" ON driver_statements FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR drv_id = (SELECT driver_id FROM users WHERE auth_uid = auth.uid()));
DROP POLICY IF EXISTS "driver_statements_insert" ON driver_statements;
CREATE POLICY "driver_statements_insert" ON driver_statements FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "driver_statements_update" ON driver_statements;
-- RLSは列を区別できないため、本人に直接UPDATEを与えると金額や添付まで書き換えられる。
-- 本人の既読・受領は mark_driver_statement() に寄せ、テーブル更新は社内のみにする
CREATE POLICY "driver_statements_update" ON driver_statements FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "driver_statements_delete" ON driver_statements;
CREATE POLICY "driver_statements_delete" ON driver_statements FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ============================================================
-- 4. Storage（ドライバー提出書類・支払明細書PDF・掲示板添付・協力会社添付ファイル置き場）
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('driver-docs', 'driver-docs', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
  ('driver-statements', 'driver-statements', false, 10485760, ARRAY['text/html','application/pdf']),
  ('board-attachments', 'board-attachments', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
  ('partner-docs', 'partner-docs', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "partner_docs_storage_select" ON storage.objects;
CREATE POLICY "partner_docs_storage_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'partner-docs' AND "current_role"() = ANY(ARRAY['admin','editor','viewer'])
);
DROP POLICY IF EXISTS "partner_docs_storage_insert" ON storage.objects;
CREATE POLICY "partner_docs_storage_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'partner-docs' AND "current_role"() = ANY(ARRAY['admin','editor'])
);
DROP POLICY IF EXISTS "partner_docs_storage_update" ON storage.objects;
CREATE POLICY "partner_docs_storage_update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'partner-docs' AND "current_role"() = ANY(ARRAY['admin','editor'])
);
DROP POLICY IF EXISTS "partner_docs_storage_delete" ON storage.objects;
CREATE POLICY "partner_docs_storage_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'partner-docs' AND "current_role"() = ANY(ARRAY['admin','editor'])
);

DROP POLICY IF EXISTS "driver_docs_storage_select" ON storage.objects;
CREATE POLICY "driver_docs_storage_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'driver-docs' AND ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "driver_docs_storage_insert" ON storage.objects;
CREATE POLICY "driver_docs_storage_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'driver-docs' AND ("current_role"() = ANY(ARRAY['admin','editor']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "driver_docs_storage_update" ON storage.objects;
CREATE POLICY "driver_docs_storage_update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'driver-docs' AND ("current_role"() = ANY(ARRAY['admin','editor']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "driver_docs_storage_delete" ON storage.objects;
CREATE POLICY "driver_docs_storage_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'driver-docs' AND "current_role"() = ANY(ARRAY['admin','editor'])
);

DROP POLICY IF EXISTS "chat_files_storage_select" ON storage.objects;
CREATE POLICY "chat_files_storage_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'chat-files' AND ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "chat_files_storage_insert" ON storage.objects;
CREATE POLICY "chat_files_storage_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'chat-files' AND ("current_role"() = ANY(ARRAY['admin','editor']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "chat_files_storage_delete" ON storage.objects;
CREATE POLICY "chat_files_storage_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'chat-files' AND "current_role"() = ANY(ARRAY['admin','editor'])
);

DROP POLICY IF EXISTS "driver_stmt_storage_select" ON storage.objects;
CREATE POLICY "driver_stmt_storage_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'driver-statements' AND ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR (storage.foldername(name))[1] = 'drv' || (SELECT driver_id::text FROM users WHERE auth_uid = auth.uid()))
);
DROP POLICY IF EXISTS "driver_stmt_storage_insert" ON storage.objects;
CREATE POLICY "driver_stmt_storage_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'driver-statements' AND "current_role"() = ANY(ARRAY['admin','editor'])
);
DROP POLICY IF EXISTS "driver_stmt_storage_delete" ON storage.objects;
CREATE POLICY "driver_stmt_storage_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'driver-statements' AND "current_role"() = ANY(ARRAY['admin','editor'])
);

-- 掲示板の添付ファイルは投稿自体の閲覧範囲がクライアント側の絞り込みのため、閲覧は認証済みユーザー全員に許可する
DROP POLICY IF EXISTS "board_attachments_select" ON storage.objects;
CREATE POLICY "board_attachments_select" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'board-attachments'
);
DROP POLICY IF EXISTS "board_attachments_insert" ON storage.objects;
CREATE POLICY "board_attachments_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'board-attachments' AND "current_role"() = ANY(ARRAY['admin','editor'])
);
DROP POLICY IF EXISTS "board_attachments_delete" ON storage.objects;
CREATE POLICY "board_attachments_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'board-attachments' AND "current_role"() = ANY(ARRAY['admin','editor'])
);


-- ============================================================
--  グループチャット・支払明細書発行の進捗
--  （本番には存在するがセットアップSQLに載っていなかったぶん）
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_groups (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  driver_ids integer[] NOT NULL DEFAULT '{}',
  staff_user_ids text[] NOT NULL DEFAULT '{}',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_group_messages (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_type text NOT NULL,
  sender_name text,
  sender_key text,
  body text,
  file_path text, file_name text, file_type text, file_size int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_group_reads (
  group_id bigint NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  member_key text NOT NULL,   -- 'staff:<users.id>' または 'driver:<drivers.id>'
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_key)
);
-- 支払明細書の発行進捗。行の単位は会社（取引先レコード）なので cli_id で持つ
CREATE TABLE IF NOT EXISTS driver_progress (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  month text NOT NULL,
  cli_id integer NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  target boolean NOT NULL DEFAULT true,
  send_method text,
  assignee_user_id text,
  check_user_id text,
  checked boolean NOT NULL DEFAULT false,
  submitted_date date, planned_date date,
  manual boolean NOT NULL DEFAULT false,
  manual_amt int,
  note text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (month, cli_id)
);
CREATE INDEX IF NOT EXISTS driver_progress_month_idx ON driver_progress(month);

ALTER TABLE chat_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_groups_select" ON chat_groups;
CREATE POLICY "chat_groups_select" ON chat_groups FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR (SELECT driver_id FROM users WHERE auth_uid = auth.uid()) = ANY(driver_ids));
DROP POLICY IF EXISTS "chat_groups_insert" ON chat_groups;
CREATE POLICY "chat_groups_insert" ON chat_groups FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "chat_groups_update" ON chat_groups;
CREATE POLICY "chat_groups_update" ON chat_groups FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']));
DROP POLICY IF EXISTS "chat_groups_delete" ON chat_groups;
CREATE POLICY "chat_groups_delete" ON chat_groups FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

ALTER TABLE chat_group_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_group_messages_select" ON chat_group_messages;
CREATE POLICY "chat_group_messages_select" ON chat_group_messages FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR EXISTS (SELECT 1 FROM chat_groups cg WHERE cg.id = chat_group_messages.group_id AND (SELECT driver_id FROM users WHERE auth_uid = auth.uid()) = ANY(cg.driver_ids)));
DROP POLICY IF EXISTS "chat_group_messages_insert" ON chat_group_messages;
CREATE POLICY "chat_group_messages_insert" ON chat_group_messages FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor']) OR EXISTS (SELECT 1 FROM chat_groups cg WHERE cg.id = chat_group_messages.group_id AND (SELECT driver_id FROM users WHERE auth_uid = auth.uid()) = ANY(cg.driver_ids)));

ALTER TABLE chat_group_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat_group_reads_select" ON chat_group_reads;
CREATE POLICY "chat_group_reads_select" ON chat_group_reads FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']) OR member_key = 'driver:' || (SELECT driver_id FROM users WHERE auth_uid = auth.uid())::text);
DROP POLICY IF EXISTS "chat_group_reads_upsert" ON chat_group_reads;
CREATE POLICY "chat_group_reads_upsert" ON chat_group_reads FOR INSERT TO authenticated WITH CHECK (member_key = 'staff:' || (SELECT id FROM users WHERE auth_uid = auth.uid()) OR member_key = 'driver:' || (SELECT driver_id FROM users WHERE auth_uid = auth.uid())::text);
DROP POLICY IF EXISTS "chat_group_reads_update" ON chat_group_reads;
CREATE POLICY "chat_group_reads_update" ON chat_group_reads FOR UPDATE TO authenticated USING (member_key = 'staff:' || (SELECT id FROM users WHERE auth_uid = auth.uid()) OR member_key = 'driver:' || (SELECT driver_id FROM users WHERE auth_uid = auth.uid())::text) WITH CHECK (member_key = 'staff:' || (SELECT id FROM users WHERE auth_uid = auth.uid()) OR member_key = 'driver:' || (SELECT driver_id FROM users WHERE auth_uid = auth.uid())::text);

ALTER TABLE driver_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "driver_progress_select" ON driver_progress;
CREATE POLICY "driver_progress_select" ON driver_progress FOR SELECT TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "driver_progress_insert" ON driver_progress;
CREATE POLICY "driver_progress_insert" ON driver_progress FOR INSERT TO authenticated WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "driver_progress_update" ON driver_progress;
CREATE POLICY "driver_progress_update" ON driver_progress FOR UPDATE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor','viewer'])) WITH CHECK ("current_role"() = ANY(ARRAY['admin','editor','viewer']));
DROP POLICY IF EXISTS "driver_progress_delete" ON driver_progress;
CREATE POLICY "driver_progress_delete" ON driver_progress FOR DELETE TO authenticated USING ("current_role"() = ANY(ARRAY['admin','editor']));

-- ============================================================
--  招待まわりの残りの関数（本番にはあるがセットアップSQLに無かったぶん）
-- ============================================================
-- 登録直後に、自分のログインIDを1度だけ確認するための窓口。
-- 期限切れの招待では引けない。宛先が固定された招待か、新規に作られたドライバーに限る
CREATE OR REPLACE FUNCTION public.get_driver_login_info(p_token text, p_driver_id integer)
RETURNS TABLE(login_id text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM driver_invites
    WHERE token = p_token AND driver_id = p_driver_id AND used_at IS NOT NULL
      AND expires_at >= now() AND (target_driver_id = p_driver_id OR created_new IS TRUE)
  ) THEN RETURN; END IF;
  RETURN QUERY SELECT u.id FROM users u WHERE u.driver_id = p_driver_id AND u.role = 'driver' LIMIT 1;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_driver_login_info(text, integer) TO anon, authenticated;

-- ドライバーポータル向け。会社設定のうち公開してよい項目だけを返す
CREATE OR REPLACE FUNCTION public.get_company_public_info()
RETURNS TABLE(name text, line_add_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT c.name, c.line_add_url FROM company_settings c WHERE c.id = 1
$function$;
REVOKE EXECUTE ON FUNCTION public.get_company_public_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_public_info() TO authenticated;

-- 支払明細書に対して本人ができるのは「既読」と「受領確認」だけ。金額や添付には触れられない
CREATE OR REPLACE FUNCTION public.mark_driver_statement(p_id integer, p_ack boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_drv integer;
BEGIN
  SELECT driver_id INTO v_drv FROM users WHERE auth_uid = auth.uid();
  IF v_drv IS NULL THEN RAISE EXCEPTION 'not_a_driver'; END IF;
  UPDATE driver_statements
     SET read_at = coalesce(read_at, now()),
         acknowledged_at = CASE WHEN p_ack THEN coalesce(acknowledged_at, now()) ELSE acknowledged_at END
   WHERE id = p_id AND drv_id = v_drv;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mark_driver_statement(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_driver_statement(integer, boolean) TO authenticated;

-- 自己登録フォームの「所属する協力会社」の候補。有効な未使用の招待トークンがある間だけ引ける。
-- 絞り込みはサーバ側で行う。画面側だけで絞ると、RPCを直接叩かれた時に全社名が漏れるため。
-- 引数を増やす前に旧シグネチャを落とす（残すとそちらが全件返したままになる）
DROP FUNCTION IF EXISTS public.list_partner_names_for_invite(text);
CREATE OR REPLACE FUNCTION public.list_partner_names_for_invite(p_token text, p_query text DEFAULT NULL)
RETURNS TABLE(name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_q text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM driver_invites WHERE token = p_token AND used_at IS NULL AND expires_at >= now()
  ) THEN RETURN; END IF;
  v_q := lower(regexp_replace(btrim(coalesce(p_query,'')), '\s', '', 'g'));
  IF length(v_q) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.name FROM clients c
     WHERE c.kind IN ('supplier','branch')   -- 所属先になりうるのは協力会社と自社支店だけ
       AND strpos(lower(regexp_replace(c.name, '\s', '', 'g')), v_q) > 0
     ORDER BY c.name LIMIT 20;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.list_partner_names_for_invite(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_partner_names_for_invite(text, text) TO anon, authenticated;

-- 自分のスケジュール色だけを変える。自分の行以外は触れない
CREATE OR REPLACE FUNCTION public.set_my_schedule_color(p_color text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id text;
BEGIN
  -- NULL は色の解除。それ以外は決め打ちの候補のみ受け付ける
  IF p_color IS NOT NULL AND p_color NOT IN ('blue','green','amber','purple','red','teal','pink') THEN
    RAISE EXCEPTION 'invalid_color';
  END IF;
  SELECT id INTO v_id FROM users WHERE auth_uid = auth.uid();
  IF v_id IS NULL THEN RAISE EXCEPTION 'not_logged_in'; END IF;
  UPDATE users SET schedule_color = p_color WHERE id = v_id;
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.set_my_schedule_color(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_schedule_color(text) TO authenticated;

-- ============================================================
-- 5. 最初のadminユーザー登録（1回だけ手動実行）
--    事前にDashboard > Authenticationで管理者用アカウントを作成し、
--    そのUUID（Auth users一覧のUIDカラム）を下記 'ここにauth_uid' に貼り替えて実行してください
-- ============================================================
-- INSERT INTO public.users (id, name, role, auth_uid) VALUES ('admin1', '管理者名', 'admin', 'ここにauth_uid');
`;
const REQUIRED_TABLES = [
  'invoices','drivers','clients','partner_companies','users','audit_logs','payment_slips','invoice_slips',
  'daily_reports','payment_schedules','receipt_schedules','board_posts','input_templates',
  'file_mappings','price_master','payment_in','company_settings',
  'driver_documents','driver_statements','partner_company_docs',
  'chat_groups','chat_group_messages','chat_group_reads','driver_progress'
];

/* ============================================================
   v14: 入金管理・経費管理・セットアップ・PWA・インボイス対応
   ============================================================ */

/* ===== 会社設定 ===== */
let companySettings = {};
let pendingStampDataUrl = undefined; // undefined=未変更（既存値を維持）, null=削除, 文字列=新しい画像
let pendingStampOriginalDataUrl = undefined; // 色を変更する前の画像（今回のアップロード分のみ。「元の色に戻す」用）

/* 会社設定を読む。
   社印画像・銀行口座・登録番号を含むため、テーブルは社内（admin/editor/viewer）だけが読める。
   ドライバーポータルが必要とするのはLINE友だち追加URLだけなので、
   ドライバーのときは必要な項目だけ返すRPCを使う。 */
async function loadCompanySettings() {
  if (!sb) return;
  if (me?.role === 'driver') {
    try {
      const {data} = await sb.rpc('get_company_public_info');
      companySettings = (Array.isArray(data) ? data[0] : data) || {};
    } catch(e) { console.warn('loadCompanySettings:', e.message); }
    return;
  }
  try {
    const {data} = await sb.from('company_settings').select('*').eq('id',1).single();
    if (data) {
      companySettings = data;
      ['reg_no','name','zip','address','tel','bank'].forEach(k => {
        const el = document.getElementById('company'+k.charAt(0).toUpperCase()+k.slice(1).replace('_',''));
        if (el) el.value = data[k]||'';
      });
      const lineEl = document.getElementById('companyLineAddUrl');
      if (lineEl) lineEl.value = data.line_add_url||'';
      pendingStampDataUrl = undefined;
      pendingStampOriginalDataUrl = undefined;
      const rotEl = document.getElementById('companyStampRotation');
      if (rotEl) rotEl.value = data.stamp_rotation_deg ?? -4;
      const sizeEl = document.getElementById('companyStampSize');
      if (sizeEl) sizeEl.value = data.stamp_size_px ?? 64;
      const sizeLabelEl = document.getElementById('companyStampSizeLabel');
      if (sizeLabelEl) sizeLabelEl.textContent = (data.stamp_size_px ?? 64) + 'px';
      const colorEl = document.getElementById('companyStampColorPicker');
      if (colorEl && data.stamp_color) colorEl.value = data.stamp_color;
      renderCompanyStampPreview(data.stamp_image||'');
      applyBrandName(data.name);
      const planSel = document.getElementById('supabasePlanSel');
      if (planSel) planSel.value = data.supabase_plan || 'free';
    }
  } catch(e) {}
}

// Supabaseの各プランごとの上限（目安）。実際の課金プラン変更を自動検知することはできないため、
// 管理者がここでプランを選ぶと、その上限を基準に使用率を表示する（プラン変更時はこの選択を変えるだけでよい）
const SUPABASE_PLAN_LIMITS = {
  free: { db: 500*1024*1024, storage: 1*1024*1024*1024, authUsers: 50000, label: 'Free' },
  pro:  { db: 8*1024*1024*1024, storage: 100*1024*1024*1024, authUsers: 100000, label: 'Pro以上' },
};
async function onSupabasePlanChange() {
  const plan = document.getElementById('supabasePlanSel').value;
  try {
    const { error } = await sb.from('company_settings').upsert({ id: 1, supabase_plan: plan });
    if (error) throw error;
    companySettings.supabase_plan = plan;
    showT('プラン設定を保存しました');
    renderSupabaseUsage(_lastSupabaseUsage);
  } catch(e) { showT('保存エラー: '+e.message, 'ter'); }
}
let _lastSupabaseUsage = null;
async function loadSupabaseUsage() {
  const area = document.getElementById('supabaseUsageArea');
  if (!area || !sb) return;
  area.innerHTML = '取得中...';
  try {
    const { data, error } = await sb.rpc('get_supabase_usage');
    if (error) throw error;
    _lastSupabaseUsage = data;
    renderSupabaseUsage(data);
  } catch(e) {
    if (e.message && (e.message.includes('does not exist') || e.message.includes('Could not find'))) {
      area.innerHTML = '⚠ get_supabase_usage関数が未作成です。セットアップページのSQLを確認してください';
    } else {
      area.innerHTML = '取得エラー: ' + escHtml(e.message);
    }
  }
}
function renderSupabaseUsage(usage) {
  const area = document.getElementById('supabaseUsageArea');
  if (!area || !usage) return;
  const plan = document.getElementById('supabasePlanSel')?.value || 'free';
  const limits = SUPABASE_PLAN_LIMITS[plan] || SUPABASE_PLAN_LIMITS.free;
  const rows = [
    { label: 'データベース容量', used: usage.db_size_bytes, limit: limits.db },
    { label: 'ファイルストレージ', used: usage.storage_bytes, limit: limits.storage },
    { label: '認証ユーザー数', used: usage.auth_users, limit: limits.authUsers, isCount: true },
  ];
  area.innerHTML = rows.map(r => {
    const pct = Math.min(100, Math.round(r.used / r.limit * 100));
    const barColor = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber-text)' : 'var(--green)';
    const usedLabel = r.isCount ? `${r.used}人` : fmtBytes(r.used);
    const limitLabel = r.isCount ? `${r.limit}人` : fmtBytes(r.limit);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:2px">
        <span>${r.label}</span><span>${usedLabel} / ${limitLabel}（${pct}%）</span>
      </div>
      <div style="background:var(--bg2);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${barColor}"></div>
      </div>
    </div>`;
  }).join('') + `<div style="font-size:10px;color:var(--text3);margin-top:4px">${limits.label}プラン基準（選択中）</div>`;
}

// 朱肉のハンコ（赤系）らしいピクセルかどうかを判定する。用紙の白・影、黒文字インクとは
// 色相が明確に異なるため、単純なRGB差分の閾値判定で十分実用的に見分けられる
function isHankoRedPixel(r, g, b) {
  return r > 100 && (r - g) > 30 && (r - b) > 30;
}
// 「どれくらい赤いか」を0(赤くない)〜1(はっきり赤い)の連続値で返す。
// 最終的な透過度をこの値で滑らかに変化させることで、輪郭やハンコ内部の彫り文字の
// 縁がギザギザにならず、なだらかな境目（アンチエイリアス）になるようにする
function hankoRedness(r, g, b) {
  if (r <= 100) return 0;
  const strength = Math.min(r - g, r - b) - 30; // 30(判定の閾値)を超えた分だけを強度にする
  return Math.max(0, Math.min(1, strength / 60)); // 60階調でなだらかに不透明へ近づける
}
// 画像・PDFいずれもフル解像度のcanvasにして返す共通の読み込み処理。
// PDFはpdf.js（既存の書類アップロード圧縮機能と共通）で1ページ目をラスタライズする
async function stampSourceToCanvas(file) {
  if (file.type === 'application/pdf') {
    const canvases = await pdfFileToCanvases(file, 2000, 1);
    if (!canvases.length) throw new Error('PDFのページを読み込めませんでした');
    return canvases[0];
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// A4用紙などをそのまま撮影・スキャン・PDF化したものから、朱肉のハンコ部分だけを自動検出して
// 切り抜き、背景を透明化したデータURLを返す。検出できなければnullを返す（呼び出し側で
// 従来通り画像全体をリサイズするフォールバックに切り替える）
function extractHankoDataUrl(sourceCanvas) {
  try {
    const sw = sourceCanvas.width, sh = sourceCanvas.height;
    // ① 縮小版で高速に赤色領域のおおよその位置を探す
    const ANALYZE_MAX = 800;
    const scale = Math.min(1, ANALYZE_MAX / Math.max(sw, sh));
    const aw = Math.max(1, Math.round(sw * scale)), ah = Math.max(1, Math.round(sh * scale));
    const aCanvas = document.createElement('canvas');
    aCanvas.width = aw; aCanvas.height = ah;
    const aCtx = aCanvas.getContext('2d');
    aCtx.drawImage(sourceCanvas, 0, 0, aw, ah);
    const aData = aCtx.getImageData(0, 0, aw, ah).data;

    const mask = new Uint8Array(aw * ah);
    for (let i = 0; i < aw * ah; i++) {
      const p = i * 4;
      if (isHankoRedPixel(aData[p], aData[p+1], aData[p+2])) mask[i] = 1;
    }
    // 単発のノイズ（JPEG圧縮ノイズ等）を除去: 8近傍のうち3つ以上一致していないマスクは捨てる
    let matchCount = 0, minX = aw, minY = ah, maxX = -1, maxY = -1;
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const i = y * aw + x;
        if (!mask[i]) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < aw && ny >= 0 && ny < ah && mask[ny*aw+nx]) neighbors++;
        }
        if (neighbors >= 3) {
          matchCount++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    // マッチ数が少なすぎる場合は誤検出とみなし、フォールバックさせる
    if (matchCount < 60 || maxX < minX || maxY < minY) return null;

    // ② 検出した範囲を元画像の解像度に換算し、余白を少し足してフル解像度で切り抜く
    const pad = 0.12;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const padX = bw * pad, padY = bh * pad;
    const fx0 = Math.max(0, Math.round((minX - padX) / scale));
    const fy0 = Math.max(0, Math.round((minY - padY) / scale));
    const fx1 = Math.min(sw, Math.round((maxX + 1 + padX) / scale));
    const fy1 = Math.min(sh, Math.round((maxY + 1 + padY) / scale));
    const fw = Math.max(1, fx1 - fx0), fh = Math.max(1, fy1 - fy0);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = fw; cropCanvas.height = fh;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(sourceCanvas, fx0, fy0, fw, fh, 0, 0, fw, fh);

    // ③ 切り抜き範囲内で、赤の強さに応じてなめらかに透明度を変える（用紙の白・影は消しつつ、
    // 輪郭やハンコ内部の彫り文字の縁がギザギザにならないようアンチエイリアスをかける）
    const cropData = cropCtx.getImageData(0, 0, fw, fh);
    const d = cropData.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i+3] = Math.round(hankoRedness(d[i], d[i+1], d[i+2]) * 255);
    }
    cropCtx.putImageData(cropData, 0, 0);

    // ④ 保存データ量を抑えつつ彫り文字などの細部が潰れないよう、必要なら最終サイズを縮小する
    const FINAL_MAX = 600;
    const finalScale = Math.min(1, FINAL_MAX / Math.max(fw, fh));
    if (finalScale < 1) {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = Math.round(fw * finalScale);
      outCanvas.height = Math.round(fh * finalScale);
      outCanvas.getContext('2d').drawImage(cropCanvas, 0, 0, outCanvas.width, outCanvas.height);
      return outCanvas.toDataURL('image/png');
    }
    return cropCanvas.toDataURL('image/png');
  } catch (e) { return null; }
}

// アップロード画像・PDFは帳票に載せるだけの用途のためキャンバスで縮小し、Supabaseへ保存するデータ量を抑える
function resizeCanvasDataUrl(sourceCanvas, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(sourceCanvas.width, sourceCanvas.height));
  const w = Math.round(sourceCanvas.width * scale), h = Math.round(sourceCanvas.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(sourceCanvas, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}
async function onCompanyStampFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const sourceCanvas = await stampSourceToCanvas(file);
    const extracted = extractHankoDataUrl(sourceCanvas);
    if (extracted) {
      pendingStampDataUrl = extracted;
      showT('ハンコ部分を自動検出して切り抜きました');
    } else {
      pendingStampDataUrl = resizeCanvasDataUrl(sourceCanvas, 200);
      showT('ハンコの自動検出ができなかったため、画像全体を使用します', 'twa');
    }
    pendingStampOriginalDataUrl = pendingStampDataUrl;
    renderCompanyStampPreview(pendingStampDataUrl);
  } catch(err) { showT('画像の読み込みに失敗しました: '+err.message, 'ter'); }
}
function removeCompanyStamp() {
  pendingStampDataUrl = null;
  pendingStampOriginalDataUrl = undefined;
  document.getElementById('companyStampFile').value = '';
  renderCompanyStampPreview('');
}
function renderCompanyStampPreview(dataUrl) {
  const img = document.getElementById('companyStampPreview');
  const empty = document.getElementById('companyStampPreviewEmpty');
  if (!img) return;
  const rotEl = document.getElementById('companyStampRotation');
  const rot = rotEl ? +rotEl.value : -4;
  const sizeEl = document.getElementById('companyStampSize');
  const size = sizeEl ? +sizeEl.value : 64;
  img.style.transform = `rotate(${rot}deg)`;
  const box = document.getElementById('companyStampPreviewBox');
  if (box) { box.style.width = size+'px'; box.style.height = size+'px'; }
  if (dataUrl) { img.src = dataUrl; img.style.display = 'block'; empty.style.display = 'none'; }
  else { img.style.display = 'none'; empty.style.display = 'block'; }
}
// 傾きスライダーの操作に合わせてプレビューをその場で回転させる
function onCompanyStampRotationInput() {
  const rotEl = document.getElementById('companyStampRotation');
  const label = document.getElementById('companyStampRotationLabel');
  if (label) label.textContent = rotEl.value + '°';
  const img = document.getElementById('companyStampPreview');
  if (img) img.style.transform = `rotate(${rotEl.value}deg)`;
}
// 大きさスライダーの操作に合わせてプレビュー枠をその場でリサイズする
function onCompanyStampSizeInput() {
  const sizeEl = document.getElementById('companyStampSize');
  const label = document.getElementById('companyStampSizeLabel');
  if (label) label.textContent = sizeEl.value + 'px';
  const box = document.getElementById('companyStampPreviewBox');
  if (box) { box.style.width = sizeEl.value+'px'; box.style.height = sizeEl.value+'px'; }
}
// 現在プレビュー表示中の印影画像の形（透過マスク）を保ったまま、選んだ色に塗り替える
async function applyStampColorTint() {
  const base = pendingStampDataUrl !== undefined ? pendingStampDataUrl : (companySettings||{}).stamp_image;
  if (!base) { showT('先にハンコ画像をアップロードしてください', 'twa'); return; }
  const colorHex = document.getElementById('companyStampColorPicker').value;
  const r = parseInt(colorHex.slice(1,3),16), g = parseInt(colorHex.slice(3,5),16), b = parseInt(colorHex.slice(5,7),16);
  try {
    const img = new Image();
    await new Promise((resolve,reject) => { img.onload = resolve; img.onerror = reject; img.src = base; });
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] === 0) continue; // 透明部分（背景）はそのまま
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
    pendingStampDataUrl = canvas.toDataURL('image/png');
    renderCompanyStampPreview(pendingStampDataUrl);
    showT('ハンコの色を変更しました（保存すると反映されます）');
  } catch(e) { showT('色の変更に失敗しました: '+e.message, 'ter'); }
}
// アップロード直後（色を変更する前）の画像に戻す。今回のセッションでアップロードしていない場合は対象がない
function resetStampColorTint() {
  if (pendingStampOriginalDataUrl === undefined) { showT('元に戻せる画像がありません。もう一度アップロードしてください', 'twa'); return; }
  pendingStampDataUrl = pendingStampOriginalDataUrl;
  renderCompanyStampPreview(pendingStampDataUrl);
  showT('元の色に戻しました');
}

async function saveCompanySettings() {
  const obj = {
    id: 1,
    reg_no: document.getElementById('invoiceRegNo')?.value.trim()||'',
    name: document.getElementById('companyName')?.value.trim()||'',
    zip: document.getElementById('companyZip')?.value.trim()||'',
    address: document.getElementById('companyAddr')?.value.trim()||'',
    tel: document.getElementById('companyTel')?.value.trim()||'',
    bank: document.getElementById('companyBank')?.value.trim()||'',
    line_add_url: document.getElementById('companyLineAddUrl')?.value.trim()||'',
    stamp_image: pendingStampDataUrl===undefined ? (companySettings.stamp_image||'') : (pendingStampDataUrl||''),
    stamp_rotation_deg: (v => Number.isFinite(v) ? v : -4)(+document.getElementById('companyStampRotation')?.value),
    stamp_size_px: (v => Number.isFinite(v) ? v : 64)(+document.getElementById('companyStampSize')?.value),
    stamp_color: document.getElementById('companyStampColorPicker')?.value || null,
    updated_at: new Date().toISOString(),
  };
  showLoad(true);
  try {
    const {error} = await sb.from('company_settings').upsert(obj,{onConflict:'id'});
    if (error) throw error;
    companySettings = obj;
    pendingStampDataUrl = undefined;
    pendingStampOriginalDataUrl = undefined;
    const msg = document.getElementById('companySettingMsg');
    if (msg) { msg.textContent='✔ 保存しました'; setTimeout(()=>{msg.textContent='';},2000); }
    addLog('会社設定保存', obj.name);
    showT('会社情報を保存しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

/* ===== セットアップページ ===== */
function renderSetupPage() {
  // まずSQLとPWA状態を表示（即座）
  const el = document.getElementById('setupSql');
  if (el) el.textContent = SETUP_SQL;
  checkPwaStatus();
  loadCompanySettings();
  // テーブル確認は非同期で（重いので遅延実行）
  const statusEl = document.getElementById('tableStatus');
  if (statusEl) statusEl.innerHTML = '<div style="font-size:11px;color:var(--text2);padding:4px">テーブル確認中... <button class="btn sml" onclick="testAllTables()">確認する</button></div>';
}

function copyAllSql() {
  navigator.clipboard.writeText(SETUP_SQL)
    .then(()=>showT('SQLをコピーしました'))
    .catch(()=>{ const el=document.getElementById('setupSql'); if(el){const r=document.createRange();r.selectNode(el);window.getSelection().removeAllRanges();window.getSelection().addRange(r);document.execCommand('copy');showT('SQLをコピーしました');} });
}

async function testAllTables() {
  const el = document.getElementById('tableStatus');
  if (!el||!sb) return;
  el.innerHTML = REQUIRED_TABLES.map(t=>`<div style="font-size:10px;padding:4px 6px;background:var(--bg2);border-radius:3px;display:flex;align-items:center;gap:4px"><span id="ts_${t}">⏳</span>${t}</div>`).join('');
  for (const t of REQUIRED_TABLES) {
    try {
      const {error} = await sb.from(t).select('id').limit(1);
      const el2 = document.getElementById('ts_'+t);
      if (el2) el2.textContent = error ? '✗' : '✓';
      if (el2) el2.style.color = error ? 'var(--red)' : 'var(--green)';
    } catch(e) {
      const el2 = document.getElementById('ts_'+t);
      if (el2) { el2.textContent='✗'; el2.style.color='var(--red)'; }
    }
  }
}

function checkPwaStatus() {
  const el = document.getElementById('pwaStatus');
  if (!el) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  el.textContent = isStandalone ? '✅ すでにアプリとしてインストール済みです' : '📱 まだアプリとして追加されていません（下記の手順で追加できます）';
  el.style.color = isStandalone ? 'var(--green)' : 'var(--text2)';
}

/* ===== 入金管理 ===== */
let paymentIns = [];

async function initPaymentIn() {
  ensureMonthRangeDefault('piFrom', 'piTo');
  await loadPaymentIns();
}

async function loadPaymentIns() {
  if (!sb) return;
  try {
    // 一覧は「請求期間（piFrom/piTo）」では絞り込まない：入金日は請求月より1〜2ヶ月先になるのが
    // 通常のため、請求期間でフィルタすると入金スケジュールから自動記録された実績が
    // 表示範囲外になり、「反映されていない」ように見えてしまう（実際はDBに記録されている）
    const {data,error} = await fetchAllRows(() => sb.from('payment_in').select('*').order('date',{ascending:false}).order('id',{ascending:false}));
    if (error) {
      if (error.message.includes('does not exist')) {
        document.getElementById('piList').innerHTML = '<div style="padding:16px;color:var(--amber-text);font-size:12px">⚠ payment_inテーブルが未作成です。<br><button class="btn sml" style="margin-top:6px" onclick="goPage(17,document.getElementById(\'nt17\'))">セットアップページへ</button></div>';
        return;
      }
      throw error;
    }
    paymentIns = data||[];
    renderPaymentIn();
  } catch(e) { document.getElementById('piList').innerHTML=`<div style="color:var(--red);padding:12px;font-size:11px">${e.message}</div>`; }
}

function renderPaymentIn() {
  const from = document.getElementById('piFrom')?.value||'';
  const to = document.getElementById('piTo')?.value||'';
  const list = document.getElementById('piList');
  const summary = document.getElementById('piSummary');
  const alert = document.getElementById('piAlert');
  if (!list) return;

  // 今月の請求済み合計（invoicesのst=3）
  const invoiced = recs.filter(r=>r.date>=from&&r.date<=to&&r.st===3).reduce((a,r)=>a+totR(r,'inc'),0);
  const received = paymentIns.reduce((a,r)=>a+(r.amt||0),0);
  const diff = invoiced - received;

  if (summary) summary.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">請求済合計</div><div class="kpi-val">${yen(invoiced)}</div></div>
    <div class="kpi-card"><div class="kpi-label">入金済合計</div><div class="kpi-val" style="color:var(--green)">${yen(received)}</div></div>
    <div class="kpi-card"><div class="kpi-label">未入金残高</div><div class="kpi-val" style="color:${diff>0?'var(--red)':'var(--green)'}">${yen(diff)}</div></div>
    <div class="kpi-card"><div class="kpi-label">入金件数</div><div class="kpi-val">${paymentIns.length}件</div></div>
  `;

  if (alert) {
    if (diff > 0) {
      alert.style.display='block';
      alert.innerHTML=`⚠ 未入金残高 ${yen(diff)} があります。入金確認をしてください。`;
    } else { alert.style.display='none'; }
  }

  if (!paymentIns.length) { list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text2);font-size:12px">入金記録がありません</div>'; return; }

  const typeLabel = {transfer:'銀行振込',cash:'現金',other:'その他'};
  list.innerHTML = paymentIns.map(p=>{
    const cli = lkC(p.cli_id);
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:12px">
      <div style="flex:1">
        <div style="font-weight:500">${p.date} <span style="color:var(--text2);font-size:10px">${typeLabel[p.type]||p.type}</span></div>
        <div style="font-size:10px;color:var(--text2)">${escHtml(cli?cli.name:'')} ${p.target_month?'/ '+p.target_month+'分':''} ${p.note?'/ '+p.note:''}</div>
      </div>
      <div style="font-size:14px;font-weight:600;color:var(--green)">${yen(p.amt)}</div>
      <button class="ibtn" style="color:var(--red)" onclick="deletePaymentIn(${p.id})">🗑</button>
    </div>`;
  }).join('');
}

function openPaymentInM() {
  const now = new Date();
  document.getElementById('piDate').value = fmtLocalDate(now);
  document.getElementById('piAmt').value = '';
  document.getElementById('piNote').value = '';
  document.getElementById('piTargetMonth').value = (document.getElementById('piFrom')?.value||'').slice(0,7);
  const sel = document.getElementById('piCli');
  sel.innerHTML = '<option value="">選択</option>' + clients.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  enhanceSelectSearchable('piCli');
  document.getElementById('mPaymentIn').classList.add('on');
}

async function savePaymentIn() {
  const date = document.getElementById('piDate').value;
  const amt = +document.getElementById('piAmt').value||0;
  if (!date||!amt) { alert('日付と金額は必須です'); return; }
  showLoad(true);
  try {
    const row = {
      date, amt,
      cli_id: +document.getElementById('piCli').value||null,
      target_month: document.getElementById('piTargetMonth').value,
      type: document.getElementById('piType').value,
      note: document.getElementById('piNote').value.trim(),
    };
    const {data,error} = await sb.from('payment_in').insert(row).select().single();
    if (error) throw error;
    paymentIns.unshift(data);
    closeM('mPaymentIn');
    renderPaymentIn();
    addLog('入金登録', `${date} ${yen(amt)}`);
    showT('入金を登録しました');
    // 対応する請求書を「入金済」に更新する提案
    const month = row.target_month;
    if (month) {
      const targets = recs.filter(r=>r.date?.startsWith(month)&&r.st===3&&(!row.cli_id||r.cli==row.cli_id));
      if (targets.length && confirm(`${month}の請求済み${targets.length}件を「入金済」に更新しますか？`)) {
        await markAsReceived(targets.map(r=>r.id));
      }
    }
  } catch(e) { showT('エラー: '+e.message,'ter'); }
  showLoad(false);
}

async function markAsReceived(ids) {
  try {
    const {error} = await sb.from('invoices').update({st:4}).in('id',ids);
    if (error) throw error;
    ids.forEach(id=>{ const r=recs.find(x=>x.id===id); if(r)r.st=4; });
    addLog('入金済更新', `${ids.length}件`);
    showT(`${ids.length}件を入金済にしました`);
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

async function deletePaymentIn(id) {
  if (!confirm('削除しますか？')) return;
  try {
    const {error} = await sb.from('payment_in').delete().eq('id',id);
    if (error) throw error;
    paymentIns = paymentIns.filter(p=>p.id!==id);
    renderPaymentIn();
    showT('削除しました');
  } catch(e) { showT('エラー: '+e.message,'ter'); }
}

/* ===== 銀行明細CSV取込・自動消込 ===== */
let bankCsvRows = [];      // 解析したCSV全行
let bankCsvDeposits = [];  // 抽出した入金行 [{date, amt, payer, cliId, sched, dup}]
let bankPayerAliases = []; // 振込人名→取引先の学習済み対応 [{payer_name, cli_id}]
let bankCsvCols = null;    // 使用する列番号 {date, amt, payer}

async function openBankCsvM(){
  document.getElementById('bankCsvFile').value = '';
  document.getElementById('bankCsvPreview').innerHTML = '';
  document.getElementById('bankCsvColPick').style.display = 'none';
  document.getElementById('bankCsvFoot').style.display = 'none';
  bankCsvRows = []; bankCsvDeposits = []; bankCsvCols = null;
  try {
    const {data} = await fetchAllRows(() => sb.from('bank_payer_aliases').select('*').order('id'));
    bankPayerAliases = data||[];
  } catch(e) { bankPayerAliases = []; }
  // マッチング先の入金予定と重複チェック用の入金実績を最新化
  try { await loadReceiptSched(); } catch(e) {}
  document.getElementById('mBankCsv').classList.add('on');
}

// 金額文字列の数値化（"1,234"・"￥1,234"・全角数字に対応）
function bankParseAmt(s){
  if (s==null) return 0;
  const t = String(s).replace(/[０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[^\d.-]/g,'');
  return Math.round(+t)||0;
}
// 日付文字列の正規化 → 'YYYY-MM-DD'（判別不能なら''）
function bankParseDate(s){
  if (!s) return '';
  const t = String(s).trim().replace(/[年月]/g,'/').replace(/日/g,'');
  let m = t.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return '';
}

async function handleBankCsvFile(file){
  if (!file) return;
  try {
    const text = await decodeCsvFile(file);
    bankCsvRows = text.split('\n').map(parseCsvLine).filter(r=>r.length>1 && r.some(c=>c&&c.trim()));
    if (!bankCsvRows.length) { showT('CSVを読み取れませんでした','ter'); return; }
    // ヘッダー行の項目名から列を自動判別（銀行によって名称が異なるため代表的なキーワードで探す）
    const header = bankCsvRows[0].map(h=>String(h||''));
    const findCol = keys => header.findIndex(h=>keys.some(k=>h.includes(k)));
    const dateCol = findCol(['日付','取引日','年月日','操作日','勘定日']);
    const amtCol = findCol(['入金','預り','預入','貸方']);
    const payerCol = findCol(['摘要','内容','振込','依頼人','備考','明細']);
    if (dateCol>=0 && amtCol>=0) {
      bankCsvCols = {date:dateCol, amt:amtCol, payer:payerCol};
      buildBankCsvDeposits();
    } else {
      const opts = header.map((h,i)=>`<option value="${i}">${i+1}列目: ${escHtml((h||'(空)').slice(0,20))}</option>`).join('');
      ['bankColDate','bankColAmt','bankColPayer'].forEach(id=>{ document.getElementById(id).innerHTML = opts; });
      document.getElementById('bankCsvColPick').style.display = 'block';
      document.getElementById('bankCsvPreview').innerHTML = '';
      document.getElementById('bankCsvFoot').style.display = 'none';
    }
  } catch(e) { showT('CSV解析エラー: '+e.message,'ter'); }
}

function rebuildBankCsvPreview(){
  bankCsvCols = {
    date: +document.getElementById('bankColDate').value,
    amt: +document.getElementById('bankColAmt').value,
    payer: +document.getElementById('bankColPayer').value,
  };
  buildBankCsvDeposits();
}

// 入金行の抽出と自動マッチング。
// マッチング順: ①学習済みの振込人名→取引先 ②未消込の入金予定と金額一致（取引先一致・日付近接を優先）
function buildBankCsvDeposits(){
  bankCsvDeposits = [];
  for (let i=1; i<bankCsvRows.length; i++) {
    const r = bankCsvRows[i];
    const amt = bankParseAmt(r[bankCsvCols.amt]);
    if (amt <= 0) continue; // 出金行・金額なし行は対象外
    const date = bankParseDate(r[bankCsvCols.date]);
    if (!date) continue;
    const payer = bankCsvCols.payer>=0 ? String(r[bankCsvCols.payer]||'').trim() : '';
    const alias = bankPayerAliases.find(a=>payer && payer.includes(a.payer_name));
    const aliasCli = alias ? alias.cli_id : null;
    // 金額が一致する未消込の入金予定から、取引先一致→日付が近い順で選ぶ
    const cands = (receiptSchedData||[]).filter(s=>!s.done && (s.amt||0)===amt && !bankCsvDeposits.some(d=>d.sched?.id===s.id));
    let sched = null;
    if (cands.length) {
      const scored = cands.map(s=>({s, score:(aliasCli && s.cli_id===aliasCli ? 0 : 100000) + Math.abs((new Date(s.date)-new Date(date))/86400000||9999)}));
      scored.sort((a,b)=>a.score-b.score);
      sched = scored[0].s;
    }
    // 取込済みらしき行（同日・同額の実績が既にある）は既定でチェックを外す
    const dup = paymentIns.some(p=>p.date===date && (p.amt||0)===amt);
    bankCsvDeposits.push({date, amt, payer, cliId: aliasCli || sched?.cli_id || '', sched, dup});
  }
  renderBankCsvPreview();
}

function renderBankCsvPreview(){
  const el = document.getElementById('bankCsvPreview');
  const foot = document.getElementById('bankCsvFoot');
  if (!bankCsvDeposits.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text2);font-size:12px">入金行が見つかりませんでした（列の判別が正しいかご確認ください）</div>';
    foot.style.display = 'none';
    return;
  }
  const cliOpts = cid => '<option value="">未設定</option>'+clients.map(c=>`<option value="${c.id}" ${c.id===+cid?'selected':''}>${escHtml(c.name)}</option>`).join('');
  const cs = 'padding:5px 6px;border-bottom:0.5px solid var(--border);font-size:11px';
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;white-space:nowrap">
    <thead><tr style="background:var(--bg2);font-size:10px">
      <th style="${cs}"><input type="checkbox" checked onchange="document.querySelectorAll('.bankRowChk').forEach(c=>c.checked=this.checked);updateBankCsvSummary()"></th>
      <th style="${cs}">入金日</th><th style="${cs}">振込人/摘要</th><th style="${cs};text-align:right">金額</th>
      <th style="${cs}">取引先</th><th style="${cs}">マッチした入金予定</th>
    </tr></thead>
    <tbody>${bankCsvDeposits.map((d,i)=>`<tr${d.dup?' style="opacity:.55"':''}>
      <td style="${cs}"><input type="checkbox" class="bankRowChk" data-i="${i}" ${d.dup?'':'checked'} onchange="updateBankCsvSummary()"></td>
      <td style="${cs}">${d.date}</td>
      <td style="${cs};max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${escHtml(d.payer)}">${escHtml(d.payer||'—')}</td>
      <td style="${cs};text-align:right;font-weight:600">${yen(d.amt)}</td>
      <td style="${cs}"><select onchange="bankCsvDeposits[${i}].cliId=this.value" style="padding:3px 5px;font-size:11px;max-width:150px">${cliOpts(d.cliId)}</select></td>
      <td style="${cs}">${d.sched?`✔ ${escHtml(d.sched.cli_name||'')} ${d.sched.date}（消込されます）`:(d.dup?'⚠ 同日同額の実績あり':'—')}</td>
    </tr>`).join('')}</tbody>
  </table>`;
  foot.style.display = 'flex';
  updateBankCsvSummary();
}

function updateBankCsvSummary(){
  const checked = [...document.querySelectorAll('.bankRowChk:checked')].map(c=>bankCsvDeposits[+c.dataset.i]);
  const total = checked.reduce((a,d)=>a+d.amt,0);
  const matched = checked.filter(d=>d.sched).length;
  document.getElementById('bankCsvSummary').textContent = `${checked.length}件選択（${yen(total)}）／うち入金予定と自動消込: ${matched}件`;
}

async function importBankCsvRows(){
  const targets = [...document.querySelectorAll('.bankRowChk:checked')].map(c=>bankCsvDeposits[+c.dataset.i]);
  if (!targets.length) { alert('取り込む行を選択してください'); return; }
  showLoad(true);
  let ok = 0, matched = 0, errs = [];
  for (const d of targets) {
    try {
      const {data, error} = await sb.from('payment_in').insert({
        date: d.date, amt: d.amt, cli_id: +d.cliId||null,
        target_month: d.sched?.month || d.date.slice(0,7),
        type: 'transfer', note: `銀行CSV取込${d.payer?': '+d.payer:''}`,
      }).select().single();
      if (error) throw error;
      paymentIns.unshift(data);
      ok++;
      if (d.sched) {
        await scheduleSetDone('receipt_schedules', d.sched.id, true);
        const item = receiptSchedData.find(s=>s.id===d.sched.id);
        if (item) item.done = true;
        matched++;
      }
      // 振込人名→取引先の対応を学習（次回から自動マッチング）
      if (d.payer && +d.cliId) {
        try { await sb.from('bank_payer_aliases').upsert({payer_name:d.payer, cli_id:+d.cliId},{onConflict:'payer_name'}); } catch(e2) {}
      }
    } catch(e) { errs.push(`${d.date} ${yen(d.amt)}: ${e.message}`); }
  }
  showLoad(false);
  closeM('mBankCsv');
  renderPaymentIn();
  if (typeof renderReceiptSched==='function' && document.getElementById('receiptSchedList')) renderReceiptSched();
  addLog('銀行CSV取込', `${ok}件（自動消込${matched}件）`);
  if (errs.length) showT(`${ok}件取込・${errs.length}件失敗: ${errs[0]}`,'twa');
  else showT(`${ok}件を取り込みました（入金予定の自動消込: ${matched}件）`);
}

// 会社設定はログイン後に自動読み込み（checkSchedAlertsと同タイミング）
// loadAllのオーバーライドではなく、applyLogin後に呼ぶ

function printAllPnlPdf2() {
  const groups = Object.values(window._aggPayGroups || {}).map(g => g.rows).filter(rows => rows.length);
  if (!groups.length) { showT('対象データがありません','twa'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtmlMulti('payment', groups));
}

// 請求明細書作成タブ: 集計期間にデータがある全取引先分の請求書PDFを、選択の有無に関わらず一括発行する
function printAllInvPdf() {
  const groups = Object.values(window._aggInvGroups || {}).map(g => g.rows).filter(rows => rows.length);
  if (!groups.length) { showT('対象データがありません','twa'); return; }
  const win = window.open('','_blank');
  if (!win) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可設定をご確認ください'); return; }
  writeStatementWindow(win, () => buildStatementHtmlMulti('billing', groups));
}


