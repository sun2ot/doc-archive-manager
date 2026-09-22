use crate::{
    database::{err, Database},
    model::{Department, Document},
    vault::{self, Key},
};
use base64::Engine;
use chrono::Utc;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use totp_rs::{Algorithm, Secret, TOTP};
use uuid::Uuid;
use zeroize::Zeroizing;

pub struct Session {
    pub db: Database,
    key: Key,
    salt: [u8; 16],
}
pub struct AppState {
    pub path: PathBuf,
    pub session: Option<Session>,
    pending_totp: Option<String>,
    failures: u32,
    retry_after: Option<Instant>,
    last_activity: Instant,
}
fn field<'a>(p: &'a Value, name: &str) -> &'a str {
    p.get(name).and_then(Value::as_str).unwrap_or("")
}
fn password(p: &Value) -> Zeroizing<String> {
    Zeroizing::new(field(p, "password").to_string())
}
fn strong(p: &str) -> Result<(), String> {
    if p.chars().count() < 10 || p.len() > 1024 {
        Err("请设置至少 10 个字符、最多 1024 字节的密码".into())
    } else {
        Ok(())
    }
}
fn totp(secret: &str) -> Result<TOTP, String> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        Secret::Encoded(secret.into()).to_bytes().map_err(err)?,
        Some("笺藏".into()),
        "本地归档库".into(),
    )
    .map_err(err)
}
fn verify_totp(db: &Database, code: &str) -> Result<(), String> {
    if let Some(secret) = db.preferences()?.totp_secret {
        if !totp(&secret)?.check_current(code).map_err(err)? {
            return Err("请输入正确的 6 位动态验证码，请检查设备时间".into());
        }
    }
    Ok(())
}
fn validate_locations(value: &Value) -> Result<Vec<String>, String> {
    let locations = value
        .get("locations")
        .and_then(Value::as_array)
        .ok_or("位置列表格式无效")?;
    if locations.len() > 200 {
        return Err("位置条目最多 200 个".into());
    }
    let mut result = Vec::new();
    for value in locations {
        let location = value.as_str().ok_or("位置条目格式无效")?.trim().to_string();
        if location.chars().count() > 300 {
            return Err("位置名称最多 300 个字符".into());
        }
        if !location.is_empty() && !result.contains(&location) {
            result.push(location);
        }
    }
    Ok(result)
}
fn validate_number_templates(value: &Value) -> Result<Vec<String>, String> {
    let templates = value
        .get("numberTemplates")
        .and_then(Value::as_array)
        .ok_or("文号模板列表格式无效")?;
    if templates.len() > 100 {
        return Err("文号模板最多 100 条".into());
    }
    let mut result = Vec::new();
    for value in templates {
        let template = value.as_str().ok_or("文号模板格式无效")?.trim().to_string();
        if template.chars().count() > 100 {
            return Err("文号模板最多 100 个字符".into());
        }
        if !template.is_empty() && !result.contains(&template) {
            result.push(template);
        }
    }
    Ok(result)
}
fn validate_departments(value: &Value) -> Result<Vec<Department>, String> {
    let departments: Vec<Department> = serde_json::from_value(
        value
            .get("departments")
            .cloned()
            .ok_or("部门列表格式无效")?,
    )
    .map_err(|_| "部门列表格式无效".to_string())?;
    if departments.len() > 500 {
        return Err("部门最多 500 个".into());
    }
    let mut ids = HashSet::new();
    for department in &departments {
        if department.id.trim().is_empty() || department.name.trim().is_empty() {
            return Err("部门名称不能为空".into());
        }
        if department.id.chars().count() > 100 || department.name.chars().count() > 100 {
            return Err("部门名称或标识过长".into());
        }
        if !ids.insert(department.id.clone()) {
            return Err("部门标识不能重复".into());
        }
        if department.leaders.len() > 20 {
            return Err("每个部门最多设置 20 位领导".into());
        }
        if department
            .leaders
            .iter()
            .any(|leader| leader.trim().is_empty() || leader.chars().count() > 100)
        {
            return Err("领导姓名格式无效".into());
        }
    }
    for department in &departments {
        let mut seen = HashSet::new();
        let mut parent = department.parent_id.clone();
        while let Some(parent_id) = parent {
            if !ids.contains(&parent_id) || !seen.insert(parent_id.clone()) {
                return Err("部门层级存在无效或循环的上级部门".into());
            }
            parent = departments
                .iter()
                .find(|item| item.id == parent_id)
                .and_then(|item| item.parent_id.clone());
        }
    }
    Ok(departments
        .into_iter()
        .map(|mut department| {
            department.id = department.id.trim().to_string();
            department.name = department.name.trim().to_string();
            department.leaders = department
                .leaders
                .into_iter()
                .map(|leader| leader.trim().to_string())
                .filter(|leader| !leader.is_empty())
                .collect();
            department
        })
        .collect())
}
fn validate_theme(
    p: &Value,
    current: &crate::model::Preferences,
) -> Result<crate::model::Preferences, String> {
    let mut next = current.clone();
    if let Some(theme) = p.get("theme").and_then(Value::as_str) {
        if !["light", "dim", "dark"].contains(&theme) {
            return Err("无效的界面主题".into());
        }
        next.theme = theme.into();
    }
    if let Some(font) = p.get("fontZh").and_then(Value::as_str) {
        if font.chars().count() > 100 {
            return Err("中文字体名称过长".into());
        }
        next.font_zh = font.into();
    }
    if let Some(font) = p.get("fontEn").and_then(Value::as_str) {
        if font.chars().count() > 100 {
            return Err("英文字体名称过长".into());
        }
        next.font_en = font.into();
    }
    if let Some(accent) = p.get("accent").and_then(Value::as_str) {
        if !accent.starts_with('#')
            || accent.len() != 7
            || !accent[1..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("主题色格式无效".into());
        }
        next.accent = accent.into();
    }
    if let Some(value) = p.get("backgroundOpacity") {
        let opacity = value
            .as_f64()
            .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
            .ok_or("背景透明度格式无效")?;
        if !(0.0..=0.85).contains(&opacity) {
            return Err("背景透明度应在 0 到 0.85 之间".into());
        }
        next.background_opacity = opacity as f32;
    }
    if let Some(value) = p.get("fontScale") {
        let scale = value
            .as_f64()
            .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
            .ok_or("界面字号格式无效")?;
        if !(0.9..=1.15).contains(&scale) {
            return Err("界面字号应在 90% 到 115% 之间".into());
        }
        next.font_scale = scale as f32;
    }
    if let Some(image) = p.get("backgroundImage").and_then(Value::as_str) {
        if image.len() > 5_500_000 {
            return Err("背景图片不能超过 4 MB".into());
        }
        next.background_image = image.into();
    }
    Ok(next)
}
pub fn backup_name() -> String {
    format!(
        "jiancang-{}-{}.dag",
        Utc::now().format("%Y%m%dT%H%M%S%.3fZ"),
        &Uuid::new_v4().to_string()[..8]
    )
}
impl AppState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            session: None,
            pending_totp: None,
            failures: 0,
            retry_after: None,
            last_activity: Instant::now(),
        }
    }
    fn current(&self) -> Result<&Session, String> {
        self.session.as_ref().ok_or_else(|| "LOCKED".into())
    }
    fn throttle(&self) -> Result<(), String> {
        if let Some(t) = self.retry_after {
            if t > Instant::now() {
                return Err(format!(
                    "尝试次数过多，请在 {} 秒后重试",
                    (t - Instant::now()).as_secs() + 1
                ));
            }
        }
        Ok(())
    }
    fn failure(&mut self) {
        self.failures += 1;
        if self.failures >= 5 {
            self.retry_after =
                Some(Instant::now() + Duration::from_secs(30 * (self.failures - 4).min(10) as u64));
        }
    }
    fn authenticate(&mut self, p: &Value) -> Result<(), String> {
        self.throttle()?;
        let result = (|| {
            let (bytes, _, _) = vault::decrypt(&vault::read(&self.path)?, &password(p))?;
            verify_totp(&Database::from_bytes(&bytes)?, field(p, "code"))
        })();
        if result.is_err() {
            self.failure();
        } else {
            self.failures = 0;
            self.retry_after = None;
        }
        result
    }
    fn commit(&mut self, db: Database) -> Result<(), String> {
        let session = self.current()?;
        let plain = Zeroizing::new(db.bytes()?);
        vault::atomic_write(
            &self.path,
            &vault::encrypt(&plain, &session.key, &session.salt)?,
        )?;
        self.session.as_mut().ok_or("LOCKED")?.db = db;
        Ok(())
    }
    fn candidate(&self) -> Result<Database, String> {
        let bytes = Zeroizing::new(self.current()?.db.bytes()?);
        Database::from_bytes(&bytes)
    }
    fn mark_backup(&mut self) -> Result<(), String> {
        let db = self.candidate()?;
        let mut prefs = db.preferences()?;
        prefs.last_backup = Some(Utc::now().to_rfc3339());
        db.set_preferences(&prefs)?;
        self.commit(db)
    }
    pub fn dispatch(&mut self, action: &str, p: Value) -> Result<Value, String> {
        if let Some(session) = self.session.as_ref() {
            let auto_lock_minutes = session.db.preferences()?.auto_lock_minutes;
            if auto_lock_minutes > 0
                && self.last_activity.elapsed() > Duration::from_secs(auto_lock_minutes as u64 * 60)
            {
                self.session = None;
                self.pending_totp = None;
            }
        }
        if action == "status" {
            return Ok(json!({"exists": self.path.exists(), "unlocked": self.session.is_some()}));
        }
        if action == "setup" {
            if self.path.exists() {
                return Err("归档库已存在，请登录".into());
            }
            let pw = password(&p);
            strong(&pw)?;
            let salt = vault::salt();
            let key = vault::derive(&pw, &salt)?;
            let db = Database::new()?;
            let plain = Zeroizing::new(db.bytes()?);
            vault::write_new(&self.path, &vault::encrypt(&plain, &key, &salt)?)?;
            self.session = Some(Session { db, key, salt });
            self.last_activity = Instant::now();
            return Ok(json!(true));
        }
        if action == "unlock" {
            self.throttle()?;
            let result = (|| {
                let (bytes, key, salt) = vault::decrypt(&vault::read(&self.path)?, &password(&p))?;
                let db = Database::from_bytes(&bytes)?;
                verify_totp(&db, field(&p, "code"))?;
                Ok::<_, String>(Session { db, key, salt })
            })();
            match result {
                Ok(session) => {
                    self.session = Some(session);
                    self.failures = 0;
                    self.retry_after = None;
                    self.last_activity = Instant::now();
                    return Ok(json!(true));
                }
                Err(e) => {
                    self.failure();
                    return Err(e);
                }
            }
        }
        if action == "import" && !self.path.exists() {
            return self.import(&p);
        }
        self.current()?;
        self.last_activity = Instant::now();
        match action {
            "activity" => Ok(json!(true)),
            "lock" => {
                self.session = None;
                self.pending_totp = None;
                Ok(json!(true))
            }
            "list" => Ok(json!(self.current()?.db.list(
                field(&p, "query"),
                field(&p, "kind"),
                field(&p, "tag")
            )?)),
            "save" => {
                let mut doc: Document = serde_json::from_value(p).map_err(err)?;
                let now = Utc::now().to_rfc3339();
                let mut previous_status = String::new();
                doc.processing_months.clear();
                doc.archived_months.clear();
                if doc.id.is_empty() {
                    doc.id = Uuid::new_v4().to_string();
                    doc.created_at = now.clone();
                } else {
                    let old = self
                        .current()?
                        .db
                        .list("", "", "")?
                        .into_iter()
                        .find(|d| d.id == doc.id)
                        .ok_or("文件已删除，请刷新")?;
                    previous_status = old.status;
                    doc.processing_months = old.processing_months;
                    doc.archived_months = old.archived_months;
                    doc.created_at = old.created_at;
                }
                doc.updated_at = now;
                doc.validate()?;
                let month = chrono::Local::now().format("%Y-%m").to_string();
                if doc.status == "processing" && !doc.processing_months.contains(&month) {
                    doc.processing_months.push(month.clone());
                }
                if doc.status == "archived" && previous_status != "archived" && !doc.archived_months.contains(&month) {
                    doc.archived_months.push(month);
                }
                let db = self.candidate()?;
                db.save(&doc)?;
                self.commit(db)?;
                Ok(json!(doc))
            }
            "delete" => {
                let db = self.candidate()?;
                db.delete(field(&p, "id"))?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "preferences" => {
                let prefs = self.current()?.db.preferences()?;
                Ok(
                    json!({"totpEnabled": prefs.totp_secret.is_some(),"webdavUrl":prefs.webdav_url,"webdavUsername":prefs.webdav_username,"hasWebdavPassword":!prefs.webdav_password.is_empty(),"lastBackup":prefs.last_backup,"dataPath":self.path.to_string_lossy(),"locations":prefs.locations,"theme":prefs.theme,"fontZh":prefs.font_zh,"fontEn":prefs.font_en,"accent":prefs.accent,"backgroundImage":prefs.background_image,"backgroundOpacity":prefs.background_opacity,"fontScale":prefs.font_scale,"autoLockMinutes":prefs.auto_lock_minutes,"numberTemplates":prefs.number_templates,"departments":prefs.departments}),
                )
            }
            "locations_set" => {
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.locations = validate_locations(&p)?;
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "number_templates_set" => {
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.number_templates = validate_number_templates(&p)?;
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "departments_set" => {
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.departments = validate_departments(&p)?;
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "security_save" => {
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                let minutes = p
                    .get("autoLockMinutes")
                    .and_then(Value::as_u64)
                    .or_else(|| {
                        p.get("autoLockMinutes")
                            .and_then(Value::as_str)
                            .and_then(|value| value.parse::<u64>().ok())
                    })
                    .ok_or("自动锁定时间格式无效")?;
                if minutes > 8 * 60 {
                    return Err("自动锁定时间不能超过 8 小时".into());
                }
                prefs.auto_lock_minutes = minutes as u32;
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "theme_save" => {
                let db = self.candidate()?;
                let prefs = db.preferences()?;
                let next = validate_theme(&p, &prefs)?;
                db.set_preferences(&next)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "background_choose" => {
                let Some(path) = rfd::FileDialog::new()
                    .set_title("选择界面背景图片")
                    .add_filter("图片", &["png", "jpg", "jpeg", "webp"])
                    .pick_file()
                else {
                    return Ok(Value::Null);
                };
                let bytes = fs::read(&path).map_err(err)?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("背景图片不能超过 4 MB".into());
                }
                let mime = match path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str()
                {
                    "jpg" | "jpeg" => "image/jpeg",
                    "webp" => "image/webp",
                    _ => "image/png",
                };
                let data = format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                );
                Ok(json!({"dataUrl":data}))
            }
            "export" => {
                let name = backup_name();
                let path = rfd::FileDialog::new()
                    .set_title("导出加密备份")
                    .add_filter("笺藏加密归档", &["dag"])
                    .set_file_name(&name)
                    .save_file();
                let Some(path) = path else {
                    return Ok(Value::Null);
                };
                vault::write_new(&path, &vault::read(&self.path)?)?;
                let warning = self.mark_backup().err();
                Ok(json!({"path":path.to_string_lossy(),"warning":warning}))
            }
            "import" => self.import(&p),
            "change_password" => {
                self.authenticate(&p)?;
                let pw = Zeroizing::new(field(&p, "newPassword").to_string());
                strong(&pw)?;
                let salt = vault::salt();
                let key = vault::derive(&pw, &salt)?;
                let plain = Zeroizing::new(self.current()?.db.bytes()?);
                vault::atomic_write(&self.path, &vault::encrypt(&plain, &key, &salt)?)?;
                let session = self.session.as_mut().ok_or("LOCKED")?;
                session.key = key;
                session.salt = salt;
                Ok(json!(true))
            }
            "totp_prepare" => {
                self.authenticate(&p)?;
                if self.current()?.db.preferences()?.totp_secret.is_some() {
                    return Err("请先关闭已有的二次验证".into());
                }
                let secret = Secret::generate_secret().to_encoded().to_string();
                let totp = totp(&secret)?;
                let qr = totp.get_qr_base64().map_err(err)?;
                let uri = totp.get_url();
                self.pending_totp = Some(secret.clone());
                Ok(json!({"secret":secret,"uri":uri,"qr":qr}))
            }
            "totp_enable" => {
                let secret = self.pending_totp.clone().ok_or("请重新生成验证密钥")?;
                if !totp(&secret)?
                    .check_current(field(&p, "code"))
                    .map_err(err)?
                {
                    return Err("验证码错误，尚未启用二次验证".into());
                }
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.totp_secret = Some(secret);
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                self.pending_totp = None;
                Ok(json!(true))
            }
            "totp_cancel" => {
                self.pending_totp = None;
                Ok(json!(true))
            }
            "totp_disable" => {
                self.authenticate(&p)?;
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.totp_secret = None;
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                self.pending_totp = None;
                Ok(json!(true))
            }
            "webdav_save" => {
                let url = field(&p, "url").trim();
                if !url.is_empty() {
                    validate_url(url)?;
                }
                let db = self.candidate()?;
                let mut prefs = db.preferences()?;
                prefs.webdav_url = url.into();
                prefs.webdav_username = field(&p, "username").into();
                if !field(&p, "password").is_empty() {
                    prefs.webdav_password = field(&p, "password").into();
                }
                if url.is_empty() {
                    prefs.webdav_password.clear();
                    prefs.webdav_username.clear();
                }
                db.set_preferences(&prefs)?;
                self.commit(db)?;
                Ok(json!(true))
            }
            "webdav_backup" => {
                let prefs = self.current()?.db.preferences()?;
                let mut url = validate_url(&prefs.webdav_url)?;
                url.path_segments_mut()
                    .map_err(|_| "WebDAV 地址无效")?
                    .pop_if_empty()
                    .push(&backup_name());
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(45))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(err)?;
                let response = client
                    .put(url.clone())
                    .basic_auth(&prefs.webdav_username, Some(&prefs.webdav_password))
                    .header("If-None-Match", "*")
                    .header("Content-Type", "application/octet-stream")
                    .body(vault::read(&self.path)?)
                    .send()
                    .map_err(|_| {
                        "无法连接 WebDAV，请检查网络、HTTPS 证书和服务器地址".to_string()
                    })?;
                if !response.status().is_success() {
                    return Err(format!(
                        "WebDAV 返回 HTTP {}，请确认目录已存在且账号具有写入权限",
                        response.status().as_u16()
                    ));
                }
                let warning = self.mark_backup().err();
                Ok(json!({"path":url.to_string(),"warning":warning}))
            }
            _ => Err("未知操作".into()),
        }
    }
    fn import(&mut self, p: &Value) -> Result<Value, String> {
        self.throttle()?;
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择笺藏加密备份")
            .add_filter("笺藏加密归档", &["dag"])
            .pick_file()
        else {
            return Ok(Value::Null);
        };
        self.import_path(&path, p)
    }
    pub(crate) fn import_path(
        &mut self,
        path: &std::path::Path,
        p: &Value,
    ) -> Result<Value, String> {
        self.throttle()?;
        if path == self.path {
            return Err("请选择导出的备份文件".into());
        }
        let bytes = vault::read(path)?;
        let result = (|| {
            let (plain, key, salt) = vault::decrypt(&bytes, &password(p))?;
            let db = Database::from_bytes(&plain)?;
            verify_totp(&db, field(p, "code"))?;
            Ok::<_, String>(Session { db, key, salt })
        })();
        let session = match result {
            Ok(s) => s,
            Err(e) => {
                self.failure();
                return Err(e);
            }
        };
        if self.path.exists() {
            let recovery = self
                .path
                .parent()
                .ok_or("数据目录错误")?
                .join(format!("before-import-{}", backup_name()));
            vault::write_new(&recovery, &vault::read(&self.path)?)?;
        }
        vault::atomic_write(&self.path, &bytes)?;
        self.session = Some(session);
        self.pending_totp = None;
        self.failures = 0;
        self.retry_after = None;
        self.last_activity = Instant::now();
        Ok(json!(true))
    }
}
fn validate_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "请输入完整的 HTTPS WebDAV 文件夹地址")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("WebDAV 仅支持 HTTPS，地址内不能包含密码、查询参数或片段".into());
    }
    Ok(url)
}
