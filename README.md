# Neon Arena

A blocky, neon-lit first-person arena shooter built with Three.js — sprint, double-jump,
wall-run, and grapple your way around an arena full of AI bots.

## Run it locally

```bash
npm install
npm start
```

Then open http://localhost:3000

## Project structure

```
neon-arena/
├── public/
│   └── index.html   ← the entire game (Three.js, all in one file)
├── server.js         ← tiny Express server that serves public/
└── package.json
```

## Deploying

This repo is set up to deploy on Railway with zero configuration — Railway detects the
Node app, runs `npm install` and `npm start` automatically.
