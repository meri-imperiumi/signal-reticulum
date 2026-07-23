# Changelog
## [Unreleased]
### Added
- bzip2 compression support: `@digitaldefiance/bzip2-wasm` is wired as the Reticulum `compressionProvider`, so compressed inbound/outbound Resource transfers (large LXMF direct messages, NomadNet pages, propagation containers, PROTOCOL-SPEC.md §10.2) work. The adapter sizes the compress output buffer for bzip2's worst-case expansion so incompressible input no longer overflows
- Configurable Reticulum log level: a new top-level `log_level` option (default `notice`) controls the verbosity of the Reticulum stack's own diagnostic output in the Signal K server log, independent of the plugin's messages. Unset falls back to Reticulum's default / the `RETICULUM_LOG_LEVEL` environment variable
- Optional NomadNet site: when the new `nomadnet` config group is enabled, the node announces a `nomadnetwork.node` destination and serves a `/page/index.mu` page (currently just the vessel name) that NomadNet clients (Sideband, NomadNet, MeshChat) can browse. The page content is evaluated per-request so live telemetry can be added in later steps. Off by default
- Filesystem-backed persistence: a `FileStorageAdapter` (from `@reticulum/node`) rooted under `app.getDataDirPath()` is wired into the Reticulum node so learned peer identities, ratchet rings and path entries survive restarts. Persistence degrades gracefully to in-memory only on servers that expose no data directory
- Crew member identities are now persisted pre-emptively: the moment an announce from a configured crew member's `lxmf.delivery` destination is heard, their identity/ratchet/path data is stored through the node's persistor — before any message is exchanged — so a restart can still reach them immediately

### Changed
- Teardown now calls `Reticulum.stop()` (which disconnects interfaces and flushes the persistence layer) instead of the plugin's own interface-teardown code; the redundant `teardownInterfaces` helper has been removed
- Switched from the monolithic `reticulum-js` package to the split `@reticulum/core` (protocol stack, identity, LXMF, utilities) and `@reticulum/node` (Node.js interfaces and the interface registry) packages
- Shared-instance connection now uses `LocalClientInterface.connectToSharedInstance` from `@reticulum/node` directly (the node no longer exposes it), and the plugin attaches the returned interface to the transport itself

### Fixed
- NomadNet clients could see the announced node but their page requests timed out: the `nomadnetwork.node` destination now accepts incoming LINKREQUESTs (sending the LRPROOF that completes the link handshake) instead of only being visible. Page REQUESTs are then served over the established link

### Added
- Ability to configure and connect to various Reticulum interfaces
- Optional shared Reticulum instance support: reuse a locally running `rnsd` and its mesh interfaces, enabled by default with automatic fallback to the configured interfaces
- Basic LXMF messaging: registers the `lxmf.delivery` destination and announces the node to the mesh
- Forward Signal K `alarm`/`emergency` notifications to crew members as LXMF messages, with episode-based debouncing to avoid spamming on flapping alerts
- Receive LXMF messages and handle text commands, starting with a `ping`/`pong` responder available to any peer
- Initial release

### Fixed
- Resolved a `ReferenceError` (`readSelf is not defined`) that prevented LXMF messaging from coming up on start
