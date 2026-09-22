use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::{rngs::OsRng, RngCore};
use std::{fs, io::Write, path::Path};
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"JCVAULT1";
pub const MAX_VAULT: u64 = 64 * 1024 * 1024 + 128;
pub struct Key(pub Zeroizing<[u8; 32]>);
pub fn salt() -> [u8; 16] {
    let mut s = [0; 16];
    OsRng.fill_bytes(&mut s);
    s
}
pub fn derive(password: &str, salt: &[u8; 16]) -> Result<Key, String> {
    if password.len() > 1024 {
        return Err("密码过长".into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|e| e.to_string())?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;
    Ok(Key(key))
}
pub fn encrypt(plain: &[u8], key: &Key, salt: &[u8; 16]) -> Result<Vec<u8>, String> {
    let mut nonce = [0; 12];
    OsRng.fill_bytes(&mut nonce);
    let mut header = MAGIC.to_vec();
    header.extend_from_slice(salt);
    header.extend_from_slice(&nonce);
    let cipher = Aes256Gcm::new_from_slice(key.0.as_ref()).map_err(|_| "加密密钥无效")?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: &header,
            },
        )
        .map_err(|_| "数据库加密失败")?;
    header.extend_from_slice(&encrypted);
    Ok(header)
}
pub fn decrypt(
    bytes: &[u8],
    password: &str,
) -> Result<(Zeroizing<Vec<u8>>, Key, [u8; 16]), String> {
    if bytes.len() < 52 || bytes.len() as u64 > MAX_VAULT || &bytes[..8] != MAGIC {
        return Err("不是有效的笺藏加密备份".into());
    }
    let salt: [u8; 16] = bytes[8..24].try_into().map_err(|_| "备份格式错误")?;
    let key = derive(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.0.as_ref()).map_err(|_| "密钥无效")?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(&bytes[24..36]),
            Payload {
                msg: &bytes[36..],
                aad: &bytes[..36],
            },
        )
        .map_err(|_| "密码错误，或文件已损坏")?;
    Ok((Zeroizing::new(plain), key, salt))
}
pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_VAULT {
        return Err("备份过大，最大支持 64 MB".into());
    }
    fs::read(path).map_err(|e| e.to_string())
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("无效的保存目录")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("保存失败，原数据保留：{}", e.error))?;
    Ok(())
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("无效的备份目录")?;
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist_noclobber(path)
        .map_err(|e| format!("备份未保存（目标可能已存在）：{}", e.error))?;
    Ok(())
}
