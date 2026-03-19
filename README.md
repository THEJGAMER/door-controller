# DoorControl Pro 🛡️

An enterprise-grade web management interface for UHPPOTE TCP/IP Wiegand Access Controllers. Built with Node.js, SQLite, and OIDC (Keycloak) for secure, scalable multi-site door management.

## 🚀 Key Features

- **🌐 Site Provisioning & Door Groups**: Group doors across multiple controllers (e.g., "All Ground Floor") and provision cards to an entire site in a single click.
- **🔐 Secure Authentication**: Integrated OIDC support (tested with Keycloak) ensures only authorized administrators can access the controller network.
- **💾 Persistent Storage**: SQLite backend saves your controller metadata, custom names, network configurations, and event history permanently.
- **🛠️ Hardware Management**:
  - Remote door unlocking and status checks.
  - Remote IP/Netmask/Gateway reconfiguration.
  - Time synchronization with server time.
  - Configuration of UDP event listeners.
- **📊 Real-time Monitoring**:
  - Live security log showing access events as they happen.
  - Persistent historical audit log of all card swipes and system events.
  - Smart health-probing for controllers across different subnets.
- **📇 Card Management**: Full support for expiry dates (Valid From/To), multi-door permissions, and PIN codes.

## 🏗️ Architecture

- **Backend**: Node.js, Express, `uhppoted` UDP driver.
- **Database**: SQLite (`better-sqlite3`) for low-latency persistence.
- **Frontend**: Vanilla JS (ES6+), Bootstrap 5, Bootstrap Icons.
- **Proxy**: Nginx configured for SSL termination and large OIDC header support.

## 📋 Prerequisites

- **UHPPOTE Controllers** (1, 2, or 4-door models).
- **Node.js** v18+
- **Keycloak** or another OIDC provider.
- **Nginx** (for reverse proxy and SSL).

## 🛠️ Installation & Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/your-repo/door-control-pro.git
   cd door-control-pro
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file based on the template:
   ```env
   PORT=4000
   BASE_URL=https://your-domain.com
   OIDC_ISSUER_URL=https://your-keycloak/realms/master
   OIDC_CLIENT_ID=acs
   OIDC_CLIENT_SECRET=your-secret
   OIDC_SECRET=random-session-secret
   
   UHPPOTE_BIND=0.0.0.0
   UHPPOTE_BROADCAST=192.168.1.255:60000
   UHPPOTE_LISTEN=0.0.0.0:60001
   ```

3. **Deploy with Systemd**:
   ```bash
   sudo cp door-controller.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now door-controller
   ```

4. **Nginx Configuration**:
   Ensure your Nginx proxy buffers are large enough for OIDC tokens:
   ```nginx
   proxy_buffer_size          128k;
   proxy_buffers              4 256k;
   proxy_busy_buffers_size    256k;
   ```

## 📖 Usage

1. **Discovery**: Go to the **Dashboard** and click "Start Scan" to find controllers on your LAN.
2. **Setup**: Go to **Controllers**, click "Add" on discovered devices, then use the **Details (Gear icon)** to give them friendly names and configure door counts.
3. **Grouping**: Use the **Door Groups** tab to create a group like "Office" containing doors from multiple controllers.
4. **Provisioning**: In the Door Groups tab, use the **Provision Site** form to push a card to every door in a group at once.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Disclaimer: This software is provided "as is" without warranty of any kind. Use caution when remotely reconfiguring hardware IP addresses.*
