use crate::{database::Database, model::Document, service::AppState, vault};
use serde_json::json;

fn document(title: &str) -> Document {
    Document {
        processing_months: vec![],
        archived_months: vec![],
        id: String::new(),
        title: title.into(),
        kind: "incoming".into(),
        sender: "综合管理部".into(),
        recipient: "本人".into(),
        handler: "张三".into(),
        signed_at: "2026-09-01".into(),
        received_at: "2026-09-03".into(),
        sent_at: "".into(),
        number: "综管〔2026〕028号".into(),
        location: "A柜二层".into(),
        notes: "重要文件".into(),
        tags: vec!["通知".into()],
        links: vec![],
        status: "pending".into(),
        archived: false,
        created_at: String::new(),
        updated_at: String::new(),
    }
}
fn setup() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let mut app = AppState::new(dir.path().join("archive.dag"));
    app.dispatch("setup", json!({"password":"a-secure-test-password"}))
        .unwrap();
    (dir, app)
}
#[test]
fn encrypted_round_trip_and_tamper_detection() {
    let salt = vault::salt();
    let key = vault::derive("test-password", &salt).unwrap();
    let bytes = vault::encrypt("机密会议材料".as_bytes(), &key, &salt).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("机密"));
    assert_eq!(
        &*vault::decrypt(&bytes, "test-password").unwrap().0,
        "机密会议材料".as_bytes()
    );
    assert!(vault::decrypt(&bytes, "wrong-password").is_err());
    let mut changed = bytes.clone();
    *changed.last_mut().unwrap() ^= 1;
    assert!(vault::decrypt(&changed, "test-password").is_err());
    let other = vault::encrypt("机密会议材料".as_bytes(), &key, &salt).unwrap();
    assert_ne!(bytes, other);
}
#[test]
fn chinese_pinyin_initials_and_tags_search() {
    let db = Database::new().unwrap();
    let mut doc = document("关于开展季度工作总结的通知");
    doc.id = "one".into();
    db.save(&doc).unwrap();
    for query in ["工作总结", "gongzuo", "gzzj", "季度 通知", "zonghe", "A柜"] {
        assert_eq!(db.list(query, "", "").unwrap().len(), 1, "query: {query}");
    }
    assert_eq!(db.list("", "incoming", "通知").unwrap().len(), 1);
    assert_eq!(db.list("", "outgoing", "").unwrap().len(), 0);
    assert_eq!(db.list("%' OR 1=1 --", "", "").unwrap().len(), 0);
    assert_eq!(db.list("", "", "不匹配").unwrap().len(), 0);
}
#[test]
fn serialized_database_preserves_links_and_cascades_delete() {
    let db = Database::new().unwrap();
    let mut a = document("原件");
    a.id = "a".into();
    db.save(&a).unwrap();
    let mut b = document("回复");
    b.id = "b".into();
    b.links = vec!["a".into()];
    db.save(&b).unwrap();
    let restored = Database::from_bytes(&db.bytes().unwrap()).unwrap();
    assert_eq!(restored.list("回复", "", "").unwrap()[0].links, vec!["a"]);
    restored.delete("a").unwrap();
    assert!(restored.list("回复", "", "").unwrap()[0].links.is_empty());
}
#[test]
fn crud_persists_across_lock_and_restart() {
    let (_dir, mut app) = setup();
    let saved = app
        .dispatch("save", json!(document("档案持久化测试")))
        .unwrap();
    let id = saved["id"].as_str().unwrap().to_string();
    app.dispatch("lock", json!({})).unwrap();
    assert!(app.dispatch("list", json!({})).is_err());
    let mut reopened = AppState::new(app.path.clone());
    reopened
        .dispatch("unlock", json!({"password":"a-secure-test-password"}))
        .unwrap();
    let found = reopened
        .dispatch("list", json!({"query":"chijiuhua"}))
        .unwrap();
    assert_eq!(found.as_array().unwrap().len(), 1);
    let mut edit = found[0].clone();
    edit["title"] = json!("更新后的标题");
    reopened.dispatch("save", edit).unwrap();
    reopened.dispatch("delete", json!({"id":id})).unwrap();
    assert!(reopened
        .dispatch("list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn invalid_link_does_not_partially_save() {
    let (_dir, mut app) = setup();
    let original = std::fs::read(&app.path).unwrap();
    let mut d = document("不得部分写入");
    d.links = vec!["missing".into()];
    assert!(app.dispatch("save", json!(d)).is_err());
    assert!(app
        .dispatch("list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(std::fs::read(&app.path).unwrap(), original);
}
#[test]
fn validation_cleans_type_specific_dates() {
    let mut d = document("   ");
    assert!(d.validate().is_err());
    d.title = "测试".into();
    d.signed_at = "2026-02-30".into();
    assert!(d.validate().is_err());
    d.signed_at = "2026-02-28".into();
    d.sent_at = "2026-09-10".into();
    d.validate().unwrap();
    assert!(d.sent_at.is_empty());
    d.kind = "outgoing".into();
    d.tags = vec![" 通知 ".into(), "通知".into()];
    d.validate().unwrap();
    assert!(d.received_at.is_empty());
    assert_eq!(d.tags, vec!["通知"]);
    d.kind = "request".into();
    d.received_at = "2026-09-11".into();
    d.sent_at = "2026-09-12".into();
    d.handler = "李四".into();
    d.validate().unwrap();
    assert!(d.received_at.is_empty() && d.sent_at.is_empty());
    assert_eq!(d.handler, "李四");
    assert!(d.number.is_empty());
    d.kind = "other".into();
    d.validate().unwrap();
    assert!(d.handler.is_empty());
    d.id = "self".into();
    d.links = vec!["self".into()];
    assert!(d.validate().is_err());
}
#[test]
fn password_rotation_leaves_old_backups_decryptable() {
    let (_dir, mut app) = setup();
    let old = std::fs::read(&app.path).unwrap();
    app.dispatch(
        "change_password",
        json!({"password":"a-secure-test-password","newPassword":"the-new-long-password"}),
    )
    .unwrap();
    let new = std::fs::read(&app.path).unwrap();
    assert!(vault::decrypt(&new, "a-secure-test-password").is_err());
    assert!(vault::decrypt(&new, "the-new-long-password").is_ok());
    assert!(vault::decrypt(&old, "a-secure-test-password").is_ok());
}
#[test]
fn backup_never_overwrites_and_atomic_update_is_valid() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.dag");
    vault::write_new(&path, b"old").unwrap();
    assert!(vault::write_new(&path, b"new").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"old");
    vault::atomic_write(&path, b"updated").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"updated");
}
#[test]
fn totp_requires_confirmation_and_protects_login() {
    use totp_rs::{Algorithm, Secret, TOTP};
    let (_dir, mut app) = setup();
    let result = app
        .dispatch("totp_prepare", json!({"password":"a-secure-test-password"}))
        .unwrap();
    assert_eq!(
        app.dispatch("preferences", json!({})).unwrap()["totpEnabled"],
        false
    );
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        Secret::Encoded(result["secret"].as_str().unwrap().into())
            .to_bytes()
            .unwrap(),
        Some("笺藏".into()),
        "本地归档库".into(),
    )
    .unwrap();
    assert!(app.dispatch("totp_enable", json!({"code":"bad"})).is_err());
    let code = totp.generate_current().unwrap();
    app.dispatch("totp_enable", json!({"code":code})).unwrap();
    app.dispatch("lock", json!({})).unwrap();
    assert!(app
        .dispatch("unlock", json!({"password":"a-secure-test-password"}))
        .is_err());
    app.dispatch(
        "unlock",
        json!({"password":"a-secure-test-password","code":totp.generate_current().unwrap()}),
    )
    .unwrap();
    assert!(app
        .dispatch(
            "totp_disable",
            json!({"password":"a-secure-test-password","code":"bad"})
        )
        .is_err());
    app.dispatch(
        "totp_disable",
        json!({"password":"a-secure-test-password","code":totp.generate_current().unwrap()}),
    )
    .unwrap();
    assert_eq!(
        app.dispatch("preferences", json!({})).unwrap()["totpEnabled"],
        false
    );
}
#[test]
fn failed_login_is_rate_limited() {
    let (_dir, mut app) = setup();
    app.dispatch("lock", json!({})).unwrap();
    for _ in 0..5 {
        assert!(app.dispatch("unlock", json!({"password":"bad"})).is_err());
    }
    assert!(app
        .dispatch("unlock", json!({"password":"a-secure-test-password"}))
        .unwrap_err()
        .contains("尝试次数过多"));
}
#[test]
fn webdav_rejects_insecure_or_credential_bearing_urls() {
    let (_dir, mut app) = setup();
    for url in [
        "http://example.com",
        "https://user:pass@example.com",
        "file:///tmp",
        "https://example.com/?password=a",
    ] {
        assert!(app.dispatch("webdav_save", json!({"url":url})).is_err());
    }
    app.dispatch(
        "webdav_save",
        json!({"url":"https://example.com/backup/","username":"me","password":"secret"}),
    )
    .unwrap();
    let prefs = app.dispatch("preferences", json!({})).unwrap();
    assert_eq!(prefs["hasWebdavPassword"], true);
    assert!(!prefs.to_string().contains("secret"));
}

#[test]
fn locations_and_theme_preferences_are_validated_and_persisted() {
    let (_dir, mut app) = setup();
    app.dispatch(
        "locations_set",
        json!({"locations":["A柜"," A柜 ","新位置"]}),
    )
    .unwrap();
    let prefs = app.dispatch("preferences", json!({})).unwrap();
    assert_eq!(prefs["locations"].as_array().unwrap().len(), 2);
    assert!(app.dispatch("theme_save",json!({"theme":"dark","fontZh":"SimSun","fontEn":"Georgia","accent":"#123456","backgroundOpacity":"0.42","backgroundImage":"data:image/png;base64,abc"})).is_ok());
    let prefs = app.dispatch("preferences", json!({})).unwrap();
    assert_eq!(prefs["theme"], "dark");
    assert_eq!(prefs["fontZh"], "SimSun");
    assert_eq!(prefs["accent"], "#123456");
    assert!(app
        .dispatch("theme_save", json!({"accent":"not-a-color"}))
        .is_err());
    assert!(app
        .dispatch("theme_save", json!({"backgroundOpacity":"1"}))
        .is_err());
}
#[test]
fn malformed_database_and_weak_password_are_rejected() {
    assert!(Database::from_bytes(b"not a database").is_err());
    assert!(vault::decrypt(b"not a vault", "password").is_err());
    let dir = tempfile::tempdir().unwrap();
    let mut app = AppState::new(dir.path().join("archive.dag"));
    assert!(app.dispatch("setup", json!({"password":"123"})).is_err());
    assert!(!app.path.exists());
}

#[test]
fn restore_preserves_original_and_rejects_wrong_password_without_mutation() {
    let (dir, mut app) = setup();
    app.dispatch("save", json!(document("备份中的文件")))
        .unwrap();
    let backup = dir.path().join("export.dag");
    std::fs::copy(&app.path, &backup).unwrap();
    app.dispatch("save", json!(document("导入前新增文件")))
        .unwrap();
    let original = std::fs::read(&app.path).unwrap();
    assert!(app
        .import_path(&backup, &json!({"password":"wrong"}))
        .is_err());
    assert_eq!(std::fs::read(&app.path).unwrap(), original);
    app.import_path(&backup, &json!({"password":"a-secure-test-password"}))
        .unwrap();
    let list = app.dispatch("list", json!({})).unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["title"], "备份中的文件");
    let recovery = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("before-import-")
        })
        .unwrap();
    assert_eq!(std::fs::read(recovery).unwrap(), original);
    let mut migrated = AppState::new(dir.path().join("new-device.dag"));
    migrated
        .import_path(&backup, &json!({"password":"a-secure-test-password"}))
        .unwrap();
    assert_eq!(
        migrated
            .dispatch("list", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn disk_failure_does_not_change_active_records() {
    let (dir, mut app) = setup();
    std::fs::rename(&app.path, dir.path().join("original.dag")).unwrap();
    std::fs::create_dir(&app.path).unwrap();
    assert!(app
        .dispatch("save", json!(document("不应出现的文件")))
        .is_err());
    assert!(app
        .dispatch("list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn sqlite_never_uses_disk_for_temporary_data_and_erases_deleted_content() {
    let db = Database::new().unwrap();
    let mut doc = document("SENSITIVE-ERASE-MARKER-56329");
    doc.id = "delete-me".into();
    db.save(&doc).unwrap();
    let restored = Database::from_bytes(&db.bytes().unwrap()).unwrap();
    let temp_store: i64 = restored
        .0
        .query_row("PRAGMA temp_store", [], |r| r.get(0))
        .unwrap();
    assert_eq!(temp_store, 2);
    restored.delete("delete-me").unwrap();
    assert!(!String::from_utf8_lossy(&restored.bytes().unwrap())
        .contains("SENSITIVE-ERASE-MARKER-56329"));
}

#[test]
fn monthly_work_is_preserved_deduplicated_and_persisted() {
    let (_dir, mut app) = setup();
    let mut doc = document("月度流转");
    doc.status = "processing".into();
    let mut saved = app.dispatch("save", json!(doc)).unwrap();
    let month = chrono::Local::now().format("%Y-%m").to_string();
    assert_eq!(saved["processingMonths"], json!([month]));
    saved["status"] = json!("archived");
    saved["processingMonths"] = json!([]);
    saved = app.dispatch("save", saved).unwrap();
    assert_eq!(saved["processingMonths"], json!([month]));
    assert_eq!(saved["archivedMonths"], json!([month]));
    saved["status"] = json!("processing");
    saved["archived"] = json!(false);
    saved = app.dispatch("save", saved).unwrap();
    saved["status"] = json!("archived");
    saved = app.dispatch("save", saved).unwrap();
    assert_eq!(saved["processingMonths"], json!([month]));
    assert_eq!(saved["archivedMonths"], json!([month]));
    app.dispatch("lock", json!({})).unwrap();
    app.dispatch("unlock", json!({"password":"a-secure-test-password"})).unwrap();
    let listed = app.dispatch("list", json!({})).unwrap();
    assert_eq!(listed[0]["processingMonths"], json!([month]));
    assert_eq!(listed[0]["archivedMonths"], json!([month]));
    let mut legacy = json!(document("旧记录"));
    legacy.as_object_mut().unwrap().remove("processingMonths");
    legacy.as_object_mut().unwrap().remove("archivedMonths");
    let legacy: Document = serde_json::from_value(legacy).unwrap();
    assert!(legacy.processing_months.is_empty());
    assert!(legacy.archived_months.is_empty());
}
