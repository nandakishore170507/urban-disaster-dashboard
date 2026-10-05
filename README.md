# 🚨 Aegis — Urban Disaster & Emergency Command Dashboard

<div align="center">

> **A real-time, mission-critical operations grid for urban hazard monitoring, automated incident reporting, GIS spatial tracking, and emergency resource dispatch.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Live%20Operations-red.svg)]()
[![Stack](https://img.shields.io/badge/Stack-Node.js%20%7C%20Supabase%20%7C%20Leaflet%20GIS-38bdf8.svg)]()

---

### 🎬 Launch Video & Interactive Trailer

You can preview the Aegis launch trailer directly in your browser:
👉 **[Open the Aegis Launch Trailer (`launch_video.html`)](launch_video.html)**

This is an animated video simulator built with HTML, CSS, and JavaScript. To create an MP4, open the page and record it with Windows Capture (`Win + Alt + R`) or OBS, then upload the exported video separately to GitHub or a GitHub Release.

</div>

---

## ⚡ Core Capabilities

- 🛰️ **Situation Room Command**: Real-time operational overview with live incident feeds, risk metrics, and monsoon surge advisories.
- 🗺️ **GIS Risk Intelligence Map**: Interactive spatial visualization powered by Leaflet with multi-layer overlays (Risk, Rainfall, and Field Resources).
- 🚨 **Rapid Incident Reporting**: Global geocoding location autocomplete, severity classification, and instant photo upload via Supabase Storage.
- 🚑 **Field Team Dispatch**: Live team tracking (`Alpha 01`, `Medical 03`, `Utility 02`) with automated status and ETA calculations.
- 📊 **Public Alert Reach & Shelters**: Historical alert broadcast analytics and live bed capacity tracking across municipal flood zones.

---

## 🏗️ Architecture & Stack

- **Frontend**: Vanilla JavaScript (ES Modules), Custom Responsive CSS with Glassmorphism, Leaflet GIS.
- **Backend API**: Node.js & Express server with secure in-memory fallback and Supabase Service Role integration.
- **Database & Storage**: Supabase PostgreSQL with custom transactional functions (`dispatch_incident`) and signed private storage buckets (`incident-photos`).

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- (Optional) Supabase Project for persistent cloud storage

### 1. Installation
```powershell
# Clone the repository
git clone https://github.com/nandakishore170507/urban-disaster-dashboard.git

# Navigate into project directory
cd urban-disaster-dashboard

# Install dependencies
npm install
```

### 2. Configure Environment (Optional for Supabase)
Copy the example environment file:
```powershell
cp .env.example .env
```
Fill in your credentials:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-or-secret-key
```
*(If no keys are provided, Aegis seamlessly operates with rich built-in in-memory demonstration telemetry).*

### 3. Run Locally
```powershell
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🗄️ Supabase Setup

1. Open the **SQL Editor** in your Supabase dashboard.
2. Execute [`supabase/schema.sql`](supabase/schema.sql) to generate the tables, transactional dispatch function, and initial seed data.
3. Create a private bucket named `incident-photos` under **Storage**.

---

## 📜 License
Distributed under the MIT License.
