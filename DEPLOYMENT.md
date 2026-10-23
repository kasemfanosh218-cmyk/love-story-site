# Deployment Guide

This app is a full-stack Node/Express site. It needs persistent disk storage for:

- `database.json`
- session files
- uploaded photos and music

Do not deploy it to static-only hosting like Netlify static sites, GitHub Pages, or Vercel serverless without external storage. File uploads need a persistent volume.

## Recommended: Render

Render is the simplest option for this code because it supports Node web services and persistent disks.

1. Create a GitHub repository and push this folder: `mockups/love_story_site`.
2. Go to Render: `https://render.com`.
3. Create a new `Blueprint` service.
4. Connect the GitHub repository.
5. Select the repository and let Render read `render.yaml`.
6. Confirm the service settings.
7. Keep the persistent disk enabled at mount path `/var/data`.
8. Deploy.
9. Open the generated Render URL, for example `https://moonlit-love-diary.onrender.com`.
10. In Render dashboard, open Environment and copy the generated `ADMIN_PASSWORD` value before first login.
11. Login with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
12. Immediately change the admin password inside the website.

The final public URL is shown in the Render service dashboard after deploy.

## Manual Render Web Service Setup

Use this if you do not use the blueprint.

1. Create `New Web Service`.
2. Runtime: `Node`.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Add a persistent disk:
   Mount path: `/var/data`
   Size: `1 GB` or larger.
6. Add environment variables:
   `NODE_ENV=production`
   `PERSISTENT_DIR=/var/data`
   `SESSION_SECRET=<generate a long random string>`
   `ADMIN_EMAIL=<your admin email>`
   `ADMIN_PASSWORD=<temporary strong password>`
7. Deploy and open the public URL Render provides.

## Railway Alternative

1. Push this folder to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add a Volume.
4. Mount it at `/data`.
5. Add environment variables:
   `NODE_ENV=production`
   `PERSISTENT_DIR=/data`
   `SESSION_SECRET=<generate a long random string>`
   `ADMIN_EMAIL=<your admin email>`
   `ADMIN_PASSWORD=<temporary strong password>`
6. Railway should detect Node automatically.
7. If needed, set start command to `npm start`.
8. Generate a public domain from Railway settings.

## Important Notes

- The app intentionally limits accounts to 3 users total.
- Uploaded files are stored in the persistent volume under `uploads/`.
- The database is stored in the persistent volume under `data/database.json`.
- Backups can be downloaded from the admin dashboard.
- For production, use a strong `SESSION_SECRET` and change the seeded admin password after first login.
