# Shared desktop runtime

This crate contains the Tauri commands shared by `xsheet-editor`,
`xsheet-remap`, and `xsheet-template`. Each desktop shell generates its
own Tauri context from its local configuration and passes that context to the
shared runtime.
