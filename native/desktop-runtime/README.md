# Shared desktop runtime

This source file contains the Tauri commands shared by `xsheet-editor`,
`xsheet-remap`, and `xsheet-template-editor`. Each desktop shell includes the
same source at compile time so app-specific Tauri configuration remains local
without duplicating filesystem and dialog behavior.
