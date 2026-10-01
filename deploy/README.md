# Deploying Borga on Oracle Cloud Always Free

One VM runs everything: the app, MySQL 8, and Caddy (automatic HTTPS). Webhooks from Twilio and Meta need that public HTTPS address.
Status: written and reviewed, **not yet run on a real Oracle VM** (see "First deploy" for the checks that prove it).

## 1. Create the VM
- Oracle Cloud → Compute → Create instance → **Ampere A1 (VM.Standard.A1.Flex)**, 2 OCPU / 12 GB is plenty, Ubuntu 24.04. (If A1 capacity is unavailable in your region, try another availability domain later; the AMD micro shape is too small for Next + MySQL.)
- Networking: add ingress rules for **TCP 80 and 443** to the subnet's security list. Keep 22 restricted to your IP.
- Ubuntu images also ship an iptables policy: `sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`.
- Reserve a **public IP** and point a DNS **A record** (your domain, or a free DuckDNS name) at it.

## 2. Install
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker $USER && newgrp docker
sudo git clone <your-repo-url> /opt/borga && sudo chown -R $USER /opt/borga
cd /opt/borga/deploy
cp .env.example .env && chmod 600 .env     # then edit: DOMAIN, passwords, secrets (openssl rand -hex 32), SMTP
docker compose up -d --build
```
Use hex passwords (`openssl rand -hex 24`) so the `DATABASE_URL` needs no URL-escaping.

## 3. Schedule cron + backups (systemd)
```bash
sudo cp systemd/borga-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now borga-cron.timer borga-backup.timer
systemctl list-timers 'borga-*'
```
The cron timer calls `POST /api/borga/cron` every 5 minutes: heartbeat, IMAP mailbox poll, SLA sweep, integration syncs. It also keeps the VM busy, which helps against Oracle's idle-reclamation of Always Free instances.

## 4. First deploy checks
1. `curl -fsS https://$DOMAIN/api/health` → `"db":"connected"`.
2. Sign up at `https://$DOMAIN/signup`, create the first company.
3. `sudo systemctl start borga-cron.service && journalctl -u borga-cron -n 5` → HTTP 200 JSON.
4. `./backup.sh` → `ok backups/borga-….sql.gz`; test a restore into a scratch DB once.
5. Integrations → Connections: add Twilio/Meta, press **Test connection**, copy the shown webhook URLs into Twilio/Meta.

## Operations
- Update: `./update.sh` (backs up first, pulls, rebuilds).
- Logs: `docker compose logs -f app`.
- Backups are local to the VM. Copy them off-box (e.g. Oracle Object Storage free tier, `rclone`) before trusting them.
- `docker compose down` keeps data; `down -v` **deletes the database volume**.
- Outbound port 25 is blocked on Oracle; use an SMTP provider on 587/465.

## Startup checks

The app exits at startup (see `docker compose logs app`) if `SESSION_SECRET`, `BORGA_SECRET_KEY` or `DATABASE_URL` is missing, too short or a placeholder. Generate each secret with `openssl rand -hex 32`. Missing `CRON_SECRET`, `SMTP_HOST` or `APP_URL` only logs a warning, but without `CRON_SECRET` the timers cannot trigger the heartbeat, SLA, mail and sync jobs.

## Administrators and signup

Set `BORGA_OPERATOR_EMAILS` to the administrator email(s) before the first start (the server refuses to start without it). Each listed address can always create an account, change the shared API keys under Integrations, and issue invites under Settings, Signup invitations. Everyone else needs a single-use invite link from an administrator. `SIGNUP_MODE` is `invite` by default; use `closed` to stop all new signups, or `open` only for a public product (the server warns).

## First-run checklist (nothing here has been run yet)

Do these in order on the VM and stop at the first failure. Each line says what a pass looks like.

1. `docker compose build` finishes. (It builds Next.js on the VM; expect several minutes.)
2. `docker compose up -d`, then `docker compose ps`: `db` is healthy, `app` is up, `caddy` is up.
3. `docker compose logs app` shows "Ready" and no "Refusing to start" (that message lists exactly which secret is missing).
4. `curl -s http://127.0.0.1:13000/api/health` shows `"db":"connected"`.
5. `https://YOUR_DOMAIN/login` loads over HTTPS with a valid certificate (DNS must already point at the VM and ports 80 and 443 must be open in the Oracle security list and the VM firewall).
6. Sign up with an address from `BORGA_OPERATOR_EMAILS`, then create an invite under Settings and sign up a second address with it.
7. Install the systemd timers, then `sudo systemctl start borga-cron.service` and `journalctl -u borga-cron.service -n 20`: it must print JSON with `"ok":true`, not a 401.
8. Run `./backup.sh`, then restore that file into a scratch database to prove the backup is usable (command in the header of `backup.sh`).
9. Copy a backup off the VM. A backup on the same disk does not survive losing the VM.
