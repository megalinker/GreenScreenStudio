# Green Screen Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/Demo-live-brightgreen)](https://7ul7b-kyaaa-aaaag-qnh7a-cai.icp0.io/)

A cross-platform web application and companion desktop service for high-performance green screen keying, preview generation, and video export. Ideal for creators who need local, secure, and fast chroma-key processing without uploading their media to the cloud.

---

## 📺 Live Demo

Try it now at: [https://7ul7b-kyaaa-aaaag-qnh7a-cai.icp0.io/](https://7ul7b-kyaaa-aaaag-qnh7a-cai.icp0.io/)

---

## 🚀 Features

* **Real-time Preview**: Generate low-latency, low-resolution video previews via WebSocket (flask-sock).
* **Final Export**: Full-quality export to MP4, ProRes (with alpha), WebM, or GIF using FFmpeg.
* **Transparent Background**: Export ProRes 4444 MOV files with alpha channel.
* **Drag & Drop**: Intuitive file inputs with live thumbnails and media property extraction.
* **Chroma Key Controls**: Pick key color via EyeDropper API, adjust similarity & blend.
* **Transform**: Scale, translate, and reset foreground/background layers with Konva.js.
* **Timeline Trimming**: Interactive timeline for start/end trimming and scrubbing.
* **Theming**: Light/dark mode via React context + CSS variables.
* **Security**: Content Security Policy (CSP) configured to limit all resources to trusted origins.
* **Open Source**: MIT licensed, fully inspectable code.

---

## 🏗 Architecture Overview

```text
Frontend (React + Vite)
├── FileInput           // Drag & drop media selection
├── Previewer           // Konva canvas & WebSocket preview
├── CollapsibleSection  // Step-by-step controls
├── Timeline            // Trim & scrub UI
├── ConnectionStatus    // Companion health check UI
└── ThemeToggleButton   // Light/dark mode

Backend (Flask + waitress)
├── /api/process                // Upload source/background + settings
├── /api/process-preview/<id>   // Queue low-res preview task
├── /api/export/<id>            // Queue final export task
├── /api/status/<id>            // Poll job status & progress
├── /api/preview-video/<id>     // Download low-res preview
├── /api/download/<id>          // Download final output
└── WebSocket `/api/preview`    // Real-time preview frame updates
```

---

## 🛠 Tech Stack

* **Frontend**: React, TypeScript, Vite, react-konva, Konva, use-image, CSS Modules
* **Backend**: Python 3.x, Flask, Flask-Cors, flask-sock, waitress, FFmpeg
* **Packaging**: Companion App built for Windows/macOS/Linux via GitHub Actions
* **Security**: CSP headers, CORS restricted, DNT-enabled embeds

---

## 🔧 Prerequisites

* **FFmpeg** installed and available on your PATH.
* **Python 3.8+**
* **Node.js 16+** and **npm** or **Yarn**
* **Git**

---

## 📥 Installation

### Clone the Repo

```bash
git clone https://github.com/megalinker/GreenScreenStudio.git
git checkout main
```

### Backend Setup

```bash
cd companion-app
python3 -m venv venv
source venv/bin/activate      # macOS / Linux
venv\Scripts\activate       # Windows
pip install -r requirements.txt
```

### Frontend Setup

```bash
cd ../frontend
yarn install            # or npm install
yarn start                # or npm start
```

---

## ⚙️ Configuration

### Environment Variables

* `COMPANION_URL` (default: `http://localhost:5000/health`)
* `API_URL` (default: `http://localhost:5000`)

Customize by creating a `.env` file in `frontend/`:

```ini
VITE_API_URL=http://localhost:5000
```

### Content Security Policy (CSP)

A strong CSP is enforced via HTTP headers in the Flask service. Example policy:

```python
@app.after_request
def apply_csp(response):
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "connect-src 'self' ws://localhost:5000; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline';"
    )
    return response
```

Ensure to update hostname and ports for production deployments.

---

## 🏃‍♂️ Running Locally

1. **Start the companion service** (in `companion-app`):

   ```bash
   python server.py
   ```
2. **Start the React frontend** (in `frontend`):

   ```bash
   yarn start
   ```

yarn start

```
3. **Open** your browser at [`http://localhost:3000`](http://localhost:3000) or the demo link.

---

## 🎬 Usage

1. Launch the web app.
2. Download & run the Companion App from GitHub Releases.
3. Upload your source video and background image/video.
4. Adjust keying settings and transforms.
5. Generate a quick preview to verify.
6. Export in your desired format and download.

---

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/...`).
3. Commit your changes (`git commit -m 'Add feature'`).
4. Push to your fork (`git push origin feature/...`).
5. Open a Pull Request.

Please follow the [Contributor Code of Conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- FFmpeg team for powerful media processing.
- Konva.js and react-konva for canvas abstractions.
- Flask and flask-sock communities for seamless backend websockets.
- Inspired by open-source green screen solutions.

---

Happy chroma-keying! 🎬

```
