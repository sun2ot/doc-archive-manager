use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub sender: String,
    pub recipient: String,
    #[serde(default)]
    pub handler: String,
    pub signed_at: String,
    pub received_at: String,
    pub sent_at: String,
    pub number: String,
    pub location: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub processing_months: Vec<String>,
    #[serde(default)]
    pub archived_months: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Department {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub leaders: Vec<String>,
}

impl Default for Department {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            parent_id: None,
            leaders: Vec::new(),
        }
    }
}

fn default_status() -> String {
    "pending".into()
}

impl Document {
    pub fn validate(&mut self) -> Result<(), String> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > 200 {
            return Err("标题不能为空，且最多 200 个字符".into());
        }
        if !["incoming", "outgoing", "request", "other"].contains(&self.kind.as_str()) {
            return Err("无效的文件类型".into());
        }
        if self.kind == "incoming" {
            self.sent_at.clear();
        } else if self.kind == "outgoing" {
            self.received_at.clear();
        } else {
            self.received_at.clear();
            self.sent_at.clear();
        }
        if self.kind != "request" {
            self.handler.clear();
        } else {
            self.number.clear();
        }
        if self.status == "pending" && self.archived {
            self.status = "archived".into();
        }
        if !["processing", "pending", "archived"].contains(&self.status.as_str()) {
            return Err("无效的文件状态".into());
        }
        self.archived = self.status == "archived";
        for date in [&self.signed_at, &self.received_at, &self.sent_at] {
            if !date.is_empty()
                && (date.len() != 10 || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err())
            {
                return Err("日期格式应为 YYYY-MM-DD".into());
            }
        }
        for text in [
            &self.sender,
            &self.recipient,
            &self.handler,
            &self.number,
            &self.location,
        ] {
            if text.chars().count() > 300 {
                return Err("字段长度不能超过 300 字".into());
            }
        }
        if self.notes.len() > 30000 || self.tags.len() > 30 || self.links.len() > 200 {
            return Err("备注、标签或关联数量过多".into());
        }
        self.tags = self
            .tags
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if self.tags.iter().any(|s| s.chars().count() > 40) {
            return Err("每个标签最多 40 字".into());
        }
        self.tags.sort();
        self.tags.dedup();
        self.links.sort();
        self.links.dedup();
        if self.links.contains(&self.id) {
            return Err("文件不能关联自身".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Preferences {
    pub totp_secret: Option<String>,
    pub webdav_url: String,
    pub webdav_username: String,
    pub webdav_password: String,
    pub last_backup: Option<String>,
    pub locations: Vec<String>,
    pub theme: String,
    pub font_zh: String,
    pub font_en: String,
    pub accent: String,
    pub background_image: String,
    pub background_opacity: f32,
    pub font_scale: f32,
    pub auto_lock_minutes: u32,
    pub number_templates: Vec<String>,
    pub departments: Vec<Department>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            totp_secret: None,
            webdav_url: String::new(),
            webdav_username: String::new(),
            webdav_password: String::new(),
            last_backup: None,
            locations: vec![
                "A 柜 · 第 2 层 · 03 号档案盒".into(),
                "B 柜 · 第 1 层 · 01 号档案盒".into(),
                "档案室待整理区".into(),
            ],
            theme: "light".into(),
            font_zh: "MiSans".into(),
            font_en: "Segoe UI".into(),
            accent: "#2563eb".into(),
            background_image: String::new(),
            background_opacity: 0.18,
            font_scale: 1.0,
            auto_lock_minutes: 15,
            number_templates: vec![
                "〔2026〕".into(),
                "发〔2026〕".into(),
                "收〔2026〕".into(),
                "请〔2026〕".into(),
            ],
            departments: Vec::new(),
        }
    }
}
