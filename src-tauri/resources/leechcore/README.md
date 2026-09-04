# LeechCore runtime resources

These files come from the official LeechCore 2.23.3 binary bundles dated
2026-08-20. Thanatology packages only the native DMA runtime libraries needed
by `memflow-pcileech`; the LeechCore core is linked into the application and is
therefore not duplicated here.

Each platform configuration maps its target-specific files to the installed
`leechcore-runtime` directory. The corresponding `LICENSE.txt` and
`license_info_all.txt` files are included in every bundle. The Windows bundle
also includes the Microsoft runtime redistribution notice.

Linux FT601 support requires the system `libusb-1.0` runtime. The macOS dynamic
libraries must be signed as nested code before signing and notarizing the app.

## SHA-256

| Target | File | SHA-256 |
| --- | --- | --- |
| macOS arm64 | `leechcore_ft601_driver_macos.dylib` | `19c14732faf6c574365bcc58ee3a54e947ba030147f954f797b687118d510116` |
| macOS arm64 | `libftd3xx.dylib` | `70eb91d10524a5a750b5653407c3d955ac1c37f32389a2bb0ec41aeb23cf2b4d` |
| Linux x86_64 | `leechcore_driver.so` | `2bfdbaaec4ee72ab43b08b958ab64738ac29aa3545cb60cf5f366acecde0975e` |
| Linux x86_64 | `leechcore_ft601_driver_linux.so` | `9c56297663ef5330a22761936c8ae29f332efe9791990446169eca03e10e915d` |
| Windows x86_64 | `leechcore_driver.dll` | `18a0125f71ac1a37127207c364024739f134f9bdedc77c68db9e51dcb0736c70` |
| Windows x86_64 | `FTD3XXWU.dll` | `c507cb40f188740c4a7ba3aae4f848a305192b9b7c9e8e9264b1d66335824bfa` |
| Windows x86_64 | `FTD3XX.dll` | `3c0fc158fd4aa604c526d58ed8274ae830d53e69e01210cc5b5fa54ec5a9b7c0` |
| Windows x86_64 | `vcruntime140.dll` | `e4d5a1842d65e99581e52225e0af6455e078e95b3ea3d3b49f673e4d5168b82d` |
