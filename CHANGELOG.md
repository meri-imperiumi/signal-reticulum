# Changelog
## [Unreleased]
### Added
- Ability to configure and connect to various Reticulum interfaces
- Optional shared Reticulum instance support: reuse a locally running `rnsd` and its mesh interfaces, enabled by default with automatic fallback to the configured interfaces
- Basic LXMF messaging: registers the `lxmf.delivery` destination and announces the node to the mesh
- Forward Signal K `alarm`/`emergency` notifications to crew members as LXMF messages, with episode-based debouncing to avoid spamming on flapping alerts
- Initial release
