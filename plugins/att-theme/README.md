# AT&T Theme Plugin for NetOps2

This plugin registers AT&T Light (`AT&T Light`) and AT&T Dark (`AT&T Dark`) themes in NetOps2, matching the look & feel and color palette from the USPe Automation Platform (`apm0014228-uspe-automation-platform`).

## Color Specs (from USPe Platform)
- **Primary Brand Color**: `#009fdb` (AT&T Blue)
- **Light Theme**:
  - Background: `#f3f5f8`
  - Cards / Surface: `#ffffff`
  - Sidebar Navy: `#0f1f2e`
  - Text Primary: `#0f1f2e`
- **Dark Theme**:
  - Background: `#0b131c`
  - Cards / Surface: `#101a26`
  - Surface Muted: `#162334`
  - Text Primary: `#eaf2fb`
- **Border Radius**: 10px

## Usage

Build plugin:
```bash
npm install
npm run build
```

Once loaded into NetOps2 (`.plugins/att-theme` or plugins directory), navigate to **Settings -> General -> Theme** and select `AT&T Light` or `AT&T Dark`.
