# back

Tafac's backend in Rust, as it moves off the Node server (`server.js`,
`server/`) a route at a time, onto
[tonAPI](https://github.com/l-ent-univ/tonAPI).

One Cargo workspace; each crate under `crates/`:

- `crates/tafac-gateway`: the routes tonAPI answers in Node's place. The
  apps call it in-process from their bridge (`src-tauri/src/bridge.rs`);
  on tafac.fr it is a small server in front of Node. How it works:
  `docs/DESKTOP.md`, « tonAPI ».

```sh
cd back
cargo test                                   # every crate
cargo build --release -p tafac-gateway       # tafac.fr's server
```

tonAPI's repository is private for now: Cargo fetches it with git
(`.cargo/config.toml`, at the repository's root), so a build needs read
access to it.
