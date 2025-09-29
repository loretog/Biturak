# Negative Blocks Shooter (Web)

Fast-paced top-down shooter prototype with auto-fire, descending enemies, and special negative number blocks that grant scaling power when collided with.

## Run locally

Open `index.html` in a modern browser, or serve with a simple static server.

PowerShell (one-liner using Python):

```powershell
python -m http.server 5173 --directory .
```

Then open `http://localhost:5173/index.html`.

## Controls
- Move: Arrow Left/Right or A/D
- Fire: Automatic

## Core Mechanics
- Shooting a negative block increases its value toward zero; popping it grants a small score.
- Colliding with a negative block grants temporary buffs scaled by its magnitude.
- Enemies descend; clear waves to progress.

## Files
- `index.html`: Canvas and UI
- `style.css`: Minimal styling
- `src/main.js`: Game loop and core systems
