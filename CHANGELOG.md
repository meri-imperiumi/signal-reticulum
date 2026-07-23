# Changelog
## [Unreleased]
### Changed
- Switched from the monolithic `reticulum-js` package to the split `@reticulum/core` (protocol stack, identity, LXMF, utilities) and `@reticulum/node` (Node.js interfaces and the interface registry) packages
- Shared-instance connection now uses `LocalClientInterface.connectToSharedInstance` from `@reticulum/node` directly (the node no longer exposes it), and the plugin attaches the returned interface to the transport itself

### Added
- Ability to configure and connect to various Reticulum interfaces
- Optional shared Reticulum instance support: reuse a locally running `rnsd` and its mesh interfaces, enabled by default with automatic fallback to the configured interfaces
- Basic LXMF messaging: registers the `lxmf.delivery` destination and announces the node to the mesh
- Forward Signal K `alarm`/`emergency` notifications to crew members as LXMF messages, with episode-based debouncing to avoid spamming on flapping alerts
- Receive LXMF messages and handle text commands, starting with a `ping`/`pong` responder available to any peer
- Initial release

### Fixed
- Resolved a `ReferenceError` (`readSelf is not defined`) that prevented LXMF messaging from coming up on start
