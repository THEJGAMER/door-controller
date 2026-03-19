> [!CAUTION]
> **WARNING: THIS PROJECT IS 100% VIBE CODED.**
> This codebase was built in a fever dream of AI prompts and "it looks right" logic. 
> If it works, it's a miracle. If it breaks your door controller, it's a vibe. 
> Proceed with extreme caution and low expectations.

# DoorControl Pro 🛡️

An enterprise-grade, real-time web management interface for UHPPOTE TCP/IP Wiegand Access Controllers. Built with Node.js, SQLite, and WebSockets for high-performance multi-site security management.

## 🚀 Key Features

### ⚡ Real-Time Operations
- **Instant WebSocket Updates**: Powered by **Socket.io**. The server pushes hardware events to your browser the millisecond they happen—no more waiting for page refreshes.
- **Live Door Status**: Visual badges for **Locked/Unlocked** (relay state) and **Open/Closed** (magnetic sensor) that react in true real-time.
- **Event-Driven UI**: Zero-latency feedback loop between the physical door and the management dashboard.

### 🏢 Site-Wide Management
- **🌐 Door Groups & Site Provisioning**: Group doors across multiple controllers (e.g., "Ground Floor", "Data Center") and provision cards to an entire site in one click.
- **🔍 Searchable Search**: Integrated **Tom Select** for powerful, searchable multi-group selection when managing user access.
- **💾 Persistent SQLite Backend**: All controller metadata, custom names, door groups, and network settings are saved permanently in a local database.

### 📊 Advanced Audit & Diagnostics
- **Unified Event History**: Automatically aggregates and merges logs from all controllers into a single chronological audit trail.
- **Smart Classification**: Intelligently distinguishes between **Card Swipes** (Access) and **Sensor Events** (Hardware status changes) with distinct icons and color-coding.
- **Hardware Diagnostics**: A dedicated **System Debug** page to send raw commands directly to controllers and inspect the underlying JSON responses.

### 🔐 Security & Reliability
- **Enterprise Auth**: Seamless **OIDC (Keycloak)** integration for secure administrator access.
- **Smart Probing**: Continually verifies controller health across subnets, providing reliable Online/Offline status indicators.
- **Auto-Sync Config**: Every time a controller's detail panel is opened, the app verifies the **actual hardware configuration** (Delay/Mode) to ensure the UI is never stale.

## 🏗️ Architecture

- **Backend**: Node.js, Express, Socket.io, `uhppoted` UDP driver.
- **Database**: SQLite (`better-sqlite3`) for high-concurrency persistence.
- **Frontend**: Vanilla JS (ES6+), WebSockets, Bootstrap 5, Tom Select.
- **Proxy**: Nginx configured for WebSocket passthrough and large OIDC token support.

## 📋 Prerequisites

- **UHPPOTE Controllers** (1, 2, or 4-door models).
- **Node.js** v18+
- **Keycloak** or another OIDC provider.
- **Nginx** (for reverse proxy, SSL, and WebSocket support).

## 🛠️ Installation & Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/your-repo/door-control-pro.git
   cd door-control-pro
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file with your OIDC and Network settings.

3. **Critical Nginx Configuration**:
   OIDC tokens and large hardware responses require expanded buffers. Add this to your `location /` block:
   ```nginx
   proxy_buffer_size          128k;
   proxy_buffers              4 256k;
   proxy_busy_buffers_size    256k;
   proxy_http_version         1.1;
   proxy_set_header           Upgrade $http_upgrade;
   proxy_set_header           Connection "upgrade";
   ```

4. **Deploy**:
   ```bash
   sudo cp door-controller.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now door-controller
   ```

## 📚 Sources & Credits

This project leverages several open-source libraries:

- **[uhppoted-nodejs](https://github.com/uhppoted/uhppoted-nodejs)**: The core hardware driver.
- **[Socket.io](https://socket.io/)**: Real-time event engine.
- **[express-openid-connect](https://github.com/auth0/express-openid-connect)**: OIDC middleware.
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)**: High-performance persistence.
- **[Tom Select](https://tom-select.js.org/)**: Searchable select UI.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Disclaimer: This software is provided "as is" without warranty of any kind. Use extreme caution when remotely reconfiguring hardware parameters.*
