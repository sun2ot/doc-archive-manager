use crate::model::{Document, Preferences};
use pinyin::ToPinyin;
use rusqlite::{params, Connection, MAIN_DB};

pub struct Database(pub Connection);
pub fn search_text(text: &str) -> String {
    let mut full = String::new();
    let mut initials = String::new();
    for ch in text.chars() {
        if let Some(py) = ch.to_pinyin() {
            full.push_str(py.plain());
            initials.push(py.first_letter().chars().next().unwrap_or(' '));
        } else {
            full.push(ch);
            initials.push(ch);
        }
    }
    format!("{} {} {}", text, full, initials).to_lowercase()
}
impl Database {
    pub fn new() -> Result<Self, String> {
        let db = Connection::open_in_memory().map_err(err)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA journal_mode=MEMORY; PRAGMA secure_delete=ON;
            CREATE TABLE documents(id TEXT PRIMARY KEY, data TEXT NOT NULL, search TEXT NOT NULL);
            CREATE TABLE links(source TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, target TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, PRIMARY KEY(source,target), CHECK(source<>target));
            CREATE INDEX links_target ON links(target);
            CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
            PRAGMA user_version=1;").map_err(err)?;
        let result = Self(db);
        result.set_preferences(&Preferences::default())?;
        Ok(result)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if !bytes.starts_with(b"SQLite format 3\0") || bytes.len() > 64 * 1024 * 1024 {
            return Err("数据库格式无效或超过 64 MB 上限".into());
        }
        let mut db = Connection::open_in_memory().map_err(err)?;
        db.deserialize_read_exact(MAIN_DB, bytes, bytes.len(), false)
            .map_err(err)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA journal_mode=MEMORY; PRAGMA secure_delete=ON;")
            .map_err(err)?;
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version != 1 {
            return Err("数据库版本不兼容，请使用对应版本的软件".into());
        }
        let check: String = db
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(err)?;
        if check != "ok" {
            return Err("数据库完整性校验失败".into());
        }
        let result = Self(db);
        result.preferences()?;
        let docs = result.list("", "", "")?;
        for mut doc in docs {
            doc.validate()?;
        }
        let broken: i64 = result
            .0
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if broken != 0 {
            return Err("文件关联完整性校验失败".into());
        }
        Ok(result)
    }
    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        let bytes = self.0.serialize(MAIN_DB).map_err(err)?.to_vec();
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("数据库超过 64 MB 上限，请分库归档".into());
        }
        Ok(bytes)
    }
    pub fn preferences(&self) -> Result<Preferences, String> {
        let s: String = self
            .0
            .query_row("SELECT data FROM settings WHERE id=1", [], |r| r.get(0))
            .map_err(err)?;
        serde_json::from_str(&s).map_err(err)
    }
    pub fn set_preferences(&self, prefs: &Preferences) -> Result<(), String> {
        self.0.execute("INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(prefs).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn list(&self, query: &str, kind: &str, tag: &str) -> Result<Vec<Document>, String> {
        let mut stmt = self.0.prepare("SELECT data,search FROM documents ORDER BY json_extract(data,'$.updatedAt') DESC, id").map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let mut result = Vec::new();
        for row in rows {
            let (data, search) = row.map_err(err)?;
            let mut doc: Document = serde_json::from_str(&data).map_err(err)?;
            if (!kind.is_empty() && doc.kind != kind)
                || (!tag.is_empty() && !doc.tags.iter().any(|t| t == tag))
                || !terms.iter().all(|q| search.contains(q))
            {
                continue;
            }
            let mut links = self
                .0
                .prepare("SELECT target FROM links WHERE source=?1 ORDER BY target")
                .map_err(err)?;
            doc.links = links
                .query_map([&doc.id], |r| r.get(0))
                .map_err(err)?
                .collect::<Result<_, _>>()
                .map_err(err)?;
            result.push(doc);
        }
        Ok(result)
    }
    pub fn save(&self, doc: &Document) -> Result<(), String> {
        let text = format!(
            "{} {} {} {} {} {} {} {}",
            doc.title,
            doc.sender,
            doc.recipient,
            doc.handler,
            doc.number,
            doc.location,
            doc.notes,
            doc.tags.join(" ")
        );
        self.0.execute("INSERT INTO documents VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,search=excluded.search",
            params![doc.id, serde_json::to_string(doc).map_err(err)?, search_text(&text)]).map_err(err)?;
        self.0
            .execute("DELETE FROM links WHERE source=?1", [&doc.id])
            .map_err(err)?;
        for target in &doc.links {
            self.0
                .execute("INSERT INTO links VALUES(?1,?2)", params![doc.id, target])
                .map_err(|_| "关联目标不存在，请刷新后重试".to_string())?;
        }
        Ok(())
    }
    pub fn delete(&self, id: &str) -> Result<(), String> {
        if self
            .0
            .execute("DELETE FROM documents WHERE id=?1", [id])
            .map_err(err)?
            == 0
        {
            return Err("文件不存在".into());
        }
        Ok(())
    }
}
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
