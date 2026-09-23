# PlayerServer white-label theme

This is a local theme override scaffold for the Xibo CMS reference container.
It does not rename API routes, image names, PHP namespaces, or the upstream
source; it only supplies the operator-facing **Player Server** styling layer.
The official Xibo white-label flow normally provides a complete theme archive
and may require a white-label licence. This scaffold is therefore a local
prototype aid, not a claim that the upstream trademark/source links have been
legally removed.

## Apply it

1. Stop the reference stack without deleting volumes: `docker compose stop`.
2. From `reference-xibo`, recreate the web container so the bind mount is
   applied: `docker compose up -d --force-recreate cms-web`.
3. Open `http://127.0.0.1:8088`, sign in, then open
   **Administration → Settings → Configuration**.
4. If the CMS theme selector lists `PlayerServer`, choose it, save, and clear
   the CMS cache (Shift+F5) if prompted. A stock image may not list an
   arbitrary folder as a selectable theme; in that case use the official
   white-label archive/build for the deployment and keep this folder as the
   CSS/mount reference.

The compose file mounts this directory at
`/var/www/cms/web/theme/custom`. The theme must be explicitly selected in the
CMS; changing a string in Player Control cannot change the separate CMS.

Official procedure: [Xibo CMS white-label theme administration](https://account.xibosignage.com/docs/setup/xibo-cms-white-label-theme-administration).

The upstream CMS remains a separate open-source component. Keep its legal
notices and review Xibo licensing requirements before distributing a branded
build outside the local prototype.
