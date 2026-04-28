# 🔩 3D Exploded View Viewer — Angular 17 + Three.js

Ek **Angular 17** application jo 3D models ke parts ko explode karke individually dekh sakti hai.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔩 Demo Engine | Built-in engine model (Engine Block, Pistons, Crankshaft, etc.) |
| 💥 Explode View | Smooth animated explode/implode with slider |
| 👁 Part Visibility | Har part ko individually show/hide karo |
| 🖱 Click to Select | 3D viewport mein part click karke info dekho |
| 📂 GLB Upload | Apna khud ka `.glb` / `.gltf` file drag-drop ya browse karke load karo |
| 🔲 Wireframe Mode | Toggle wireframe view |
| 🎥 Orbit Controls | Mouse se rotate, pan, zoom |

---

## 🚀 Setup & Run

### Step 1 — Prerequisites
```bash
node --version   # >= 18
npm --version    # >= 9
```

### Step 2 — Install dependencies
```bash
cd exploded-viewer
npm install
```

### Step 3 — Start dev server
```bash
npm start
# Browser mein khulega: http://localhost:4200
```

### Step 4 — Production build
```bash
npm run build
# Output: dist/exploded-viewer/
```

---

## 📁 Project Structure

```
src/
├── app/
│   ├── components/
│   │   └── viewer/
│   │       └── three-viewer.component.ts   ← 3D engine (Three.js)
│   ├── services/
│   │   └── model.service.ts               ← GLB loader + demo model
│   ├── app.component.ts                   ← Main controller
│   ├── app.component.html                 ← UI template
│   ├── app.component.scss                 ← Styles
│   └── app.config.ts
├── main.ts
├── index.html
└── styles.scss
```

---

## 🎮 Controls

| Action | How |
|---|---|
| Rotate | Left mouse drag |
| Pan | Right mouse drag |
| Zoom | Scroll wheel |
| Select part | Click on mesh |
| Explode | Slider ya preset buttons |
| Toggle visibility | Eye icon in parts list |
| Load custom model | Upload button ya drag-drop |

---

## 🔧 Apna GLB Model Load Kaise Karein

1. Koi bhi GLB/GLTF model lo (Sketchfab, Blender export, etc.)
2. "Upload GLB" button click karo ya viewport par drag-drop karo
3. Model load hoga aur sab meshes parts list mein dikhenge
4. Slider se explode karo!

> **Tip**: Blender mein model ke parts alag-alag objects hone chahiye for best explode effect.

---

## 🛠 Tech Stack

- **Angular 17** (Standalone components, Signals-ready)
- **Three.js r169** (WebGL rendering)
- **GLTFLoader** (GLB/GLTF support)
- **OrbitControls** (Camera interaction)
- **SCSS** (Dark industrial theme)
