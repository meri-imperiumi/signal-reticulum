# Changelog
## [Unreleased]
### Added
- Periodic telemetry broadcast to the crew: when the new `telemetry` config group is enabled, the node builds a Sideband-compatible telemetry snapshot from Signal K and sends it to every configured crew member over LXMF (carried in the `FIELD_TELEMETRY` field) shortly after start and then on a configurable interval (default 300 s, clamped to a 30 s minimum). The snapshot is wire-compatible with Sideband's `Telemeter.packed()` format so Sideband, NomadNet and MeshChat render it in the peer telemetry view
- Position is sent as the Sideband `location` sensor: `navigation.position` (lat/lon), `navigation.speedOverGround` (m/s → km/h) and `navigation.courseOverGroundTrue` (rad → deg), packed as the exact big-endian fixed-point integers Sideband expects
- The same Signal K keys the NomadNet index page serves are now also emitted as telemetry sensors so both views stay consistent: house battery state of charge (0–1 → %, as the `battery` sensor) and depth, tide, wind (m/s → knots, rad → deg), anchor watch and navigation state (as `custom` sensor entries with Material Design icons)
- NomadNet site index page now shows live telemetry (vessel state, navigation position, anchor distance, water depth, tide, wind in knots/degrees, house battery state of charge and current) when the corresponding Signal K keys are available. Readings are converted for display (m/s → knots, radians → degrees, decimal degrees → degrees and decimal minutes, 0–1 → %) and absent ones are omitted so the page never shows empty placeholders
- Configurable NomadNet page banner: a new `banner` option lets you replace the vessel-name heading with multi-line micron/ASCII art
- Configurable NomadNet page footer: a new `footer` option appends multi-line micron/ASCII text to the bottom of the index page (after the telemetry), useful for contact details or a static note
- The NomadNet page `banner` (and the new `footer`) configuration fields are now multi-line text areas, so multi-line ASCII art and micron content can be entered comfortably in the Signal K plugin config UI
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
- LXMF clients could not see the node's `lxmf.delivery` announce even though the NomadNet announce showed up fine: the LXMF delivery destination advertised a forward-secrecy ratchet (announce `context_flag = 1`), which clients that parse the announce body at a fixed signature offset (older Sideband / NomadNet / MeshChat, firmware builds) silently reject as signature-invalid. Ratchets are now off by default so the announce is ratchet-less (`context_flag = 0`), which is interop-correct against every RNS 1.x receiver. Operators whose clients all support ratchet-bearing announces can re-enable forward secrecy with the new `messaging.forward_secrecy` option
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
