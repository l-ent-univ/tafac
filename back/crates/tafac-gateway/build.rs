// Puts tonAPI's universities (their settings files) into the crate.
//
// tonAPI is a dependency at one commit (Cargo.toml). Its settings for each
// university are files of its repository, beside its code
// (universities/<id>/university.toml, establishments/*.toml). They are taken
// from the very copy Cargo builds this crate with, so settings and code
// never differ and nothing of tonAPI is kept in this repository:
// src/universities.rs includes what this writes.
//
// Where that copy is: Cargo's own folder of git checkouts, by the commit the
// lock file names; `cargo metadata` when it isn't found there.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const PACKAGE: &str = "tonapi-config";

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("set by Cargo"));
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");

    let lock = lock_file(&manifest_dir);
    if let Some(lock) = &lock {
        println!("cargo:rerun-if-changed={}", lock.display());
    }
    let commit = lock.as_deref().and_then(locked_commit);
    let universities = commit
        .as_deref()
        .and_then(in_cargo_checkouts)
        .or_else(|| from_cargo_metadata(&manifest_dir))
        .unwrap_or_else(|| panic!("tonAPI's universities were not found: is {PACKAGE} still a git dependency (Cargo.toml)?"));

    let mut written = String::from("// Written by build.rs: tonAPI's settings, from the copy this crate is built with.\n");
    written.push_str(&format!("pub const TONAPI_COMMIT: &str = {:?};\n", commit.unwrap_or_default()));
    written.push_str("pub const EMBEDDED: &[Embedded] = &[\n");
    for id in folders(&universities) {
        let folder = universities.join(&id);
        let university = folder.join("university.toml");
        if !university.is_file() {
            continue;
        }
        written.push_str(&format!("    Embedded {{ id: {id:?}, university: include_str!({:?}), establishments: &[\n", university));
        for file in files(&folder.join("establishments"), "toml") {
            let name = file.file_stem().unwrap_or_default().to_string_lossy().to_string();
            written.push_str(&format!("        ({name:?}, include_str!({file:?})),\n"));
        }
        written.push_str("    ] },\n");
    }
    written.push_str("];\n");

    let out = PathBuf::from(env::var("OUT_DIR").expect("set by Cargo")).join("universities.rs");
    fs::write(out, written).expect("the build's own folder is writable");
}

fn folders(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| !name.starts_with('.') && !name.starts_with('_'))
        .collect();
    names.sort();
    names
}

fn files(folder: &Path, extension: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|found| found == extension))
        .collect();
    files.sort();
    files
}

// The lock file of the build: this crate's folder, or the workspace's above.
fn lock_file(manifest_dir: &Path) -> Option<PathBuf> {
    manifest_dir.ancestors().map(|folder| folder.join("Cargo.lock")).find(|lock| lock.is_file())
}

// The commit tonAPI is locked at: `source = "git+https://…#<commit>"`.
fn locked_commit(lock: &Path) -> Option<String> {
    let text = fs::read_to_string(lock).ok()?;
    let package = text.split("[[package]]").find(|package| package.contains(&format!("name = \"{PACKAGE}\"")))?;
    let source = package.lines().find(|line| line.starts_with("source = \"git+"))?;
    let commit = source.rsplit('#').next()?.trim_end_matches('"');
    (commit.len() >= 7 && commit.chars().all(|character| character.is_ascii_hexdigit())).then(|| commit.to_string())
}

// <cargo home>/git/checkouts/<repository>-<hash>/<start of the commit>/
fn in_cargo_checkouts(commit: &str) -> Option<PathBuf> {
    let user = || env::var_os("HOME").or_else(|| env::var_os("USERPROFILE"));
    let home = env::var_os("CARGO_HOME").map(PathBuf::from).or_else(|| Some(PathBuf::from(user()?).join(".cargo")))?;
    let checkouts = home.join("git").join("checkouts");
    for repository in folders(&checkouts) {
        for checkout in folders(&checkouts.join(&repository)) {
            let folder = checkouts.join(&repository).join(&checkout);
            if checkout.len() >= 7 && commit.starts_with(&checkout) && is_tonapi(&folder) {
                return Some(folder.join("universities"));
            }
        }
    }
    None
}

fn is_tonapi(checkout: &Path) -> bool {
    checkout.join("crates").join(PACKAGE).join("Cargo.toml").is_file() && checkout.join("universities").is_dir()
}

// <tonAPI>/crates/tonapi-config/Cargo.toml → <tonAPI>/universities
fn from_cargo_metadata(manifest_dir: &Path) -> Option<PathBuf> {
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let output = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--locked"])
        .args(env::var("TARGET").ok().map(|target| ["--filter-platform".to_string(), target]).into_iter().flatten())
        .arg("--manifest-path")
        .arg(manifest_dir.join("Cargo.toml"))
        .output()
        .ok()?;
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let package = metadata["packages"].as_array()?.iter().find(|package| package["name"] == PACKAGE)?;
    let checkout = Path::new(package["manifest_path"].as_str()?).parent()?.parent()?.parent()?.to_path_buf();
    is_tonapi(&checkout).then(|| checkout.join("universities"))
}
