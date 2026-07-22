# Changelog
## [Unreleased]
### Added
- Ability to configure and connect to various Reticulum interfaces
- Basic LXMF messaging: registers the `lxmf.delivery` destination and announces the node to the mesh
- Forward Signal K `alarm`/`emergency` notifications to crew members as LXMF messages, with episode-based debouncing to avoid spamming on flapping alerts
- Initial release
